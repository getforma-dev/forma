//! `PageResponse::frame`: the preview frame's document, with an opaque
//! origin, its requests closed but for the documented residuals, and the
//! runtime inline by its hash (DR-14 tier (c); L-17, L-27, L-44, L-52; SR32;
//! FORMA-125).
#![allow(deprecated)]

use super::{
    render_shell as render_browser_shell, render_ssr as try_render, RenderFixture as PageConfig,
    RenderPath as RenderMode,
};
use crate as forma_server;
use axum::body::to_bytes;
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use forma_server::assets::try_load_manifest;
use forma_server::csp::build_csp_header;
use forma_server::{AssetManifest, CspNonce, PageResponse, PreviewFrame, RenderCtx, RouteAssets};
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
#[derive(Embed)]
#[folder = "tests/fixtures/frame/cr/"]
struct CarriageReturn;
#[derive(Embed)]
#[folder = "tests/fixtures/frame/nul-byte/"]
struct Nul;

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

/// The good fixture's runtime, as embedded.
fn runtime() -> String {
    String::from_utf8(
        Good::get("forma-runtime.0a1b2c3d.js")
            .expect("fixture")
            .data
            .to_vec(),
    )
    .expect("utf-8")
}

/// The base64 SHA-256 a browser computes over an inline script's text.
fn sha256(text: &str) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .encode(ring::digest::digest(&ring::digest::SHA256, text.as_bytes()).as_ref())
}

/// The response's nonce: the frame's style-src carries it.
fn style_nonce(policy: &str) -> CspNonce {
    let start = policy.find("style-src 'nonce-").expect("style-src") + "style-src 'nonce-".len();
    let end = policy[start..].find('\'').expect("nonce end") + start;
    CspNonce::parse(&policy[start..end]).expect("a nonce")
}

#[tokio::test]
async fn the_frame_policy_replaces_exactly_its_nine_directives() {
    let preview = preview();
    let (headers, _) = sent(PageResponse::frame(&preview).expect("a frame")).await;
    let policy = one(&headers, "content-security-policy");
    let nonce = style_nonce(&policy);
    let frame = directives(&policy);
    let strict = directives(&build_csp_header(&nonce));

    // Every directive of the strict policy is still there, in its place; the
    // nine written in place of the strict ones are exactly these (L-27,
    // L-52); nothing else was added, removed or changed.
    let words = |w: &[&str]| w.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let expected_frame: Vec<(String, Vec<String>)> = strict
        .iter()
        .map(|(name, sources)| {
            let sources = match name.as_str() {
                "script-src" => vec![format!("'sha256-{}'", sha256(&runtime()))],
                "style-src" => vec![format!("'nonce-{nonce}'")],
                "worker-src" | "connect-src" | "font-src" | "form-action" => words(&["'none'"]),
                "img-src" => words(&["data:"]),
                "frame-ancestors" => vec![ORIGIN.to_string()],
                _ => sources.clone(),
            };
            (name.clone(), sources)
        })
        .chain([("sandbox".to_string(), words(&["allow-scripts"]))])
        .collect();
    assert_eq!(frame, expected_frame);
    // What stays the strict policy's, named, so a change to the strict
    // policy that loosens the frame shows here too.
    for (name, value) in [
        ("default-src", "'none'"),
        ("object-src", "'none'"),
        ("base-uri", "'none'"),
        ("style-src-attr", "'unsafe-inline'"),
        ("require-trusted-types-for", "'script'"),
        ("trusted-types", "forma forma-runtime"),
    ] {
        assert!(
            frame.iter().any(|(n, s)| n == name && s.join(" ") == value),
            "{name} {value}: {policy}"
        );
    }

    // In SR32's and L-52's words: no `allow-same-origin`; no nonce, no
    // `'strict-dynamic'` and no `'self'` for scripts; no `'self'` anywhere,
    // since in this document it names the application; `style-src-attr`'s
    // still the only `'unsafe-inline'` (SR39).
    assert!(!policy.contains("allow-same-origin"), "{policy}");
    assert!(!policy.contains("strict-dynamic"), "{policy}");
    assert!(!policy.contains("'self'"), "{policy}");
    assert!(
        !policy.contains("report-"),
        "no reporting endpoint: {policy}"
    );
    assert_eq!(policy.matches("'unsafe-inline'").count(), 1, "{policy}");
    assert_eq!(
        policy.matches("'nonce-").count(),
        1,
        "the nonce only in style-src"
    );

    // Trusted Types reported with no endpoint (L-52), so, as on any page
    // without one, in development builds only (FORMA-127, WebKit).
    if cfg!(debug_assertions) {
        assert_eq!(
            one(&headers, "content-security-policy-report-only"),
            "require-trusted-types-for 'script'; trusted-types forma forma-runtime"
        );
    } else {
        assert!(headers.get("content-security-policy-report-only").is_none());
    }
    assert!(headers.get("reporting-endpoints").is_none());
    // The rest of a page's headers.
    assert_eq!(one(&headers, "cache-control"), "no-store");
    assert_eq!(one(&headers, "content-type"), "text/html; charset=utf-8");
    assert_eq!(one(&headers, "x-content-type-options"), "nosniff");

    // Each frame draws its own nonce; the script's hash is the runtime's.
    let (again, _) = sent(PageResponse::frame(&preview).expect("a frame")).await;
    assert_ne!(style_nonce(&one(&again, "content-security-policy")), nonce);
}

#[tokio::test]
async fn the_frame_document_inlines_the_runtime_by_its_hash_and_names_nothing_to_fetch() {
    let preview = preview();
    let (headers, html) = sent(PageResponse::frame(&preview).expect("a frame")).await;
    let runtime = runtime();

    // The whole document: one root, the runtime inline with no nonce (the
    // policy allows it by hash), and no URL anywhere, so it fetches nothing.
    assert_eq!(
        html,
        format!(
            "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
             <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
             <title>Preview</title>\n</head>\n<body>\n<div id=\"forma-frame\"></div>\n\
             <script>{runtime}</script>\n</body>\n</html>"
        )
    );
    // The hash is over exactly the text between the tags, as a browser
    // computes it.
    let start = html.find("<script>").expect("script") + "<script>".len();
    let end = html.find("</script>").expect("end");
    assert!(one(&headers, "content-security-policy").contains(&format!(
        "script-src 'sha256-{}';",
        sha256(&html[start..end])
    )));
    for absent in [
        "src=",
        "href=",
        "<link",
        "url(",
        "@import",
        "type=\"module\"",
        "nonce=",
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
    // The parser rewrites CR and NUL before the script runs, so its hash
    // would not match (S1).
    assert_eq!(code::<CarriageReturn>(ORIGIN), "FRAME-103");
    assert_eq!(code::<Nul>(ORIGIN), "FRAME-103");

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
        // Ports a URL parser refuses or that never serve, and hosts no name
        // can be (review 5517929761, N1).
        "https://studio.example:0",
        "https://studio.example:+443",
        "https://studio.example:65536",
        "https://studio.example:99999",
        "https://studio.example:00443",
        "https://-",
        "https://-studio.example",
        "https://studio-.example",
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
        (
            "https://studio.example:65535",
            "https://studio.example:65535",
        ),
        ("https://studio-1.example", "https://studio-1.example"),
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
            mode: forma_server::RouteMode::Browser,
            modulepreload: Vec::new(),
            js: vec!["app.a1b2c3d4.js".to_string()],
            css: vec![],
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
        build: "test".to_string(),
        assets: super::fixture_assets(&routes),
        routes,
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
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
        render_mode: RenderMode::Phase2SsrReconcile,
        ir_module: Some(&module),
        slots: Some(&slots),
    };
    let pages = [
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

    // And by construction: `PagePolicy`'s fields are private to `csp.rs`, so
    // a policy is written only there, by `page_policy` or `frame_policy`, and
    // `frame_policy` has one caller, `PageResponse::frame`. A second check
    // pins both in the sources (every `.rs` under `src/`, recursively).
    fn sources(dir: &Path, out: &mut Vec<(String, String)>) {
        for entry in std::fs::read_dir(dir).expect("src") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                sources(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                let name = path
                    .file_name()
                    .expect("name")
                    .to_string_lossy()
                    .into_owned();
                out.push((name, std::fs::read_to_string(&path).expect("utf-8 source")));
            }
        }
    }
    let mut files = Vec::new();
    sources(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    let mut frame_policy = Vec::new();
    let mut literals = Vec::new();
    for (name, text) in &files {
        for line in text.lines().map(str::trim_start) {
            if line.starts_with("//") {
                continue;
            }
            // Any mention, a call or an import under another name.
            if line.contains("frame_policy") {
                frame_policy.push(name.clone());
            }
            if line.contains("PagePolicy {")
                && !line.contains("struct PagePolicy")
                && !line.contains("impl PagePolicy")
            {
                literals.push(name.clone());
            }
        }
    }
    frame_policy.sort();
    assert_eq!(
        frame_policy,
        ["csp.rs", "frame.rs"],
        "frame_policy is defined in csp.rs and named once, in frame.rs's call"
    );
    assert_eq!(
        literals,
        ["csp.rs", "csp.rs"],
        "a PagePolicy is written only by page_policy and frame_policy"
    );

    // Inside csp.rs, privacy does not stop a third writer: pin the functions
    // whose return type names a PagePolicy, and any assignment to one of its
    // fields anywhere (review 5518552921, n1).
    let code = |text: &str| -> String {
        let lines: Vec<&str> = text
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect();
        lines
            .join(" ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };
    let csp = code(&files.iter().find(|(n, _)| n == "csp.rs").expect("csp.rs").1);
    let mut returning = Vec::new();
    for (at, _) in csp.match_indices(" -> ") {
        let rest = &csp[at + 4..];
        let end = rest.find(" {").unwrap_or(rest.len());
        if rest[..end].contains("PagePolicy") {
            let name: String = csp[..at]
                .rfind(" fn ")
                .map(|f| &csp[f + 4..])
                .unwrap_or("")
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            returning.push(name);
        }
    }
    returning.sort();
    assert_eq!(
        returning,
        ["frame_policy", "page_policy"],
        "only page_policy and frame_policy return a PagePolicy"
    );
    for (name, text) in &files {
        let text = code(text);
        for field in [
            "csp",
            "report_only",
            "reporting_endpoints",
            "relaxed",
            "opener",
        ] {
            for assignment in [format!(".{field} ="), format!(".{field}=")] {
                // `==` is a comparison, not an assignment.
                let found = text
                    .match_indices(assignment.as_str())
                    .any(|(at, m)| !text[at + m.len()..].starts_with('='));
                assert!(!found, "{name}: assigns a policy's {field} ({assignment})");
            }
        }
    }
}
