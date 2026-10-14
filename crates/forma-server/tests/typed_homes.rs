//! The typed homes for what applications put in `body_prefix` that is not
//! their own markup (DR-19; FORMA-126): forma-server writes the route's
//! `modulepreload` links from the build's manifest, nonced (Ledger's
//! workaround), and head links have a field (ksx Studio's `</head>` splice).
//! Data already has `config_json`.
//!
//! Every guarantee is asserted on both renders that take a `RenderCtx`
//! (`Path`): `try_render` and `render_browser_shell`.
// `config_script` is a field every 0.2.x literal names.
#![allow(deprecated)]

use forma_ir::parser::test_helpers::{
    build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
};
use forma_ir::{IrModule, SlotData};
use forma_server::assets::{try_load_manifest, try_load_module_preloads};
use forma_server::{
    render_browser_shell, try_render, AssetManifest, HeadLink, PageConfig, PageResponse, RenderCtx,
    RenderError, RenderMode, RouteAssets,
};
use rust_embed::Embed;
use std::collections::HashMap;

#[derive(Embed)]
#[folder = "tests/fixtures/preloads/good/"]
struct Split;

#[derive(Embed)]
#[folder = "tests/fixtures/preloads/foreign/"]
struct Foreign;

type Path = fn(&PageConfig, &RenderCtx) -> Result<PageResponse, RenderError>;
const PATHS: [(&str, Path); 2] = [
    ("try_render", try_render),
    ("render_browser_shell", render_browser_shell),
];

fn module() -> IrModule {
    let mut ops = encode_open_tag(0, &[]);
    ops.extend_from_slice(&encode_text(1));
    ops.extend_from_slice(&encode_close_tag(0));
    IrModule::parse(&build_minimal_ir(&["p", "walked"], &[], &ops, &[])).expect("module")
}

fn config<'a>(
    manifest: &'a AssetManifest,
    route: &'a str,
    module: &'a IrModule,
    slots: &'a SlotData,
    personality_css: Option<&'a str>,
) -> PageConfig<'a> {
    PageConfig {
        title: "Homes",
        route_pattern: route,
        manifest,
        config_script: None,
        config_json: None,
        body_class: None,
        personality_css,
        body_prefix: None,
        render_mode: RenderMode::Phase2SsrReconcile,
        ir_module: Some(module),
        slots: Some(slots),
    }
}

/// The page's head (between `<head>\n` and `</head>`) and the nonce its
/// policy blesses, checked to be the one the HTML carries.
fn head_and_nonce(page: PageResponse) -> (String, String) {
    let parts = page.into_parts_unchecked();
    let nonce = parts.nonce.to_string();
    let csp = parts
        .headers
        .iter()
        .find(|(n, _)| n.as_str() == "content-security-policy")
        .map(|(_, v)| v.to_str().expect("ascii").to_string())
        .expect("policy");
    assert!(csp.contains(&format!("'nonce-{nonce}'")), "{csp}");
    let start = parts.html.find("<head>\n").expect("head") + "<head>\n".len();
    let end = parts.html.find("</head>").expect("head end");
    (parts.html[start..end].to_string(), nonce)
}

fn preload(nonce: &str, file: &str) -> String {
    format!("<link rel=\"modulepreload\" nonce=\"{nonce}\" href=\"/_assets/{file}\">\n")
}

#[test]
fn try_render_writes_the_routes_manifest_modulepreload_links_nonced() {
    let manifest = try_load_manifest::<Split>().expect("manifest");
    let preloads = try_load_module_preloads::<Split>().expect("preloads");
    let module = module();
    let slots = SlotData::new(0);
    let ctx = RenderCtx::new().with_module_preloads(&preloads);

    // Each route's entry first (written from `js`, as in 0.2.1), then its
    // static dependencies in the manifest's order: no repeat, not the entry
    // again, no other route's chunk, no dynamically imported chunk.
    let expected: [(&str, &[&str]); 3] = [
        (
            "/",
            &["home.A1B2C3D4.js", "chunk.SHARED01.js", "chunk.HOMEONLY.js"],
        ),
        (
            "/admin",
            &[
                "admin.E5F6A7B8.js",
                "chunk.ADMIN001.js",
                "chunk.SHARED01.js",
            ],
        ),
        ("/plain", &["home.A1B2C3D4.js"]),
    ];
    for (name, render) in PATHS {
        for (route, files) in expected {
            let page =
                render(&config(&manifest, route, &module, &slots, None), &ctx).expect("renders");
            let (head, nonce) = head_and_nonce(page);
            let block: String = files.iter().map(|f| preload(&nonce, f)).collect();
            // Exactly these links, in this order, and no other preload.
            assert!(head.ends_with(&block), "{name} {route}:\n{head}");
            assert_eq!(
                head.matches("rel=\"modulepreload\"").count(),
                files.len(),
                "{name} {route}:\n{head}"
            );
            assert!(!head.contains("LAZY0001"), "{name} {route}: a lazy chunk");
        }

        // Without the table, the 0.2.1 head: the entry alone.
        let page = render(
            &config(&manifest, "/", &module, &slots, None),
            &RenderCtx::new(),
        )
        .expect("renders");
        let (head, nonce) = head_and_nonce(page);
        assert!(
            head.ends_with(&preload(&nonce, "home.A1B2C3D4.js")),
            "{name}"
        );
        assert_eq!(head.matches("rel=\"modulepreload\"").count(), 1, "{name}");
    }
}

#[test]
fn a_manifest_preload_that_is_not_one_of_the_builds_files_refuses_the_table() {
    let error = try_load_module_preloads::<Foreign>().expect_err("refused");
    assert!(error.contains("route /"), "{error}");
    assert!(error.contains("https://cdn.example/evil.js"), "{error}");
    assert!(error.contains("not one of the build's files"), "{error}");
    // The same manifest is otherwise a manifest: the refusal is the preload's.
    assert!(try_load_manifest::<Foreign>().is_ok());
    // And the table for a build whose preloads are all its own loads.
    let table = try_load_module_preloads::<Split>().expect("loads");
    assert_eq!(table.route("/"), ["chunk.SHARED01.js", "chunk.HOMEONLY.js"]);
    assert!(table.route("/plain").is_empty());
    assert!(table.route("/missing").is_empty());
}

fn styled_manifest() -> AssetManifest {
    let mut routes = HashMap::new();
    routes.insert(
        "/".to_string(),
        RouteAssets {
            js: vec!["app.1.js".into()],
            css: vec!["s.2.css".into()],
            fonts: vec![],
            total_size_br: 0,
            budget_warn_threshold: 0,
            ir: None,
        },
    );
    AssetManifest {
        version: 1,
        build_hash: "h".into(),
        assets: HashMap::new(),
        routes,
        wasm: None,
    }
}

#[test]
fn head_links_are_written_escaped_in_the_head_in_the_order_added() {
    let manifest = styled_manifest();
    let module = module();
    let slots = SlotData::new(0);
    let ctx = RenderCtx::new()
        .with_head_link(
            HeadLink::new("icon", "/favicon.svg")
                .expect("link")
                .with_type("image/svg+xml"),
        )
        .with_head_link(
            HeadLink::new("apple-touch-icon", "/apple-touch-icon.png")
                .expect("link")
                .with_sizes("180x180"),
        )
        // A value with every character that could leave its attribute.
        .with_head_link(
            HeadLink::new("alternate", "/feed?a=1&b=\"><script>alert(1)</script>")
                .expect("link")
                .with_type("application/rss+xml\" onload=\"alert(1)"),
        );

    for (name, render) in PATHS {
        let page = render(
            &config(&manifest, "/", &module, &slots, Some("body{margin:0}")),
            &ctx,
        )
        .expect("renders");
        let (head, nonce) = head_and_nonce(page);
        let expected = format!(
            "<link rel=\"stylesheet\" href=\"/_assets/s.2.css\">\n\
             <link rel=\"modulepreload\" nonce=\"{nonce}\" href=\"/_assets/app.1.js\">\n\
             <link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\">\n\
             <link rel=\"apple-touch-icon\" href=\"/apple-touch-icon.png\" sizes=\"180x180\">\n\
             <link rel=\"alternate\" href=\"/feed?a=1&amp;b=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;\" \
             type=\"application/rss+xml&quot; onload=&quot;alert(1)\">\n\
             <style nonce=\"{nonce}\">body{{margin:0}}</style>\n"
        );
        // After the stylesheets and preloads, before the inline style.
        assert!(head.ends_with(&expected), "{name}:\n{head}");
        assert!(
            !head.contains("<script"),
            "{name}: no element escaped its attribute"
        );
        assert!(
            !head.contains("\" onload"),
            "{name}: no attribute escaped its value"
        );

        // Without links, the same head less exactly those three lines.
        let page = render(
            &config(&manifest, "/", &module, &slots, Some("body{margin:0}")),
            &RenderCtx::new(),
        )
        .expect("renders");
        let (bare, bare_nonce) = head_and_nonce(page);
        let links: String = expected
            .lines()
            .filter(|l| !l.contains("nonce=") && !l.contains("stylesheet"))
            .map(|l| format!("{l}\n"))
            .collect();
        assert_eq!(
            head.replace(&nonce, "N").replacen(&links, "", 1),
            bare.replace(&bare_nonce, "N"),
            "{name}"
        );
    }
}

#[test]
fn a_head_link_refuses_a_script_url_and_keeps_every_other() {
    for href in [
        "javascript:alert(1)",
        "JAVASCRIPT:alert(1)",
        " \tjavascript:alert(1)",
        "java\nscript:alert(1)",
        "vbscript:msgbox(1)",
        "javascript://example.com/%0aalert(1)",
    ] {
        let error = HeadLink::new("icon", href).expect_err(href);
        assert_eq!(error.reason(), "href is a script URL", "{href:?}");
        assert!(error.to_string().contains("rel=\"icon\""), "{error}");
    }
    for (rel, reason) in [
        (
            "",
            "rel is not a list of link types separated by single spaces",
        ),
        (
            "icon\"",
            "rel is not a list of link types separated by single spaces",
        ),
        (
            "icon  x",
            "rel is not a list of link types separated by single spaces",
        ),
        (
            "icon ",
            "rel is not a list of link types separated by single spaces",
        ),
        (
            "ic<on",
            "rel is not a list of link types separated by single spaces",
        ),
    ] {
        let error = HeadLink::new(rel, "/favicon.ico").expect_err(rel);
        assert_eq!(error.reason(), reason, "{rel:?}");
    }
    assert_eq!(
        HeadLink::new("icon", " ").expect_err("empty").reason(),
        "href is empty"
    );

    // Negative space: what an icon, a manifest or a feed links to is kept,
    // including a path or host that merely contains a script scheme's name.
    let manifest = styled_manifest();
    let module = module();
    let slots = SlotData::new(0);
    for (rel, href) in [
        ("icon", "/favicon.ico"),
        (
            "icon",
            "data:image/svg+xml,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%2F%3E",
        ),
        ("manifest", "/site.webmanifest"),
        ("alternate stylesheet", "/dark.css"),
        ("canonical", "https://example.com/guides/javascript"),
        ("icon", "/javascript:not-a-scheme.png"),
        ("preconnect", "https://javascript.example"),
    ] {
        let link = HeadLink::new(rel, href).unwrap_or_else(|e| panic!("{rel} {href}: {e}"));
        let page = try_render(
            &config(&manifest, "/", &module, &slots, None),
            &RenderCtx::new().with_head_link(link),
        )
        .expect("renders");
        let (head, _) = head_and_nonce(page);
        assert!(
            head.ends_with(&format!("<link rel=\"{rel}\" href=\"{href}\">\n")),
            "{rel} {href}:\n{head}"
        );
    }
}
