use axum::{
    extract::Path,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use rust_embed::Embed;

/// Load a text asset from the embedded dist directory. Panics if missing.
pub fn asset<A: Embed>(name: &str) -> String {
    let file = A::get(name).unwrap_or_else(|| panic!("Missing asset: {name}"));
    String::from_utf8(file.data.to_vec()).unwrap_or_else(|_| panic!("Non-UTF8 asset: {name}"))
}

/// Load raw bytes from the embedded dist directory. Returns None if missing.
pub fn asset_bytes<A: Embed>(name: &str) -> Option<Vec<u8>> {
    A::get(name).map(|f| f.data.to_vec())
}

/// Load and parse the asset manifest from embedded assets.
pub fn load_manifest<A: Embed>() -> crate::AssetManifest {
    let data = asset::<A>("manifest.json");
    serde_json::from_str(&data).expect("Failed to parse manifest.json")
}

/// Axum handler: serve a static asset with content negotiation (brotli, gzip).
///
/// Mount at `/_assets/{filename}` in your router.
pub async fn serve_asset<A: Embed>(Path(filename): Path<String>, headers: HeaderMap) -> Response {
    let accept = headers
        .get(header::ACCEPT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Try brotli first, then gzip, then raw
    let (data, encoding) = if accept.contains("br") {
        if let Some(br) = A::get(&format!("{filename}.br")) {
            (br.data.to_vec(), Some("br"))
        } else if let Some(raw) = A::get(&filename) {
            (raw.data.to_vec(), None)
        } else {
            return StatusCode::NOT_FOUND.into_response();
        }
    } else if accept.contains("gzip") {
        if let Some(gz) = A::get(&format!("{filename}.gz")) {
            (gz.data.to_vec(), Some("gzip"))
        } else if let Some(raw) = A::get(&filename) {
            (raw.data.to_vec(), None)
        } else {
            return StatusCode::NOT_FOUND.into_response();
        }
    } else if let Some(raw) = A::get(&filename) {
        (raw.data.to_vec(), None)
    } else {
        return StatusCode::NOT_FOUND.into_response();
    };

    asset_response(&filename, data, encoding)
}

fn asset_response(filename: &str, data: Vec<u8>, encoding: Option<&str>) -> Response {
    let mime = mime_for(filename);
    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header("vary", "accept-encoding")
        .header("x-content-type-options", "nosniff");

    if let Some(enc) = encoding {
        builder = builder.header(header::CONTENT_ENCODING, enc);
    }

    builder
        .body(axum::body::Body::from(data))
        .unwrap()
        .into_response()
}

fn mime_for(filename: &str) -> &'static str {
    if filename.ends_with(".js") {
        "application/javascript; charset=utf-8"
    } else if filename.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if filename.ends_with(".woff2") {
        "font/woff2"
    } else if filename.ends_with(".wasm") {
        "application/wasm"
    } else if filename.ends_with(".json") {
        "application/json"
    } else if filename.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if filename.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    }
}
