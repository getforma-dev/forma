//! The bench fixture application: the consumers' heaviest pages as synthetic data
//! (design.md A4), for the measurements FORMA-191 takes and for the parity corpus. Every
//! page is server markup in lists over a handler-generated dataset, plus a few small
//! islands. The data is deterministic: the same request is the same markup (the response's nonce aside).

use std::sync::Arc;

use axum::extract::State;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use fixture::bench_data::*;
use forma_fixture_apps as fixture;
use forma_server::{PageHandle, RenderCtx};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "out/bench/dist/"]
struct Assets;

struct App {
    login: PageHandle<Login300Props>,
    console: PageHandle<Console1500Props>,
    document: PageHandle<Doc10000Props>,
    canvas: PageHandle<Canvas15000Props>,
    ledger: PageHandle<Ledger20000Props>,
    islands: PageHandle<Islands100Props>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let start = fixture::load::<Assets>();
    let app = App {
        login: fixture::bind(&start.pages, "/pages/300"),
        console: fixture::bind(&start.pages, "/pages/1500"),
        document: fixture::bind(&start.pages, "/pages/10000"),
        canvas: fixture::bind(&start.pages, "/pages/15000"),
        ledger: fixture::bind(&start.pages, "/pages/20000"),
        islands: fixture::bind(&start.pages, "/pages/islands-100"),
    };
    fixture::finalize(&start.pages);
    let router = Router::new()
        .route("/pages/300", get(login))
        .route("/pages/1500", get(console))
        .route("/pages/10000", get(document))
        .route("/pages/15000", get(canvas))
        .route("/pages/20000", get(ledger))
        .route("/pages/islands-100", get(islands))
        .with_state(Arc::new(app));
    fixture::serve(fixture::with_assets::<Assets>(router)).await;
}

async fn login(State(app): State<Arc<App>>) -> Response {
    let props = login_props();
    fixture::respond(
        app.login
            .render(&props, &RenderCtx::new().with_title("Sign in")),
    )
}

async fn console(State(app): State<Arc<App>>) -> Response {
    let props = console_props();
    fixture::respond(
        app.console
            .render(&props, &RenderCtx::new().with_title("Console")),
    )
}

async fn document(State(app): State<Arc<App>>) -> Response {
    let props = document_props();
    fixture::respond(
        app.document
            .render(&props, &RenderCtx::new().with_title("Document")),
    )
}

async fn canvas(State(app): State<Arc<App>>) -> Response {
    let props = canvas_props();
    fixture::respond(
        app.canvas
            .render(&props, &RenderCtx::new().with_title("Canvas")),
    )
}

async fn ledger(State(app): State<Arc<App>>) -> Response {
    let props = ledger_props();
    fixture::respond(
        app.ledger
            .render(&props, &RenderCtx::new().with_title("Transactions")),
    )
}

async fn islands(State(app): State<Arc<App>>) -> Response {
    let props = islands_props();
    fixture::respond(
        app.islands
            .render(&props, &RenderCtx::new().with_title("Islands")),
    )
}
