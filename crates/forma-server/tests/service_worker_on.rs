//! An application that enables its worker (FORMA-130, DR-25, Q15: today
//! Ledger): its pages register `/sw.js`, and `/sw.js` serves the worker its
//! build embedded.
//!
//! Its own test binary: the setting is process-wide.
// `render_page` is deprecated on the A2 stack (FORMA-120); these tests use
// it because it is the page API on `main` too.
#![allow(deprecated)]

use axum::body::to_bytes;
use axum::http::StatusCode;
use forma_server::{render_page, sw, AssetManifest, PageConfig, RenderMode};
use rust_embed::Embed;
use std::collections::HashMap;
use std::sync::Once;

#[derive(Embed)]
#[folder = "test_fixtures/"]
struct Fixtures;

static CONFIGURE: Once = Once::new();

fn setup() {
    CONFIGURE.call_once(|| {
        let on = sw::ServiceWorker::for_app("ledger")
            .expect("valid name")
            .enabled();
        sw::configure(on).expect("configured before first use");
    });
}

#[test]
fn an_enabled_application_s_pages_register_the_worker() {
    setup();
    let manifest = AssetManifest {
        version: 1,
        build_hash: "test".to_string(),
        assets: HashMap::new(),
        routes: HashMap::new(),
        wasm: None,
    };
    #[allow(deprecated)]
    let page = render_page(&PageConfig {
        title: "Ledger",
        route_pattern: "/",
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
    #[allow(deprecated)]
    let (html, nonce) = (page.html, page.nonce);
    // The 0.2.1 registration, nonced with this page's nonce.
    assert!(
        html.contains(&format!(
            "<script nonce=\"{nonce}\">if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');</script>"
        )),
        "{html}"
    );
}

#[tokio::test]
async fn an_enabled_application_serves_its_built_worker() {
    setup();
    let embedded = Fixtures::get("sw.js").expect("the fixture embeds a worker");
    let response = sw::serve_sw::<Fixtures>().await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()["cache-control"],
        "no-cache, no-store, must-revalidate"
    );
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    assert_eq!(&body[..], &embedded.data[..]);
}

#[test]
fn the_setting_is_configured_once() {
    setup();
    let error = sw::configure(sw::ServiceWorker::off()).expect_err("set once, at start");
    assert!(error.to_string().contains("already"), "{error}");
    assert!(sw::configured().is_enabled());
}
