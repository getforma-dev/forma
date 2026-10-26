use serde::Deserialize;
use std::collections::HashMap;

/// Document metadata for an explicitly browser-rendered page.
/// Server-rendered pages use a bound [`crate::PageHandle`].
#[derive(Debug)]
pub struct PageConfig<'a> {
    /// Text for the page's `<title>`, HTML-escaped on the way out.
    pub title: &'a str,
    /// The route this page was matched by, used to look up its assets in the
    /// manifest (e.g. `/users/:id`).
    pub route_pattern: &'a str,
    /// Build manifest naming the content-hashed JS/CSS/font/IR files.
    pub manifest: &'a AssetManifest,
    /// Optional server data to expose to the client as
    /// `window.__FORMA_CONFIG__`.
    ///
    /// This is the safe path: the value is serialized by `serde_json` with
    /// every `<` escaped, which cannot be misused no matter what the data
    /// contains. Application code belongs in the page bundle.
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
    /// Construct reviewed markup with [`RawHtml::trusted`](crate::RawHtml::trusted)
    /// and borrow it here. Plain strings do not satisfy this field's type.
    ///
    /// What is not the application's own markup has a typed home instead:
    /// `modulepreload` links come from the build's manifest
    /// ([`RenderCtx::with_module_preloads`](crate::RenderCtx::with_module_preloads)),
    /// head links from [`RenderCtx::with_head_link`](crate::RenderCtx::with_head_link),
    /// and data from [`PageConfig::config_json`].
    pub body_prefix: Option<&'a crate::RawHtml>,
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
    /// The build's deployment identity (FORMA-186, DR-29): `@getforma/build` computes
    /// it from the build's own outputs and compiles it into every bundle, and this
    /// server writes it on the page's root as `data-forma-build`, where core
    /// compares it with its bundle's before it activates anything. Opaque here: any
    /// non-empty string, written escaped.
    pub build: String,
    /// Logical names mapped to emitted filenames.
    pub aliases: HashMap<String, String>,
    /// Metadata keyed by emitted filenames, including retained files.
    pub assets: HashMap<String, AssetMetadata>,
    /// Explicit rendering mode and assets for each route.
    pub routes: HashMap<String, RouteAssets>,
}

/// Metadata for one emitted file, including its full uncompressed-byte digest.
#[derive(Debug, Clone, Deserialize)]
pub struct AssetMetadata {
    /// Whether this URL may be cached immutably; never inferred from its name.
    pub immutable: bool,
    /// Canonical SHA-384 of uncompressed final bytes (`sha384-` and 64 base64 characters).
    pub integrity: String,
    /// A file of the previous release that the build copied in for tabs still open on
    /// it (FORMA-186, DR-29, L-25). It is served as any immutable asset is, and a
    /// retained entry that is not immutable is refused at start.
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
    /// Compiler-verified owner and outlet for an opt-in native navigation group.
    #[cfg(feature = "navigation")]
    #[serde(default)]
    pub navigation: Option<RouteNavigation>,
    /// Explicit browser or server rendering, independent of file availability.
    pub mode: RouteMode,
    /// JS modules for this route, in load order. An empty list on an SSR route
    /// declares static output: no island definitions or module preloads.
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

/// Compiler/build declaration for one independently rendered navigation owner.
#[cfg(feature = "navigation")]
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouteNavigation {
    /// Shared verified bootstrap group.
    pub group: String,
    /// Owner identity within that group.
    pub owner: String,
    /// Literal empty div outside all island subtrees, or no child outlet.
    pub outlet: Option<String>,
}

impl RouteAssets {
    /// A native route whose accepted product publishes no browser entry.
    pub(crate) fn is_static_ssr(&self) -> bool {
        self.mode == RouteMode::Ssr && self.js.is_empty()
    }
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
        if let Some(assets) = value.get("assets").and_then(serde_json::Value::as_object) {
            for (name, metadata) in assets {
                if metadata
                    .get("integrity")
                    .and_then(serde_json::Value::as_str)
                    .is_none()
                {
                    return Err(serde::de::Error::custom(format!(
                        "MANIFEST-103 missing or non-string SHA-384 integrity for {name:?}"
                    )));
                }
            }
        }
        // The reserved navigation capability must not disappear as an unknown
        // serde field when this reader was built without its feature. Ordinary
        // forward-compatible fields retain their existing behavior.
        #[cfg(not(feature = "navigation"))]
        if let Some(routes) = value.get("routes").and_then(serde_json::Value::as_object) {
            for (pattern, route) in routes {
                if route.get("navigation").is_some() {
                    return Err(serde::de::Error::custom(format!(
                        "MANIFEST-103 route {pattern}: native navigation capability requires the forma-server navigation feature"
                    )));
                }
            }
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
            if !valid_integrity(&meta.integrity) {
                return Err(format!(
                    "MANIFEST-103 invalid SHA-384 integrity for {name:?}"
                ));
            }
            if meta.retained && !meta.immutable {
                return Err(format!(
                    "MANIFEST-103 retained asset {name:?} must be immutable: a retained file is the previous release's, served as a content-named asset"
                ));
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
            if route.is_static_ssr() && !route.modulepreload.is_empty() {
                return Err(format!("MANIFEST-103 route {pattern}: static SSR must not declare module preloads without a JavaScript entry"));
            }
            #[cfg(feature = "navigation")]
            if let Some(nav) = &route.navigation {
                if !crate::navigation::identifier(&nav.group)
                    || !crate::navigation::identifier(&nav.owner)
                    || nav
                        .outlet
                        .as_deref()
                        .is_some_and(|name| !crate::navigation::identifier(name))
                    || route.mode != RouteMode::Ssr
                    || route.js.len() != 1
                    || !route.modulepreload.is_empty()
                {
                    return Err(format!(
                        "MANIFEST-103 route {pattern}: invalid native navigation owner declaration"
                    ));
                }
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

/// Full SHA-384, in the single canonical SRI spelling emitted by the build.
pub(crate) fn valid_integrity(integrity: &str) -> bool {
    use base64::Engine;
    let Some(encoded) = integrity.strip_prefix("sha384-") else {
        return false;
    };
    if encoded.len() != 64 {
        return false;
    }
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) else {
        return false;
    };
    bytes.len() == 48 && base64::engine::general_purpose::STANDARD.encode(bytes) == encoded
}
