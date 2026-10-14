//! `PageResponse::frame`: the preview frame's document, with an opaque
//! origin, no network, and the runtime inline (DR-14 tier (c); L-17, L-27,
//! L-44; SR32; FORMA-125).
// `config_script` and `AssetManifest::wasm` are fields every 0.2.x literal
// names, and the bridge from `render_page` is one of the page paths.
#![allow(deprecated)]

use axum::body::to_bytes;
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use forma_server::assets::try_load_manifest;
use forma_server::csp::build_csp_header;
use forma_server::{
    render_browser_shell, render_page, try_render, AssetManifest, CspNonce, PageConfig,
    PageResponse, PolicyExtensions, PreviewFrame, RenderCtx, RenderMode, RouteAssets,
};
use rust_embed::Embed;
use std::collections::HashMap;
use std::path::Path;

#[derive(Embed)]
#[folder = "tests/fixtures/frame/good/"]
struct Good;
#[derive(Embed)]
#[folder = "tests/fixtures/frame/no-entry/"]
struct NoEntry;
#[derive(Embed)]
#[folder = "tests/fixtures/frame/not-embedded/"]
struct NotEmbedded;
#[derive(Embed)]
#[folder = "tests/fixtures/frame/terminator/"]
struct Terminator;
#[derive(Embed)]
#[folder = "tests/fixtures/frame/comment/"]
struct Comment;
#[derive(Embed)]
#[folder = "tests/fixtures/frame/empty/"]
struct Empty;
#[derive(Embed)]
#[folder = "tests/fixtures/frame/not-utf8/"]
struct NotUtf8;

const ORIGIN: &str = "https://studio.example";

fn preview() -> PreviewFrame {
    let manifest = try_load_manifest::<Good>().expect("manifest");
    PreviewFrame::load::<Good>(&manifest, ORIGIN).expect("the runtime loads")
}

/// The headers and the HTML a client receives.
async fn sent(page: PageResponse) -> (HeaderMap, String) {
    let response = page.into_response();
    let headers = response.headers().clone();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    (headers, String::from_utf8(body.to_vec()).expect("utf-8"))
}

fn one(headers: &HeaderMap, name: &str) -> String {
    let values: Vec<_> = headers.get_all(name).iter().collect();
    assert_eq!(values.len(), 1, "exactly one {name}: {values:?}");
    values[0].to_str().expect("ascii").to_string()
}

/// A policy's directives, in order, as (name, sources).
fn directives(policy: &str) -> Vec<(String, Vec<String>)> {
    policy
        .split(';')
        .map(|d| {
            let mut words = d.split_ascii_whitespace().map(str::to_string);
            let name = words.next().expect("a directive name");
            (name, words.collect())
        })
        .collect()
}

/// The nonce of the document's one script.
fn script_nonce(html: &str) -> CspNonce {
    let start = html.find("<script nonce=\"").expect("a script") + "<script nonce=\"".len();
    let end = html[start..].find('"').expect("nonce end") + start;
    CspNonce::parse(&html[start..end]).expect("a nonce")
}

#[tokio::test]
async fn the_frame_policy_replaces_exactly_its_four_directives() {
    let preview = preview();
    let (headers, html) = sent(PageResponse::frame(&preview).expect("a frame")).await;
    let nonce = script_nonce(&html);
    let frame = directives(&one(&headers, "content-security-policy"));
    let strict = directives(&build_csp_header(&nonce));

    // Every directive of the strict policy is still there, in its place; the
    // four written in place of the strict ones are exactly these; nothing
    // else was added, removed or changed.
    let expected_frame: Vec<(String, Vec<String>)> = strict
        .iter()
        .map(|(name, sources)| {
            let sources = match name.as_str() {
                "script-src" => vec![format!("'nonce-{nonce}'")],
                "connect-src" => vec!["'none'".to_string()],
                "frame-ancestors" => vec![ORIGIN.to_string()],
                _ => sources.clone(),
            };
            (name.clone(), sources)
        })
        .chain([("sandbox".to_string(), vec!["allow-scripts".to_string()])])
        .collect();
    assert_eq!(frame, expected_frame);

    // In the words of SR32: no `allow-same-origin`, no `'strict-dynamic'` or
    // `'self'` for scripts, and `style-src-attr`'s still the only
    // `'unsafe-inline'` (SR39).
    let policy = one(&headers, "content-security-policy");
    assert!(!policy.contains("allow-same-origin"), "{policy}");
    assert!(!policy.contains("strict-dynamic"), "{policy}");
    assert_eq!(policy.matches("'unsafe-inline'").count(), 1, "{policy}");
    // The enforced header, never Report-Only: `sandbox` is ignored there.
    assert!(headers
        .get_all("content-security-policy-report-only")
        .iter()
        .all(|v| !v.to_str().expect("ascii").contains("sandbox")));
    // The rest of a page's headers.
    assert_eq!(one(&headers, "cache-control"), "no-store");
    assert_eq!(one(&headers, "content-type"), "text/html; charset=utf-8");
    assert_eq!(one(&headers, "x-content-type-options"), "nosniff");

    // Each frame draws its own nonce.
    let (_, again) = sent(PageResponse::frame(&preview).expect("a frame")).await;
    assert_ne!(script_nonce(&again), nonce);
}

#[tokio::test]
async fn the_frame_document_inlines_the_runtime_under_its_nonce_and_names_nothing_to_fetch() {
    let preview = preview();
    let (headers, html) = sent(PageResponse::frame(&preview).expect("a frame")).await;
    let nonce = script_nonce(&html);
    let runtime = String::from_utf8(
        Good::get("forma-runtime.0a1b2c3d.js")
            .expect("fixture")
            .data
            .to_vec(),
    )
    .expect("utf-8");

    // The whole document: one root, the runtime inline under the nonce the
    // policy blesses, and no URL anywhere, so it fetches nothing.
    assert_eq!(
        html,
        format!(
            "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
             <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
             <title>Preview</title>\n</head>\n<body>\n<div id=\"forma-frame\"></div>\n\
             <script nonce=\"{nonce}\">{runtime}</script>\n</body>\n</html>"
        )
    );
    assert!(
        one(&headers, "content-security-policy").contains(&format!("script-src 'nonce-{nonce}';"))
    );
    for absent in [
        "src=",
        "href=",
        "<link",
        "url(",
        "@import",
        "type=\"module\"",
        "app.11111111.js",
    ] {
        assert!(!html.contains(absent), "{absent} in the frame document");
    }
    assert_eq!(html.matches("<script").count(), 1);
}

#[test]
fn a_frame_without_its_runtime_is_a_coded_error_at_start() {
    fn code<A: Embed>(origin: &str) -> String {
        let manifest = try_load_manifest::<A>().expect("manifest");
        match PreviewFrame::load::<A>(&manifest, origin) {
            Ok(frame) => panic!("loaded {frame:?}"),
            Err(error) => {
                let text = error.to_string();
                assert!(text.starts_with(error.code()), "{text}");
                error.code().to_string()
            }
        }
    }
    assert_eq!(code::<NoEntry>(ORIGIN), "FRAME-101");
    assert_eq!(code::<NotEmbedded>(ORIGIN), "FRAME-102");
    assert_eq!(code::<Terminator>(ORIGIN), "FRAME-103");
    assert_eq!(code::<Comment>(ORIGIN), "FRAME-103");
    assert_eq!(code::<Empty>(ORIGIN), "FRAME-103");
    assert_eq!(code::<NotUtf8>(ORIGIN), "FRAME-103");

    // The application's origin: exactly a scheme, a host and a port.
    for origin in [
        "",
        "'self'",
        "*",
        "studio.example",
        "https://",
        "https://*.example",
        "https://studio.example/",
        "https://studio.example/preview",
        "https://studio.example?x=1",
        "https://user@studio.example",
        "https://studio.example:",
        "https://studio.example:99999x",
        "https://studio.example; script-src *",
        "https://studio.example https://evil.example",
        "https://[2001:db8::1]",
        "http://studio.example",
        "http://localhost.evil.example",
        "javascript:alert(1)",
        "data:",
    ] {
        assert_eq!(code::<Good>(origin), "FRAME-104", "{origin:?}");
    }
    let manifest = try_load_manifest::<Good>().expect("manifest");
    for (origin, written) in [
        ("https://studio.example", "https://studio.example"),
        ("HTTPS://Studio.Example:8443", "https://studio.example:8443"),
        ("http://localhost:3000", "http://localhost:3000"),
        ("http://127.0.0.1", "http://127.0.0.1"),
        ("http://[::1]:8080", "http://[::1]:8080"),
    ] {
        let frame = PreviewFrame::load::<Good>(&manifest, origin).expect(origin);
        assert_eq!(frame.app_origin(), written);
    }
}

fn manifest() -> AssetManifest {
    let mut routes = HashMap::new();
    routes.insert(
        "/".to_string(),
        RouteAssets {
            js: vec!["app.a1b2c3d4.js".to_string()],
            css: vec![],
            fonts: vec![],
            total_size_br: 0,
            budget_warn_threshold: 0,
            ir: None,
        },
    );
    AssetManifest {
        version: 1,
        build_hash: "test".to_string(),
        assets: HashMap::new(),
        routes,
        wasm: None,
    }
}

#[tokio::test]
async fn page_response_frame_is_the_only_response_that_rewrites_the_policy() {
    // Every other way to make a page writes the strict policy, unrewritten
    // and with no `sandbox` (the 2,000-case property in
    // `tests/page_response.rs` holds it for every extension set).
    let manifest = manifest();
    let module = {
        use forma_ir::parser::test_helpers::{
            build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
        };
        let mut ops = encode_open_tag(0, &[]);
        ops.extend_from_slice(&encode_text(1));
        ops.extend_from_slice(&encode_close_tag(0));
        forma_ir::IrModule::parse(&build_minimal_ir(&["p", "hi"], &[], &ops, &[])).expect("module")
    };
    let slots = forma_ir::SlotData::new(0);
    let config = PageConfig {
        title: "Page",
        route_pattern: "/",
        manifest: &manifest,
        config_script: None,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
        render_mode: RenderMode::Phase2SsrReconcile,
        ir_module: Some(&module),
        slots: Some(&slots),
    };
    let pages = [
        render_page(&config)
            .into_page_response(&PolicyExtensions::new())
            .expect("bridge"),
        try_render(&config, &RenderCtx::new()).expect("try_render"),
        render_browser_shell(&config, &RenderCtx::new()).expect("shell"),
    ];
    for page in pages {
        let parts = page.into_parts_unchecked();
        let policy = parts
            .headers
            .iter()
            .find(|(n, _)| n.as_str() == "content-security-policy")
            .map(|(_, v)| v.to_str().expect("ascii").to_string())
            .expect("policy");
        assert_eq!(policy, build_csp_header(&parts.nonce));
        assert!(!policy.contains("sandbox"));
    }

    // And in the sources, the frame's policy is built in one place and used
    // in one: `PageResponse::frame`'s.
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut uses = Vec::new();
    for entry in std::fs::read_dir(&src).expect("src") {
        let path = entry.expect("entry").path();
        let text = std::fs::read_to_string(&path).expect("utf-8");
        for (number, line) in text.lines().enumerate() {
            let code = line.trim_start();
            if !code.starts_with("//") && code.contains("frame_policy(") {
                uses.push(format!(
                    "{}:{}",
                    path.file_name().expect("name").to_string_lossy(),
                    number + 1
                ));
            }
        }
    }
    let mut files: Vec<&str> = uses
        .iter()
        .map(|u| u.split(':').next().expect("file"))
        .collect();
    files.sort_unstable();
    assert_eq!(files, ["csp.rs", "frame.rs"], "{uses:?}");
}
