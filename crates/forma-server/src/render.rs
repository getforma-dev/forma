//! The A2 render: a page with its counts, or a coded error the handler
//! answers (DR-11, DR-12, L-3).
//!
//! [`try_render`] is the bridge to 3.0.0's `render` on a bound page handle
//! (L-28): it takes today's [`PageConfig`] and returns what that `render`
//! will return, `Result<PageResponse, RenderError>`. It sits beside the
//! deprecated `render_page`, which keeps its Phase 1 fallback.

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
/// in `body_prefix` (DR-19): the route's `modulepreload` links from the
/// build's manifest, and head links. Never a nonce: the render draws one per
/// response (L-14). Data goes through [`PageConfig::config_json`].
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
    limits: WalkLimits,
    module_preloads: Option<ModulePreloads>,
    head_links: Vec<HeadLink>,
}

impl RenderCtx {
    /// The strict policy and the walker's default budgets (8 MiB of output,
    /// 50,000 list rows).
    pub fn new() -> Self {
        Self::default()
    }

    /// Extend this page's policy (see [`PolicyExtensions`]).
    #[must_use]
    pub fn with_policy(mut self, policy: PolicyExtensions) -> Self {
        self.policy = policy;
        self
    }

    /// Budget this page's walk differently from the defaults.
    #[must_use]
    pub fn with_limits(mut self, limits: WalkLimits) -> Self {
        self.limits = limits;
        self
    }

    /// Write the route's `modulepreload` links from the build's manifest,
    /// each with the page's nonce, after the route's own modules (DR-19). The
    /// typed home for a preload workaround in `body_prefix`, such as
    /// Ledger's. The table covers every route; the render takes
    /// `config.route_pattern`'s list. Like every typed home, each call site
    /// belongs on SR8's raw-entry allowlist (L-37).
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
    /// Verified by: crates/forma-server/tests/typed_homes.rs > "try_render_writes_the_routes_manifest_modulepreload_links_nonced"
    #[must_use]
    pub fn with_module_preloads(mut self, preloads: &ModulePreloads) -> Self {
        self.module_preloads = Some(preloads.clone());
        self
    }

    /// Add a `<link>` to the page's head (see [`HeadLink`]), after any added
    /// before it. The typed home for links spliced in before `</head>`; each
    /// call site belongs on SR8's raw-entry allowlist (L-37).
    ///
    /// Verified by: crates/forma-server/tests/typed_homes.rs > "head_links_are_written_escaped_in_the_head_in_the_order_added"
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
/// when the failure is not inside a component). The codes, by family (L-3):
///
/// | Code | Variant | Cause |
/// |---|---|---|
/// | RENDER-101 | [`MissingModule`](RenderError::MissingModule) | The config has no module or no slots to render |
/// | RENDER-102 | [`Walk`](RenderError::Walk) | The walk refused the module or its data |
/// | RENDER-201 | [`Policy`](RenderError::Policy) | A policy extension is not a source a page may add |
/// | RENDER-202 | [`Nonce`](RenderError::Nonce) | The system random source failed to draw a nonce |
/// | RENDER-301 | [`Budget`](RenderError::Budget) | The walk's output passed `max_output_bytes` |
/// | RENDER-302 | [`Budget`](RenderError::Budget) | The walk's list rows passed `max_list_iterations` |
/// | RENDER-303 | [`Budget`](RenderError::Budget) | Lists or control flow nested past the walker's depth |
/// | RENDER-399 | [`Fault`](RenderError::Fault) | The render panicked; a defect, not an input |
///
/// A code, once published, keeps its meaning; new causes get new codes.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum RenderError {
    /// RENDER-101: [`try_render`] renders on the server, and the config
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
    /// RENDER-301, RENDER-302, RENDER-303: the walk reached one of its
    /// budgets, and stopped there instead of running on (SR22).
    #[non_exhaustive]
    Budget {
        /// The route being rendered.
        route: String,
        /// The islands open where the walk stopped, outermost first.
        component_path: Vec<String>,
        /// How far the walk got before the budget stopped it.
        counts: RenderCounts,
        /// The budget the walker reports.
        cause: IrError,
    },
    /// RENDER-399: the render panicked and the panic was caught (DR-12). The
    /// process and every other request carry on, while the application
    /// unwinds on panic; under `panic = "abort"` the process ends (SA8).
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
            RenderError::MissingModule { .. } => "RENDER-101",
            RenderError::Walk { .. } => "RENDER-102",
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
            RenderError::MissingModule { route }
            | RenderError::Walk { route, .. }
            | RenderError::Policy { route, .. }
            | RenderError::Nonce { route, .. }
            | RenderError::Budget { route, .. }
            | RenderError::Fault { route, .. } => route,
        }
    }

    /// The component names of the islands open where the render stopped,
    /// outermost first; empty when it stopped outside every island or before
    /// the walk. A component the compiler inlined into its parent has no name
    /// until FMIR v3's source positions (L-7).
    pub fn component_path(&self) -> &[String] {
        match self {
            RenderError::Walk { component_path, .. }
            | RenderError::Budget { component_path, .. }
            | RenderError::Fault { component_path, .. } => component_path,
            _ => &[],
        }
    }

    /// How far the walk got, for an error raised during it.
    pub fn counts(&self) -> Option<RenderCounts> {
        match self {
            RenderError::Walk { counts, .. }
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
            RenderError::MissingModule { .. } => {
                write!(f, ": no module or slots to render on the server")
            }
            RenderError::Walk { cause, .. } | RenderError::Budget { cause, .. } => {
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
            RenderError::Walk { cause, .. } | RenderError::Budget { cause, .. } => Some(cause),
            RenderError::Policy { cause, .. } => Some(cause),
            RenderError::Nonce { cause, .. } => Some(cause),
            _ => None,
        }
    }
}

/// Render a page on the server: the page with its counts, or why not.
///
/// The bridge to 3.0.0's `render` (DR-11, L-3). Unlike the deprecated
/// `render_page`, it never substitutes an empty shell for a failure: a
/// missing module, a walk the module or data fails, an exceeded budget, an
/// invalid policy extension, a failed nonce draw and a panic each come back
/// as a [`RenderError`] with a stable code, the route and the component
/// path. The page is written into its own buffer and returned whole, or not
/// at all, so no partial page leaves. Forma logs none of these: the handler
/// chooses the response. (A caught panic still runs the process's panic hook
/// first: the default hook prints it to stderr, and a reporting hook, such as
/// an error tracker's, records it.)
///
/// It always renders on the server: `config.render_mode` steers only the
/// deprecated `render_page`. A route the build declares `ssr: false` is
/// served by [`render_browser_shell`].
///
/// ```no_run
/// use axum::http::StatusCode;
/// use axum::response::{IntoResponse, Response};
/// use forma_server::{try_render, PageConfig, RenderCtx};
///
/// fn home(config: &PageConfig) -> Response {
///     match try_render(config, &RenderCtx::new()) {
///         Ok(page) => page.into_response(), // no-store, policy, headers
///         Err(error) => {
///             // Count it by code and route; serve the application's error page.
///             eprintln!("{error}");
///             StatusCode::INTERNAL_SERVER_ERROR.into_response()
///         }
///     }
/// }
/// ```
///
/// # Threads and panics
///
/// The walk is synchronous work on the caller's thread, and forma-server
/// starts nothing and depends on no async runtime (R4). At the measured 12.5
/// million nodes a second, a page past about 12,500 nodes holds the thread
/// past a millisecond; [`RenderCounts`] reports each page's nodes and walk
/// time, so a handler whose counts show that can move the render into tokio's
/// blocking pool itself (owned inputs, since the closure must be `'static`):
///
/// ```no_run
/// # use std::sync::Arc;
/// # use forma_server::{try_render, AssetManifest, PageConfig, RenderCtx, RenderMode, PageResponse, RenderError};
/// # use forma_ir::{IrModule, SlotData};
/// # #[allow(deprecated)]
/// async fn heavy(
///     manifest: Arc<AssetManifest>,
///     module: Arc<IrModule>,
///     slots: SlotData,
/// ) -> Result<PageResponse, RenderError> {
///     tokio::task::spawn_blocking(move || {
///         # #[allow(deprecated)]
///         let config = PageConfig {
///             title: "Ledger",
///             route_pattern: "/ledger",
///             manifest: &manifest,
///             config_script: None,
///             config_json: None,
///             body_class: None,
///             personality_css: None,
///             body_prefix: None,
///             render_mode: RenderMode::Phase2SsrReconcile,
///             ir_module: Some(&module),
///             slots: Some(&slots),
///         };
///         try_render(&config, &RenderCtx::new())
///     })
///     .await
///     .expect("the blocking task ran")
/// }
/// ```
///
/// A panic inside the render is caught and returned as
/// [`RenderError::Fault`] (DR-12), which holds only while the application
/// unwinds on panic, as both templates leave it. Under `panic = "abort"` a
/// fault still ends the process with every request in flight (SA8).
///
/// Verified by: crates/forma-server/tests/try_render.rs > "a_panicking_component_returns_fault_the_handler_answers_500_and_the_next_request_renders"
pub fn try_render(config: &PageConfig, ctx: &RenderCtx) -> Result<PageResponse, RenderError> {
    render_guarded(config, ctx, CspNonce::try_generate, Root::Walk)
}

/// Serve a route the build declares browser-rendered (`ssr: false`): the
/// nonced bundle and the same headers as any page, around an empty root.
///
/// By declaration, never in place of a failure (DR-11): it does not walk,
/// even when the config carries a module. Fails only as a page fails before
/// its walk: an invalid policy extension, a failed nonce draw, or a fault.
///
/// Verified by: crates/forma-server/tests/try_render.rs > "render_browser_shell_serves_the_bundle_around_an_empty_root_with_the_page_headers"
pub fn render_browser_shell(
    config: &PageConfig,
    ctx: &RenderCtx,
) -> Result<PageResponse, RenderError> {
    render_guarded(config, ctx, CspNonce::try_generate, Root::Shell)
}

/// What goes in the page's root.
#[derive(Debug, Clone, Copy)]
enum Root {
    /// The walk's HTML.
    Walk,
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
    root: Root,
) -> Result<PageResponse, RenderError> {
    match catch_unwind(AssertUnwindSafe(|| render(config, ctx, draw, root))) {
        Ok(result) => result,
        Err(payload) => Err(RenderError::Fault {
            route: config.route_pattern.to_string(),
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
    root: Root,
) -> Result<PageResponse, RenderError> {
    let route = || config.route_pattern.to_string();
    let nonce = draw().map_err(|cause| RenderError::Nonce {
        route: route(),
        cause,
    })?;
    // The policy before the walk: an invalid extension costs no walk.
    let policy = csp::page_policy(&nonce, &ctx.policy).map_err(|cause| RenderError::Policy {
        route: route(),
        cause,
    })?;

    let (ssr_body, counts) = match root {
        Root::Shell => (None, RenderCounts::default()),
        Root::Walk => {
            let (Some(module), Some(slots)) = (config.ir_module, config.slots) else {
                return Err(RenderError::MissingModule { route: route() });
            };
            let started = Instant::now();
            let walked = forma_ir::walk_to_html_counted(module, slots, ctx.limits);
            let walk_time = started.elapsed();
            match walked {
                Ok(out) => (
                    Some(out.html),
                    RenderCounts::from_walk(out.counts, walk_time),
                ),
                Err(failure) => {
                    let route = route();
                    let component_path = failure.component_path;
                    let counts = RenderCounts::from_walk(failure.counts, walk_time);
                    let cause = failure.error;
                    return Err(match cause {
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

    let html = crate::template::write_document(config, &nonce, ssr_body.as_deref(), ctx);
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
    use crate::types::{AssetManifest, RenderMode};
    use std::collections::HashMap;

    fn manifest() -> AssetManifest {
        AssetManifest {
            version: 1,
            build_hash: "test".to_string(),
            assets: HashMap::new(),
            routes: HashMap::new(),
            wasm: None,
        }
    }

    #[allow(deprecated)]
    fn shell_config(manifest: &AssetManifest) -> PageConfig<'_> {
        PageConfig {
            title: "Seam",
            route_pattern: "/seam",
            manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        }
    }

    #[test]
    fn render_202_a_failed_nonce_draw() {
        // The OS random source cannot be made to fail from a test, so the
        // render takes its draw as a parameter and this test hands it a
        // failing one. `try_render` passes `CspNonce::try_generate`.
        let manifest = manifest();
        for root in [Root::Walk, Root::Shell] {
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
        let error = try_render(&shell_config(&manifest), &ctx).unwrap_err();
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
