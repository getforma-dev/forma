//! The typed homes for what applications put in `body_prefix` that is not
//! their own markup (DR-19; FORMA-126): forma-server writes the route's
//! `modulepreload` links from the build's manifest, nonced (Ledger's
//! workaround), and head links have a field (ksx Studio's `</head>` splice).
//! Data already has `config_json`.
//!
//! Every guarantee is asserted on both renders that take a `RenderCtx`
//! (`Path`): `try_render` and `render_browser_shell`.
#![allow(deprecated)]

use super::{
    render_shell as render_browser_shell, render_ssr as try_render, RenderFixture as PageConfig,
    RenderPath as RenderMode,
};
use crate as forma_server;
use forma_ir::parser::test_helpers::{
    build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
};
use forma_ir::{IrModule, SlotData};
use forma_server::assets::{try_load_manifest, try_load_module_preloads};
use forma_server::{AssetManifest, HeadLink, PageResponse, RenderCtx, RenderError, RouteAssets};
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
    let head = &parts.html[start..end];
    const STATE: &str = "<script type=\"application/json\" data-island-state>{\"v\":1,\"s\":[],\"i\":[]}</script>\n";
    // These fixtures have no islands. Assert the new state block exactly,
    // then compare the pre-existing typed links/style portion unchanged.
    assert_eq!(
        head.matches(STATE).count(),
        usize::from(parts.html.contains("data-forma-ssr"))
    );
    (head.replace(STATE, ""), nonce)
}

fn preload(nonce: &str, file: &str) -> String {
    format!("<link rel=\"modulepreload\" nonce=\"{nonce}\" href=\"/_assets/{file}\" integrity=\"sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb\" crossorigin=\"anonymous\">\n")
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
    // Every loading path shares the same reference validation.
    assert!(try_load_manifest::<Foreign>().is_err());
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
            #[cfg(feature = "navigation")]
            navigation: None,
            mode: forma_server::RouteMode::Browser,
            modulepreload: Vec::new(),
            js: vec!["app.1.js".into()],
            css: vec!["s.2.css".into()],
            fonts: vec![],
            total_size_br: 0,
            budget_warn_threshold: 0,
            ir: None,
        },
    );
    AssetManifest {
        version: 2,
        writer: "3.0.0".into(),
        app: "ledger".into(),
        aliases: HashMap::new(),
        build: "h".into(),
        assets: super::fixture_assets(&routes),
        routes,
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
            "<link rel=\"stylesheet\" href=\"/_assets/s.2.css\" integrity=\"sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb\" crossorigin=\"anonymous\">\n\
             <link rel=\"modulepreload\" nonce=\"{nonce}\" href=\"/_assets/app.1.js\" integrity=\"sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb\" crossorigin=\"anonymous\">\n\
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

/// Exported only on an explicit test-run request for the real-browser metadata
/// gate. These are actual complete SSR/shell documents, never copied HTML.
#[test]
fn ordinary_metadata_uses_the_shared_rule_one_vectors_on_both_render_paths() {
    let vectors: serde_json::Value = serde_json::from_str(include_str!(
        "../../../forma-ir/tests/fixtures/parity/normalization.json"
    ))
    .unwrap();
    let manifest = styled_manifest();
    let module = module();
    let slots = SlotData::new(0);
    let mut documents = Vec::new();
    let mut failures = Vec::new();
    for vector in vectors["values"].as_array().unwrap() {
        let input = vector["input"].as_str().unwrap();
        let expected = vector["expected"].as_str().unwrap();
        // This oracle escapes already-normalized shared expected values; it
        // deliberately does not call the production writer/normalizer.
        let escaped = expected
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;");
        let ctx = RenderCtx::new().with_head_link(
            HeadLink::new("alternate", "/metadata?one=1&two=2")
                .unwrap()
                .with_type(input)
                .with_sizes(input),
        );
        for (name, render) in PATHS {
            let mut config = config(&manifest, "/", &module, &slots, None);
            config.title = input;
            config.body_class = Some(input);
            let page = render(&config, &ctx).unwrap().into_parts_unchecked();
            for fragment in [
                format!("<title>{escaped}</title>"),
                format!("<body class=\"{escaped}\">"),
                format!("type=\"{escaped}\" sizes=\"{escaped}\""),
            ] {
                if !page.html.contains(&fragment) {
                    failures.push(format!("{name}/{} missing {fragment:?}", vector["id"]));
                }
            }
            // Nonces and manifest digests stay opaque and exact.
            if vector["id"] == "nul" {
                let size = page.html.len();
                let limits = |bytes| {
                    ctx.clone().with_limits(forma_ir::WalkLimits {
                        max_output_bytes: bytes,
                        ..forma_ir::WalkLimits::default()
                    })
                };
                assert!(render(&config, &limits(size)).is_ok());
                assert!(matches!(
                    render(&config, &limits(size - 1)),
                    Err(RenderError::Budget { .. })
                ));
            }
            let nonce = page.nonce.to_string();
            assert!(page.html.contains(&format!("nonce=\"{nonce}\"")));
            assert!(page
                .headers
                .iter()
                .any(|(key, value)| key == "content-security-policy"
                    && value
                        .to_str()
                        .unwrap()
                        .contains(&format!("'nonce-{nonce}'"))));
            assert!(page.html.contains("integrity=\"sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb\""));
            documents.push(serde_json::json!({
                "path": name, "id": vector["id"], "expected": expected, "document": page.html,
            }));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    if let Some(path) = std::env::var_os("FORMA_METADATA_OUTPUT") {
        std::fs::write(path, serde_json::to_vec(&documents).unwrap()).unwrap();
    }
}

#[test]
fn metadata_normalization_preserves_transport_and_url_refusals() {
    let manifest = styled_manifest();
    let module = module();
    let slots = SlotData::new(0);
    let data = serde_json::json!({"value": "original\r\n\0<&"});
    for (_, render) in PATHS {
        let mut config = config(&manifest, "/", &module, &slots, None);
        config.config_json = Some(&data);
        let page = render(&config, &RenderCtx::new())
            .unwrap()
            .into_parts_unchecked();
        let start =
            page.html.find("window.__FORMA_CONFIG__=").unwrap() + "window.__FORMA_CONFIG__=".len();
        let json = page.html[start..].split(";</script>").next().unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(json).unwrap(),
            data
        );
    }
    for href in [
        "java\r\nscript:alert(1)",
        "\r\nvbscript:x",
        "java\rscript:x",
    ] {
        assert_eq!(
            HeadLink::new("alternate", href).unwrap_err().code(),
            "HEAD-103"
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
        assert_eq!(error.code(), "HEAD-103", "{href:?}");
        assert_eq!(error.reason(), "href is a script URL", "{href:?}");
        assert!(error.to_string().starts_with("HEAD-103 "), "{error}");
        assert!(error.to_string().contains("rel=\"icon\""), "{error}");
    }
    let empty = HeadLink::new("icon", " ").expect_err("empty");
    assert_eq!(
        (empty.code(), empty.reason()),
        ("HEAD-104", "href is empty")
    );

    // Negative space: what an icon, a feed or a canonical URL links to is
    // kept, including a path or host that merely contains a script scheme's
    // name.
    let manifest = styled_manifest();
    let module = module();
    let slots = SlotData::new(0);
    for (rel, href) in [
        ("icon", "/favicon.ico"),
        (
            "icon",
            "data:image/svg+xml,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%2F%3E",
        ),
        ("alternate", "/feed.xml"),
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

/// The link types a head link carries, each written as given in lower case.
const KEPT: [&str; 10] = [
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

/// The link types that load style or script (HEAD-101).
const LOADING: [&str; 6] = [
    "stylesheet",
    "modulepreload",
    "preload",
    "prefetch",
    "prerender",
    "import",
];

/// Every other link type the HTML standard and the browsers define, and the
/// legacy ones in use (HEAD-102): none may be added without this test.
const OTHERS: [&str; 19] = [
    "bookmark",
    "expect",
    "external",
    "help",
    "me",
    "next",
    "nofollow",
    "noopener",
    "noreferrer",
    "opener",
    "pingback",
    "prev",
    "privacy-policy",
    "search",
    "tag",
    "terms-of-service",
    "shortcut",
    "serviceworker",
    "compression-dictionary",
];

#[test]
fn a_head_link_carries_only_the_listed_link_types() {
    let manifest = styled_manifest();
    let module = module();
    let slots = SlotData::new(0);
    let head_for = |link: HeadLink| {
        let page = try_render(
            &config(&manifest, "/", &module, &slots, None),
            &RenderCtx::new().with_head_link(link),
        )
        .expect("renders");
        head_and_nonce(page).0
    };

    // Each kept type, in any case, alone and beside another kept type.
    for rel in KEPT {
        for given in [rel.to_string(), rel.to_ascii_uppercase()] {
            let link = HeadLink::new(&given, "/x").unwrap_or_else(|e| panic!("{given}: {e}"));
            assert!(
                head_for(link).ends_with(&format!("<link rel=\"{rel}\" href=\"/x\">\n")),
                "{given}"
            );
        }
        let pair = HeadLink::new(&format!("alternate\t {rel}"), "/x").expect("two kept types");
        assert!(head_for(pair).ends_with(&format!("<link rel=\"alternate {rel}\" href=\"/x\">\n")));
    }

    // A type that loads style or script, alone, in any case, or beside a
    // kept one: HEAD-101, whatever the href.
    for rel in LOADING {
        for given in [
            rel.to_string(),
            rel.to_ascii_uppercase(),
            format!("alternate {rel}"),
            format!("{rel} icon"),
        ] {
            for href in [
                "/same-origin.css",
                "data:text/css,body{}",
                "https://cdn.example/x.js",
            ] {
                let error = HeadLink::new(&given, href).expect_err(&given);
                assert_eq!(error.code(), "HEAD-101", "{given} {href}");
                assert!(error.reason().contains("build's manifest"), "{error}");
            }
        }
    }

    // Any other type, or no link type at all: HEAD-102.
    for rel in OTHERS.iter().copied().chain([
        "",
        " ",
        "shortcut icon",
        "icon\"",
        "ic<on",
        "icon,",
        "stylesheets",
        "x-icon",
    ]) {
        let error = HeadLink::new(rel, "/x").expect_err(rel);
        assert_eq!(error.code(), "HEAD-102", "{rel:?}");
        assert!(error.to_string().starts_with("HEAD-102 "), "{error}");
    }
}
