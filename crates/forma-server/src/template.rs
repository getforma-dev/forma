use crate::csp::CspNonce;
use crate::head::HeadLink;
use crate::render::{RenderCtx, RenderError};
use crate::types::{AssetManifest, PageConfig};

/// Resolved asset URLs for a route — shared between Phase 1 and Phase 2 paths.
struct ResolvedAssets {
    fonts: Vec<String>,
    css_urls: Vec<Resource>,
    js_urls: Vec<Resource>,
}

/// A resource whose manifest digest was checked before any document is emitted.
struct Resource {
    url: String,
    integrity: String,
}

/// Escape text for an HTML attribute value or text content.
pub(crate) fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Rule 1 applies to ordinary DOM values before HTML escaping. Transport
/// data, nonces, digests, and build identity keep their existing exact encoding.
pub(crate) fn escape_dom_html(s: &str) -> String {
    escape_html(
        &s.replace("\r\n", "\n")
            .replace('\r', "\n")
            .replace('\0', "\u{fffd}"),
    )
}

/// Build the common `<head>` content shared by both render paths.
///
/// `preloads` and `links` are the typed homes a [`RenderCtx`] carries;
/// a render without one passes neither. External resource tags always include SRI.
fn build_head(
    title: &str,
    nonce: &str,
    assets: &ResolvedAssets,
    personality_css: Option<&str>,
    preloads: &[Resource],
    links: &[HeadLink],
) -> String {
    let mut head = String::with_capacity(2048);
    head.push_str("<meta charset=\"utf-8\">\n");
    head.push_str("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
    head.push_str(&format!("<title>{}</title>\n", escape_dom_html(title)));

    // Font preloads
    for font in &assets.fonts {
        head.push_str(&format!(
            "<link rel=\"preload\" href=\"{}\" as=\"font\" type=\"font/woff2\" crossorigin>\n",
            escape_dom_html(font)
        ));
    }

    // CSS stylesheets
    for css in &assets.css_urls {
        head.push_str(&format!(
            "<link rel=\"stylesheet\" href=\"{}\" integrity=\"{}\" crossorigin=\"anonymous\">\n",
            escape_dom_html(&css.url),
            escape_html(&css.integrity)
        ));
    }

    // JS modulepreloads. Nonced because under `script-src 'strict-dynamic'` an
    // un-nonced script-destination preload hint is dropped. Losing it is a
    // degradation, not a breakage — the real module tag is nonced and its
    // static imports inherit that nonce, so the chunk still loads; you lose a
    // warm-cache round trip and gain a console violation.
    for js in &assets.js_urls {
        head.push_str(&format!(
            "<link rel=\"modulepreload\" nonce=\"{}\" href=\"{}\" integrity=\"{}\" crossorigin=\"anonymous\">\n",
            escape_html(nonce),
            escape_dom_html(&js.url),
            escape_html(&js.integrity)
        ));
    }

    // The route's static dependencies from the build's manifest (DR-19), in
    // the same form and for the same reason: the typed home for Ledger's
    // preloads in `body_prefix`. The table leaves out the route's own
    // modules and repeats (`ModulePreloads`).
    for file in preloads {
        head.push_str(&format!(
            "<link rel=\"modulepreload\" nonce=\"{}\" href=\"{}\" integrity=\"{}\" crossorigin=\"anonymous\">\n",
            escape_html(nonce),
            escape_dom_html(&file.url),
            escape_html(&file.integrity)
        ));
    }

    // Head links (icons, a web app manifest), every value escaped (DR-19).
    for link in links {
        link.write(&mut head);
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

/// Resolve each resource through this response's manifest snapshot.
fn resource(manifest: &AssetManifest, file: &str, route: &str) -> Result<Resource, RenderError> {
    let metadata = manifest
        .assets
        .get(file)
        .filter(|meta| crate::types::valid_integrity(&meta.integrity))
        .ok_or_else(|| RenderError::Manifest {
            route: route.into(),
            message: format!(
                "resource {file:?} requires canonical SHA-384 integrity in this manifest"
            ),
        })?;
    Ok(Resource {
        url: format!("/_assets/{file}"),
        integrity: metadata.integrity.clone(),
    })
}

/// Resolve asset URLs from the manifest for a given route pattern.
fn resolve_assets(
    manifest: &AssetManifest,
    route_pattern: &str,
) -> Result<ResolvedAssets, RenderError> {
    let route = manifest.route(route_pattern);
    let resolve = |files: &[String]| {
        files
            .iter()
            .map(|file| resource(manifest, file, route_pattern))
            .collect::<Result<Vec<_>, _>>()
    };
    Ok(ResolvedAssets {
        fonts: route
            .map(|r| r.fonts.iter().map(|f| format!("/_assets/{f}")).collect())
            .unwrap_or_default(),
        css_urls: resolve(route.map_or(&[], |r| &r.css))?,
        js_urls: resolve(route.map_or(&[], |r| &r.js))?,
    })
}

/// Build shared body fragments (class attr, prefix, escaped JSON data, page JS tag).
struct BodyParts {
    body_class_attr: String,
    body_prefix: String,
    config_json_tag: String,
    page_js_tag: String,
    sw_script: String,
}

fn build_body_parts(nonce: &str, config: &PageConfig, js_urls: &[Resource]) -> BodyParts {
    let body_class_attr = config
        .body_class
        .map(|c| format!(" class=\"{}\"", escape_dom_html(c)))
        .unwrap_or_default();
    let body_prefix = config
        .body_prefix
        .map_or("", crate::RawHtml::as_str)
        .to_string();

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

    // Route `js` contains declared entry modules in order. Dependency chunks
    // live in the separate modulepreload table and must not execute eagerly.
    let page_js_tag = js_urls
        .iter()
        .map(|url| {
            format!(
                "<script type=\"module\" nonce=\"{nonce}\" src=\"{}\" integrity=\"{}\" crossorigin=\"anonymous\"></script>",
                escape_dom_html(&url.url),
                escape_html(&url.integrity)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    // Registration belongs only to pages that publish a JavaScript entry.
    // Static pages never bootstrap a worker, even in an enabled application.
    // The worker endpoint and off-mode retirement remain independently available.
    let sw_script = if js_urls.is_empty() {
        String::new()
    } else {
        crate::sw::registration_script(nonce)
    };

    BodyParts {
        body_class_attr,
        body_prefix,
        config_json_tag,
        page_js_tag,
        sw_script,
    }
}

/// The document around the page's root: empty for a client-mounted page,
/// or holding the walk's HTML. `ctx` carries the typed head metadata.
pub(crate) fn write_document(
    config: &PageConfig,
    nonce: &CspNonce,
    ssr_body: Option<&str>,
    island_state: Option<&forma_ir::IslandState>,
    ctx: &RenderCtx,
    max_output_bytes: usize,
    counts: crate::RenderCounts,
) -> Result<String, RenderError> {
    #[cfg(feature = "navigation")]
    let navigation_metadata = crate::navigation::initial_metadata(config, ctx)?;
    #[cfg(not(feature = "navigation"))]
    let navigation_metadata = String::new();
    write_document_parts(
        config,
        nonce,
        ssr_body,
        island_state.map(forma_ir::IslandState::as_json),
        ctx,
        max_output_bytes,
        counts,
        &navigation_metadata,
        false,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn write_document_parts(
    config: &PageConfig,
    nonce: &CspNonce,
    ssr_body: Option<&str>,
    island_state: Option<&str>,
    ctx: &RenderCtx,
    max_output_bytes: usize,
    counts: crate::RenderCounts,
    navigation_metadata: &str,
    owner_branch: bool,
) -> Result<String, RenderError> {
    // Defence in depth: CspNonce already rejects anything attribute- or
    // directive-significant, so this never changes a real nonce.
    let nonce_attr = escape_html(nonce.as_str());
    let assets = resolve_assets(config.manifest, config.route_pattern)?;
    let mut preloads = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for file in ctx.module_preloads(config.route_pattern) {
        let url = format!("/_assets/{file}");
        if assets.js_urls.iter().any(|asset| asset.url == url) || !seen.insert(file) {
            continue;
        }
        preloads.push(resource(config.manifest, file, config.route_pattern)?);
    }
    let head = build_head(
        config.title,
        &nonce_attr,
        &assets,
        config.personality_css,
        &preloads,
        ctx.head_links(),
    );
    let parts = build_body_parts(&nonce_attr, config, &assets.js_urls);
    // The root names the build the manifest names (FORMA-186, DR-29): core compares it
    // with the identity compiled into the bundle before it activates anything. The
    // manifest is data, so it is escaped as any attribute value is, and no render input
    // can set or override it.
    let static_route = config
        .manifest
        .route(config.route_pattern)
        .is_some_and(crate::RouteAssets::is_static_ssr);
    let build_attr = if static_route {
        String::new()
    } else {
        format!(
            " data-forma-build=\"{}\"",
            escape_html(&config.manifest.build)
        )
    };

    // Every byte of the completed document, including state tags/envelope,
    // counts against the same response limit. Charge before allocating/copying
    // the final document; body walk counts remain a separate diagnostic.
    let fragments = [
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n",
        head.as_str(),
        if island_state.is_some() {
            "<script type=\"application/json\" data-island-state>"
        } else {
            ""
        },
        island_state.unwrap_or(""),
        if island_state.is_some() {
            "</script>\n"
        } else {
            ""
        },
        navigation_metadata,
        "</head>\n<body",
        parts.body_class_attr.as_str(),
        ">\n",
        parts.body_prefix.as_str(),
        "<div id=\"app\"",
        build_attr.as_str(),
        if owner_branch {
            " data-forma-router-root"
        } else {
            ""
        },
        if ssr_body.is_some() {
            if static_route {
                ">"
            } else {
                " data-forma-ssr>"
            }
        } else {
            "></div>"
        },
        ssr_body.unwrap_or(""),
        if ssr_body.is_some() { "</div>" } else { "" },
        "\n",
        parts.config_json_tag.as_str(),
        parts.page_js_tag.as_str(),
        "\n",
        parts.sw_script.as_str(),
        "</body>\n</html>",
    ];
    let total = fragments
        .iter()
        .try_fold(0usize, |total, part| total.checked_add(part.len()));
    let Some(total) = total.filter(|total| *total <= max_output_bytes) else {
        return Err(RenderError::Budget {
            route: config.route_pattern.into(),
            component_path: Vec::new(),
            counts,
            cause: forma_ir::IrError::OutputLimitExceeded {
                limit: max_output_bytes,
            },
        });
    };
    let mut html = String::with_capacity(total);
    for fragment in fragments {
        html.push_str(fragment);
    }

    Ok(html)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render_contract::{RenderFixture as PageConfig, RenderPath as RenderMode};
    use crate::types::RouteAssets;
    use forma_ir::parser::IrModule;
    use forma_ir::slot::{SlotData, SlotValue};
    use std::collections::HashMap;

    fn render_parts(config: &PageConfig) -> crate::PageParts {
        let ctx = RenderCtx::new();
        match config.render_mode {
            RenderMode::Phase1ClientMount => crate::render_contract::render_shell(config, &ctx),
            RenderMode::Phase2SsrReconcile => crate::render_contract::render_ssr(config, &ctx),
        }
        .expect("valid fixture renders")
        .into_parts_unchecked()
    }
    fn policy(page: &crate::PageParts) -> &str {
        page.headers
            .iter()
            .find(|(name, _)| name == "content-security-policy")
            .unwrap()
            .1
            .to_str()
            .unwrap()
    }

    /// Build a minimal AssetManifest with no routes for testing.
    fn empty_manifest() -> AssetManifest {
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

    #[test]
    fn a_legacy_manifest_is_refused_before_removed_wasm_fields_can_be_used() {
        let error = serde_json::from_value::<AssetManifest>(serde_json::json!({
            "version":1,"build_hash":"legacy","assets":{},"routes":{},
            "wasm":{"loader":"legacy-loader.js","binary":"legacy.wasm"}
        }))
        .unwrap_err();
        assert!(error.to_string().contains("MANIFEST-101"));
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
        let page = render_parts(&PageConfig {
            title: "Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });

        // The root carries the build's identity (FORMA-186); the manifest's build here is "test".
        assert!(page
            .html
            .contains("<div id=\"app\" data-forma-build=\"test\"></div>"));
        // Check that the #app div does NOT have the SSR attribute
        assert!(!page.html.contains("data-forma-ssr"));
    }

    #[test]
    fn phase2_renders_ssr_content_with_data_attr() {
        let manifest = empty_manifest();
        let ir = hello_ir_module();
        let slots = SlotData::new(0);

        let page = render_parts(&PageConfig {
            title: "SSR Test",
            route_pattern: "/test",
            manifest: &manifest,
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
        assert!(page.html.contains(
            "<div id=\"app\" data-forma-build=\"test\" data-forma-ssr><p>hello</p></div>"
        ));
    }

    /// The deployment identity (FORMA-186, DR-29) is the manifest's `build`, written
    /// on the root of a server-rendered page and of a browser shell, once, escaped
    /// as any attribute value is: a manifest is data, never markup.
    ///
    /// Verified by: crates/forma-server/src/template.rs > "the_root_carries_the_manifests_build_escaped_on_both_forms"
    #[test]
    fn the_root_carries_the_manifests_build_escaped_on_both_forms() {
        let mut manifest = empty_manifest();
        manifest.build = "5f0c9a1e7d2b4c86".into();
        let ir = hello_ir_module();
        let slots = SlotData::new(0);
        for (mode, ir_module, slots) in [
            (RenderMode::Phase1ClientMount, None, None),
            (RenderMode::Phase2SsrReconcile, Some(&ir), Some(&slots)),
        ] {
            let page = render_parts(&PageConfig {
                title: "Identity",
                route_pattern: "/test",
                manifest: &manifest,
                config_json: None,
                body_class: None,
                personality_css: None,
                body_prefix: None,
                render_mode: mode,
                ir_module,
                slots,
            });
            assert_eq!(
                page.html.matches("data-forma-build=").count(),
                1,
                "exactly one stamp: {}",
                page.html
            );
            assert!(page
                .html
                .contains("<div id=\"app\" data-forma-build=\"5f0c9a1e7d2b4c86\""));
        }
        manifest.build = "a\"b<c>&d".into();
        let page = render_parts(&PageConfig {
            title: "Identity",
            route_pattern: "/test",
            manifest: &manifest,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });
        assert!(page
            .html
            .contains("data-forma-build=\"a&quot;b&lt;c&gt;&amp;d\""));
        assert!(!page.html.contains("a\"b<c>"));
    }

    #[test]
    fn phase2_ssr_preserves_head_content() {
        let manifest = empty_manifest();
        let ir = hello_ir_module();
        let slots = SlotData::new(0);

        let page = render_parts(&PageConfig {
            title: "Head Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_json: Some(&serde_json::json!({"test":true})),
            body_class: Some("dark"),
            personality_css: Some(":root{--c:red}"),
            body_prefix: Some(&crate::RawHtml::trusted("<nav>nav</nav>")),
            render_mode: RenderMode::Phase2SsrReconcile,
            ir_module: Some(&ir),
            slots: Some(&slots),
        });

        assert!(page.html.contains("<title>Head Test</title>"));
        assert!(page.html.contains("window.__FORMA_CONFIG__="));
        assert!(page.html.contains("class=\"dark\""));
        assert!(page.html.contains(":root{--c:red}"));
        assert!(page.html.contains("<nav>nav</nav>"));
        assert!(page.html.contains("<p>hello</p>"));
        assert!(page.html.contains("data-forma-ssr"));
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
        let page = render_parts(&PageConfig {
            title: "Slot Test",
            route_pattern: "/test",
            manifest: &manifest,
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
                #[cfg(feature = "navigation")]
                navigation: None,
                mode: crate::RouteMode::Browser,
                modulepreload: Vec::new(),
                js: vec!["\"><script>alert(1)</script>".to_string()],
                css: vec!["\"><script>alert(2)</script>".to_string()],
                fonts: vec!["\"><script>alert(3)</script>".to_string()],
                total_size_br: 0,
                budget_warn_threshold: 204800,
                ir: None,
            },
        );
        let manifest = AssetManifest {
            version: 2,
            writer: "3.0.0".into(),
            app: "ledger".into(),
            aliases: HashMap::new(),
            build: "test".to_string(),
            assets: crate::render_contract::fixture_assets(&routes),
            routes,
        };

        let page = render_parts(&PageConfig {
            title: "XSS Test",
            route_pattern: "/test",
            manifest: &manifest,
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
        let page = render_parts(&PageConfig {
            title: "Body Class Test",
            route_pattern: "/test",
            manifest: &manifest,
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
            let page = render_parts(&PageConfig {
                title: "CSS Test",
                route_pattern: "/test",
                manifest: &manifest,
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
        let page = render_parts(&PageConfig {
            title: "CSS Test",
            route_pattern: "/test",
            manifest: &manifest,
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

    #[test]
    fn config_json_emits_no_raw_angle_brackets() {
        let manifest = empty_manifest();
        let value = serde_json::json!({
            "user": "</script><img src=x onerror=alert(1)>",
            "note": "<!--<script>",
        });
        let page = render_parts(&PageConfig {
            title: "Config Test",
            route_pattern: "/test",
            manifest: &manifest,
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
    fn named_parts_expose_the_nonce_bound_to_the_document() {
        let manifest = empty_manifest();
        let page = render_parts(&PageConfig {
            title: "Nonce Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_json: Some(&serde_json::json!({"x":1})),
            body_class: None,
            personality_css: Some("body{color:red}"),
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });

        // No string-parsing the CSP to recover it.
        assert!(policy(&page).contains(&format!("'nonce-{}'", page.nonce)));
        assert!(page
            .html
            .contains(&format!("<script nonce=\"{}\">", page.nonce)));
        assert!(page
            .html
            .contains(&format!("<style nonce=\"{}\">", page.nonce)));
    }

    #[test]
    fn page_response_headers_are_no_store() {
        // The HTML embeds a per-request nonce, so it must never be cached.
        let manifest = empty_manifest();
        let page = render_parts(&PageConfig {
            title: "Header Test",
            route_pattern: "/test",
            manifest: &manifest,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });

        let headers = page.headers;
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
        let page = render_parts(&PageConfig {
            title: "Style Attr",
            route_pattern: "/test",
            manifest: &manifest,
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
            policy(&page).contains("style-src-attr 'unsafe-inline'"),
            "CSP must permit the attribute style the walker just emitted: {}",
            policy(&page)
        );
    }
}
