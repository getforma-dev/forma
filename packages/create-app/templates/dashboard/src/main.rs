use std::sync::Arc;
use axum::{
    extract::State,
    http::header,
    response::{Html, IntoResponse},
    routing::get,
    Json, Router,
};
use forma_server::{assets, render_page, sw, PageConfig, RenderMode};
use rust_embed::Embed;

mod data;

#[derive(Embed)]
#[folder = "admin/dist/"]
struct Assets;

struct AppState {
    manifest: forma_server::types::AssetManifest,
}

async fn page_dashboard(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    // Phase 1: the server sends an empty `<div id="app">` and the client
    // mounts into it. This is deliberate for this template — the page is a
    // tree of components, and the FMIR compiler can only walk literal JSX, so
    // an SSR build of THIS app produces island placeholders rather than
    // markup (see README > "Phase 1 by design"). The `minimal` template
    // demonstrates a working Phase 2 setup.
    //
    // personality_css sets the dark background immediately via a nonce'd
    // <style> tag, so there is no white flash before the JS mounts.
    let page = render_page(&PageConfig {
        title: "FormaOps Dashboard",
        route_pattern: "/",
        manifest: &state.manifest,
        render_mode: RenderMode::Phase1ClientMount,
        ir_module: None,
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
    // Without a subscriber, forma-server's warnings (asset lookups, render
    // fallbacks) go nowhere and a misconfigured build looks like a working one.
    tracing_subscriber::fmt::init();

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
        .route("/", get(page_dashboard))
        .route("/overview", get(page_dashboard))
        .route("/deployments", get(page_dashboard))
        .route("/servers", get(page_dashboard))
        .route("/settings", get(page_dashboard))
        // These routes are UNAUTHENTICATED. They serve the mock data in
        // data.rs; before you put real data behind them, put auth in front.
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

    // Binds to loopback by default. Set FORMA_HOST to expose the server (e.g. on your LAN).
    // An empty or whitespace-only FORMA_HOST is treated as unset.
    let host = std::env::var("FORMA_HOST")
        .ok()
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let addr = format!("{host}:3000");

    // Loopback (127.x.x.x, ::1, optionally bracketed) is quiet; anything else warns.
    let bare_host = host.trim_start_matches('[').trim_end_matches(']');
    let is_loopback = bare_host
        .parse::<std::net::IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(bare_host == "localhost");

    if is_loopback {
        println!("\n  FormaOps Dashboard running at http://localhost:3000\n");
    } else {
        eprintln!("\n  WARNING: FORMA_HOST={host} — the dashboard is reachable from your network.");
        eprintln!("  The /api/* routes have no authentication; anyone who can reach this");
        eprintln!("  machine can read them. Unset FORMA_HOST to serve on localhost only.\n");
        println!("\n  FormaOps Dashboard running at http://{host}:3000\n");
    }

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("Failed to bind to {addr}: {e}"));
    axum::serve(listener, app).await.expect("Server error");
}
