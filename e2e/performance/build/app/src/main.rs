//! Public typed application endpoint for the fixed N7 build/rebuild workload.
//! Release embeds assets; ordinary debug rust-embed reads the paired watch output.
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use forma_ir::PageProps;
use forma_server::{assets, load_ir_modules, PageHandle, RenderCtx};
use rust_embed::Embed;
use std::sync::Arc;

#[derive(Embed)]
#[folder = "admin/dist/"]
struct Assets;

#[derive(PageProps)]
struct Row {
    id: u32,
    label: String,
}

#[derive(PageProps)]
struct PageData {
    count: u32,
    title: String,
    rows: Vec<Row>,
    show_notice: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();
    let manifest = assets::load_manifest::<Assets>()?;
    let pages = load_ir_modules::<Assets>(&manifest).map_err(|errors| format!("{errors:?}"))?;
    let handles = (0..12)
        .map(|i| pages.bind::<PageData>(&format!("/page/{i:02}")))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|errors| format!("{errors:?}"))?;
    pages.finalize().map_err(|errors| format!("{errors:?}"))?;
    forma_server::sw::configure(forma_server::sw::ServiceWorker::off())?;
    let router = Router::new()
        .route("/page/{id}", get(page))
        .route("/_assets/{*filename}", get(assets::serve_asset::<Assets>))
        .route("/favicon.ico", get(|| async { StatusCode::NO_CONTENT }))
        .with_state(Arc::new(handles));
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
    println!("FORMA_LISTENING http://{}", listener.local_addr()?);
    axum::serve(listener, router).await?;
    Ok(())
}

async fn page(
    Path(id): Path<String>,
    State(pages): State<Arc<Vec<PageHandle<PageData>>>>,
) -> Response {
    let Some((index, handle)) = id.parse::<usize>().ok().and_then(|index| {
        (id == format!("{index:02}")).then(|| pages.get(index).map(|handle| (index, handle)))?
    }) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let props = PageData {
        count: 7,
        title: format!("Workspace {index}"),
        rows: vec![
            Row {
                id: 1,
                label: "Open".into(),
            },
            Row {
                id: 2,
                label: "Closed".into(),
            },
        ],
        show_notice: true,
    };
    match handle.render(&props, &RenderCtx::new().with_title(&props.title)) {
        Ok(page) => page.into_response(),
        Err(error) => {
            tracing::error!(code = error.code(), "{error}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
