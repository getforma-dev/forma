use std::sync::Arc;
use axum::{
    extract::State,
    http::header,
    response::{Html, IntoResponse},
    routing::get,
    Json, Router,
};
use forma_server::{assets, load_ir_modules, render_page, sw, PageConfig, RenderMode};
use rust_embed::Embed;
use std::collections::HashMap;

mod data;

#[derive(Embed)]
#[folder = "admin/dist/"]
struct Assets;

struct AppState {
    manifest: forma_server::types::AssetManifest,
    render_modes: HashMap<String, RenderMode>,
    ir_modules: HashMap<String, forma_ir::parser::IrModule>,
}

async fn page(State(state): State<Arc<AppState>>) -> impl IntoResponse {

    // Use Phase 2 SSR if an IR module was compiled for this route, otherwise Phase 1
    let route = "/";
    let render_mode = state.render_modes
        .get(route)
        .copied()
        .unwrap_or(RenderMode::Phase1ClientMount);
    let ir_module = state.ir_modules.get(route);

    let page = render_page(&PageConfig {
        title: "Dashboard",
        route_pattern: route,
        manifest: &state.manifest,
        render_mode,
        ir_module,
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

    // Load IR modules for Phase 2 SSR (falls back to Phase 1 if none compiled)
    let (render_modes, ir_modules) = load_ir_modules::<Assets>(&manifest);

    let state = Arc::new(AppState { manifest, render_modes, ir_modules });

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
