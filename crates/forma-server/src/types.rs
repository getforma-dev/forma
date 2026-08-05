use serde::Deserialize;
use std::collections::HashMap;

/// Per-route render strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderMode {
    /// Phase 1: empty `<div id="app"></div>`, client JS mounts from scratch.
    Phase1ClientMount,
    /// Phase 2: server renders HTML into `#app` via IR walker, client reconciles.
    Phase2SsrReconcile,
}

/// Configuration for rendering an HTML page with external assets.
#[derive(Debug)]
pub struct PageConfig<'a> {
    /// Text for the page's `<title>`, HTML-escaped on the way out.
    pub title: &'a str,
    /// The route this page was matched by, used to look up its assets in the
    /// manifest (e.g. `/users/:id`).
    pub route_pattern: &'a str,
    /// Build manifest naming the content-hashed JS/CSS/font/IR files.
    pub manifest: &'a AssetManifest,
    /// Optional inline `<script>` content (e.g. `window.__CONFIG__ = {...}`).
    ///
    /// **RAW, TRUSTED ESCAPE HATCH.** The content is emitted into an inline
    /// `<script>` with no JavaScript escaping. `</script` and `<!--` are
    /// neutralized so the value cannot break out of the element, but that is
    /// not the same as making it safe: a `"` or `\` arriving from untrusted
    /// data still yields nonce-blessed script execution inside your own page.
    ///
    /// Use [`PageConfig::config_json`] for anything derived from user input.
    pub config_script: Option<&'a str>,
    /// Optional server data to expose to the client as
    /// `window.__FORMA_CONFIG__`.
    ///
    /// This is the safe path: the value is serialized by `serde_json` with
    /// every `<` escaped, which cannot be misused no matter what the data
    /// contains. Prefer it over [`PageConfig::config_script`].
    pub config_json: Option<&'a serde_json::Value>,
    /// Optional `class` attribute for `<body>`, HTML-escaped.
    pub body_class: Option<&'a str>,
    /// Optional inline `<style>` for personality/theme overrides.
    ///
    /// Emitted inside a `<style>` element. `</` is neutralized (as a CSS
    /// escape, losslessly) so the value cannot break out; everything else is
    /// passed through as CSS.
    pub personality_css: Option<&'a str>,
    /// Optional extra HTML before `<div id="app">`.
    ///
    /// **RAW, TRUSTED HTML.** Interpolated verbatim with no escaping — that is
    /// the point of the field (callers use it to emit their own markup, e.g. a
    /// hand-rendered `__forma_islands` block). Never build it from untrusted
    /// data.
    pub body_prefix: Option<&'a str>,
    /// Whether to server-render the body or ship an empty `#app` shell.
    pub render_mode: RenderMode,
    /// Pre-parsed IR module for Phase 2 SSR
    pub ir_module: Option<&'a forma_ir::parser::IrModule>,
    /// Slot data for Phase 2 SSR
    pub slots: Option<&'a forma_ir::slot::SlotData>,
}

/// Output from render_page: HTML body + CSP header value + the nonce binding
/// them together.
///
/// The HTML and the CSP header are a single unit — the HTML embeds a
/// per-request nonce that only this policy blesses. Serve them together with
/// `Cache-Control: no-store` and never cache the HTML across requests: a
/// cached body with a fresh policy kills every script, and caching both ships
/// one static, publicly-known nonce to every user, which defeats nonce-based
/// CSP entirely.
#[non_exhaustive]
#[derive(Debug)]
pub struct PageOutput {
    /// The complete HTML document.
    pub html: String,
    /// The `Content-Security-Policy` header value that blesses it.
    pub csp: String,
    /// The nonce embedded in `html` and blessed by `csp`.
    ///
    /// Exposed so a caller can add its own nonced `<script>`/`<style>`, or
    /// re-stamp a cached shell, without string-parsing the CSP.
    pub nonce: crate::csp::CspNonce,
}

impl PageOutput {
    /// Response headers for this page: content type, `no-store`, and the CSP.
    ///
    /// Reads the (public, mutable) `csp` field, so a caller that must rewrite
    /// a directive can do so in place first and still use this helper.
    pub fn headers(&self) -> Vec<(axum::http::HeaderName, axum::http::HeaderValue)> {
        let mut headers = vec![
            (
                axum::http::header::CONTENT_TYPE,
                axum::http::HeaderValue::from_static("text/html; charset=utf-8"),
            ),
            (
                axum::http::header::CACHE_CONTROL,
                axum::http::HeaderValue::from_static("no-store"),
            ),
        ];
        if let Ok(value) = axum::http::HeaderValue::from_str(&self.csp) {
            headers.push((axum::http::header::CONTENT_SECURITY_POLICY, value));
        }
        headers.extend_from_slice(document_security_headers());
        headers
    }
}

/// `X-Content-Type-Options: nosniff` — belongs on every response, not just
/// documents.
pub const NOSNIFF: (&str, &str) = ("x-content-type-options", "nosniff");

/// Security headers that only make sense on an HTML **document** response.
///
/// Deliberately not one flat set applied as a blanket layer: a browser ignores
/// `Cross-Origin-Opener-Policy`, `Referrer-Policy` and `Permissions-Policy` on
/// a JSON/CSS/JS response, so a global layer would put ~150 dead bytes on
/// every asset and every API poll. Use [`asset_security_headers`] there.
///
/// HSTS is deliberately absent: it is the TLS terminator's responsibility, not
/// the application's.
///
/// Caveat on `Cross-Origin-Opener-Policy: same-origin` — it applies only to
/// top-level documents in a secure context (a no-op over plain HTTP on a
/// non-localhost host) and it severs `window.opener`, which breaks popup-based
/// OAuth flows.
pub fn document_security_headers() -> &'static [(axum::http::HeaderName, axum::http::HeaderValue)] {
    use axum::http::{HeaderName, HeaderValue};
    static HEADERS: std::sync::OnceLock<Vec<(HeaderName, HeaderValue)>> =
        std::sync::OnceLock::new();
    HEADERS.get_or_init(|| {
        vec![
            (
                HeaderName::from_static("x-content-type-options"),
                HeaderValue::from_static("nosniff"),
            ),
            (
                HeaderName::from_static("referrer-policy"),
                HeaderValue::from_static("strict-origin-when-cross-origin"),
            ),
            (
                // `interest-cohort=()` is deliberately omitted: FLoC was
                // withdrawn in 2022 and the token is not a registered feature,
                // so Chrome logs an "Unrecognized feature" warning for it on
                // every page load.
                HeaderName::from_static("permissions-policy"),
                HeaderValue::from_static("geolocation=(), camera=(), microphone=()"),
            ),
            (
                HeaderName::from_static("cross-origin-opener-policy"),
                HeaderValue::from_static("same-origin"),
            ),
        ]
    })
}

/// Security headers for subresource responses (`/_assets/*`, `/sw.js`).
///
/// `Cross-Origin-Resource-Policy` belongs here rather than on the document.
/// `same-origin` is correct while assets are served from the app's own origin;
/// an app that fronts `/_assets` with a separate CDN origin must relax it.
pub fn asset_security_headers() -> &'static [(axum::http::HeaderName, axum::http::HeaderValue)] {
    use axum::http::{HeaderName, HeaderValue};
    static HEADERS: std::sync::OnceLock<Vec<(HeaderName, HeaderValue)>> =
        std::sync::OnceLock::new();
    HEADERS.get_or_init(|| {
        vec![
            (
                HeaderName::from_static("x-content-type-options"),
                HeaderValue::from_static("nosniff"),
            ),
            (
                HeaderName::from_static("cross-origin-resource-policy"),
                HeaderValue::from_static("same-origin"),
            ),
        ]
    })
}

/// Asset manifest loaded from `manifest.json` in the embedded dist directory.
#[derive(Debug, Clone, Deserialize)]
pub struct AssetManifest {
    /// Manifest schema version.
    pub version: u32,
    /// Identifier for the build that produced these assets.
    pub build_hash: String,
    /// Logical asset name → content-hashed filename.
    pub assets: HashMap<String, String>,
    /// Route pattern → the assets that route needs.
    pub routes: HashMap<String, RouteAssets>,
    /// The WASM walker, when the build ships one.
    #[serde(default)]
    pub wasm: Option<WasmAssets>,
}

/// Per-route asset references.
#[derive(Debug, Clone, Deserialize)]
pub struct RouteAssets {
    /// JS modules for this route, in load order.
    pub js: Vec<String>,
    /// Stylesheets for this route.
    pub css: Vec<String>,
    /// Fonts to preload for this route.
    pub fonts: Vec<String>,
    /// Total brotli-compressed size of the route's assets, in bytes.
    pub total_size_br: u64,
    /// Size above which the build warns about this route's payload.
    pub budget_warn_threshold: u64,
    /// The route's compiled `.fmir` module, when it has one (Phase 2).
    #[serde(default)]
    pub ir: Option<String>,
}

/// WASM asset references.
#[derive(Debug, Clone, Deserialize)]
pub struct WasmAssets {
    /// The JS glue module wasm-bindgen emits.
    pub loader: String,
    /// The `.wasm` binary itself.
    pub binary: String,
}

impl AssetManifest {
    /// Resolve a logical asset name to its content-hashed filename.
    pub fn resolve<'a>(&'a self, logical_name: &'a str) -> &'a str {
        self.assets
            .get(logical_name)
            .map(|s| s.as_str())
            .unwrap_or(logical_name)
    }

    /// Get route assets for a route pattern.
    pub fn route(&self, pattern: &str) -> Option<&RouteAssets> {
        self.routes.get(pattern)
    }
}
