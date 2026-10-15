//! Emit the actual public off-worker response body for ordinary browser contract tests.
use std::io::Write;
struct NoAssets;
impl rust_embed::Embed for NoAssets {
    fn get(_: &str) -> Option<rust_embed::EmbeddedFile> {
        None
    }
    fn iter() -> impl Iterator<Item = std::borrow::Cow<'static, str>> {
        std::iter::empty()
    }
}
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = std::env::args()
        .nth(1)
        .ok_or("usage: retiring_worker_source <app>")?;
    forma_server::sw::configure(forma_server::sw::ServiceWorker::for_app(&app)?)?;
    let response = forma_server::sw::serve_sw::<NoAssets>().await;
    if response.status() != axum::http::StatusCode::OK {
        return Err("off worker did not return success".into());
    }
    let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024).await?;
    std::io::stdout().write_all(&bytes)?;
    Ok(())
}
