//! Historical page behaviour retained after the explicit FORMA-110 removals.
//!
//! This consumer exercises the remaining deprecated page API. The old manifest
//! WASM field is gone; golden documents keep their historical bytes and the
//! assertions subtract only the two intentional script removals.
#![allow(deprecated)]

use forma_server::{
    render_page, render_page_with_nonce, AssetManifest, CspNonce, PageConfig, PageOutput,
    RenderMode,
};
use std::collections::HashMap;

fn manifest() -> AssetManifest {
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

fn config<'a>(manifest: &'a AssetManifest, config_script: Option<&'a str>) -> PageConfig<'a> {
    PageConfig {
        title: "Compat",
        route_pattern: "/",
        manifest,
        config_script,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
        render_mode: RenderMode::Phase1ClientMount,
        ir_module: None,
        slots: None,
    }
}

#[test]
fn remaining_legacy_page_api_still_compiles_and_renders() {
    let manifest = manifest();

    // `render_page`, its public fields, and `headers()`.
    let page: PageOutput = render_page(&config(&manifest, Some("window.__X__=1;")));
    assert!(page.html.contains("<div id=\"app\"></div>"));
    assert!(
        page.html.contains("window.__X__=1;"),
        "config_script still written"
    );
    assert!(page.csp.contains(&format!("'nonce-{}'", page.nonce)));
    let headers = page.headers();
    let get = |name: &str| {
        headers
            .iter()
            .find(|(n, _)| n.as_str() == name)
            .map(|(_, v)| v.to_str().expect("ascii").to_string())
    };
    assert_eq!(get("cache-control").as_deref(), Some("no-store"));
    assert_eq!(
        get("content-security-policy").as_deref(),
        Some(page.csp.as_str())
    );

    // The caller rewriting the policy text in place, then using headers():
    // still possible on 0.2.x, and still what `headers()` sends.
    let mut page = page;
    page.csp.push_str("; frame-src 'self'");
    let rewritten = page
        .headers()
        .into_iter()
        .find(|(n, _)| n.as_str() == "content-security-policy")
        .map(|(_, v)| v.to_str().expect("ascii").to_string());
    assert!(rewritten.expect("policy").ends_with("; frame-src 'self'"));

    // `render_page_with_nonce` with a caller's nonce.
    let nonce = CspNonce::generate();
    let page = render_page_with_nonce(&config(&manifest, None), &nonce);
    assert_eq!(page.nonce, nonce);
    // The caller's nonce is the one the policy blesses. (0.2.1's page also
    // carried it on the worker registration script, which 0.2.2 writes only
    // for an application that enables its worker, FORMA-130.)
    assert!(page.csp.contains(&format!("'nonce-{nonce}'")));
}

/// The documents 0.2.1 wrote for one fully-populated config, in each mode.
///
/// The goldens in `tests/fixtures/documents-0.2.1/` were written by this
/// function's body run against `main` at 36d835f (forma-server 0.2.1), with a
/// fixed nonce. A2 restructures the render; this pins that `render_page`'s
/// document and policy did not move beyond the explicitly retired scripts.
fn documents() -> Vec<(&'static str, String)> {
    use forma_ir::parser::test_helpers::{
        build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
    };
    use forma_server::RouteAssets;

    let mut routes = HashMap::new();
    routes.insert(
        "/r".to_string(),
        RouteAssets {
            mode: forma_server::RouteMode::Ssr,
            modulepreload: Vec::new(),
            js: vec!["vendor.1.js".into(), "app.2.js".into()],
            css: vec!["s.3.css".into()],
            fonts: vec!["f.4.woff2".into()],
            total_size_br: 0,
            budget_warn_threshold: 0,
            ir: Some("p.5.ir".into()),
        },
    );
    let manifest = AssetManifest {
        version: 2,
        writer: "3.0.0".into(),
        app: "ledger".into(),
        aliases: HashMap::new(),
        build: "h".into(),
        assets: HashMap::new(),
        routes,
    };
    let mut ops = Vec::new();
    ops.extend_from_slice(&encode_open_tag(0, &[]));
    ops.extend_from_slice(&encode_text(1));
    ops.extend_from_slice(&encode_close_tag(0));
    let ir = forma_ir::IrModule::parse(&build_minimal_ir(&["p", "hi & <bye>"], &[], &ops, &[]))
        .expect("module");
    let slots = forma_ir::SlotData::new(0);
    let json = serde_json::json!({"a": "</script>"});
    let nonce = CspNonce::parse("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").expect("nonce");

    let mut out = Vec::new();
    for (name, mode, with_ir) in [
        ("phase1", RenderMode::Phase1ClientMount, false),
        ("phase2", RenderMode::Phase2SsrReconcile, true),
        ("fallback", RenderMode::Phase2SsrReconcile, false),
    ] {
        let page = render_page_with_nonce(
            &PageConfig {
                title: "T<i>",
                route_pattern: "/r",
                manifest: &manifest,
                config_script: Some("window.x=1;"),
                config_json: Some(&json),
                body_class: Some("dark"),
                personality_css: Some(":root{--c:red}"),
                body_prefix: Some("<nav>n</nav>"),
                render_mode: mode,
                ir_module: if with_ir { Some(&ir) } else { None },
                slots: Some(&slots),
            },
            &nonce,
        );
        out.push((name, format!("{}\n--CSP--\n{}", page.html, page.csp)));
    }
    out
}

/// The one line 0.2.2 writes differently on purpose: 0.2.1 registered the
/// service worker on every page; 0.2.2 registers it only for an application
/// that enables its worker (FORMA-130, DR-25), and this process does not.
const REGISTRATION: &str = "<script nonce=\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\">\
    if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');</script>\n";

const WASM_BOOTSTRAP: &str = "<script nonce=\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\">window.__FORMA_WASM__={loader:\"/_assets/l.js\",binary:\"/_assets/b.wasm\",ir:\"/_assets/p.5.ir\"};</script>\n";

#[test]
fn render_page_preserves_document_except_retired_scripts() {
    for (name, document) in documents() {
        let path = format!(
            "{}/tests/fixtures/documents-0.2.1/{name}.txt",
            env!("CARGO_MANIFEST_DIR")
        );
        let golden = std::fs::read_to_string(&path).expect("golden present in the repo");
        // The goldens stay what 0.2.1 wrote; subtract the two retired scripts
        // exactly once each. All other bytes remain asserted.
        assert_eq!(
            golden.matches(REGISTRATION).count(),
            1,
            "{name}: 0.2.1's golden carries the registration exactly once"
        );
        assert_eq!(golden.matches(WASM_BOOTSTRAP).count(), 1);
        let expected = golden
            .replacen(REGISTRATION, "", 1)
            .replacen(WASM_BOOTSTRAP, "", 1);
        assert_eq!(
            document, expected,
            "{name} differs from 0.2.1's document beyond the retired worker registration and WASM bootstrap"
        );
    }
}
