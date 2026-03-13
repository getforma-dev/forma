use axum::{extract::State, response::{Html, IntoResponse, Response}, routing::get, Router};
use forma_server::{assets, render_page, PageConfig, RenderMode};
use rust_embed::Embed;
use std::sync::Arc;

#[derive(Embed)]
#[folder = "admin/dist/"]
struct Assets;

struct AppState {
    manifest: forma_server::AssetManifest,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let manifest = assets::load_manifest::<Assets>();
    let state = Arc::new(AppState { manifest });

    let app = Router::new()
        .route("/", get(home))
        .route("/_assets/{*filename}", get(assets::serve_asset::<Assets>))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await.unwrap();
    tracing::info!("Listening on http://127.0.0.1:3000");
    axum::serve(listener, app).await.unwrap();
}

async fn home(State(state): State<Arc<AppState>>) -> Response {
    let page = render_page(&PageConfig {
        title: "Home",
        route_pattern: "/",
        manifest: &state.manifest,
        config_script: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
        render_mode: RenderMode::Phase1ClientMount,
        ir_module: None,
        slots: None,
    });
    Html(page.html).into_response()
}
