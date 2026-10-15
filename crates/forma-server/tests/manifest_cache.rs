//! Cache decisions come from schema-2 metadata in both debug and release builds.
use axum::{
    extract::Path,
    http::{HeaderMap, HeaderValue, StatusCode},
};
use forma_server::assets::serve_asset;
use rust_embed::Embed;
#[derive(Embed)]
#[folder = "tests/fixtures/manifest-cache/a/"]
struct A;
#[derive(Embed)]
#[folder = "tests/fixtures/manifest-cache/b/"]
struct B;
async fn get<T: Embed + 'static>(file: &str, headers: HeaderMap) -> axum::response::Response {
    serve_asset::<T>(Path(file.into()), headers).await
}
#[tokio::test]
async fn each_embed_type_uses_its_metadata_for_raw_compressed_retained_and_304_responses() {
    for _ in 0..3 {
        let a = get::<A>("chunk-SPLITXYZ.js", HeaderMap::new()).await;
        assert!(a.headers()["cache-control"]
            .to_str()
            .unwrap()
            .contains("immutable"));
        let mut conditional = HeaderMap::new();
        conditional.insert("if-none-match", a.headers()["etag"].clone());
        let cached = get::<A>("chunk-SPLITXYZ.js", conditional).await;
        assert_eq!(cached.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(
            cached.headers()["cache-control"],
            a.headers()["cache-control"]
        );
        let b = get::<B>("chunk-SPLITXYZ.js", HeaderMap::new()).await;
        assert_eq!(
            b.headers()["cache-control"],
            "public, max-age=0, must-revalidate"
        );
        let mut compressed = HeaderMap::new();
        compressed.insert("accept-encoding", HeaderValue::from_static("gzip"));
        let gzip = get::<A>("chunk-SPLITXYZ.js", compressed).await;
        assert_eq!(gzip.headers()["content-encoding"], "gzip");
        assert_eq!(
            gzip.headers()["cache-control"],
            a.headers()["cache-control"]
        );
        for file in ["looks.aaaaaaaa.js", "unknown.aaaaaaaa.js"] {
            assert_eq!(
                get::<A>(file, HeaderMap::new()).await.headers()["cache-control"],
                "public, max-age=0, must-revalidate"
            );
        }
        assert!(get::<A>("old-retained.js", HeaderMap::new())
            .await
            .headers()["cache-control"]
            .to_str()
            .unwrap()
            .contains("immutable"));
        for file in ["manifest.json", "page.ir", "chunk-SPLITXYZ.js.gz"] {
            assert_eq!(
                get::<A>(file, HeaderMap::new()).await.status(),
                StatusCode::NOT_FOUND
            );
        }
    }
}

#[derive(Embed)]
#[folder = "tests/fixtures/manifest-cache/a/"]
struct C;
#[derive(Embed)]
#[folder = "tests/fixtures/manifest-cache/b/"]
struct D;
#[derive(Embed)]
#[folder = "tests/fixtures/manifest-cache/a/"]
struct E;
#[derive(Embed)]
#[folder = "tests/fixtures/manifest-cache/b/"]
struct F;
#[tokio::test]
async fn metadata_cache_overflow_falls_back_without_crossing_embed_types() {
    for _ in 0..2 {
        for (response, immutable) in [
            (get::<A>("chunk-SPLITXYZ.js", HeaderMap::new()).await, true),
            (get::<B>("chunk-SPLITXYZ.js", HeaderMap::new()).await, false),
            (get::<C>("chunk-SPLITXYZ.js", HeaderMap::new()).await, true),
            (get::<D>("chunk-SPLITXYZ.js", HeaderMap::new()).await, false),
            (get::<E>("chunk-SPLITXYZ.js", HeaderMap::new()).await, true),
            (get::<F>("chunk-SPLITXYZ.js", HeaderMap::new()).await, false),
        ] {
            assert_eq!(
                response.headers()["cache-control"]
                    .to_str()
                    .unwrap()
                    .contains("immutable"),
                immutable
            );
        }
    }
}

// A controlled build replaces only the manifest bytes; no on-disk fixture is changed.
#[cfg(debug_assertions)]
struct Rebuilt;
#[cfg(debug_assertions)]
static CHANGED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(debug_assertions)]
impl Embed for Rebuilt {
    fn get(path: &str) -> Option<rust_embed::EmbeddedFile> {
        let mut file = A::get(path)?;
        if path == "manifest.json" && CHANGED.load(std::sync::atomic::Ordering::SeqCst) {
            let mut value: serde_json::Value = serde_json::from_slice(&file.data).unwrap();
            value["assets"]["chunk-SPLITXYZ.js"]["immutable"] = false.into();
            file.data = std::borrow::Cow::Owned(value.to_string().into_bytes());
        }
        Some(file)
    }
    fn iter() -> impl Iterator<Item = std::borrow::Cow<'static, str>> {
        A::iter()
    }
}
#[cfg(debug_assertions)]
#[tokio::test]
async fn development_cache_policy_rereads_rebuilt_metadata() {
    assert!(get::<Rebuilt>("chunk-SPLITXYZ.js", HeaderMap::new())
        .await
        .headers()["cache-control"]
        .to_str()
        .unwrap()
        .contains("immutable"));
    CHANGED.store(true, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        get::<Rebuilt>("chunk-SPLITXYZ.js", HeaderMap::new())
            .await
            .headers()["cache-control"],
        "public, max-age=0, must-revalidate"
    );
}
