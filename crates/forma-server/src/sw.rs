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
            let response = Response::builder()
                .header(
                    header::CONTENT_TYPE,
                    "application/javascript; charset=utf-8",
                )
                .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
                .header("service-worker-allowed", "/")
                .body(axum::body::Body::from(data))
                .unwrap();
            response.into_response()
        }
        None => axum::http::StatusCode::NOT_FOUND.into_response(),
    }
}
