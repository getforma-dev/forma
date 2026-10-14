//! Typed homes for what applications put in `body_prefix` that is not their
//! own markup (DR-19): the route's `modulepreload` links, read from the
//! build's manifest and nonced here, and the page's head links.
//!
//! The third, data, already has its home: [`PageConfig::config_json`]
//! (`window.__FORMA_CONFIG__`, every `<` escaped), and in 3.0.0 the state
//! block (DR-4).
//!
//! Each reaches the page through [`RenderCtx`](crate::RenderCtx), so only
//! [`try_render`](crate::try_render) and
//! [`render_browser_shell`](crate::render_browser_shell) write them; the
//! deprecated `render_page` writes the document 0.2.1 wrote.
//!
//! [`PageConfig::config_json`]: crate::PageConfig::config_json

use serde::Deserialize;
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
/// The table is the one from the manifest at start. In development, a chunk
/// the watcher renames stays listed until the server restarts; its preload
/// fails harmlessly, as a hint, and the module itself still loads.
///
/// Verified by: crates/forma-server/tests/typed_homes.rs > "try_render_writes_the_routes_manifest_modulepreload_links_nonced"
#[derive(Debug, Clone)]
pub struct ModulePreloads {
    routes: Arc<HashMap<String, Vec<String>>>,
}

/// The two manifest fields the table is read from.
#[derive(Deserialize)]
struct Manifest {
    assets: HashMap<String, String>,
    routes: HashMap<String, Route>,
}

#[derive(Deserialize)]
struct Route {
    #[serde(default)]
    js: Vec<String>,
    #[serde(default)]
    modulepreload: Vec<String>,
}

impl ModulePreloads {
    /// Read the table from `manifest.json`'s text.
    ///
    /// Each listed file must be one of the build's own files, a value in the
    /// manifest's `assets`, or the table is refused: a preload carries the
    /// page's nonce, so it may name only what the build wrote. A route's own
    /// modules (`js`), which forma-server already preloads, and repeats are
    /// left out.
    ///
    /// Verified by: crates/forma-server/tests/typed_homes.rs > "a_manifest_preload_that_is_not_one_of_the_builds_files_refuses_the_table"
    pub(crate) fn from_manifest_json(json: &str) -> Result<Self, String> {
        let manifest: Manifest = serde_json::from_str(json)
            .map_err(|e| format!("Failed to parse manifest.json: {e}"))?;
        let built: std::collections::HashSet<&str> =
            manifest.assets.values().map(String::as_str).collect();
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
/// a web app manifest, a canonical URL (DR-19). The typed home for what ksx
/// Studio splices before `</head>`.
///
/// Every value is escaped for its attribute, and a script URL is refused, so
/// a head link is never markup and never runs anything. Add it to a render
/// with [`RenderCtx::with_head_link`](crate::RenderCtx::with_head_link); it is
/// written after the route's stylesheets and preloads, in the order added.
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
/// Verified by: crates/forma-server/tests/typed_homes.rs > "head_links_are_written_escaped_in_the_head_in_the_order_added"
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadLink {
    rel: String,
    href: String,
    mime: Option<String>,
    sizes: Option<String>,
}

impl HeadLink {
    /// A link of type `rel` (one or more link types, such as `icon` or
    /// `apple-touch-icon`, separated by single spaces) to `href`.
    ///
    /// # Errors
    ///
    /// A [`HeadLinkError`] when `rel` is not a list of link types (ASCII
    /// letters, digits and `-`), or `href` is empty or a `javascript:` or
    /// `vbscript:` URL, in any case and with any tab, newline or leading
    /// control character a browser would strip.
    ///
    /// Verified by: crates/forma-server/tests/typed_homes.rs > "a_head_link_refuses_a_script_url_and_keeps_every_other"
    pub fn new(rel: &str, href: &str) -> Result<HeadLink, HeadLinkError> {
        let refuse = |reason| {
            Err(HeadLinkError {
                rel: rel.to_string(),
                href: href.to_string(),
                reason,
            })
        };
        let types_ok = !rel.is_empty()
            && rel.split(' ').all(|t| {
                !t.is_empty() && t.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            });
        if !types_ok {
            return refuse("rel is not a list of link types separated by single spaces");
        }
        if href.trim().is_empty() {
            return refuse("href is empty");
        }
        if is_script_url(href) {
            return refuse("href is a script URL");
        }
        Ok(HeadLink {
            rel: rel.to_string(),
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
        use crate::template::escape_html;
        head.push_str("<link rel=\"");
        head.push_str(&escape_html(&self.rel));
        head.push_str("\" href=\"");
        head.push_str(&escape_html(&self.href));
        head.push('"');
        if let Some(mime) = &self.mime {
            head.push_str(" type=\"");
            head.push_str(&escape_html(mime));
            head.push('"');
        }
        if let Some(sizes) = &self.sizes {
            head.push_str(" sizes=\"");
            head.push_str(&escape_html(sizes));
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

/// A [`HeadLink`] that could not be made, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadLinkError {
    rel: String,
    href: String,
    reason: &'static str,
}

impl HeadLinkError {
    /// Why the link was refused.
    pub fn reason(&self) -> &'static str {
        self.reason
    }
}

impl fmt::Display for HeadLinkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "head link rel={:?} href={:?}: {}",
            self.rel, self.href, self.reason
        )
    }
}

impl std::error::Error for HeadLinkError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest_with_preloads(preloads: &[&str]) -> String {
        serde_json::json!({
            "version": 1,
            "build_hash": "h",
            "assets": {"home.js": "home.A1B2C3D4.js", "chunk.X.js": "chunk.X.js"},
            "routes": {"/": {
                "js": ["home.A1B2C3D4.js"],
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
        assert!(
            error.starts_with("Failed to parse manifest.json"),
            "{error}"
        );
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
