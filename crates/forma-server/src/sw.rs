use axum::{
    http::header,
    response::{IntoResponse, Response},
};
use rust_embed::Embed;

/// Axum handler: serve the service worker with no-cache headers.
///
/// Mount at `/sw.js` in your router. Returns 404 if sw.js is not embedded.
pub async fn serve_sw<A: Embed>() -> Response {
    match crate::assets::asset_bytes::<A>("sw.js") {
        Some(data) => {
            let mut builder = Response::builder()
                .header(header::CONTENT_TYPE, "text/javascript; charset=utf-8")
                .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
                .header("service-worker-allowed", "/");
            // The service worker is the highest-value script on the origin;
            // it must not be sniffable into another type.
            for (name, value) in crate::types::asset_security_headers() {
                builder = builder.header(name, value);
            }
            // Static headers cannot fail to parse; if one ever did, answer 500
            // rather than panic or send the worker without its headers.
            match builder.body(axum::body::Body::from(data)) {
                Ok(response) => response.into_response(),
                Err(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            }
        }
        None => axum::http::StatusCode::NOT_FOUND.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_embed::Embed;

    #[derive(Embed)]
    #[folder = "test_fixtures/"]
    struct Fixtures;

    #[tokio::test]
    async fn serve_sw_sets_nosniff_and_no_store() {
        let response = serve_sw::<Fixtures>().await;
        let headers = response.headers();
        assert_eq!(
            headers
                .get("x-content-type-options")
                .map(|v| v.to_str().unwrap()),
            Some("nosniff"),
            "the service worker must not be sniffable into another type"
        );
        assert_eq!(
            headers
                .get(header::CONTENT_TYPE)
                .map(|v| v.to_str().unwrap()),
            Some("text/javascript; charset=utf-8")
        );
        assert!(headers
            .get(header::CACHE_CONTROL)
            .unwrap()
            .to_str()
            .unwrap()
            .contains("no-store"));
    }
}
