use std::sync::Arc;
use axum::{
    extract::State,
    http::header,
    response::{Html, IntoResponse},
    routing::get,
    Json, Router,
};
use forma_server::{assets, csp, render_page, sw, PageConfig, RenderMode};
use rust_embed::Embed;

mod data;

#[derive(Embed)]
#[folder = "admin/dist/"]
struct Assets;

struct AppState {
    manifest: forma_server::types::AssetManifest,
}

async fn page(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let nonce = csp::generate_nonce();
    let page = render_page(&PageConfig {
        title: "Dashboard",
        route_pattern: "/",
        manifest: &state.manifest,
        render_mode: RenderMode::Phase1ClientMount,
        ir_module: None,
        slots: None,
        config_script: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
    });

    (
        [
            (header::CACHE_CONTROL, "no-store".to_string()),
            (
                header::HeaderName::from_static("content-security-policy"),
                page.csp,
            ),
        ],
        Html(page.html),
    )
}

async fn api_stats() -> Json<data::Stats> {
    Json(data::get_stats())
}

async fn api_activity() -> Json<Vec<data::Activity>> {
    Json(data::get_activity())
}

async fn api_users() -> Json<Vec<data::User>> {
    Json(data::get_users())
}

#[tokio::main]
async fn main() {
    // Check if frontend has been built
    if Assets::get("manifest.json").is_none() {
        eprintln!("\n  Error: Frontend not built yet.\n");
        eprintln!("  Run these commands first:");
        eprintln!("    cd admin");
        eprintln!("    npm install");
        eprintln!("    npm run build\n");
        std::process::exit(1);
    }

    let manifest = assets::load_manifest::<Assets>();

    let state = Arc::new(AppState { manifest });

    let app = Router::new()
        .route("/", get(page))
        .route("/api/stats", get(api_stats))
        .route("/api/activity", get(api_activity))
        .route("/api/users", get(api_users))
        .route("/sw.js", get(sw::serve_sw::<Assets>))
        .route("/_assets/{*path}", get(assets::serve_asset::<Assets>))
        .with_state(state);

    println!("\n  Dashboard running at http://localhost:3000\n");

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind to port 3000");
    axum::serve(listener, app)
        .await
        .expect("Server error");
}
