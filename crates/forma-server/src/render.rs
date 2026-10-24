//! Checked document rendering and per-request metadata.
//! Server rendering is entered only through a finalized bound page handle.

use crate::csp::{self, CspNonce, NonceError, PolicyError, PolicyExtensions};
use crate::head::{HeadLink, ModulePreloads};
use crate::response::{PageResponse, RenderCounts};
use crate::types::PageConfig;
use forma_ir::{IrError, WalkLimits};
use std::fmt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::Instant;

/// What a render takes beyond [`PageConfig`]: the policy's typed extensions,
/// the walk's budgets, and the typed homes for what applications used to put
/// in `body_prefix`: the route's `modulepreload` links from the
/// build's manifest, and head links. Never a nonce: the render draws one per
/// response. Data goes through [`PageConfig::config_json`].
///
/// ```
/// use forma_server::{HeadLink, PolicyExtensions, RenderCtx, WalkLimits};
///
/// let ctx = RenderCtx::new()
///     .with_policy(PolicyExtensions::new().img_src("https:"))
///     .with_limits(WalkLimits { max_list_iterations: 100_000, ..WalkLimits::default() })
///     .with_head_link(HeadLink::new("icon", "/favicon.svg")?);
/// # let _ = ctx;
/// # Ok::<(), forma_server::HeadLinkError>(())
/// ```
#[derive(Debug, Clone, Default)]
pub struct RenderCtx {
    policy: PolicyExtensions,
    limits: Option<WalkLimits>,
    module_preloads: Option<ModulePreloads>,
    head_links: Vec<HeadLink>,
    title: Option<String>,
    body_class: Option<String>,
    config_json: Option<serde_json::Value>,
    personality_css: Option<String>,
    body_prefix: Option<crate::RawHtml>,
}

impl RenderCtx {
    /// The strict policy with limits inherited from the bound page.
    pub fn new() -> Self {
        Self::default()
    }

    /// Override the bound page's document title for this request; escaped as text.
    #[must_use]
    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    /// Set this request's body class; escaped as an attribute.
    #[must_use]
    pub fn with_body_class(mut self, class: impl Into<String>) -> Self {
        self.body_class = Some(class.into());
        self
    }

    /// Request data assigned to `window.__FORMA_CONFIG__` by a nonced script.
    /// Static SSR routes refuse this executable configuration with `RENDER-105`.
    #[must_use]
    pub fn with_config_json(mut self, value: serde_json::Value) -> Self {
        self.config_json = Some(value);
        self
    }

    /// Request branding CSS. The document writer neutralizes style end tags.
    #[must_use]
    pub fn with_personality_css(mut self, css: impl Into<String>) -> Self {
        self.personality_css = Some(css.into());
        self
    }

    /// Explicit trusted markup before the page root; plain strings do not satisfy this API.
    #[must_use]
    pub fn with_body_prefix(mut self, html: crate::RawHtml) -> Self {
        self.body_prefix = Some(html);
        self
    }

    pub(crate) fn config_json(&self) -> Option<&serde_json::Value> {
        self.config_json.as_ref()
    }
    pub(crate) fn personality_css(&self) -> Option<&str> {
        self.personality_css.as_deref()
    }
    pub(crate) fn body_prefix(&self) -> Option<&crate::RawHtml> {
        self.body_prefix.as_ref()
    }

    pub(crate) fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }
    pub(crate) fn body_class(&self) -> Option<&str> {
        self.body_class.as_deref()
    }

    /// Extend this page's policy (see [`PolicyExtensions`]).
    #[must_use]
    pub fn with_policy(mut self, policy: PolicyExtensions) -> Self {
        self.policy = policy;
        self
    }

    /// Override both walk budgets for this request only. Without this call,
    /// the handle's bind-time limits apply. Use its `limits()` value with struct
    /// update syntax to change just one budget.
    #[must_use]
    pub fn with_limits(mut self, limits: WalkLimits) -> Self {
        self.limits = Some(limits);
        self
    }

    /// Use the bound page's limits unless this request explicitly overrides them.
    pub(crate) fn limits(&self, inherited: WalkLimits) -> WalkLimits {
        self.limits.unwrap_or(inherited)
    }

    /// Write the route's `modulepreload` links from the build's manifest,
    /// each with the page's nonce, after the route's own modules. The
    /// typed home for a preload workaround in `body_prefix`, such as
    /// Ledger's. The table covers every route; the render takes
    /// `config.route_pattern`'s list. Like every typed home, each call site
    /// belongs on the application's raw-entry allowlist (`forma-raw-lint`).
    ///
    /// ```no_run
    /// use forma_server::{assets, ModulePreloads, RenderCtx};
    ///
    /// // At start, beside the manifest; refuse to start on its error.
    /// fn start<Assets: rust_embed::Embed>() -> Result<ModulePreloads, String> {
    ///     assets::try_load_module_preloads::<Assets>()
    /// }
    ///
    /// // Per request.
    /// fn ctx(preloads: &ModulePreloads) -> RenderCtx {
    ///     RenderCtx::new().with_module_preloads(preloads)
    /// }
    /// ```
    ///
    /// Verified by: crates/forma-server/tests/internal_renderer/typed_homes.rs > "try_render_writes_the_routes_manifest_modulepreload_links_nonced"
    #[must_use]
    pub fn with_module_preloads(mut self, preloads: &ModulePreloads) -> Self {
        self.module_preloads = Some(preloads.clone());
        self
    }

    /// Add a `<link>` to the page's head (see [`HeadLink`]), after any added
    /// before it. The typed home for links spliced in before `</head>`; each
    /// call site belongs on the application's raw-entry allowlist
    /// (`forma-raw-lint`).
    ///
    /// Verified by: crates/forma-server/tests/internal_renderer/typed_homes.rs > "head_links_are_written_escaped_in_the_head_in_the_order_added"
    #[must_use]
    pub fn with_head_link(mut self, link: HeadLink) -> Self {
        self.head_links.push(link);
        self
    }

    /// The route's manifest preloads, empty without a table.
    pub(crate) fn module_preloads(&self, route_pattern: &str) -> &[String] {
        self.module_preloads
            .as_ref()
            .map_or(&[], |table| table.route(route_pattern))
    }

    /// The head links, in the order added.
    pub(crate) fn head_links(&self) -> &[HeadLink] {
        &self.head_links
    }
}

/// Why a page was not rendered. Nothing reaches the browser unless the
/// handler sends it: answer with the application's own error page.
///
/// Every error has a stable [`code`](RenderError::code), the
/// [`route`](RenderError::route) it was rendering, and the
/// [`component_path`](RenderError::component_path) where it stopped (empty
/// when the failure is not inside a component). The codes, by family:
///
/// | Code | Variant | Cause |
/// |---|---|---|
/// | RENDER-101 | [`MissingModule`](RenderError::MissingModule) | The config has no module or no slots to render |
/// | RENDER-104 | [`Manifest`](RenderError::Manifest) | Invalid manifest or referenced integrity |
/// | RENDER-105 | [`StaticRoute`](RenderError::StaticRoute) | A static SSR route requires JavaScript for islands, configuration or preloads |
/// | RENDER-103 | [`RouteMode`](RenderError::RouteMode) | A shell route is absent or not Browser |
/// | RENDER-406 | [`Unfinalized`](RenderError::Unfinalized) | Required startup finalization is incomplete |
/// | RENDER-102 | [`Walk`](RenderError::Walk) | The walk refused the module or its data |
/// | RENDER-503 | [`Walk`](RenderError::Walk) | A keyed list row has no usable identity, repeats another row's key, or has no single root to carry it (FORMA-181) |
/// | RENDER-201 | [`Policy`](RenderError::Policy) | A policy extension is not a source a page may add |
/// | RENDER-202 | [`Nonce`](RenderError::Nonce) | The system random source failed to draw a nonce |
/// | RENDER-301 | [`Budget`](RenderError::Budget) | The complete escaped response passed `max_output_bytes` |
/// | RENDER-302 | [`Budget`](RenderError::Budget) | The walk's list rows passed `max_list_iterations` |
/// | RENDER-303 | [`Budget`](RenderError::Budget) | Lists or control flow nested past the walker's depth |
/// | RENDER-501 | [`IslandState`](RenderError::IslandState) | Declared island input mapping or value is invalid |
/// | RENDER-502 | [`IslandState`](RenderError::IslandState) | Escaped island state exceeds one MiB |
/// | RENDER-399 | [`Fault`](RenderError::Fault) | The render panicked; a defect, not an input |
///
/// A code, once published, keeps its meaning; new causes get new codes.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum RenderError {
    /// RENDER-105: a static SSR route cannot execute or preload JavaScript.
    #[non_exhaustive]
    StaticRoute {
        /// The requested route.
        route: String,
        /// The incompatible island, configuration or preload contract.
        message: String,
    },
    /// RENDER-104: manifest or referenced resource integrity is invalid.
    #[non_exhaustive]
    Manifest {
        /// The requested route.
        route: String,
        /// Manifest validation failure or the resource whose integrity is unavailable.
        message: String,
    },
    /// RENDER-103: a browser shell requires an explicitly declared browser route.
    #[non_exhaustive]
    RouteMode {
        /// The requested route.
        route: String,
    },
    /// RENDER-406: every SSR handler must bind and the registry must finalize first.
    #[non_exhaustive]
    Unfinalized {
        /// The bound route.
        route: String,
    },
    /// RENDER-401..404: a handler value violates its declared contract.
    #[non_exhaustive]
    Props {
        /// Checked value error, including its declared property path and sources.
        cause: forma_ir::props::PropsError,
    },
    /// RENDER-405: a development reload no longer matches the bound handler.
    #[non_exhaustive]
    Binding {
        /// Bound route.
        route: String,
        /// Binding refusals for the changed module. No partial HTML is returned.
        errors: Vec<forma_ir::props::PropsError>,
    },
    /// RENDER-101: Server rendering, and the config
    /// carries no module or no slots for it. A browser-rendered route is
    /// served by [`render_browser_shell`], by declaration.
    #[non_exhaustive]
    MissingModule {
        /// The route being rendered.
        route: String,
    },
    /// RENDER-102: the walk refused the module or the data it was given.
    #[non_exhaustive]
    Walk {
        /// The route being rendered.
        route: String,
        /// The islands open where the walk stopped, outermost first.
        component_path: Vec<String>,
        /// How far the walk got.
        counts: RenderCounts,
        /// The walker's error.
        cause: IrError,
    },
    /// RENDER-501 or RENDER-502: no partial state or page is returned.
    #[non_exhaustive]
    IslandState {
        /// Route whose island state was refused.
        route: String,
        /// Open island registration names, outermost first.
        component_path: Vec<String>,
        /// Body walk work completed before refusal.
        counts: RenderCounts,
        /// The invalid field path or fixed state-byte ceiling.
        cause: IrError,
    },
    /// RENDER-201: a policy extension was refused; there is no page to send
    /// without its policy.
    #[non_exhaustive]
    Policy {
        /// The route being rendered.
        route: String,
        /// The refused extension.
        cause: PolicyError,
    },
    /// RENDER-202: no nonce could be drawn, so no policy could bless the page.
    #[non_exhaustive]
    Nonce {
        /// The route being rendered.
        route: String,
        /// The failed draw.
        cause: NonceError,
    },
    /// RENDER-301, RENDER-302, RENDER-303: the complete response exceeded
    /// its output-byte limit, or the walk reached a list/depth budget.
    #[non_exhaustive]
    Budget {
        /// The route being rendered.
        route: String,
        /// The islands open where the walk stopped, outermost first.
        component_path: Vec<String>,
        /// Body-only walk work, including when complete response assembly refuses.
        counts: RenderCounts,
        /// The output, list, or depth budget that refused the response.
        cause: IrError,
    },
    /// RENDER-399: the render panicked and the panic was caught. The
    /// process and every other request carry on, while the application
    /// unwinds on panic; under `panic = "abort"` the process ends.
    #[non_exhaustive]
    Fault {
        /// The route being rendered.
        route: String,
        /// The islands open where the walk panicked, when it was in the walk.
        component_path: Vec<String>,
        /// How far the walk got, when it was in the walk.
        counts: RenderCounts,
        /// The panic's message.
        message: String,
    },
}

impl RenderError {
    /// The stable code, such as `RENDER-301`.
    pub fn code(&self) -> &'static str {
        match self {
            RenderError::StaticRoute { .. } => "RENDER-105",
            RenderError::Manifest { .. } => "RENDER-104",
            RenderError::RouteMode { .. } => "RENDER-103",
            RenderError::Unfinalized { .. } => "RENDER-406",
            RenderError::Props { cause } => cause.code(),
            RenderError::Binding { .. } => "RENDER-405",
            RenderError::MissingModule { .. } => "RENDER-101",
            RenderError::Walk { cause, .. } => match cause {
                // A published code keeps its meaning; the keyed-row refusal
                // is a new cause with its own code (FORMA-181, DR-8).
                IrError::InvalidListKey(_) => "RENDER-503",
                _ => "RENDER-102",
            },
            RenderError::IslandState { cause, .. } => match cause {
                IrError::IslandStateLimitExceeded { .. } => "RENDER-502",
                IrError::InvalidIslandState(_) => "RENDER-501",
                _ => "RENDER-501",
            },
            RenderError::Policy { .. } => "RENDER-201",
            RenderError::Nonce { .. } => "RENDER-202",
            RenderError::Budget { cause, .. } => match cause {
                IrError::OutputLimitExceeded { .. } => "RENDER-301",
                IrError::ListBudgetExceeded { .. } => "RENDER-302",
                _ => "RENDER-303",
            },
            RenderError::Fault { .. } => "RENDER-399",
        }
    }

    /// The route pattern the render was for.
    pub fn route(&self) -> &str {
        match self {
            RenderError::StaticRoute { route, .. }
            | RenderError::Manifest { route, .. }
            | RenderError::RouteMode { route }
            | RenderError::Unfinalized { route } => route,
            RenderError::Props { cause } => cause.route(),
            RenderError::Binding { route, .. } => route,
            RenderError::MissingModule { route }
            | RenderError::Walk { route, .. }
            | RenderError::IslandState { route, .. }
            | RenderError::Policy { route, .. }
            | RenderError::Nonce { route, .. }
            | RenderError::Budget { route, .. }
            | RenderError::Fault { route, .. } => route,
        }
    }

    /// The declared property path of a checked-value refusal.
    pub fn property_path(&self) -> Option<&str> {
        match self {
            Self::Props { cause } => Some(cause.path()),
            Self::IslandState {
                cause: IrError::InvalidIslandState(problem),
                ..
            } => Some(&problem.path),
            _ => None,
        }
    }

    /// The component names of the islands open where the render stopped,
    /// outermost first; empty when it stopped outside every island or before
    /// the walk. A component the compiler inlined into its parent has no name
    /// until FMIR v3's source positions.
    pub fn component_path(&self) -> &[String] {
        match self {
            RenderError::Walk { component_path, .. }
            | RenderError::IslandState { component_path, .. }
            | RenderError::Budget { component_path, .. }
            | RenderError::Fault { component_path, .. } => component_path,
            _ => &[],
        }
    }

    /// How far the walk got, for an error raised during it.
    pub fn counts(&self) -> Option<RenderCounts> {
        match self {
            RenderError::Walk { counts, .. }
            | RenderError::IslandState { counts, .. }
            | RenderError::Budget { counts, .. }
            | RenderError::Fault { counts, .. } => Some(*counts),
            _ => None,
        }
    }
}

impl fmt::Display for RenderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.code(), self.route())?;
        let path = self.component_path();
        if !path.is_empty() {
            write!(f, " in {}", path.join(" > "))?;
        }
        match self {
            RenderError::StaticRoute { message, .. } | RenderError::Manifest { message, .. } => {
                write!(f, ": {message}")
            }
            RenderError::RouteMode { .. } => {
                write!(f, ": route is not explicitly browser-rendered")
            }
            RenderError::Unfinalized { .. } => write!(
                f,
                ": bind every SSR route and finalize Pages before serving"
            ),
            RenderError::Props { cause } => write!(f, ": {cause}"),
            RenderError::Binding { errors, .. } => {
                for error in errors {
                    write!(f, "; {error}")?;
                }
                Ok(())
            }
            RenderError::MissingModule { .. } => {
                write!(f, ": no module or slots to render on the server")
            }
            RenderError::Walk { cause, .. }
            | RenderError::IslandState { cause, .. }
            | RenderError::Budget { cause, .. } => {
                write!(f, ": {cause}")
            }
            RenderError::Policy { cause, .. } => write!(f, ": {cause}"),
            RenderError::Nonce { cause, .. } => write!(f, ": {cause}"),
            RenderError::Fault { message, .. } => write!(f, ": render panicked: {message}"),
        }?;
        if let Some(c) = self.counts() {
            write!(
                f,
                " (after {} nodes, {} bytes, {} list rows)",
                c.nodes, c.bytes, c.list_iterations
            )?;
        }
        Ok(())
    }
}

impl std::error::Error for RenderError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            RenderError::Walk { cause, .. }
            | RenderError::IslandState { cause, .. }
            | RenderError::Budget { cause, .. } => Some(cause),
            RenderError::Props { cause } => Some(cause),
            RenderError::Binding { errors, .. } => {
                errors.first().map(|error| error as &dyn std::error::Error)
            }
            RenderError::Policy { cause, .. } => Some(cause),
            RenderError::Nonce { cause, .. } => Some(cause),
            _ => None,
        }
    }
}

/// The sole private SSR entry: its module and slots come from a verified handle.
pub(crate) fn render_bound(
    config: &PageConfig,
    ctx: &RenderCtx,
    module: Option<&forma_ir::IrModule>,
    slots: Option<&forma_ir::SlotData>,
    limits: WalkLimits,
) -> Result<PageResponse, RenderError> {
    render_guarded(
        config,
        ctx,
        CspNonce::try_generate,
        Root::Walk {
            module,
            slots,
            limits,
        },
    )
}

/// Serve a route the build declares browser-rendered (`ssr: false`): the
/// nonced bundle and the same headers as any page, around an empty root.
///
/// By declaration, never in place of a failure: it does not walk. Unknown and
/// SSR routes are refused before document work. Policy, nonce and fault errors
/// retain the same response boundary as a bound SSR page.
///
/// Verified by: crates/forma-server/tests/internal_renderer/checked_render.rs > "render_browser_shell_serves_the_bundle_around_an_empty_root_with_the_page_headers"
pub fn render_browser_shell(
    config: &PageConfig,
    ctx: &RenderCtx,
) -> Result<PageResponse, RenderError> {
    if !config
        .manifest
        .route(config.route_pattern)
        .is_some_and(|route| route.mode == crate::RouteMode::Browser)
    {
        return Err(RenderError::RouteMode {
            route: config.route_pattern.into(),
        });
    }
    config
        .manifest
        .validate()
        .map_err(|message| RenderError::Manifest {
            route: config.route_pattern.into(),
            message,
        })?;
    render_guarded(config, ctx, CspNonce::try_generate, Root::Shell)
}

/// What goes in the page's root.
#[derive(Debug, Clone, Copy)]
enum Root<'a> {
    /// The walk's HTML.
    Walk {
        module: Option<&'a forma_ir::IrModule>,
        slots: Option<&'a forma_ir::SlotData>,
        limits: WalkLimits,
    },
    /// Nothing: the browser renders.
    Shell,
}

/// The render, with the nonce source a parameter so a test can make it fail,
/// inside the outer `catch_unwind`.
///
/// The walk catches its own panic, with the component path
/// (`forma_ir::walk_to_html_counted`); this guard covers the rest of the
/// render, which carries no `unwrap`, `expect` or `panic!` (the crate denies
/// them) and so has no known panic to catch.
fn render_guarded(
    config: &PageConfig,
    ctx: &RenderCtx,
    draw: impl FnOnce() -> Result<CspNonce, NonceError>,
    root: Root<'_>,
) -> Result<PageResponse, RenderError> {
    guard(config.route_pattern, || render(config, ctx, draw, root))
}

/// Catch request-side unwinds, including user-defined props conversion.
pub(crate) fn guard(
    route: &str,
    render: impl FnOnce() -> Result<PageResponse, RenderError>,
) -> Result<PageResponse, RenderError> {
    match catch_unwind(AssertUnwindSafe(render)) {
        Ok(result) => result,
        Err(payload) => Err(RenderError::Fault {
            route: route.to_string(),
            component_path: Vec::new(),
            counts: RenderCounts::default(),
            message: panic_message(payload.as_ref()),
        }),
    }
}

fn render(
    config: &PageConfig,
    ctx: &RenderCtx,
    draw: impl FnOnce() -> Result<CspNonce, NonceError>,
    root: Root<'_>,
) -> Result<PageResponse, RenderError> {
    let route = || config.route_pattern.to_string();
    let static_route = config
        .manifest
        .route(config.route_pattern)
        .is_some_and(crate::RouteAssets::is_static_ssr);
    if static_route {
        let message = if config.config_json.is_some() {
            Some("static SSR cannot execute config_json; publish a JavaScript entry for client configuration")
        } else if !ctx.module_preloads(config.route_pattern).is_empty()
            || config
                .manifest
                .route(config.route_pattern)
                .is_some_and(|assets| !assets.modulepreload.is_empty())
        {
            Some("static SSR cannot load module preloads; rebuild the route and its request preload table together")
        } else if matches!(root, Root::Walk { module: Some(module), .. } if !module.islands.is_empty())
        {
            Some("static SSR contains declared islands but has no JavaScript entry")
        } else {
            None
        };
        if let Some(message) = message {
            return Err(RenderError::StaticRoute {
                route: route(),
                message: message.into(),
            });
        }
    }
    let nonce = draw().map_err(|cause| RenderError::Nonce {
        route: route(),
        cause,
    })?;
    // The policy before the walk: an invalid extension costs no walk.
    let policy = csp::page_policy(&nonce, &ctx.policy).map_err(|cause| RenderError::Policy {
        route: route(),
        cause,
    })?;

    let output_limit = match root {
        Root::Walk { limits, .. } => limits.max_output_bytes,
        Root::Shell => ctx.limits(WalkLimits::default()).max_output_bytes,
    };
    let (ssr_body, island_state, counts) = match root {
        Root::Shell => (None, None, RenderCounts::default()),
        Root::Walk {
            module,
            slots,
            limits,
        } => {
            let (Some(module), Some(slots)) = (module, slots) else {
                return Err(RenderError::MissingModule { route: route() });
            };
            let started = Instant::now();
            let mode = if static_route {
                forma_ir::RenderMode::Static
            } else {
                forma_ir::RenderMode::Adoptable
            };
            let walked = forma_ir::walk_to_html_counted_with_mode(module, slots, limits, mode);
            let walk_time = started.elapsed();
            match walked {
                Ok(out) => (
                    Some(out.html),
                    (!static_route).then_some(out.island_state),
                    RenderCounts::from_walk(out.counts, walk_time),
                ),
                Err(failure) => {
                    let route = route();
                    let component_path = failure.component_path;
                    let counts = RenderCounts::from_walk(failure.counts, walk_time);
                    let cause = failure.error;
                    return Err(match cause {
                        IrError::InvalidIslandState(_)
                        | IrError::IslandStateLimitExceeded { .. } => RenderError::IslandState {
                            route,
                            component_path,
                            counts,
                            cause,
                        },
                        IrError::OutputLimitExceeded { .. }
                        | IrError::ListBudgetExceeded { .. }
                        | IrError::ListDepthExceeded { .. }
                        | IrError::RecursionLimitExceeded => RenderError::Budget {
                            route,
                            component_path,
                            counts,
                            cause,
                        },
                        IrError::Panicked { message } => RenderError::Fault {
                            route,
                            component_path,
                            counts,
                            message,
                        },
                        cause => RenderError::Walk {
                            route,
                            component_path,
                            counts,
                            cause,
                        },
                    });
                }
            }
        }
    };

    let html = crate::template::write_document(
        config,
        &nonce,
        ssr_body.as_deref(),
        island_state.as_ref(),
        ctx,
        output_limit,
        counts,
    )?;
    if let Some(reason) = policy.relaxed() {
        csp::log_relaxation(config.route_pattern, reason);
    }
    Ok(PageResponse::with_policy(html, nonce, policy, counts))
}

/// A panic payload's message: `panic!` with a literal gives a `&str`, with
/// formatting a `String`.
fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "a panic with no message".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AssetManifest;
    use std::collections::HashMap;

    fn manifest() -> AssetManifest {
        AssetManifest {
            version: 2,
            writer: "3.0.0".into(),
            app: "ledger".into(),
            aliases: HashMap::new(),
            build: "test".to_string(),
            assets: HashMap::new(),
            routes: HashMap::new(),
        }
    }

    #[allow(deprecated)]
    fn shell_config(manifest: &AssetManifest) -> PageConfig<'_> {
        PageConfig {
            title: "Seam",
            route_pattern: "/seam",
            manifest,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
        }
    }

    /// FORMA-181: a keyed-row refusal is a new cause of a refused walk with its own code;
    /// every other walk refusal keeps RENDER-102.
    #[test]
    fn a_keyed_row_refusal_is_render_503_and_other_walk_refusals_stay_render_102() {
        use forma_ir::{ListKeyReason, ListKeyViolation};
        let walk = |cause: IrError| RenderError::Walk {
            route: "/seam".into(),
            component_path: vec!["Rows".into()],
            counts: RenderCounts::default(),
            cause,
        };
        let keyed = walk(IrError::InvalidListKey(Box::new(ListKeyViolation::new(
            30,
            2,
            "user.id",
            ListKeyReason::Duplicate { first_row: 0 },
        ))));
        assert_eq!(keyed.code(), "RENDER-503");
        assert_eq!(keyed.component_path(), ["Rows".to_string()]);
        let text = keyed.to_string();
        assert!(
            text.contains("RENDER-503: LIST at bytecode offset 30, row 2, key path `user.id`: the row repeats the key row 0 already rendered"),
            "{text}"
        );
        assert_eq!(walk(IrError::InvalidOpcode(0xff)).code(), "RENDER-102");
    }

    #[test]
    fn static_island_mismatch_refuses_before_nonce_or_walk() {
        use forma_ir::parser::test_helpers::{
            build_declared_fixture, encode_close_tag, encode_open_tag,
        };
        let mut manifest = manifest();
        manifest.routes.insert(
            "/seam".into(),
            crate::RouteAssets {
                mode: crate::RouteMode::Ssr,
                js: vec![],
                css: vec![],
                fonts: vec![],
                modulepreload: vec![],
                ir: Some("home.ir".into()),
                total_size_br: 0,
                budget_warn_threshold: 0,
            },
        );
        let opcodes = [
            vec![11, 0, 0],
            encode_open_tag(0, &[]),
            encode_close_tag(0),
            vec![12, 0, 0],
        ]
        .concat();
        let module = forma_ir::IrModule::parse(&build_declared_fixture(
            &["div", "Panel"],
            &[],
            &opcodes,
            &[(0, 1, 0, 1, 0, &[])],
        ))
        .unwrap();
        let error = render_guarded(
            &shell_config(&manifest),
            &RenderCtx::new(),
            || panic!("static refusal must precede nonce generation"),
            Root::Walk {
                module: Some(&module),
                slots: None,
                limits: WalkLimits::default(),
            },
        )
        .unwrap_err();
        assert_eq!(error.code(), "RENDER-105");
        assert_eq!(error.route(), "/seam");
        assert!(error.to_string().contains("declared islands"));
        assert_eq!(error.counts(), None);
        assert!(error.component_path().is_empty());
    }

    #[test]
    fn render_202_a_failed_nonce_draw() {
        // The OS random source cannot be made to fail from a test, so the
        // render takes its draw as a parameter and this test hands it a
        // failing one. `try_render` passes `CspNonce::try_generate`.
        let manifest = manifest();
        for root in [
            Root::Walk {
                module: None,
                slots: None,
                limits: WalkLimits::default(),
            },
            Root::Shell,
        ] {
            let error = render_guarded(
                &shell_config(&manifest),
                &RenderCtx::new(),
                || Err(NonceError),
                root,
            )
            .unwrap_err();
            assert_eq!(error.code(), "RENDER-202");
            assert_eq!(error.route(), "/seam");
            assert!(error.component_path().is_empty());
            assert_eq!(error.counts(), None);
        }
        // The same seam with a real draw renders: the failure is the draw's.
        let page = render_guarded(
            &shell_config(&manifest),
            &RenderCtx::new(),
            CspNonce::try_generate,
            Root::Shell,
        );
        assert!(page.is_ok());
    }

    #[test]
    fn a_panic_outside_the_walk_is_still_a_fault() {
        // The outer guard: a panic before the walk (here, in the draw) comes
        // back as RENDER-399 too, with no component path.
        let manifest = manifest();
        let error = render_guarded(
            &shell_config(&manifest),
            &RenderCtx::new(),
            || -> Result<CspNonce, NonceError> { panic!("draw blew up") },
            Root::Shell,
        )
        .unwrap_err();
        assert_eq!(error.code(), "RENDER-399");
        assert_eq!(error.route(), "/seam");
        assert!(error.component_path().is_empty());
        match error {
            RenderError::Fault { message, .. } => assert_eq!(message, "draw blew up"),
            other => panic!("expected Fault, got {other:?}"),
        }
    }

    #[test]
    fn an_invalid_extension_fails_before_the_walk() {
        // No module at all: if the walk ran first this would be RENDER-101.
        let manifest = manifest();
        let ctx = RenderCtx::new().with_policy(PolicyExtensions::new().form_action("'none'"));
        let error = render_bound(
            &shell_config(&manifest),
            &ctx,
            None,
            None,
            WalkLimits::default(),
        )
        .unwrap_err();
        assert_eq!(error.code(), "RENDER-201");
    }

    #[test]
    fn display_names_code_route_component_and_counts() {
        let error = RenderError::Budget {
            route: "/t/:tenant".to_string(),
            component_path: vec!["Shell".to_string(), "Branding".to_string()],
            counts: RenderCounts {
                nodes: 102,
                bytes: 2048,
                list_iterations: 50,
                ..RenderCounts::default()
            },
            cause: IrError::ListBudgetExceeded { max: 50 },
        };
        let text = error.to_string();
        assert!(
            text.starts_with("RENDER-302 /t/:tenant in Shell > Branding: "),
            "{text}"
        );
        assert!(
            text.ends_with("(after 102 nodes, 2048 bytes, 50 list rows)"),
            "{text}"
        );
    }
}
