//! Opt-in typed native owner navigation and enhanced action representations.
//!
//! A fetched response cannot install document headers. Adoption requires the
//! sealed application policy profile and matching app, build, group and context.
mod owners;
use crate::{PageConfig, RenderCounts, RenderCtx, RenderError};
use axum::{
    body::Body,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
pub use owners::{NavigationBranch, NavigationOwner};
use serde::Serialize;
use std::{
    fmt,
    io::{self, Write},
};

/// Native navigation response media type.
pub const NAVIGATION_MEDIA_TYPE: &str = "application/vnd.forma.navigation+json";
/// Enhanced action response media type.
pub const ACTION_MEDIA_TYPE: &str = "application/vnd.forma.action+json";

/// Application-owned admission identities, never authorization credentials.
#[derive(Debug, Clone, Serialize)]
pub struct NavigationConfig {
    group: String,
    layout: String,
    context: String,
    #[serde(skip)]
    sealed: Option<SealedNavigationPolicy>,
}
/// Invalid navigation identity or action response input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NavigationInputError(&'static str);
impl fmt::Display for NavigationInputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for NavigationInputError {}
impl NavigationConfig {
    /// Select a compiler/build navigation group, persistent-layout version/key,
    /// and opaque server-owned security-context generation. Never put a secret
    /// or user identifier in these values. Each is 1..128 ASCII identifier bytes.
    pub fn new(
        group: impl Into<String>,
        layout: impl Into<String>,
        context: impl Into<String>,
    ) -> Result<Self, NavigationInputError> {
        let value = Self {
            group: group.into(),
            layout: layout.into(),
            context: context.into(),
            sealed: None,
        };
        for item in [&value.group, &value.layout, &value.context] {
            if item.is_empty()
                || item.len() > 128
                || !item
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
            {
                return Err(NavigationInputError(
                    "navigation identities require 1..128 ASCII identifier bytes",
                ));
            }
        }
        Ok(value)
    }

    /// Attest that the typed page response represents the complete effective
    /// document policy, and declare the only enhanced action endpoints.
    pub fn with_sealed_policy(mut self, policy: SealedNavigationPolicy) -> Self {
        self.sealed = Some(policy);
        self
    }
}

/// Explicit application attestation for the restricted native navigation profile.
///
/// The application must serve the typed PageResponse without adding policy in
/// middleware, a proxy, meta elements or an unchecked raw response exit. This
/// constructor cannot inspect a deployment. If that guarantee is unavailable,
/// use ordinary document navigation. Enhanced forms support only these exact
/// same-origin endpoints and an enforced `form-action 'self'` policy.
#[derive(Debug, Clone)]
pub struct SealedNavigationPolicy {
    actions: Vec<String>,
}
impl SealedNavigationPolicy {
    /// Declare the complete typed-policy profile and up to 128 canonical action
    /// pathnames. Empty means no enhanced POST actions; GET forms still navigate.
    /// Sorting makes identity stable.
    pub fn page_response_only<I, S>(actions: I) -> Result<Self, NavigationInputError>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut result = Vec::new();
        for action in actions {
            let action = action.into();
            if result.len() >= 128 || !canonical_endpoint(&action) {
                return Err(NavigationInputError(
                    "sealed navigation requires at most 128 canonical action pathnames",
                ));
            }
            result.push(action);
        }
        result.sort();
        result.dedup();
        Ok(Self { actions: result })
    }
}
const POLICY_PROFILE: &str = "page-response-only-v1";
pub(crate) fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphabetic()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}
fn canonical_endpoint(endpoint: &str) -> bool {
    !endpoint.is_empty()
        && endpoint.len() <= 2048
        && endpoint.starts_with('/')
        && endpoint
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.' | b'~'))
        && (endpoint == "/"
            || !endpoint[1..]
                .split('/')
                .any(|segment| segment.is_empty() || matches!(segment, "." | "..")))
}
pub(crate) fn validate_sealed(config: &PageConfig, ctx: &RenderCtx) -> Result<(), RenderError> {
    validate_context(config, ctx)?;
    let nav = ctx
        .navigation()
        .ok_or_else(|| refusal(config.route_pattern, "missing navigation context"))?;
    if nav.sealed.is_none() {
        return Err(refusal(
            config.route_pattern,
            "native owners require an explicit SealedNavigationPolicy attestation",
        ));
    }
    if !identifier(&nav.group) || !ctx.module_preloads(config.route_pattern).is_empty() {
        return Err(refusal(
            config.route_pattern,
            "native owner requires a compiler group and no request module preloads",
        ));
    }
    let declaration = config
        .manifest
        .route(config.route_pattern)
        .and_then(|route| route.navigation.as_ref());
    if declaration.is_none_or(|declaration| declaration.group != nav.group) {
        return Err(refusal(
            config.route_pattern,
            "sealed navigation requires matching compiler/build owner metadata",
        ));
    }
    let nonce = crate::CspNonce::parse("FORMA_NAVIGATION_POLICY_NONCE_PLACEHOLDER")
        .map_err(|_| refusal(config.route_pattern, "invalid policy placeholder"))?;
    let policy = crate::csp::page_policy(&nonce, ctx.policy_extensions()).map_err(|cause| {
        RenderError::Policy {
            route: config.route_pattern.into(),
            cause,
        }
    })?;
    if !policy
        .csp()
        .to_str()
        .unwrap_or("")
        .split(';')
        .any(|part| part.trim() == "form-action 'self'")
    {
        return Err(refusal(
            config.route_pattern,
            "sealed navigation requires form-action 'self' without additional destinations",
        ));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
struct Metadata<'a> {
    version: u8,
    app: &'a str,
    build: &'a str,
    route: &'a str,
    group: &'a str,
    layout: &'a str,
    context: &'a str,
    policy: String,
}
#[derive(Debug, Serialize)]
struct Asset<'a> {
    kind: &'static str,
    url: String,
    integrity: &'a str,
}
#[derive(Debug, Serialize)]
struct BootstrapMetadata<'a> {
    #[serde(flatten)]
    metadata: Metadata<'a>,
    assets: Vec<Asset<'a>>,
}
#[cfg(feature = "experimental-router")]
#[derive(Debug, Serialize)]
struct PageEnvelope<'a> {
    #[serde(flatten)]
    metadata: Metadata<'a>,
    kind: &'static str,
    title: &'a str,
    html: String,
    state: serde_json::Value,
    assets: Vec<Asset<'a>>,
}
fn refusal(route: &str, message: impl Into<String>) -> RenderError {
    RenderError::Navigation {
        route: route.into(),
        message: message.into(),
    }
}

pub(crate) fn validate_context(config: &PageConfig, ctx: &RenderCtx) -> Result<(), RenderError> {
    if ctx.navigation().is_none() {
        return Err(refusal(
            config.route_pattern,
            "native navigation requires explicit NavigationConfig",
        ));
    }
    config
        .manifest
        .validate()
        .map_err(|message| RenderError::Manifest {
            route: config.route_pattern.into(),
            message,
        })?;
    let assets = config
        .manifest
        .route(config.route_pattern)
        .ok_or_else(|| refusal(config.route_pattern, "missing declared route"))?;
    if assets.mode != crate::RouteMode::Ssr || assets.is_static_ssr() {
        return Err(refusal(
            config.route_pattern,
            "native navigation requires a declared adoptable SSR route with a bootstrap",
        ));
    }
    if config.config_json.is_some()
        || config.personality_css.is_some()
        || config.body_prefix.is_some()
        || !ctx.head_links().is_empty()
        || config.body_class.is_some()
    {
        return Err(refusal(config.route_pattern, "native navigation does not transfer executable configuration, inline styling, raw prefixes, body classes or request head links"));
    }
    Ok(())
}

/// Hash an actual policy built with a typed, fixed nonce placeholder. No incoming
/// CSP text is parsed or stripped. A future policy-builder/header change changes
/// this identity, and conservatively forces a new document.
fn policy_identity(ctx: &RenderCtx, route: &str) -> Result<String, RenderError> {
    let nonce = crate::CspNonce::parse("FORMA_NAVIGATION_POLICY_NONCE_PLACEHOLDER")
        .map_err(|_| refusal(route, "internal policy placeholder invalid"))?;
    let policy = crate::csp::page_policy(&nonce, ctx.policy_extensions()).map_err(|cause| {
        RenderError::Policy {
            route: route.into(),
            cause,
        }
    })?;
    let mut fields: Vec<(&str, &[u8])> = vec![
        ("content-security-policy", policy.csp().as_bytes()),
        ("cache-control", b"no-store"),
    ];
    if let Some(value) = policy.report_only() {
        fields.push(("content-security-policy-report-only", value.as_bytes()));
    }
    if let Some(value) = policy.reporting_endpoints() {
        fields.push(("reporting-endpoints", value.as_bytes()));
    }
    for (name, value) in crate::types::document_security_headers() {
        if name.as_str() != "cross-origin-opener-policy" {
            fields.push((name.as_str(), value.as_bytes()));
        }
    }
    fields.push(("cross-origin-opener-policy", policy.opener().as_bytes()));
    let mut digest = ring::digest::Context::new(&ring::digest::SHA256);
    digest.update(b"forma-document-policy-v1\0");
    for (name, bytes) in fields {
        digest.update(name.as_bytes());
        digest.update(&[0]);
        digest.update(bytes);
        digest.update(&[0]);
    }
    if let Some(sealed) = ctx.navigation().and_then(|nav| nav.sealed.as_ref()) {
        digest.update(POLICY_PROFILE.as_bytes());
        for action in &sealed.actions {
            digest.update(&[0]);
            digest.update(action.as_bytes());
        }
    }
    Ok(digest
        .finish()
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}
fn metadata<'a>(config: &'a PageConfig, ctx: &'a RenderCtx) -> Result<Metadata<'a>, RenderError> {
    let nav = ctx
        .navigation()
        .ok_or_else(|| refusal(config.route_pattern, "missing navigation config"))?;
    Ok(Metadata {
        version: 1,
        app: &config.manifest.app,
        build: &config.manifest.build,
        route: config.route_pattern,
        group: &nav.group,
        layout: &nav.layout,
        context: &nav.context,
        policy: policy_identity(ctx, config.route_pattern)?,
    })
}

fn route_assets<'a>(
    config: &'a PageConfig,
    ctx: &'a RenderCtx,
) -> Result<Vec<Asset<'a>>, RenderError> {
    let route = config
        .manifest
        .route(config.route_pattern)
        .ok_or_else(|| refusal(config.route_pattern, "missing declared route"))?;
    let mut assets = Vec::new();
    for (kind, files) in [
        ("script", route.js.as_slice()),
        ("style", route.css.as_slice()),
        ("font", route.fonts.as_slice()),
        ("modulepreload", route.modulepreload.as_slice()),
        ("modulepreload", ctx.module_preloads(config.route_pattern)),
    ] {
        for file in files {
            let entry = config
                .manifest
                .assets
                .get(file)
                .ok_or_else(|| refusal(config.route_pattern, "missing asset metadata"))?;
            assets.push(Asset {
                kind,
                url: format!("/_assets/{file}"),
                integrity: &entry.integrity,
            });
        }
    }
    Ok(assets)
}

pub(crate) fn initial_metadata(
    config: &PageConfig,
    ctx: &RenderCtx,
) -> Result<String, RenderError> {
    if ctx.navigation().is_none() {
        return Ok(String::new());
    }
    validate_context(config, ctx)?;
    if ctx.navigation().is_some_and(|nav| nav.sealed.is_some()) {
        return Err(refusal(
            config.route_pattern,
            "sealed navigation documents must be rendered through NavigationBranch",
        ));
    }
    let value = serde_json::to_string(&BootstrapMetadata {
        metadata: metadata(config, ctx)?,
        assets: route_assets(config, ctx)?,
    })
    .map_err(|error| refusal(config.route_pattern, error.to_string()))?;
    Ok(format!(
        "<script type=\"application/json\" data-forma-navigation>{}</script>\n",
        value.replace('<', "\\u003c")
    ))
}

/// Opaque, bounded JSON response. HTML/state cannot leave without admission
/// metadata and no-store policy through this API.
#[derive(Debug)]
pub struct NavigationResponse {
    bytes: Vec<u8>,
    counts: RenderCounts,
    status: StatusCode,
}
impl NavigationResponse {
    #[cfg(feature = "experimental-router")]
    pub(crate) fn from_render(
        config: &PageConfig,
        ctx: &RenderCtx,
        body: &str,
        state: Option<&forma_ir::IslandState>,
        counts: RenderCounts,
        limit: usize,
    ) -> Result<Self, RenderError> {
        let state =
            state.ok_or_else(|| refusal(config.route_pattern, "missing adoptable island state"))?;
        let state = serde_json::from_str(state.as_json()).map_err(|error| {
            refusal(
                config.route_pattern,
                format!("invalid internal state: {error}"),
            )
        })?;
        let assets = route_assets(config, ctx)?;
        let html = format!(
            "<div data-forma-ssr data-forma-build=\"{}\">{body}</div>",
            crate::template::escape_html(&config.manifest.build)
        );
        let envelope = PageEnvelope {
            metadata: metadata(config, ctx)?,
            kind: "page",
            title: config.title,
            html,
            state,
            assets,
        };
        let bytes = bounded_json(&envelope, limit).map_err(|_| RenderError::Budget {
            route: config.route_pattern.into(),
            component_path: vec![],
            counts,
            cause: forma_ir::IrError::OutputLimitExceeded { limit },
        })?;
        Ok(Self {
            bytes,
            counts,
            status: StatusCode::OK,
        })
    }
    /// Work performed by the checked native walk, excluding JSON serialization.
    pub fn counts(&self) -> RenderCounts {
        self.counts
    }
}
impl IntoResponse for NavigationResponse {
    fn into_response(self) -> Response {
        json_response(self.bytes, NAVIGATION_MEDIA_TYPE, self.status)
    }
}

fn json_response(bytes: Vec<u8>, media_type: &'static str, status: StatusCode) -> Response {
    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(media_type));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::VARY, HeaderValue::from_static("Accept"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'; base-uri 'none'"),
    );
    response
}
struct BoundedWriter {
    bytes: Vec<u8>,
    limit: usize,
}
impl Write for BoundedWriter {
    fn write(&mut self, value: &[u8]) -> io::Result<usize> {
        if value.len() > self.limit.saturating_sub(self.bytes.len()) {
            return Err(io::Error::other("response budget exceeded"));
        }
        self.bytes.extend_from_slice(value);
        Ok(value.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn bounded_json(value: &impl Serialize, limit: usize) -> Result<Vec<u8>, serde_json::Error> {
    let mut output = BoundedWriter {
        bytes: Vec::with_capacity(limit.min(8192)),
        limit,
    };
    serde_json::to_writer(&mut output, value)?;
    Ok(output.bytes)
}

/// Admission identity derived only from a finalized, currently bound page and
/// typed render context. Its fields cannot be supplied independently. This is
/// a compatibility assertion, not proof of authentication or mutation rollback.
/// Create a fresh context from the server's actual request policy before each
/// action response; do not cache it across build/security-context changes.
///
/// Independent/unbound contexts cannot be constructed by application code:
/// ```compile_fail
/// use forma_server::ActionContext;
/// let unbound = ActionContext {};
/// ```
#[derive(Debug, Clone, Serialize)]
pub struct ActionContext {
    version: u8,
    app: String,
    build: String,
    group: String,
    layout: String,
    context: String,
    policy: String,
    endpoint: String,
    #[serde(rename = "policyProfile", skip_serializing_if = "Option::is_none")]
    policy_profile: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    actions: Option<Vec<String>>,
}
impl ActionContext {
    pub(crate) fn from_bound(
        config: &PageConfig,
        ctx: &RenderCtx,
        endpoint: &str,
    ) -> Result<Self, RenderError> {
        validate_context(config, ctx)?;
        // Deliberately narrow proof contract: never silently normalize an action
        // identity that the browser or HTTP stack might interpret differently.
        if !canonical_endpoint(endpoint) {
            return Err(refusal(
                config.route_pattern,
                "action endpoint requires an exact canonical ASCII pathname",
            ));
        }
        let sealed = ctx.navigation().and_then(|nav| nav.sealed.as_ref());
        if let Some(profile) = sealed {
            validate_sealed(config, ctx)?;
            if !profile.actions.iter().any(|action| action == endpoint) {
                return Err(refusal(
                    config.route_pattern,
                    "action endpoint is not declared in the sealed profile",
                ));
            }
        } else if !cfg!(feature = "experimental-router") {
            return Err(refusal(
                config.route_pattern,
                "enhanced actions require a sealed navigation profile",
            ));
        }
        let bound = metadata(config, ctx)?;
        Ok(Self {
            version: bound.version,
            app: bound.app.into(),
            build: bound.build.into(),
            group: bound.group.into(),
            layout: bound.layout.into(),
            context: bound.context.into(),
            policy: bound.policy,
            endpoint: endpoint.into(),
            policy_profile: sealed.map(|_| POLICY_PROFILE),
            actions: sealed.map(|profile| profile.actions.clone()),
        })
    }
}

#[derive(Serialize)]
struct ActionEnvelope<'a, T> {
    #[serde(flatten)]
    admission: &'a ActionContext,
    kind: &'static str,
    outcome: &'static str,
    status: u16,
    data: T,
}
/// Explicit enhanced mutation outcome. This type does not execute, authorize,
/// retry, or deduplicate mutations. The application owns CSRF and idempotency.
/// A client must verify admission metadata, endpoint, HTTP status, and outcome
/// before interpreting `data`. An unreadable or mismatched response after POST
/// is an unknown outcome; it does not demonstrate that a mutation was rejected.
///
/// An action cannot be emitted without its bound context:
/// ```compile_fail
/// use forma_server::ActionResponse;
/// let unbound = ActionResponse::success(serde_json::json!({"ok": true}));
/// ```
#[derive(Debug)]
pub struct ActionResponse {
    bytes: Vec<u8>,
    status: StatusCode,
}
impl ActionResponse {
    fn result<T: Serialize>(
        admission: &ActionContext,
        outcome: &'static str,
        data: T,
        status: StatusCode,
    ) -> Result<Self, NavigationInputError> {
        let bytes = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            bounded_json(
                &ActionEnvelope {
                    admission,
                    kind: "action",
                    outcome,
                    status: status.as_u16(),
                    data,
                },
                1_048_576,
            )
        }))
        .map_err(|_| NavigationInputError("action serialization panicked"))?
        .map_err(|_| NavigationInputError("action JSON exceeded 1 MiB or could not serialize"))?;
        Ok(Self { bytes, status })
    }
    /// A confirmed successful mutation. The router must revalidate fresh server data.
    pub fn success<T: Serialize>(
        admission: &ActionContext,
        data: T,
    ) -> Result<Self, NavigationInputError> {
        Self::result(admission, "success", data, StatusCode::OK)
    }
    /// Field/form errors with a 422 status. Do not include secrets in echoed values.
    pub fn validation<T: Serialize>(
        admission: &ActionContext,
        errors: T,
    ) -> Result<Self, NavigationInputError> {
        Self::result(
            admission,
            "validation",
            errors,
            StatusCode::UNPROCESSABLE_ENTITY,
        )
    }
    /// An application error with its actual 4xx/5xx status.
    pub fn error<T: Serialize>(
        admission: &ActionContext,
        status: StatusCode,
        data: T,
    ) -> Result<Self, NavigationInputError> {
        if !status.is_client_error() && !status.is_server_error() {
            return Err(NavigationInputError(
                "action errors require a 4xx or 5xx status",
            ));
        }
        Self::result(admission, "error", data, status)
    }
    /// A confirmed POST/redirect/GET outcome, represented explicitly so Fetch
    /// cannot hide the redirect. For ordinary forms use an actual HTTP 303.
    /// Only root-relative same-origin destinations are supported.
    pub fn redirect(
        admission: &ActionContext,
        location: &str,
    ) -> Result<Self, NavigationInputError> {
        if location.len() > 2048
            || !location.starts_with('/')
            || location.starts_with("//")
            || location
                .bytes()
                .any(|b| b == b'\\' || b <= 0x20 || b == 0x7f)
        {
            return Err(NavigationInputError(
                "enhanced redirect requires a root-relative same-origin URL",
            ));
        }
        Self::result(
            admission,
            "redirect",
            serde_json::json!({"location":location,"status":303}),
            StatusCode::OK,
        )
    }
}
impl IntoResponse for ActionResponse {
    fn into_response(self) -> Response {
        json_response(self.bytes, ACTION_MEDIA_TYPE, self.status)
    }
}
