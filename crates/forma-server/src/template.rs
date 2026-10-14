use crate::csp::{self, CspNonce};
use crate::types::{AssetManifest, PageConfig, PageOutput, RenderMode};
use forma_ir as ir;

/// Resolved asset URLs for a route — shared between Phase 1 and Phase 2 paths.
struct ResolvedAssets {
    fonts: Vec<String>,
    css_urls: Vec<String>,
    js_urls: Vec<String>,
}

/// Build the common `<head>` content shared by both render paths.
fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Neutralize the only two sequences that can end an inline `<script>` element
/// or start a comment-driven double-escape inside one.
///
/// `</script` → `<\/script` and `<!--` → `<\!--`. Both are identity escapes in
/// a JS string, template literal or regex, so the *value* is preserved — which
/// is why `<!--` becomes `<\!--` and not `<--` (the latter changes the string's
/// contents and parses as `< --` in code position).
///
/// The match is case-insensitive because HTML tag names are: `</ScRiPt >`
/// closes the element just as well as `</script>`. Matching bare `</script`
/// (rather than `</script` plus a tag-name terminator, which is what the
/// tokenizer requires) is slightly over-broad, and that is fine here because
/// the transform is value-preserving.
///
/// This makes the value unable to escape its element. It does NOT make an
/// untrusted value safe — see the doc comment on `PageConfig::config_script`.
fn neutralize_script_terminators(s: &str) -> String {
    let lower = s.to_ascii_lowercase();
    let mut out = String::with_capacity(s.len() + 8);
    let mut i = 0;
    while i < s.len() {
        if lower[i..].starts_with("</script") {
            out.push_str("<\\/script");
            i += "</script".len();
        } else if lower[i..].starts_with("<!--") {
            out.push_str("<\\!--");
            i += "<!--".len();
        } else {
            // Walk by char so multi-byte UTF-8 is never split.
            let ch = s[i..].chars().next().expect("in-bounds index");
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn build_head(
    title: &str,
    nonce: &str,
    assets: &ResolvedAssets,
    personality_css: Option<&str>,
) -> String {
    let mut head = String::with_capacity(2048);
    head.push_str("<meta charset=\"utf-8\">\n");
    head.push_str("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
    head.push_str(&format!("<title>{}</title>\n", escape_html(title)));

    // Font preloads
    for font in &assets.fonts {
        head.push_str(&format!(
            "<link rel=\"preload\" href=\"{}\" as=\"font\" type=\"font/woff2\" crossorigin>\n",
            escape_html(font)
        ));
    }

    // CSS stylesheets
    for css in &assets.css_urls {
        head.push_str(&format!(
            "<link rel=\"stylesheet\" href=\"{}\">\n",
            escape_html(css)
        ));
    }

    // JS modulepreloads. Nonced because under `script-src 'strict-dynamic'` an
    // un-nonced script-destination preload hint is dropped. Losing it is a
    // degradation, not a breakage — the real module tag is nonced and its
    // static imports inherit that nonce, so the chunk still loads; you lose a
    // warm-cache round trip and gain a console violation.
    for js in &assets.js_urls {
        head.push_str(&format!(
            "<link rel=\"modulepreload\" nonce=\"{}\" href=\"{}\">\n",
            escape_html(nonce),
            escape_html(js)
        ));
    }

    // Personality CSS (inline, small).
    //
    // Neutralize `</`, not `</style>`. A literal two-case string replace was
    // never sufficient: HTML tag names are case-insensitive and the tokenizer
    // accepts whitespace and `/` before `>`, so `</StYlE>`, `</style >`,
    // `</style\t>` and `</style/>` all escaped the element. The ONLY way out
    // of a RAWTEXT element is `</` followed by a tag name — character
    // references are not decoded and comments are not recognised there — so if
    // no `</` survives, no end tag can be produced.
    //
    // `\/` is a valid CSS escape for `/`, valid inside strings, `url()` tokens
    // and idents, and it consumes no following whitespace, so real CSS
    // round-trips byte-identically (`content:"</div>"` still computes to
    // `</div>`). Escaping `<` instead would be secure but silently breaks
    // modern CSS: `\00003c` is an ident-start escape, not the `<` delim token
    // that the Media Queries Level 4 range grammar needs, so
    // `@media (width < 600px)` would parse and then never match.
    if let Some(css) = personality_css {
        let safe_css = css.replace("</", "<\\/");
        head.push_str(&format!("<style nonce=\"{nonce}\">{safe_css}</style>\n"));
    }

    head
}

/// Resolve asset URLs from the manifest for a given route pattern.
fn resolve_assets(manifest: &AssetManifest, route_pattern: &str) -> ResolvedAssets {
    let route = manifest.route(route_pattern);
    ResolvedAssets {
        fonts: route
            .map(|r| r.fonts.iter().map(|f| format!("/_assets/{f}")).collect())
            .unwrap_or_default(),
        css_urls: route
            .map(|r| r.css.iter().map(|f| format!("/_assets/{f}")).collect())
            .unwrap_or_default(),
        js_urls: route
            .map(|r| r.js.iter().map(|f| format!("/_assets/{f}")).collect())
            .unwrap_or_default(),
    }
}

/// Build shared body fragments (class attr, prefix, config script, page JS tag).
struct BodyParts {
    body_class_attr: String,
    body_prefix: String,
    config_script_tag: String,
    page_js_tag: String,
    wasm_script: String,
    sw_script: String,
}

fn build_body_parts(nonce: &str, config: &PageConfig, js_urls: &[String]) -> BodyParts {
    let body_class_attr = config
        .body_class
        .map(|c| format!(" class=\"{}\"", escape_html(c)))
        .unwrap_or_default();
    // Raw, trusted HTML by contract — see PageConfig::body_prefix.
    let body_prefix = config.body_prefix.unwrap_or("").to_string();

    // `config_json` is the safe path: serde_json output with every `<`
    // escaped, which simultaneously kills `</script`, `<!--` and `<script`
    // and is value-preserving in JSON (`<` is a valid string escape, so
    // JSON.parse yields byte-identical values).
    let config_json_tag = config
        .config_json
        .map(|value| {
            let json = serde_json::to_string(value).unwrap_or_else(|_| "null".to_string());
            format!(
                "<script nonce=\"{nonce}\">window.__FORMA_CONFIG__={};</script>\n",
                json.replace('<', "\\u003c")
            )
        })
        .unwrap_or_default();

    // `config_script` is the raw escape hatch. Neutralizing the terminators
    // stops it breaking out of its own element; it does not make untrusted
    // content safe inside it.
    let config_script_tag = config
        .config_script
        .map(|s| {
            format!(
                "<script nonce=\"{nonce}\">{}</script>\n",
                neutralize_script_terminators(s)
            )
        })
        .unwrap_or_default();
    let config_script_tag = format!("{config_json_tag}{config_script_tag}");

    let page_js_tag = js_urls
        .last()
        .map(|url| {
            format!(
                "<script type=\"module\" nonce=\"{nonce}\" src=\"{}\"></script>",
                escape_html(url)
            )
        })
        .unwrap_or_default();

    let wasm_script = match (
        &config.manifest.wasm,
        config.manifest.route(config.route_pattern),
    ) {
        (Some(wasm), Some(route)) => match route.ir.as_ref() {
            Some(ir_name) => format!(
                "<script nonce=\"{nonce}\">window.__FORMA_WASM__={{loader:\"/_assets/{}\",binary:\"/_assets/{}\",ir:\"/_assets/{}\"}};</script>\n",
                escape_html(&wasm.loader), escape_html(&wasm.binary), escape_html(ir_name)
            ),
            None => String::new(),
        },
        _ => String::new(),
    };

    // Only for an application that enabled its worker (DR-25, Q15): the
    // default registers nothing, and `/sw.js` retires any worker installed
    // by an earlier release.
    let sw_script = crate::sw::registration_script(nonce);

    BodyParts {
        body_class_attr,
        body_prefix,
        config_script_tag,
        page_js_tag,
        wasm_script,
        sw_script,
    }
}

/// Render a page, generating a fresh CSP nonce for it.
///
/// The returned HTML and CSP header are ONE UNIT: the HTML embeds the nonce
/// that only this policy blesses. Serve them together with
/// `Cache-Control: no-store` and never cache the HTML across requests —
/// [`PageOutput::headers`] does that for you. Caching the HTML while
/// regenerating the CSP kills every script on the page; caching both ships one
/// static, publicly-known nonce to all users and defeats nonce-based CSP.
///
/// A cache-aware caller should use [`render_page_with_nonce`] instead and
/// re-stamp the shell per request.
pub fn render_page(config: &PageConfig) -> PageOutput {
    render_page_with_nonce(config, &csp::generate_csp_nonce())
}

/// [`render_page`] with a caller-supplied per-request nonce.
///
/// Takes a validated [`CspNonce`] rather than a `&str`: the value is
/// interpolated unescaped into five HTML attributes and into the CSP header,
/// so an arbitrary string would be an attribute- and directive-injection sink.
pub fn render_page_with_nonce(config: &PageConfig, nonce: &CspNonce) -> PageOutput {
    match config.render_mode {
        RenderMode::Phase1ClientMount => render_page_phase1(config, nonce),
        RenderMode::Phase2SsrReconcile => render_page_phase2(config, nonce),
    }
}

/// Phase 1: empty `<div id="app"></div>` — client JS mounts from scratch.
fn render_page_phase1(config: &PageConfig, nonce: &CspNonce) -> PageOutput {
    // Defence in depth: CspNonce already rejects anything attribute- or
    // directive-significant, so this never changes a real nonce.
    let nonce_attr = escape_html(nonce.as_str());
    let nonce = nonce.clone();
    let assets = resolve_assets(config.manifest, config.route_pattern);
    let head = build_head(config.title, &nonce_attr, &assets, config.personality_css);
    let parts = build_body_parts(&nonce_attr, config, &assets.js_urls);

    let html = format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n{head}</head>\n<body{bc}>\n{bp}<div id=\"app\"></div>\n{cs}{pj}\n{wasm}{sw}</body>\n</html>",
        bc = parts.body_class_attr,
        bp = parts.body_prefix,
        cs = parts.config_script_tag,
        pj = parts.page_js_tag,
        wasm = parts.wasm_script,
        sw = parts.sw_script,
    );

    PageOutput {
        html,
        csp: csp::build_csp_header(&nonce),
        nonce,
    }
}

/// Phase 2: server-render the IR module into `<div id="app" data-forma-ssr>`.
/// Falls back to Phase 1 on any error (missing IR module, walk failure, etc.).
fn render_page_phase2(config: &PageConfig, nonce: &CspNonce) -> PageOutput {
    // Both ir_module and slots must be present for SSR
    let (ir_module, slots) = match (config.ir_module, config.slots) {
        (Some(m), Some(s)) => (m, s),
        _ => {
            tracing::warn!(
                route = config.route_pattern,
                "Phase 2 SSR: missing IR module or slots, falling back to Phase 1"
            );
            return render_page_phase1(config, nonce);
        }
    };

    // Attempt IR walk. This is also where the walker's resource budgets
    // surface — an over-limit or malformed module degrades to Phase 1 rather
    // than aborting the process.
    let ssr_body = match ir::walker::walk_to_html(ir_module, slots) {
        Ok(html) => html,
        Err(err) => {
            tracing::warn!(
                route = config.route_pattern,
                error = %err,
                "Phase 2 SSR: IR walk failed, falling back to Phase 1"
            );
            return render_page_phase1(config, nonce);
        }
    };

    // SSR succeeded — build the full page with SSR content
    let nonce_attr = escape_html(nonce.as_str());
    let nonce = nonce.clone();
    let assets = resolve_assets(config.manifest, config.route_pattern);
    let head = build_head(config.title, &nonce_attr, &assets, config.personality_css);
    let parts = build_body_parts(&nonce_attr, config, &assets.js_urls);

    let html = format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n{head}</head>\n<body{bc}>\n{bp}<div id=\"app\" data-forma-ssr>{ssr}</div>\n{cs}{pj}\n{wasm}{sw}</body>\n</html>",
        bc = parts.body_class_attr,
        bp = parts.body_prefix,
        ssr = ssr_body,
        cs = parts.config_script_tag,
        pj = parts.page_js_tag,
        wasm = parts.wasm_script,
        sw = parts.sw_script,
    );

    PageOutput {
        html,
        csp: csp::build_csp_header(&nonce),
        nonce,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{RouteAssets, WasmAssets};
    use forma_ir::parser::IrModule;
    use forma_ir::slot::{SlotData, SlotValue};
    use std::collections::HashMap;

    /// Build a minimal AssetManifest with no routes for testing.
    fn empty_manifest() -> AssetManifest {
        AssetManifest {
            version: 1,
            build_hash: "test".to_string(),
            assets: HashMap::new(),
            routes: HashMap::new(),
            wasm: None,
        }
    }

    /// Build a valid IR module that renders "<p>hello</p>".
    fn hello_ir_module() -> IrModule {
        use forma_ir::parser::test_helpers::{
            build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
        };

        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[])); // <p>
        opcodes.extend_from_slice(&encode_text(1)); // hello
        opcodes.extend_from_slice(&encode_close_tag(0)); // </p>

        let data = build_minimal_ir(&["p", "hello"], &[], &opcodes, &[]);
        IrModule::parse(&data).unwrap()
    }

    #[test]
    fn phase1_renders_empty_app_div() {
        let manifest = empty_manifest();
        let page = render_page(&PageConfig {
            title: "Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });

        assert!(page.html.contains("<div id=\"app\"></div>"));
        // Check that the #app div does NOT have the SSR attribute
        assert!(!page.html.contains("<div id=\"app\" data-forma-ssr>"));
    }

    #[test]
    fn phase2_renders_ssr_content_with_data_attr() {
        let manifest = empty_manifest();
        let ir = hello_ir_module();
        let slots = SlotData::new(0);

        let page = render_page(&PageConfig {
            title: "SSR Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase2SsrReconcile,
            ir_module: Some(&ir),
            slots: Some(&slots),
        });

        assert!(page.html.contains("data-forma-ssr"));
        assert!(page.html.contains("<p>hello</p>"));
        assert!(page.html.contains("<div id=\"app\" data-forma-ssr>"));
    }

    #[test]
    fn phase2_falls_back_to_phase1_when_ir_module_missing() {
        let manifest = empty_manifest();

        let page = render_page(&PageConfig {
            title: "Fallback Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase2SsrReconcile,
            ir_module: None,
            slots: None,
        });

        // Should fall back to Phase 1: empty #app, no data-forma-ssr
        assert!(page.html.contains("<div id=\"app\"></div>"));
        assert!(!page.html.contains("<div id=\"app\" data-forma-ssr>"));
    }

    #[test]
    fn phase2_falls_back_to_phase1_when_slots_missing() {
        let manifest = empty_manifest();
        let ir = hello_ir_module();

        let page = render_page(&PageConfig {
            title: "Fallback Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase2SsrReconcile,
            ir_module: Some(&ir),
            slots: None,
        });

        assert!(page.html.contains("<div id=\"app\"></div>"));
        assert!(!page.html.contains("<div id=\"app\" data-forma-ssr>"));
    }

    #[test]
    fn phase2_falls_back_on_ir_walk_error() {
        let manifest = empty_manifest();
        // A TEXT opcode referencing string index 99 with only one string in
        // the table. This parses (IrModule::parse validates structure and
        // cross-table ids, not every string index) and fails during the walk —
        // an invalid *opcode* byte no longer works for this test because the
        // structural pass now rejects it at load time.
        let mut opcodes = vec![0x04]; // TEXT
        opcodes.extend_from_slice(&99u32.to_le_bytes());
        let data = forma_ir::parser::test_helpers::build_minimal_ir(&["x"], &[], &opcodes, &[]);
        let ir = IrModule::parse(&data).unwrap();
        let slots = SlotData::new(0);

        let page = render_page(&PageConfig {
            title: "Walk Error Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase2SsrReconcile,
            ir_module: Some(&ir),
            slots: Some(&slots),
        });

        // Should fall back to Phase 1
        assert!(page.html.contains("<div id=\"app\"></div>"));
        assert!(!page.html.contains("<div id=\"app\" data-forma-ssr>"));
    }

    #[test]
    fn phase2_ssr_preserves_head_content() {
        let manifest = empty_manifest();
        let ir = hello_ir_module();
        let slots = SlotData::new(0);

        let page = render_page(&PageConfig {
            title: "Head Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: Some("window.__TEST__=true;"),
            config_json: None,
            body_class: Some("dark"),
            personality_css: Some(":root{--c:red}"),
            body_prefix: Some("<nav>nav</nav>"),
            render_mode: RenderMode::Phase2SsrReconcile,
            ir_module: Some(&ir),
            slots: Some(&slots),
        });

        assert!(page.html.contains("<title>Head Test</title>"));
        assert!(page.html.contains("window.__TEST__=true;"));
        assert!(page.html.contains("class=\"dark\""));
        assert!(page.html.contains(":root{--c:red}"));
        assert!(page.html.contains("<nav>nav</nav>"));
        assert!(page.html.contains("<p>hello</p>"));
        assert!(page.html.contains("data-forma-ssr"));
    }

    #[test]
    fn wasm_script_injected_when_manifest_has_wasm_and_route_has_ir() {
        let mut routes = HashMap::new();
        routes.insert(
            "/test".to_string(),
            RouteAssets {
                js: vec!["test.abc123.js".to_string()],
                css: vec![],
                fonts: vec![],
                total_size_br: 0,
                budget_warn_threshold: 204800,
                ir: Some("test.def456.ir".to_string()),
            },
        );

        let manifest = AssetManifest {
            version: 1,
            build_hash: "test".to_string(),
            assets: HashMap::new(),
            routes,
            wasm: Some(WasmAssets {
                loader: "forma_ir.abc.js".to_string(),
                binary: "forma_ir_bg.def.wasm".to_string(),
            }),
        };

        let page = render_page(&PageConfig {
            title: "WASM Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });

        assert!(page.html.contains("__FORMA_WASM__"));
        assert!(page.html.contains("/_assets/forma_ir.abc.js"));
        assert!(page.html.contains("/_assets/forma_ir_bg.def.wasm"));
        assert!(page.html.contains("/_assets/test.def456.ir"));
    }

    #[test]
    fn wasm_script_not_injected_when_no_wasm_in_manifest() {
        let manifest = empty_manifest();
        let page = render_page(&PageConfig {
            title: "No WASM",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });

        assert!(!page.html.contains("__FORMA_WASM__"));
    }

    #[test]
    fn wasm_script_not_injected_when_route_has_no_ir() {
        let mut routes = HashMap::new();
        routes.insert(
            "/test".to_string(),
            RouteAssets {
                js: vec!["test.abc123.js".to_string()],
                css: vec![],
                fonts: vec![],
                total_size_br: 0,
                budget_warn_threshold: 204800,
                ir: None, // no IR
            },
        );

        let manifest = AssetManifest {
            version: 1,
            build_hash: "test".to_string(),
            assets: HashMap::new(),
            routes,
            wasm: Some(WasmAssets {
                loader: "forma_ir.abc.js".to_string(),
                binary: "forma_ir_bg.def.wasm".to_string(),
            }),
        };

        let page = render_page(&PageConfig {
            title: "No IR",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });

        assert!(!page.html.contains("__FORMA_WASM__"));
    }

    #[test]
    fn phase2_with_slot_data() {
        use forma_ir::parser::test_helpers::{build_minimal_ir, encode_close_tag, encode_open_tag};

        // Build IR with DYN_TEXT referencing slot 0
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[])); // <span>
                                                             // DYN_TEXT opcode: 0x05 + slot_id(u16) + marker_id(u16)
        opcodes.push(0x05);
        opcodes.extend_from_slice(&0u16.to_le_bytes()); // slot_id = 0
        opcodes.extend_from_slice(&0u16.to_le_bytes()); // marker_id = 0
        opcodes.extend_from_slice(&encode_close_tag(0)); // </span>

        let data = build_minimal_ir(
            &["span", "name"],          // strings
            &[(0, 1, 0x01, 0x00, &[])], // slot: id=0, name_str_idx=1, type=Text, source=Server
            &opcodes,
            &[],
        );
        let ir = IrModule::parse(&data).unwrap();

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("World".to_string()));

        let manifest = empty_manifest();
        let page = render_page(&PageConfig {
            title: "Slot Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase2SsrReconcile,
            ir_module: Some(&ir),
            slots: Some(&slots),
        });

        assert!(page.html.contains("data-forma-ssr"));
        // DYN_TEXT wraps content in marker comments for client reconciliation
        assert!(page
            .html
            .contains("<span><!--f:t0-->World<!--/f:t0--></span>"));
    }

    // -- Security: escape_html tests -----------------------------------------

    #[test]
    fn escape_html_basic_entities() {
        assert_eq!(escape_html("<script>"), "&lt;script&gt;");
        assert_eq!(escape_html("\"quotes\""), "&quot;quotes&quot;");
        assert_eq!(escape_html("a&b"), "a&amp;b");
        assert_eq!(escape_html("clean"), "clean");
    }

    #[test]
    fn asset_filename_xss_is_escaped() {
        // If a manifest somehow contained a malicious filename, it must be escaped
        // in the HTML output rather than injected raw.
        let mut routes = HashMap::new();
        routes.insert(
            "/test".to_string(),
            RouteAssets {
                js: vec!["\"><script>alert(1)</script>".to_string()],
                css: vec!["\"><script>alert(2)</script>".to_string()],
                fonts: vec!["\"><script>alert(3)</script>".to_string()],
                total_size_br: 0,
                budget_warn_threshold: 204800,
                ir: None,
            },
        );
        let manifest = AssetManifest {
            version: 1,
            build_hash: "test".to_string(),
            assets: HashMap::new(),
            routes,
            wasm: None,
        };

        let page = render_page(&PageConfig {
            title: "XSS Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });

        // The raw "<script>" must not appear unescaped in the output
        assert!(
            !page.html.contains("<script>alert("),
            "asset filenames must be HTML-escaped, got: {}",
            page.html
        );
        assert!(
            page.html.contains("&lt;script&gt;"),
            "escaped <script> should be present"
        );
    }

    #[test]
    fn body_class_with_quotes_is_escaped() {
        let manifest = empty_manifest();
        let page = render_page(&PageConfig {
            title: "Body Class Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: Some("dark\" onload=\"alert(1)"),
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });

        // The double quote in body_class must be escaped so the attacker
        // cannot break out of the class="..." attribute.
        // Raw: class="dark" onload="alert(1)"  (attribute injection)
        // Safe: class="dark&quot; onload=&quot;alert(1)"  (single quoted attr value)
        assert!(
            page.html.contains("&quot;"),
            "body_class double quote must be escaped"
        );
        assert!(
            !page.html.contains(r#"class="dark" onload="#),
            "body_class must not allow attribute breakout via unescaped double quote"
        );
    }

    #[test]
    fn personality_css_style_breakout_prevented() {
        // Table-driven, because the old two-case literal replace passed a test
        // that only checked the adjacent-literal shape. HTML tag names are
        // case-insensitive and the tokenizer accepts whitespace and `/` before
        // `>`, so every one of these used to escape the <style> element.
        for css in [
            "body{color:red}</style><script>alert(1)</script>",
            "body{color:red}</StYlE><script>alert(1)</script>",
            "body{color:red}</style ><script>alert(1)</script>",
            "body{color:red}</style\t><script>alert(1)</script>",
            "body{color:red}</style/><script>alert(1)</script>",
            "body{color:red}</style\n><script>alert(1)</script>",
            "body{color:red}</style\x0c><script>alert(1)</script>",
            "body{color:red}<</style><script>alert(1)</script>",
            "body{color:red}</sty</style><script>alert(1)</script>",
        ] {
            let manifest = empty_manifest();
            let page = render_page(&PageConfig {
                title: "CSS Test",
                route_pattern: "/test",
                manifest: &manifest,
                config_script: None,
                config_json: None,
                body_class: None,
                personality_css: Some(css),
                body_prefix: None,
                render_mode: RenderMode::Phase1ClientMount,
                ir_module: None,
                slots: None,
            });

            // Assert the real invariant, not one literal shape: the rendered
            // <style> region must contain no `</` other than the closing tag
            // the template itself appends. `</` is the ONLY way out of a
            // RAWTEXT element, so if none survives, no end tag can be formed.
            let start = page.html.find("<style").expect("style element");
            let body_start = page.html[start..].find('>').expect("style open") + start + 1;
            let end = page.html[body_start..]
                .find("</style>")
                .expect("style close")
                + body_start;
            let body = &page.html[body_start..end];
            assert!(
                !body.contains("</"),
                "style body must contain no `</` for input {css:?}, got: {body}"
            );
        }
    }

    #[test]
    fn personality_css_round_trips_legitimate_values() {
        // `\/` is a valid CSS escape for `/`, so real CSS is unchanged in
        // meaning. Range media queries in particular must survive: escaping
        // `<` instead (the obvious alternative) turns `@media (width < 600px)`
        // into an ident token that parses but never matches.
        let manifest = empty_manifest();
        let css = "@media (width < 600px){#t{color:rgb(1,2,3)}}\
                   .a::after{content:\"</div>\"}\
                   .b{font:12px/1.4 sans-serif;aspect-ratio:16/9}";
        let page = render_page(&PageConfig {
            title: "CSS Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: Some(css),
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });

        // Untouched: no `<` before a `/`.
        assert!(page.html.contains("@media (width < 600px)"));
        assert!(page.html.contains("font:12px/1.4 sans-serif"));
        assert!(page.html.contains("aspect-ratio:16/9"));
        // Escaped but value-preserving: `content:"<\/div>"` computes to
        // `</div>`.
        assert!(page.html.contains("content:\"<\\/div>\""));
    }

    // -- config_script / config_json (S3) -----------------------------------

    /// Render a page with the given config_script and return the HTML.
    fn page_with_config_script(script: &str) -> String {
        let manifest = empty_manifest();
        render_page(&PageConfig {
            title: "Config Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: Some(script),
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        })
        .html
    }

    #[test]
    fn config_script_terminators_are_neutralized() {
        // </script closes the tag and turns the remainder into live markup...
        let html = page_with_config_script("window.x=\"</script><img src=x onerror=alert(1)>\";");
        assert!(!html.contains("</script><img"));
        assert!(html.contains("<\\/script>"));

        // ...and the match must be case-insensitive, because the tokenizer is.
        let html = page_with_config_script("window.x=\"</ScRiPt ><img src=x>\";");
        assert!(!html.to_ascii_lowercase().contains("</script ><img"));

        // <!--<script drives the script-data-double-escaped state, where the
        // element's own closing tag stops ending it.
        let html = page_with_config_script("window.x=\"<!--<script>PAYLOAD\";");
        assert!(!html.contains("<!--<script"));
        // `\!` is an identity escape in a JS string, so the value survives.
        assert!(html.contains("<\\!--"));
    }

    #[test]
    fn config_json_emits_no_raw_angle_brackets() {
        let manifest = empty_manifest();
        let value = serde_json::json!({
            "user": "</script><img src=x onerror=alert(1)>",
            "note": "<!--<script>",
        });
        let page = render_page(&PageConfig {
            title: "Config Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: Some(&value),
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });

        let start = page
            .html
            .find("window.__FORMA_CONFIG__=")
            .expect("config json script")
            + "window.__FORMA_CONFIG__=".len();
        let end = page.html[start..].find("</script>").expect("close") + start;
        let json = &page.html[start..end];
        assert!(
            !json.contains('<'),
            "config_json output must contain no raw '<', got: {json}"
        );
        // ...and it is value-preserving: < is a valid JSON escape.
        let parsed: serde_json::Value = serde_json::from_str(json.trim_end_matches(';')).unwrap();
        assert_eq!(parsed, value);
    }

    // -- Nonce plumbing (S11) -----------------------------------------------

    #[test]
    fn page_output_exposes_the_nonce_it_embedded() {
        let manifest = empty_manifest();
        let page = render_page(&PageConfig {
            title: "Nonce Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: Some("window.x=1;"),
            config_json: None,
            body_class: None,
            personality_css: Some("body{color:red}"),
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });

        // No string-parsing the CSP to recover it.
        assert!(page.csp.contains(&format!("'nonce-{}'", page.nonce)));
        assert!(page
            .html
            .contains(&format!("<script nonce=\"{}\">", page.nonce)));
        assert!(page
            .html
            .contains(&format!("<style nonce=\"{}\">", page.nonce)));
    }

    #[test]
    fn render_page_with_nonce_uses_the_supplied_nonce() {
        // The cache-aware path: a caller re-stamping a shell per request must
        // get the same nonce in the HTML and the header.
        let manifest = empty_manifest();
        let nonce = crate::csp::CspNonce::generate();
        let page = render_page_with_nonce(
            &PageConfig {
                title: "Nonce Test",
                route_pattern: "/test",
                manifest: &manifest,
                config_script: None,
                config_json: None,
                body_class: None,
                personality_css: None,
                body_prefix: None,
                render_mode: RenderMode::Phase1ClientMount,
                ir_module: None,
                slots: None,
            },
            &nonce,
        );
        assert_eq!(page.nonce, nonce);
        assert!(page.csp.contains(&format!("'nonce-{nonce}'")));
    }

    #[test]
    fn page_output_headers_are_no_store() {
        // The HTML embeds a per-request nonce, so it must never be cached.
        let manifest = empty_manifest();
        let page = render_page(&PageConfig {
            title: "Header Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });

        let headers = page.headers();
        let get = |name: &str| {
            headers
                .iter()
                .find(|(n, _)| n.as_str() == name)
                .map(|(_, v)| v.to_str().unwrap().to_string())
        };
        assert_eq!(get("cache-control").as_deref(), Some("no-store"));
        assert_eq!(get("x-content-type-options").as_deref(), Some("nosniff"));
        assert!(get("content-security-policy").is_some());
        assert!(get("referrer-policy").is_some());
    }

    // -- CSP / walker interlock (S4) ----------------------------------------

    #[test]
    fn style_attributes_rendered_by_the_walker_are_permitted_by_the_csp() {
        // A DYN_ATTR bound to `style` renders a style ATTRIBUTE, so the header
        // this crate ships must permit attribute styles — otherwise the
        // framework's default CSP breaks the framework's own output.
        let mut opcodes = forma_ir::parser::test_helpers::encode_open_tag(0, &[]);
        opcodes.push(0x06); // DYN_ATTR
        opcodes.extend_from_slice(&1u32.to_le_bytes()); // "style"
        opcodes.extend_from_slice(&0u16.to_le_bytes()); // slot 0
        let data = forma_ir::parser::test_helpers::build_minimal_ir(
            &["div", "style", "css"],
            &[(0, 2, 0x01, 0x00, &[])],
            &opcodes,
            &[],
        );
        let ir = IrModule::parse(&data).unwrap();
        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("color:red".into()));

        let manifest = empty_manifest();
        let page = render_page(&PageConfig {
            title: "Style Attr",
            route_pattern: "/test",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase2SsrReconcile,
            ir_module: Some(&ir),
            slots: Some(&slots),
        });

        assert!(
            page.html.contains("style=\"color:red\""),
            "walker must emit the style attribute: {}",
            page.html
        );
        assert!(
            page.csp.contains("style-src-attr 'unsafe-inline'"),
            "CSP must permit the attribute style the walker just emitted: {}",
            page.csp
        );
    }
}
