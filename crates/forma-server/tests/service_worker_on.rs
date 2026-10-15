//! An explicitly enabled worker retains its registration and delivery behavior.

use axum::body::to_bytes;
use axum::http::StatusCode;
use forma_server::{render_browser_shell, sw, AssetManifest, PageConfig, RenderCtx, RenderMode};
use rust_embed::Embed;
use std::collections::HashMap;
use std::sync::Once;

#[derive(Embed)]
#[folder = "test_fixtures/"]
struct Fixtures;

/// A build that embedded no `sw.js`.
#[derive(Embed)]
#[folder = "tests/fixtures/asset-sets/a/"]
struct NoWorker;

static CONFIGURE: Once = Once::new();

fn setup() {
    CONFIGURE.call_once(|| {
        let on = sw::ServiceWorker::for_app("ledger")
            .expect("valid name")
            .enabled();
        let manifest = forma_server::assets::try_load_manifest::<Fixtures>().expect("manifest");
        sw::configure_for_manifest(on, &manifest).expect("configured before first use");
    });
}

#[test]
fn an_enabled_application_s_pages_register_the_worker() {
    setup();
    let manifest = AssetManifest {
        version: 2,
        writer: "3.0.0".into(),
        app: "ledger".into(),
        aliases: HashMap::new(),
        build: "test".to_string(),
        assets: HashMap::new(),
        routes: HashMap::new(),
    };
    #[allow(deprecated)]
    let page = render_browser_shell(
        &PageConfig {
            title: "Ledger",
            route_pattern: "/",
            manifest: &manifest,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        },
        &RenderCtx::new(),
    )
    .unwrap()
    .into_parts_unchecked();
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

#[tokio::test]
async fn an_enabled_application_with_no_built_worker_is_told_once() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tracing::field::{Field, Visit};
    use tracing::span::{Attributes, Id, Record};
    use tracing::{Event, Metadata, Subscriber};

    struct Warnings(Arc<AtomicUsize>);
    impl Subscriber for Warnings {
        fn enabled(&self, _: &Metadata<'_>) -> bool {
            true
        }
        fn new_span(&self, _: &Attributes<'_>) -> Id {
            Id::from_u64(1)
        }
        fn record(&self, _: &Id, _: &Record<'_>) {}
        fn record_follows_from(&self, _: &Id, _: &Id) {}
        fn event(&self, event: &Event<'_>) {
            struct Message(String);
            impl Visit for Message {
                fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
                    if field.name() == "message" {
                        self.0 = format!("{value:?}");
                    }
                }
            }
            let mut message = Message(String::new());
            event.record(&mut message);
            if *event.metadata().level() == tracing::Level::WARN
                && message.0.contains("embedded no sw.js")
            {
                self.0.fetch_add(1, Ordering::SeqCst);
            }
        }
        fn enter(&self, _: &Id) {}
        fn exit(&self, _: &Id) {}
    }

    setup();
    let seen = Arc::new(AtomicUsize::new(0));
    let _guard = tracing::subscriber::set_default(Warnings(seen.clone()));
    for _ in 0..3 {
        // Still 404, as at 0.2.1: the warning is the only change.
        assert_eq!(
            sw::serve_sw::<NoWorker>().await.status(),
            StatusCode::NOT_FOUND
        );
    }
    assert_eq!(seen.load(Ordering::SeqCst), 1, "once per process");
    // A build that did embed its worker draws no warning.
    assert_eq!(sw::serve_sw::<Fixtures>().await.status(), StatusCode::OK);
    assert_eq!(seen.load(Ordering::SeqCst), 1);
}
