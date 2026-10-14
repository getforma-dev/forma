//! The default (FORMA-130, DR-25, Q15): no page registers a service worker,
//! and `/sw.js` is the retiring worker, which deletes Forma's v1 caches and
//! unregisters, whatever worker the build embedded.
//!
//! Its own test binary: the setting is process-wide and this one is never
//! configured, so every test here sees the default.
// `render_page` is deprecated on the A2 stack (FORMA-120); these tests use
// it because it is the page API on `main` too.
#![allow(deprecated)]

use axum::body::to_bytes;
use axum::http::StatusCode;
use forma_server::{render_page, sw, AssetManifest, PageConfig, RenderMode, RouteAssets};
use rust_embed::Embed;
use std::collections::HashMap;

#[derive(Embed)]
#[folder = "test_fixtures/"]
struct Fixtures;

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

fn page_html(manifest: &AssetManifest) -> String {
    #[allow(deprecated)] // `config_script` is named by every 0.2.x literal on the A2 stack
    let config = PageConfig {
        title: "Home",
        route_pattern: "/",
        manifest,
        config_script: None,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
        render_mode: RenderMode::Phase1ClientMount,
        ir_module: None,
        slots: None,
    };
    #[allow(deprecated)]
    let page = render_page(&config);
    #[allow(deprecated)]
    let html = page.html;
    html
}

#[test]
fn by_default_no_page_registers_a_worker() {
    let html = page_html(&manifest());
    assert!(
        !html.contains("serviceWorker"),
        "no registration by default: {html}"
    );
    // The rest of the page is intact: its bundle, nonced.
    assert!(html.contains("<script type=\"module\" nonce=\""));
    assert!(html.contains("src=\"/_assets/app.a1b2c3d4.js\""));
    assert!(!sw::configured().is_enabled());
}

#[tokio::test]
async fn by_default_sw_js_is_the_retiring_worker_even_with_a_built_worker_embedded() {
    let embedded = Fixtures::get("sw.js").expect("the fixture embeds a worker");
    let response = sw::serve_sw::<Fixtures>().await;
    assert_eq!(response.status(), StatusCode::OK);
    let headers = response.headers().clone();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let body = String::from_utf8(body.to_vec()).expect("utf-8");

    assert_ne!(
        body.as_bytes(),
        &embedded.data[..],
        "not the embedded worker"
    );
    assert!(body.contains("registration.unregister()"), "{body}");
    assert!(
        !body.contains("addEventListener('fetch'"),
        "it serves nothing: {body}"
    );
    // Unnamed: no application's own caches to delete, only v1's names.
    assert!(body.contains("const OWN = null;"), "{body}");

    // The worker's headers, as for the built one.
    assert_eq!(headers["content-type"], "text/javascript; charset=utf-8");
    assert_eq!(
        headers["cache-control"],
        "no-cache, no-store, must-revalidate"
    );
    assert_eq!(headers["x-content-type-options"], "nosniff");
    assert_eq!(headers["service-worker-allowed"], "/");
}

#[test]
fn configuring_after_the_first_use_is_refused() {
    // A render or a request already read the default; switching the worker on
    // now would leave those pages and this process disagreeing.
    let _ = sw::configured();
    let on = sw::ServiceWorker::for_app("ledger")
        .expect("valid name")
        .enabled();
    let error = sw::configure(on).expect_err("too late");
    assert!(error.to_string().contains("already"), "{error}");
    assert!(!sw::configured().is_enabled(), "still the default");
}
