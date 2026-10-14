//! An application that names itself and keeps the worker off (or turns it
//! off to roll back): `/sw.js` is the retiring worker that also deletes this
//! application's own caches, `forma:<app>:...`, and no page registers
//! (FORMA-130, DR-25, M25).
//!
//! Its own test binary: the setting is process-wide.

use axum::body::to_bytes;
use forma_server::sw;
use rust_embed::Embed;
use std::sync::Once;

#[derive(Embed)]
#[folder = "test_fixtures/"]
struct Fixtures;

static CONFIGURE: Once = Once::new();

fn setup() {
    CONFIGURE.call_once(|| {
        sw::configure(sw::ServiceWorker::for_app("ledger").expect("valid name"))
            .expect("configured before first use");
    });
}

#[tokio::test]
async fn a_named_application_s_retiring_worker_also_deletes_its_own_caches() {
    setup();
    assert!(!sw::configured().is_enabled());
    assert_eq!(sw::configured().app(), Some("ledger"));
    let response = sw::serve_sw::<Fixtures>().await;
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let body = String::from_utf8(body.to_vec()).expect("utf-8");
    assert!(body.contains(r#"const OWN = "forma:ledger:";"#), "{body}");
    assert!(body.contains("registration.unregister()"), "{body}");
}
