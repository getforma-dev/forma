use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use forma_ir::{IrModule, SlotData};
use forma_server::{
    assets, load_ir_modules_strict, render_browser_shell, sw, try_render, PageConfig, RenderCtx,
    RenderMode,
};
use rust_embed::Embed;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Embed)]
#[folder = "admin/dist/"]
struct Assets;

struct AppState {
    manifest: forma_server::AssetManifest,
    /// Per-route render mode, read at start from what the frontend build
    /// declared: `npm run build` emits no `.ir`, so `/` is rendered in the
    /// browser; `npm run build:ssr` emits one, and `/` is rendered on the
    /// server.
    render_modes: HashMap<String, RenderMode>,
    ir_modules: HashMap<String, IrModule>,
}

#[tokio::main]
async fn main() {
    // A render that fails comes back to `home` as a coded error, which `home`
    // logs through `tracing`; forma-server's own security events go there too.
    // Without a subscriber those lines go nowhere. Keep this.
    tracing_subscriber::fmt::init();

    // Check if frontend has been built
    if Assets::get("manifest.json").is_none() {
        eprintln!("\n  Error: Frontend not built yet.\n");
        eprintln!("  Run these commands first:");
        eprintln!("    cd admin");
        eprintln!("    npm ci");
        eprintln!("    npm run build\n");
        std::process::exit(1);
    }

    let manifest = assets::try_load_manifest::<Assets>().unwrap_or_else(|error| {
        eprintln!("\n  Error: admin/dist/manifest.json: {error}\n");
        std::process::exit(1);
    });
    // Every module the build declared, or no server: a module that is
    // missing, corrupt or from another format version stops the server here,
    // before the port binds, naming its route, file and code.
    let (render_modes, ir_modules) =
        load_ir_modules_strict::<Assets>(&manifest).unwrap_or_else(|errors| {
            eprintln!("\n  Error: the frontend build's IR modules did not load:");
            for error in &errors {
                eprintln!("    {error}");
            }
            eprintln!("\n  Rebuild the frontend: cd admin && npm run build:ssr\n");
            std::process::exit(1);
        });

    match render_modes.get("/") {
        Some(RenderMode::Phase2SsrReconcile) => {
            tracing::info!("/ is Phase 2 (server-rendered from IR)");
        }
        _ => {
            tracing::info!(
                "/ is Phase 1 (client mount). Run `npm run build:ssr` in admin/ for Phase 2."
            );
        }
    }

    // No service worker: no page registers one, and /sw.js serves
    // forma-server's retiring worker, which deletes the caches an earlier
    // Forma worker left on this origin and unregisters itself. To turn a
    // worker on, see `forma_server::sw`.
    sw::configure(sw::ServiceWorker::off()).expect("configured once, before the first page");

    let state = Arc::new(AppState { manifest, render_modes, ir_modules });

    let app = Router::new()
        .route("/", get(home))
        .route("/favicon.ico", get(favicon))
        .route("/sw.js", get(sw::serve_sw::<Assets>))
        .route("/_assets/{*filename}", get(assets::serve_asset::<Assets>))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await.unwrap();
    tracing::info!("Listening on http://127.0.0.1:3000");
    axum::serve(listener, app).await.unwrap();
}

async fn home(State(state): State<Arc<AppState>>) -> Response {
    let route = "/";
    // Decided at start by what the build emitted, never here in place of a
    // failure.
    let render_mode = state
        .render_modes
        .get(route)
        .copied()
        .unwrap_or(RenderMode::Phase1ClientMount);
    let ir_module = state.ir_modules.get(route);

    // Start from the IR's own defaults here; to server-render real data,
    // replace this with
    // `SlotData::from_json(&serde_json::to_string(&data)?, module)` — the JSON
    // keys are the slot names in the emitted `.ir`.
    let slots = ir_module.map(|module| SlotData::new_from_defaults(&module.slots));

    // Every forma-server 0.2.x `PageConfig` names `config_script`, which is
    // deprecated and removed in 3.0.0; it stays `None`.
    #[allow(deprecated)]
    let config = PageConfig {
        title: "Home",
        route_pattern: route,
        manifest: &state.manifest,
        config_script: None,
        // Server data reaches the page here, as JSON: serde_json escapes every
        // <, so data derived from user input cannot break out of the script.
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
        render_mode,
        ir_module,
        slots: slots.as_ref(),
    };

    let ctx = RenderCtx::new();
    let rendered = match render_mode {
        // The page rendered from its module, or a coded error: never an
        // empty shell in its place.
        RenderMode::Phase2SsrReconcile => try_render(&config, &ctx),
        // Built without SSR: the script and style tags around an empty
        // `<div id="app">`, which the browser fills.
        RenderMode::Phase1ClientMount => render_browser_shell(&config, &ctx),
    };
    match rendered {
        // A `PageResponse` sends the HTML with the policy for its nonce,
        // `Cache-Control: no-store` (the nonce is this response's alone) and
        // the document security headers.
        Ok(page) => page.into_response(),
        // Forma logs nothing: count failures by code and route here, and
        // answer with your own error page. The error stays in the log, never
        // in the response, and no empty shell takes the page's place.
        Err(error) => {
            tracing::error!(code = error.code(), route = error.route(), "{error}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(header::CACHE_CONTROL, "no-store"), (header::X_CONTENT_TYPE_OPTIONS, "nosniff")],
                "Internal Server Error",
            )
                .into_response()
        }
    }
}

async fn favicon() -> StatusCode {
    StatusCode::NO_CONTENT
}
