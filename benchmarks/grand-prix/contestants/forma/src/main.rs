use axum::{
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use forma_ir::PageProps;
use forma_server::{assets, load_ir_modules, PageHandle, RenderCtx, RouteMode};
use rust_embed::Embed;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Embed)]
#[folder = "admin/dist/"]
struct Assets;

#[derive(PageProps)]
struct Row {
    id: String,
    label: String,
    owner: String,
    amount: String,
    status: String,
    badge: String,
    updated: String,
}

#[derive(PageProps)]
struct Props {
    count: String,
    open: String,
    total: String,
    average: String,
    rows: Vec<Row>,
}

// ---- exact port of shared/dataset.mjs ----
const ADJ: [&str; 25] = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain",
    "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly",
    "adorable", "important", "inexpensive", "cheap", "expensive", "fancy"];
const COLOR: [&str; 11] = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white",
    "black", "orange"];
const NOUN: [&str; 13] = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich",
    "burger", "pizza", "mouse", "keyboard"];
const OWNERS: [&str; 5] = ["maya", "sarah", "jordan", "ops", "finance"];

fn money(cents: u64) -> String {
    let dollars = cents / 100;
    let c = format!("{:02}", cents % 100);
    let mut s = dollars.to_string();
    let mut out = String::new();
    while s.len() > 3 {
        out = format!(",{}{}", &s[s.len() - 3..], out);
        s.truncate(s.len() - 3);
    }
    format!("${}{}.{}", s, out, c)
}

fn build(n: usize) -> Props {
    let mut rows = Vec::with_capacity(n);
    let (mut total, mut open) = (0u64, 0u64);
    for i in 1..=n {
        let amount = ((i * 7919) % 100000) as u64;
        let is_open = i % 3 != 0;
        total += amount;
        if is_open { open += 1; }
        let status = if is_open { "open" } else { "closed" };
        rows.push(Row {
            id: i.to_string(),
            label: format!("{} {} {}", ADJ[(i * 7) % ADJ.len()], COLOR[(i * 11) % COLOR.len()], NOUN[(i * 13) % NOUN.len()]),
            owner: OWNERS[i % OWNERS.len()].to_string(),
            amount: money(amount),
            status: status.to_string(),
            badge: format!("badge {status}"),
            updated: format!("2026-10-{:02}", (i % 28) + 1),
        });
    }
    let average = if n > 0 { total / n as u64 } else { 0 };
    Props { count: n.to_string(), open: open.to_string(), total: money(total), average: money(average), rows }
}

struct AppState {
    page: PageHandle<Props>,
    island: PageHandle<Props>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let manifest = assets::try_load_manifest::<Assets>().unwrap_or_else(|e| {
        eprintln!("manifest: {e}");
        std::process::exit(1);
    });
    let pages = load_ir_modules::<Assets>(&manifest).unwrap_or_else(|errors| {
        for e in errors { eprintln!("{e}"); }
        std::process::exit(1);
    });
    let page = match manifest.route("/ssr").map(|r| r.mode) {
        Some(RouteMode::Ssr) => pages.bind::<Props>("page").unwrap_or_else(|errors| {
            for e in errors { eprintln!("{e}"); }
            std::process::exit(1);
        }),
        _ => { eprintln!("route /ssr is not an SSR route"); std::process::exit(1); }
    };
    let island = pages.bind::<Props>("island").unwrap_or_else(|errors| {
        for error in errors { eprintln!("{error}"); }
        std::process::exit(1);
    });
    pages.finalize().unwrap_or_else(|errors| {
        for e in errors { eprintln!("{e}"); }
        std::process::exit(1);
    });

    let state = Arc::new(AppState { page, island });
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ssr", get(ssr))
        .route("/island", get(island_route))
        .route("/favicon.ico", get(|| async { StatusCode::NO_CONTENT }))
        .route("/_assets/{*filename}", get(assets::serve_asset::<Assets>))
        .with_state(state);

    let port: u16 = std::env::var("PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(3000);
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, port)).await.unwrap();
    let workers = tokio::runtime::Handle::current().metrics().num_workers();
    println!("GP_WORKER_THREADS={workers} available_parallelism={:?}", std::thread::available_parallelism().map(|n| n.get()));
    println!("FORMA_LISTENING http://{}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}

async fn ssr(State(state): State<Arc<AppState>>, Query(q): Query<HashMap<String, String>>) -> Response {
    let n: usize = match q.get("rows").map(|v| v.parse::<usize>()) {
        None => 100,
        Some(Ok(v)) if v == 10 || v == 100 || v == 1000 => v,
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };
    let ctx = RenderCtx::new().with_title("Grand Prix");
    match state.page.render(&build(n), &ctx) {
        Ok(page) => page.into_response(),
        Err(error) => {
            tracing::error!(code = error.code(), route = error.route(), "{error}");
            (StatusCode::INTERNAL_SERVER_ERROR, [(header::CACHE_CONTROL, "no-store")], "Internal Server Error").into_response()
        }
    }
}

async fn island_route(State(state): State<Arc<AppState>>) -> Response {
    let ctx = RenderCtx::new().with_title("Grand Prix");
    match state.island.render(&build(100), &ctx) {
        Ok(page) => page.into_response(),
        Err(error) => {
            tracing::error!(code = error.code(), route = error.route(), "{error}");
            (StatusCode::INTERNAL_SERVER_ERROR, [(header::CACHE_CONTROL, "no-store")], "Internal Server Error").into_response()
        }
    }
}
