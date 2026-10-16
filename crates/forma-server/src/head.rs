//! Typed homes for what applications put in `body_prefix` that is not their
//! own markup: the route's `modulepreload` links, read from the
//! build's manifest and nonced here, and the page's head links.
//!
//! The third, data, already has its home: [`PageConfig::config_json`]
//! (`window.__FORMA_CONFIG__`, every `<` escaped), and in 3.0.0 the state
//! block.
//!
//! Each reaches the page through [`RenderCtx`](crate::RenderCtx), so only
//! [`PageHandle::render`](crate::PageHandle::render) and
//! [`render_browser_shell`](crate::render_browser_shell) write them.
//!
//! [`PageConfig::config_json`]: crate::PageConfig::config_json

use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

/// Each route's static ESM dependencies, as the build's manifest lists them
/// in `modulepreload` (`@getforma/build` with `codeSplitting`).
///
/// forma-server writes one `<link rel="modulepreload">` per file into the
/// route's head, after the route's own modules, with the page's nonce: under
/// `'strict-dynamic'` a preload without it is dropped. Load the table once at
/// start with [`assets::try_load_module_preloads`](crate::assets::try_load_module_preloads)
/// and hand it to each render through
/// [`RenderCtx::with_module_preloads`](crate::RenderCtx::with_module_preloads);
/// cloning it is cheap. Dynamically imported chunks are not in the list: the
/// build leaves them out, so they load when the page asks for them.
///
/// The table is the one from the manifest at start. A render resolves every
/// listed file's integrity through its current manifest snapshot. If development
/// renames a chunk out of that snapshot, rendering refuses with RENDER-104 until
/// the application replaces its preload table; no unchecked tag is emitted.
/// A static SSR route refuses a nonempty request table with RENDER-105 even
/// when those files remain valid retained assets in the current manifest.
///
/// Verified by: crates/forma-server/tests/internal_renderer/typed_homes.rs > "try_render_writes_the_routes_manifest_modulepreload_links_nonced"
#[derive(Debug, Clone)]
pub struct ModulePreloads {
    routes: Arc<HashMap<String, Vec<String>>>,
}

impl ModulePreloads {
    /// Read the table from `manifest.json`'s text.
    ///
    /// Each listed file must be one of the build's own files, a key in the
    /// manifest's `assets` keys, or the table is refused: a preload carries the
    /// page's nonce, so it may name only what the build wrote. A route's own
    /// modules (`js`), which forma-server already preloads, and repeats are
    /// left out.
    ///
    /// Verified by: crates/forma-server/tests/internal_renderer/typed_homes.rs > "a_manifest_preload_that_is_not_one_of_the_builds_files_refuses_the_table"
    pub(crate) fn from_manifest_json(json: &str) -> Result<Self, String> {
        let manifest = crate::AssetManifest::from_json(json)?;
        let built: std::collections::HashSet<&str> =
            manifest.assets.keys().map(String::as_str).collect();
        let mut routes = HashMap::new();
        for (route, assets) in &manifest.routes {
            let mut files: Vec<String> = Vec::new();
            for file in &assets.modulepreload {
                if !built.contains(file.as_str()) {
                    return Err(format!(
                        "manifest.json: route {route} lists modulepreload {file:?}, which is not \
                         one of the build's files (the manifest's assets)"
                    ));
                }
                if !assets.js.contains(file) && !files.contains(file) {
                    files.push(file.clone());
                }
            }
            if !files.is_empty() {
                routes.insert(route.clone(), files);
            }
        }
        Ok(ModulePreloads {
            routes: Arc::new(routes),
        })
    }

    /// The files a route preloads, in the manifest's order; empty for a route
    /// the manifest lists none for.
    pub fn route(&self, route_pattern: &str) -> &[String] {
        self.routes.get(route_pattern).map_or(&[], Vec::as_slice)
    }
}

/// A `<link>` for the page's head that is not an asset of the build: an icon,
/// a canonical URL, a feed. The typed home for what ksx Studio
/// splices before `</head>`.
///
/// Its `rel` is one or more of a closed list of link types, none of which
/// loads style or script:
///
/// | Link types | Why they are kept |
/// |---|---|
/// | `icon`, `apple-touch-icon`, `mask-icon` | An image the browser shows for the page, fetched under the policy's `img-src` |
/// | `manifest` | The web app manifest; see below |
/// | `canonical`, `alternate`, `author`, `license` | Metadata: the browser fetches and runs nothing |
/// | `preconnect`, `dns-prefetch` | A connection hint to an origin the page will use: nothing is fetched or run |
///
/// Everything else is refused, with a code: `stylesheet`, `modulepreload`,
/// `preload`, `prefetch`, `prerender` and `import` load style or script, and
/// a page's stylesheets and module preloads come from the build's manifest
/// (`HEAD-101`); any other word, `shortcut` included (write `icon`), is not on
/// the list (`HEAD-102`). Link types are matched without regard to case and
/// written in lower case. Every value is escaped for its attribute, and a
/// script URL is refused, so a head link is never markup and never runs
/// anything. Add it to a render with
/// [`RenderCtx::with_head_link`](crate::RenderCtx::with_head_link); it is
/// written after the route's stylesheets and preloads, in the order added.
///
/// **`manifest` needs a policy the default does not give.** The browser
/// fetches a web app manifest under `manifest-src`, which falls back to the
/// strict policy's `default-src 'none'`, so the default policy blocks it.
/// [`PolicyExtensions`](crate::PolicyExtensions) has no manifest source
/// (it names image and frame sources, a form target and the opener
/// policy), so a page that links a manifest today sees it refused,
/// with a policy violation in the console.
///
/// ```
/// use forma_server::{HeadLink, RenderCtx};
///
/// let ctx = RenderCtx::new()
///     .with_head_link(HeadLink::new("icon", "/favicon.svg")?.with_type("image/svg+xml"))
///     .with_head_link(HeadLink::new("apple-touch-icon", "/apple-touch-icon.png")?);
/// # let _ = ctx;
/// # Ok::<(), forma_server::HeadLinkError>(())
/// ```
///
/// Verified by: crates/forma-server/tests/internal_renderer/typed_homes.rs > "head_links_are_written_escaped_in_the_head_in_the_order_added"
/// Verified by: crates/forma-server/tests/internal_renderer/typed_homes.rs > "a_head_link_carries_only_the_listed_link_types"
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadLink {
    rel: String,
    href: String,
    mime: Option<String>,
    sizes: Option<String>,
}

/// The link types a head link may carry (see [`HeadLink`]).
const LINK_TYPES: &[&str] = &[
    "icon",
    "apple-touch-icon",
    "mask-icon",
    "manifest",
    "canonical",
    "alternate",
    "author",
    "license",
    "preconnect",
    "dns-prefetch",
];

/// The link types that load style or script, refused as `HEAD-101`.
const LOADING_TYPES: &[&str] = &[
    "stylesheet",
    "modulepreload",
    "preload",
    "prefetch",
    "prerender",
    "import",
];

impl HeadLink {
    /// A link of type `rel` (one or more of [`HeadLink`]'s link types,
    /// separated by whitespace) to `href`.
    ///
    /// # Errors
    ///
    /// A [`HeadLinkError`] with its [`code`](HeadLinkError::code):
    ///
    /// | Code | Cause |
    /// |---|---|
    /// | HEAD-101 | `rel` names a link type that loads style or script |
    /// | HEAD-102 | `rel` names no link type, or one outside the list |
    /// | HEAD-103 | `href` is a `javascript:` or `vbscript:` URL, in any case and with any tab, newline or leading control character a browser strips |
    /// | HEAD-104 | `href` is empty |
    ///
    /// Verified by: crates/forma-server/tests/internal_renderer/typed_homes.rs > "a_head_link_carries_only_the_listed_link_types"
    /// Verified by: crates/forma-server/tests/internal_renderer/typed_homes.rs > "a_head_link_refuses_a_script_url_and_keeps_every_other"
    pub fn new(rel: &str, href: &str) -> Result<HeadLink, HeadLinkError> {
        let refuse = |code, reason| {
            Err(HeadLinkError {
                rel: rel.to_string(),
                href: href.to_string(),
                code,
                reason,
            })
        };
        let types: Vec<String> = rel
            .split_ascii_whitespace()
            .map(str::to_ascii_lowercase)
            .collect();
        if types.iter().any(|t| LOADING_TYPES.contains(&t.as_str())) {
            return refuse(
                "HEAD-101",
                "rel names a link type that loads style or script; a page's stylesheets and \
                 module preloads come from the build's manifest",
            );
        }
        if types.is_empty() || !types.iter().all(|t| LINK_TYPES.contains(&t.as_str())) {
            return refuse(
                "HEAD-102",
                "rel is not one of the link types a head link carries: icon, apple-touch-icon, \
                 mask-icon, manifest, canonical, alternate, author, license, preconnect, \
                 dns-prefetch",
            );
        }
        if is_script_url(href) {
            return refuse("HEAD-103", "href is a script URL");
        }
        if href.trim().is_empty() {
            return refuse("HEAD-104", "href is empty");
        }
        Ok(HeadLink {
            rel: types.join(" "),
            href: href.to_string(),
            mime: None,
            sizes: None,
        })
    }

    /// Add a `type` attribute, such as `image/svg+xml`.
    #[must_use]
    pub fn with_type(mut self, mime: &str) -> Self {
        self.mime = Some(mime.to_string());
        self
    }

    /// Add a `sizes` attribute, such as `180x180`.
    #[must_use]
    pub fn with_sizes(mut self, sizes: &str) -> Self {
        self.sizes = Some(sizes.to_string());
        self
    }

    /// The element, every value escaped for its attribute.
    pub(crate) fn write(&self, head: &mut String) {
        use crate::template::escape_dom_html;
        head.push_str("<link rel=\"");
        head.push_str(&escape_dom_html(&self.rel));
        head.push_str("\" href=\"");
        head.push_str(&escape_dom_html(&self.href));
        head.push('"');
        if let Some(mime) = &self.mime {
            head.push_str(" type=\"");
            head.push_str(&escape_dom_html(mime));
            head.push('"');
        }
        if let Some(sizes) = &self.sizes {
            head.push_str(" sizes=\"");
            head.push_str(&escape_dom_html(sizes));
            head.push('"');
        }
        head.push_str(">\n");
    }
}

/// Whether a browser would read `href` as a `javascript:` or `vbscript:` URL.
///
/// The URL parser strips leading and trailing C0 controls and spaces and
/// removes every ASCII tab and newline before it reads the scheme, so
/// `" java\tscript:"` is still `javascript:`; scheme names are ASCII
/// case-insensitive.
fn is_script_url(href: &str) -> bool {
    let cleaned: String = href
        .trim_start_matches(|c: char| c <= ' ')
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .collect();
    let Some((scheme, _)) = cleaned.split_once(':') else {
        return false;
    };
    scheme.eq_ignore_ascii_case("javascript") || scheme.eq_ignore_ascii_case("vbscript")
}

/// A [`HeadLink`] that could not be made: its code and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadLinkError {
    rel: String,
    href: String,
    code: &'static str,
    reason: &'static str,
}

impl HeadLinkError {
    /// The stable code, `HEAD-101` to `HEAD-104` (see [`HeadLink::new`]).
    pub fn code(&self) -> &'static str {
        self.code
    }

    /// Why the link was refused.
    pub fn reason(&self) -> &'static str {
        self.reason
    }
}

impl fmt::Display for HeadLinkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} head link rel={:?} href={:?}: {}",
            self.code, self.rel, self.href, self.reason
        )
    }
}

impl std::error::Error for HeadLinkError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest_with_preloads(preloads: &[&str]) -> String {
        serde_json::json!({
            "version": 2, "writer":"3.0.0", "app":"ledger", "build":"h",
            "aliases": {"home.js": "home.A1B2C3D4.js", "chunk.X.js": "chunk.X.js"},
            "assets": {"home.A1B2C3D4.js":{"immutable":true,"integrity":"sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb"}, "chunk.X.js":{"immutable":true,"integrity":"sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb"}},
            "routes": {"/": {
                "mode":"browser", "js": ["home.A1B2C3D4.js"],
                "modulepreload": preloads,
                "css": [], "fonts": [], "total_size_br": 0, "budget_warn_threshold": 0
            }}
        })
        .to_string()
    }

    #[test]
    fn a_preload_must_be_one_of_the_builds_files() {
        // Hostile and mistaken names: another origin, a traversal, markup, a
        // logical name rather than the built file, an unhashed sibling.
        for file in [
            "https://cdn.example/x.js",
            "//cdn.example/x.js",
            "../secret.js",
            "\"><script>alert(1)</script>",
            "home.js",
            "chunk.Y.js",
            "",
        ] {
            let error =
                ModulePreloads::from_manifest_json(&manifest_with_preloads(&["chunk.X.js", file]))
                    .expect_err(file);
            assert!(error.contains(&format!("{file:?}")), "{error}");
        }
        // Allowed: the build's own files, the route's own entry dropped and a
        // repeat written once.
        let table = ModulePreloads::from_manifest_json(&manifest_with_preloads(&[
            "chunk.X.js",
            "home.A1B2C3D4.js",
            "chunk.X.js",
        ]))
        .expect("loads");
        assert_eq!(table.route("/"), ["chunk.X.js"]);
        // A manifest that is not one fails as the manifest loader does.
        let error = ModulePreloads::from_manifest_json("{").expect_err("not JSON");
        assert!(error.starts_with("manifest.json:"), "{error}");
    }

    #[test]
    fn script_urls_are_recognised_as_a_browser_reads_them() {
        for href in [
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "  javascript:alert(1)",
            "\u{1}javascript:alert(1)",
            "java\tscript:alert(1)",
            "java\nscript:alert(1)",
            "jav\rascript:alert(1)",
            "vbscript:msgbox(1)",
            "VBSCRIPT:msgbox(1)",
            "javascript://host/%0aalert(1)",
        ] {
            assert!(is_script_url(href), "{href:?} is a script URL");
        }
        for href in [
            "/favicon.svg",
            "/guides/javascript.svg",
            "/javascript:not-a-scheme",
            "https://cdn.example/javascript.png",
            "data:image/svg+xml,%3Csvg%3E",
            "javascripts:x",
            "x-javascript:y",
            "favicon.ico",
        ] {
            assert!(!is_script_url(href), "{href:?} is not a script URL");
        }
    }
}
