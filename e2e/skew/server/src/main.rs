//! Five genuine embedded deployments behind the drill's one-origin balancer.
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use forma_ir::PageProps;
use forma_server::{
    assets, load_ir_modules, render_browser_shell, AssetManifest, PageConfig, PageHandle, RenderCtx,
};
use rust_embed::Embed;
use std::sync::Arc;

#[derive(Embed)]
#[folder = "../out/A/"]
struct A;
#[derive(Embed)]
#[folder = "../out/B/"]
struct B;
#[derive(Embed)]
#[folder = "../out/B2/"]
struct B2;
#[derive(Embed)]
#[folder = "../out/C/"]
struct C;
#[derive(Embed)]
#[folder = "../out/S/"]
struct S;

#[derive(PageProps)]
struct Props {
    count: u32,
    label: String,
    panels: Vec<String>,
}
struct App {
    page: PageHandle<Props>,
    props: Props,
    manifest: AssetManifest,
}

fn respond(result: Result<forma_server::PageResponse, forma_server::RenderError>) -> Response {
    match result {
        Ok(page) => page.into_response(),
        Err(error) => {
            eprintln!("{}: {error}", error.code());
            (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
        }
    }
}
async fn page(State(app): State<Arc<App>>) -> Response {
    respond(
        app.page
            .render(&app.props, &RenderCtx::new().with_title("Deployment drill")),
    )
}
async fn browser(State(app): State<Arc<App>>) -> Response {
    respond(render_browser_shell(
        &PageConfig {
            title: "Browser drill",
            route_pattern: "/csr",
            manifest: &app.manifest,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
        },
        &RenderCtx::new(),
    ))
}
async fn start<T: Embed + 'static>(label: &str) -> String {
    let manifest = assets::try_load_manifest::<T>().expect("valid embedded manifest");
    let pages = load_ir_modules::<T>(&manifest).expect("load compiled native modules");
    let page = pages.bind::<Props>("/").expect("bind native Props");
    pages.finalize().expect("finalize all native routes");
    let panels = (1..=8)
        .map(|index| {
            format!(
                "/_assets/{}",
                manifest.aliases[&format!("panel-{index}.js")]
            )
        })
        .collect();
    let app = Arc::new(App {
        page,
        props: Props {
            count: 7,
            label: label.into(),
            panels,
        },
        manifest,
    });
    let router = Router::new()
        .route("/", get(self::page))
        .route("/csr", get(browser))
        .route("/_assets/{*filename}", get(assets::serve_asset::<T>))
        .route("/favicon.ico", get(|| async { StatusCode::NO_CONTENT }))
        .with_state(app);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind");
    let origin = format!("http://{}", listener.local_addr().expect("bound address"));
    tokio::spawn(async move {
        axum::serve(listener, router)
            .await
            .expect("serve deployment");
    });
    origin
}
#[tokio::main]
async fn main() {
    forma_server::sw::configure(forma_server::sw::ServiceWorker::off())
        .expect("configure worker policy");
    let ports = serde_json::json!({ "A": start::<A>("A").await, "B": start::<B>("B").await,
        "B2": start::<B2>("B").await, "C": start::<C>("C").await, "S": start::<S>("S").await });
    println!("{ports}");
    std::future::pending::<()>().await;
}
