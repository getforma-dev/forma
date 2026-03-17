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

async fn page_dashboard(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let route = "/";
    let render_mode = state.render_modes.get(route).copied().unwrap_or(RenderMode::Phase1ClientMount);
    let ir_module = state.ir_modules.get(route);

    // personality_css sets dark background immediately via a nonce'd <style> tag.
    // This prevents the white flash during Phase 1 (before JS mounts).
    // Full skeleton with layout structure requires Phase 2 SSR.
    let page = render_page(&PageConfig {
        title: "FormaOps Dashboard",
        route_pattern: route,
        manifest: &state.manifest,
        render_mode,
        ir_module,
        slots: None,
        config_script: None,
        body_class: None,
        personality_css: Some("body{background:#282828;color:#ebdbb2;margin:0}"),
        body_prefix: None,
    });

    (
        [
            (header::CACHE_CONTROL, "no-store".to_string()),
            (header::HeaderName::from_static("content-security-policy"), page.csp),
        ],
        Html(page.html),
    )
}

async fn api_metrics() -> Json<Vec<data::Metric>> { Json(data::get_metrics()) }
async fn api_deployment_stats() -> Json<data::DeploymentStats> { Json(data::get_deployment_stats()) }
async fn api_deployments() -> Json<Vec<data::Deployment>> { Json(data::get_deployments()) }
async fn api_services() -> Json<Vec<data::Service>> { Json(data::get_services()) }
async fn api_service_summary() -> Json<data::ServiceStatusSummary> { Json(data::get_service_summary()) }
async fn api_servers() -> Json<Vec<data::Server>> { Json(data::get_servers()) }
async fn api_request_volume() -> Json<Vec<data::RequestVolumePoint>> { Json(data::get_request_volume()) }
async fn api_incidents() -> Json<Vec<data::Incident>> { Json(data::get_incidents()) }

#[tokio::main]
async fn main() {
    if Assets::get("manifest.json").is_none() {
        eprintln!("\n  Error: Frontend not built yet.\n");
        eprintln!("  Run these commands first:");
        eprintln!("    cd admin");
        eprintln!("    npm install");
        eprintln!("    npm run build\n");
        std::process::exit(1);
    }

    let manifest = assets::load_manifest::<Assets>();
    let (render_modes, ir_modules) = load_ir_modules::<Assets>(&manifest);
    let state = Arc::new(AppState { manifest, render_modes, ir_modules });

    let app = Router::new()
        .route("/", get(page_dashboard))
        .route("/overview", get(page_dashboard))
        .route("/deployments", get(page_dashboard))
        .route("/servers", get(page_dashboard))
        .route("/settings", get(page_dashboard))
        .route("/api/metrics", get(api_metrics))
        .route("/api/deployment-stats", get(api_deployment_stats))
        .route("/api/deployments", get(api_deployments))
        .route("/api/services", get(api_services))
        .route("/api/service-summary", get(api_service_summary))
        .route("/api/servers", get(api_servers))
        .route("/api/request-volume", get(api_request_volume))
        .route("/api/incidents", get(api_incidents))
        .route("/sw.js", get(sw::serve_sw::<Assets>))
        .route("/_assets/{*path}", get(assets::serve_asset::<Assets>))
        .with_state(state);

    println!("\n  FormaOps Dashboard running at http://localhost:3000\n");

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind to port 3000");
    axum::serve(listener, app).await.expect("Server error");
}
