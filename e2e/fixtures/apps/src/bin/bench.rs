//! The bench fixture application: the consumers' heaviest pages as synthetic data
//! (design.md A4), for the measurements FORMA-191 takes and for the parity corpus. Every
//! page is server markup in lists over a handler-generated dataset, plus a few small
//! islands. The data is deterministic: the same request is the same bytes.

use std::sync::Arc;

use axum::extract::State;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use forma_fixture_apps as fixture;
use forma_ir::PageProps;
use forma_server::{PageHandle, RenderCtx};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "out/bench/dist/"]
struct Assets;

#[derive(PageProps)]
struct Tile {
    id: u32,
    label: String,
    count: u32,
    on: bool,
}

#[derive(PageProps)]
struct Field {
    id: u32,
    name: String,
    label: String,
    hint: String,
}

#[derive(PageProps)]
struct Link {
    id: u32,
    text: String,
    href: String,
}

#[derive(PageProps)]
struct Login300Props {
    title: String,
    lede: String,
    fields: Vec<Field>,
    links: Vec<Link>,
    tiles: Vec<Tile>,
}

#[derive(PageProps)]
struct TableRow {
    id: u32,
    name: String,
    status: String,
    owner: String,
    updated: String,
}

#[derive(PageProps)]
struct Console1500Props {
    title: String,
    nav: Vec<Link>,
    rows: Vec<TableRow>,
    tiles: Vec<Tile>,
}

#[derive(PageProps)]
struct Line {
    id: u32,
    text: String,
    note: String,
}

#[derive(PageProps)]
struct Doc10000Props {
    title: String,
    lines: Vec<Line>,
    tiles: Vec<Tile>,
}

#[derive(PageProps)]
struct Cell {
    id: u32,
    text: String,
}

#[derive(PageProps)]
struct Module {
    id: u32,
    title: String,
    count: u32,
    on: bool,
    cells: Vec<Cell>,
}

#[derive(PageProps)]
struct Canvas15000Props {
    title: String,
    modules: Vec<Module>,
}

#[derive(PageProps)]
struct Txn {
    id: u32,
    date: String,
    payee: String,
    category: String,
    amount: String,
}

#[derive(PageProps)]
struct Ledger20000Props {
    title: String,
    transactions: Vec<Txn>,
    tiles: Vec<Tile>,
}

#[derive(PageProps)]
struct Islands100Props {
    title: String,
    tiles: Vec<Tile>,
}

struct App {
    login: PageHandle<Login300Props>,
    console: PageHandle<Console1500Props>,
    document: PageHandle<Doc10000Props>,
    canvas: PageHandle<Canvas15000Props>,
    ledger: PageHandle<Ledger20000Props>,
    islands: PageHandle<Islands100Props>,
}

// How many rows each page holds. Each is chosen so the walker's own node count lands on the
// consumer's figure (apps.spec.ts holds every page within 3% of it).
const LOGIN_FIELDS: u32 = 28;
const LOGIN_LINKS: u32 = 33;
const CONSOLE_NAV: u32 = 25;
const CONSOLE_ROWS: u32 = 146;
const DOCUMENT_LINES: u32 = 1989;
const CANVAS_MODULES: u32 = 50;
const CANVAS_CELLS: u32 = 96;
const LEDGER_TXNS: u32 = 1990;
const ISLANDS: u32 = 100;

const WORDS: [&str; 16] = [
    "amber", "birch", "cedar", "delta", "ember", "fjord", "grove", "harbor", "iris", "juniper",
    "kelp", "lumen", "marsh", "nectar", "orchid", "pebble",
];

/// A small deterministic generator: the same seed is the same words on every run.
fn word(seed: u32) -> &'static str {
    let mut x = seed.wrapping_mul(0x9E37_79B9).wrapping_add(0x85EB_CA6B);
    x ^= x >> 15;
    x = x.wrapping_mul(0x2C1B_3C6D);
    x ^= x >> 12;
    WORDS[(x as usize) % WORDS.len()]
}

fn phrase(seed: u32) -> String {
    format!("{} {}", word(seed), word(seed.wrapping_add(7919)))
}

/// `n` tiles; tile 0 starts at 7 and tile 1 at 1001, the values the audit's criteria name.
fn tiles(n: u32) -> Vec<Tile> {
    (0..n)
        .map(|id| Tile {
            id,
            label: format!("Tile {id}"),
            count: match id {
                0 => 7,
                1 => 1001,
                _ => id * 3 % 97,
            },
            on: false,
        })
        .collect()
}

fn links(n: u32) -> Vec<Link> {
    (0..n)
        .map(|id| Link {
            id,
            text: phrase(id),
            href: format!("/pages/{}", 100 + id),
        })
        .collect()
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
    let props = Login300Props {
        title: "Sign in to Acme".into(),
        lede: "Use your work account.".into(),
        fields: (0..LOGIN_FIELDS)
            .map(|id| Field {
                id,
                name: format!("field-{id}"),
                label: phrase(id),
                hint: phrase(id + 1000),
            })
            .collect(),
        links: links(LOGIN_LINKS),
        tiles: tiles(2),
    };
    fixture::respond(
        app.login
            .render(&props, &RenderCtx::new().with_title("Sign in")),
    )
}

async fn console(State(app): State<Arc<App>>) -> Response {
    let props = Console1500Props {
        title: "Operations console".into(),
        nav: links(CONSOLE_NAV),
        rows: (0..CONSOLE_ROWS)
            .map(|id| TableRow {
                id,
                name: phrase(id),
                status: word(id + 31).into(),
                owner: word(id + 57).into(),
                updated: format!("2026-09-{:02}", id % 28 + 1),
            })
            .collect(),
        tiles: tiles(10),
    };
    fixture::respond(
        app.console
            .render(&props, &RenderCtx::new().with_title("Console")),
    )
}

async fn document(State(app): State<Arc<App>>) -> Response {
    let props = Doc10000Props {
        title: "Field notes".into(),
        lines: (0..DOCUMENT_LINES)
            .map(|id| Line {
                id,
                text: format!("{} {} {}", phrase(id), word(id + 3), word(id + 5)),
                note: word(id + 11).into(),
            })
            .collect(),
        tiles: tiles(5),
    };
    fixture::respond(
        app.document
            .render(&props, &RenderCtx::new().with_title("Document")),
    )
}

async fn canvas(State(app): State<Arc<App>>) -> Response {
    let props = Canvas15000Props {
        title: "Canvas".into(),
        modules: (0..CANVAS_MODULES)
            .map(|id| Module {
                id,
                title: format!("Module {id}"),
                count: match id {
                    0 => 7,
                    1 => 1001,
                    _ => id * 5 % 89,
                },
                on: false,
                cells: (0..CANVAS_CELLS)
                    .map(|cell| Cell {
                        id: cell,
                        text: phrase(id * 1000 + cell),
                    })
                    .collect(),
            })
            .collect(),
    };
    fixture::respond(
        app.canvas
            .render(&props, &RenderCtx::new().with_title("Canvas")),
    )
}

async fn ledger(State(app): State<Arc<App>>) -> Response {
    let props = Ledger20000Props {
        title: "Transactions 2025".into(),
        transactions: (0..LEDGER_TXNS)
            .map(|id| Txn {
                id,
                date: format!("2025-{:02}-{:02}", id % 12 + 1, id % 28 + 1),
                payee: phrase(id),
                category: word(id + 13).into(),
                amount: format!("${}.{:02}", id % 900 + 3, id % 100),
            })
            .collect(),
        tiles: tiles(5),
    };
    fixture::respond(
        app.ledger
            .render(&props, &RenderCtx::new().with_title("Transactions")),
    )
}

async fn islands(State(app): State<Arc<App>>) -> Response {
    let props = Islands100Props {
        title: "One hundred islands".into(),
        tiles: tiles(ISLANDS),
    };
    fixture::respond(
        app.islands
            .render(&props, &RenderCtx::new().with_title("Islands")),
    )
}
