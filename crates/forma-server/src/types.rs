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
    /// Deprecated: data goes through [`PageConfig::config_json`] as
    /// escaped JSON, and code goes into the page's bundle, reading a flag from
    /// that data. Set this to `None`; 3.0.0 removes the field.
    #[deprecated(
        since = "0.2.2",
        note = "writes handler text into a nonced script; pass data through \
                `config_json` and move code into the bundle. Removed in 3.0.0"
    )]
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
    /// the point of the field (callers use it to emit their own markup, such
    /// as a hand-written shell or a logo). Never build it from untrusted data.
    ///
    /// Pass a [`RawHtml`](crate::RawHtml), the one named raw-HTML type, bound
    /// first and borrowed: `let logo = RawHtml::trusted(..);` then
    /// `body_prefix: Some(&logo)`, so review and CI find every raw entry by
    /// its constructor; the line compiles in 3.0.0 too, where the
    /// field takes only a `RawHtml`. A plain string still works and is written
    /// exactly as before; in debug builds the first one a process renders
    /// logs `RAW-101` once.
    ///
    /// What is not the application's own markup has a typed home instead:
    /// `modulepreload` links come from the build's manifest
    /// ([`RenderCtx::with_module_preloads`](crate::RenderCtx::with_module_preloads)),
    /// head links from [`RenderCtx::with_head_link`](crate::RenderCtx::with_head_link),
    /// and data from [`PageConfig::config_json`].
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
///
/// Superseded by [`PageResponse`](crate::PageResponse), which writes those
/// headers itself and cannot be sent without them. Turn a
/// `PageOutput` into one with [`PageOutput::into_page_response`]; the public
/// fields and [`PageOutput::headers`] are deprecated and go private in 3.0.0.
#[non_exhaustive]
#[derive(Debug)]
pub struct PageOutput {
    /// The complete HTML document.
    #[deprecated(
        since = "0.2.2",
        note = "send the page as a `PageResponse` (`into_page_response`), which carries \
                `no-store` and the policy with it. Private in 3.0.0"
    )]
    pub html: String,
    /// The `Content-Security-Policy` header value that blesses it.
    #[deprecated(
        since = "0.2.2",
        note = "the policy is typed now: extend it with `PolicyExtensions` and send a \
                `PageResponse` rather than editing this text. Private in 3.0.0"
    )]
    pub csp: String,
    /// The nonce embedded in `html` and blessed by `csp`.
    ///
    /// Exposed so a caller can add its own nonced `<script>`/`<style>`, or
    /// re-stamp a cached shell, without string-parsing the CSP.
    #[deprecated(
        since = "0.2.2",
        note = "render with `try_render` (0.2.2), which draws the nonce and writes it into \
                the page and its policy; a handler that must read it takes \
                `PageResponse::into_parts_unchecked().nonce`. Private in 3.0.0, which gives \
                no caller a nonce"
    )]
    pub nonce: crate::csp::CspNonce,
    /// What the render did, carried into [`PageOutput::into_page_response`].
    pub(crate) counts: crate::response::RenderCounts,
}

#[allow(deprecated)] // this impl is the bridge from the deprecated fields
impl PageOutput {
    /// Response headers for this page: content type, `no-store`, the CSP, and
    /// (from 0.2.2, in development builds) Trusted Types in
    /// `Content-Security-Policy-Report-Only`.
    ///
    /// Reads the (public, mutable) `csp` field, so a caller that must rewrite
    /// a directive can do so in place first and still use this helper. An
    /// invalid `csp` is left out rather than reported; that silent drop is
    /// one of the reasons this is deprecated.
    #[deprecated(
        since = "0.2.2",
        note = "use `into_page_response`: a `PageResponse` writes these headers itself and \
                fails rather than dropping an invalid policy. Removed in 3.0.0"
    )]
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
        // Trusted Types, reported and not enforced (DR-20), as a page with
        // no reporting endpoint carries them: in development builds only, to
        // the browser's console.
        if let Some(Ok(value)) =
            crate::csp::report_only_policy().map(|text| axum::http::HeaderValue::from_str(&text))
        {
            headers.push((
                axum::http::header::CONTENT_SECURITY_POLICY_REPORT_ONLY,
                value,
            ));
        }
        headers.extend_from_slice(document_security_headers());
        headers
    }

    /// This page as a [`PageResponse`](crate::PageResponse): `no-store`, the
    /// strict policy for the page's nonce with `extensions` added, and the
    /// document headers, written whenever it is sent.
    ///
    /// The policy is rebuilt from the nonce the HTML embeds, so a `csp` edited
    /// as text would not carry over: it is refused instead, wherever the edit
    /// went (a widening one would fail in the browser, a tightening one would
    /// be lost). Express the edit as an extension:
    ///
    /// ```no_run
    /// # #![allow(deprecated)]
    /// # use forma_server::{render_page, PageConfig, PolicyExtensions};
    /// # fn config() -> PageConfig<'static> { unimplemented!() }
    /// // Was: page.csp.replace("img-src 'self' data:", "img-src 'self' data: https:")
    /// let page = render_page(&config())
    ///     .into_page_response(&PolicyExtensions::new().img_src("https:"))?;
    /// # Ok::<(), forma_server::PolicyError>(())
    /// ```
    ///
    /// The bridge trusts the deprecated public `nonce` and `html` as they
    /// are: a nonce the caller chose (through `render_page_with_nonce`, or by
    /// assigning the field) carries into the `PageResponse`. A fresh nonce
    /// per response is guaranteed only when the render draws it, as
    /// `render_page` and `try_render` do.
    ///
    /// # Errors
    ///
    /// A [`PolicyError`](crate::PolicyError) naming the first extension that
    /// is not a source a page may add, or, for directive
    /// `content-security-policy`, a `csp` that is not the one forma-server
    /// wrote for this page's nonce. There is then no response to send:
    /// answer with an error page rather than this one without its policy.
    ///
    /// Verified by: crates/forma-server/tests/page_response.rs > "into_page_response_refuses_a_policy_edited_as_text"
    pub fn into_page_response(
        self,
        extensions: &crate::csp::PolicyExtensions,
    ) -> Result<crate::PageResponse, crate::PolicyError> {
        if self.csp != crate::csp::build_csp_header(&self.nonce) {
            return Err(crate::csp::PolicyError::edited_as_text(self.csp));
        }
        crate::PageResponse::new(self.html, self.nonce, extensions, self.counts)
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

/// Validated schema-2 build manifest. Deserialize through the shared validator.
#[derive(Debug, Clone)]
pub struct AssetManifest {
    /// Manifest schema, currently 2.
    pub version: u32,
    /// Writer's numeric base version, without package prerelease metadata.
    pub writer: String,
    /// Application identity; the same grammar as the worker namespace.
    pub app: String,
    /// Opaque build identifier. Deployment identity is owned by FORMA-186.
    pub build: String,
    /// Logical names mapped to emitted filenames.
    pub aliases: HashMap<String, String>,
    /// Metadata keyed by emitted filenames, including retained files.
    pub assets: HashMap<String, AssetMetadata>,
    /// Explicit rendering mode and assets for each route.
    pub routes: HashMap<String, RouteAssets>,
}

/// Metadata for one emitted file. Integrity enforcement belongs to FORMA-111.
#[derive(Debug, Clone, Deserialize)]
pub struct AssetMetadata {
    /// Whether this URL may be cached immutably; never inferred from its name.
    pub immutable: bool,
    /// SHA-384 of uncompressed final bytes, when supplied by the build.
    pub integrity: Option<String>,
    /// Metadata for a retained asset; retention discovery belongs to FORMA-186.
    #[serde(default)]
    pub retained: bool,
}

/// The manifest's explicit route mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RouteMode {
    /// A required compiled module is rendered on the server.
    Ssr,
    /// An intentionally browser-rendered route, with no compiled module.
    Browser,
}

/// Per-route asset references.
#[derive(Debug, Clone, Deserialize)]
pub struct RouteAssets {
    /// Explicit browser or server rendering, independent of file availability.
    pub mode: RouteMode,
    /// JS modules for this route, in load order.
    pub js: Vec<String>,
    /// Stylesheets for this route.
    pub css: Vec<String>,
    /// Fonts to preload for this route.
    pub fonts: Vec<String>,
    /// Static module dependencies, excluding duplicates and route entrypoints at render.
    #[serde(default)]
    pub modulepreload: Vec<String>,
    /// Total brotli-compressed size of the route's assets, in bytes.
    pub total_size_br: u64,
    /// Size above which the build warns about this route's payload.
    pub budget_warn_threshold: u64,
    /// Required for SSR, absent for an intentional browser route.
    #[serde(default)]
    pub ir: Option<String>,
}

impl<'de> Deserialize<'de> for AssetManifest {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        // Diagnose old schemas before their missing schema-2 fields.
        if value.get("version").and_then(|v| v.as_u64()) != Some(2) {
            return Err(serde::de::Error::custom(format!(
                "MANIFEST-101 unsupported manifest schema {}; reader requires schema 2",
                value.get("version").unwrap_or(&serde_json::Value::Null)
            )));
        }
        if value.get("app").is_none() {
            return Err(serde::de::Error::custom("MANIFEST-101 manifest without app is a legacy schema-1 manifest; rebuild for schema 2"));
        }
        #[derive(Deserialize)]
        struct Raw {
            version: u32,
            writer: String,
            app: String,
            build: String,
            aliases: HashMap<String, String>,
            assets: HashMap<String, AssetMetadata>,
            routes: HashMap<String, RouteAssets>,
        }
        let raw: Raw = serde_json::from_value(value).map_err(serde::de::Error::custom)?;
        let manifest = AssetManifest {
            version: raw.version,
            writer: raw.writer,
            app: raw.app,
            build: raw.build,
            aliases: raw.aliases,
            assets: raw.assets,
            routes: raw.routes,
        };
        manifest.validate().map_err(serde::de::Error::custom)?;
        Ok(manifest)
    }
}

impl AssetManifest {
    /// Read and validate schema, versions, modes and references at startup.
    pub fn from_json(json: &str) -> Result<Self, String> {
        serde_json::from_str(json).map_err(|e| format!("manifest.json: {e}"))
    }

    /// Revalidate even a manifest constructed by the caller before loading modules.
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 2 {
            return Err(format!(
                "MANIFEST-101 unsupported manifest schema {}; reader requires schema 2",
                self.version
            ));
        }
        if self.app.is_empty() {
            return Err("MANIFEST-101 manifest without app is a legacy schema-1 manifest; rebuild for schema 2".into());
        }
        crate::sw::ServiceWorker::for_app(&self.app).map_err(|e| format!("MANIFEST-103 {e}"))?;
        let parts = self.writer.split('.').collect::<Vec<_>>();
        if parts.len() != 3
            || parts.iter().any(|p| {
                p.is_empty()
                    || !p.bytes().all(|b| b.is_ascii_digit())
                    || (p.len() > 1 && p.starts_with('0'))
            })
        {
            return Err(format!(
                "MANIFEST-102 writer {:?} must be a numeric base X.Y.Z without a prerelease suffix",
                self.writer
            ));
        }
        let mut writer = [0u16; 3];
        for (i, part) in parts.iter().enumerate() {
            writer[i] = part.parse().map_err(|_| {
                format!(
                    "MANIFEST-102 writer {:?} exceeds the u16 version range",
                    self.writer
                )
            })?;
        }
        let reader = forma_ir::format::reader_version();
        if !forma_ir::format::accepts_writer(reader, writer) {
            return Err(format!("MANIFEST-102 writer {} is incompatible with reader {}.{}.{}; upgrade the reader within major {} to at least minor {}",self.writer,reader[0],reader[1],reader[2],writer[0],writer[1]));
        }
        if self.build.is_empty() {
            return Err("MANIFEST-103 build must not be empty".into());
        }
        fn filename(name: &str) -> bool {
            !name.is_empty()
                && !name.starts_with('/')
                && !name.contains(['\\', '?', '#', ':'])
                && !name.chars().any(char::is_control)
                && name
                    .split('/')
                    .all(|p| !p.is_empty() && p != "." && p != "..")
        }
        for (name, meta) in &self.assets {
            if !filename(name) {
                return Err(format!("MANIFEST-103 invalid asset filename {name:?}"));
            }
            if let Some(integrity) = &meta.integrity {
                use base64::Engine;
                if integrity
                    .strip_prefix("sha384-")
                    .and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok())
                    .is_none_or(|bytes| bytes.len() != 48)
                {
                    return Err(format!(
                        "MANIFEST-103 invalid SHA-384 integrity for {name:?}"
                    ));
                }
            }
        }
        for (alias, file) in &self.aliases {
            if !filename(alias) || !self.assets.contains_key(file) {
                return Err(format!(
                    "MANIFEST-103 alias {alias:?} names unlisted asset {file:?}"
                ));
            }
        }
        for (pattern, route) in &self.routes {
            if !pattern.starts_with('/') {
                return Err(format!("MANIFEST-103 route {pattern:?} must begin with /"));
            }
            match (route.mode,route.ir.as_deref()) {
                (RouteMode::Ssr,Some(file)) if file.ends_with(".ir")=>{},
                (RouteMode::Browser,None)=>{},
                _=>return Err(format!("MANIFEST-103 route {pattern}: ssr requires an .ir module; browser must not declare one")),
            }
            for file in route
                .js
                .iter()
                .chain(&route.css)
                .chain(&route.fonts)
                .chain(&route.modulepreload)
                .chain(route.ir.iter())
            {
                if !self.assets.contains_key(file) {
                    return Err(format!("MANIFEST-103 route {pattern} references {file:?}, which is not one of the build's files (the manifest's assets)"));
                }
            }
        }
        crate::sw::validate_manifest_app(self)?;
        Ok(())
    }

    /// Resolve a logical name through the manifest's explicit aliases.
    pub fn resolve<'a>(&'a self, logical_name: &'a str) -> &'a str {
        self.aliases
            .get(logical_name)
            .map(String::as_str)
            .unwrap_or(logical_name)
    }

    /// Get assets and the declared mode for a route.
    pub fn route(&self, pattern: &str) -> Option<&RouteAssets> {
        self.routes.get(pattern)
    }
}
