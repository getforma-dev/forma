//! Two `Embed` types served from one binary each serve their own files.
//!
//! forma-server 0.2.0 cached the release-build name list in a `static` declared
//! inside the generic `is_embedded::<A>`. Rust shares such a static across every
//! instantiation ("There will not be one item per monomorphization", the Rust
//! reference on static items), so the first type served filled it and a second
//! type's valid assets answered 404. Debug builds never cached, so the defect
//! existed only in release and this test only has teeth there: CI runs it with
//! `cargo test -p forma-server --release` (the `test-release` job).
//!
//! This file is its own test binary on purpose: it holds one test, so the order
//! in which the two types first reach the cache is the order written below.

use axum::body::to_bytes;
use axum::extract::Path;
use axum::http::{HeaderMap, StatusCode};
use forma_server::assets::serve_asset;
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "tests/fixtures/asset-sets/a/"]
struct SetA;

#[derive(Embed)]
#[folder = "tests/fixtures/asset-sets/b/"]
struct SetB;

/// Serve `name` from `A` through the public handler; return status and body.
async fn fetch<A: Embed + 'static>(name: &str) -> (StatusCode, Vec<u8>) {
    let response = serve_asset::<A>(Path(name.to_string()), HeaderMap::new()).await;
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("an asset body is in memory and cannot fail to collect");
    (status, body.to_vec())
}

fn ok(body: &[u8]) -> (StatusCode, Vec<u8>) {
    (StatusCode::OK, body.to_vec())
}

#[tokio::test]
async fn two_embed_types_each_serve_their_own_assets() {
    // Three rounds, so each type is served before, between and after the other
    // and every request after the first finds the cache already filled.
    for round in 1..=3 {
        // Each type serves its own hashed file, byte for byte. In 0.2.0's
        // release build SetA's first request filled the shared cache with
        // SetA's names, and SetB's request below answered 404.
        assert_eq!(
            fetch::<SetA>("a.aaaaaaaa.js").await,
            ok(b"export default \"a\";\n"),
            "round {round}: SetA must serve its own asset"
        );
        assert_eq!(
            fetch::<SetB>("b.bbbbbbbb.js").await,
            ok(b"export default \"bb\";\n"),
            "round {round}: SetB must serve its own asset"
        );

        // Neither type serves the other's file: keying the cache by type must
        // not widen what a type will serve.
        assert_eq!(
            fetch::<SetA>("b.bbbbbbbb.js").await.0,
            StatusCode::NOT_FOUND,
            "round {round}: SetA must not serve SetB's asset"
        );
        assert_eq!(
            fetch::<SetB>("a.aaaaaaaa.js").await.0,
            StatusCode::NOT_FOUND,
            "round {round}: SetB must not serve SetA's asset"
        );

        // A name both sets carry resolves to each set's own bytes.
        assert_eq!(
            fetch::<SetA>("shared.css").await,
            ok(b".a{}\n"),
            "round {round}: SetA's shared.css"
        );
        assert_eq!(
            fetch::<SetB>("shared.css").await,
            ok(b".bb{}\n"),
            "round {round}: SetB's shared.css"
        );
    }
}
