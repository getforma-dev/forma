//! The HTTP fixture and release measurements use these identical deterministic typed inputs.
use forma_ir::PageProps;

#[derive(PageProps)]
pub struct Tile {
    id: u32,
    label: String,
    count: u32,
    on: bool,
}

#[derive(PageProps)]
pub struct Field {
    id: u32,
    name: String,
    label: String,
    hint: String,
}

#[derive(PageProps)]
pub struct Link {
    id: u32,
    text: String,
    href: String,
}

#[derive(PageProps)]
pub struct Login300Props {
    title: String,
    lede: String,
    fields: Vec<Field>,
    links: Vec<Link>,
    tiles: Vec<Tile>,
}

#[derive(PageProps)]
pub struct TableRow {
    id: u32,
    name: String,
    status: String,
    owner: String,
    updated: String,
}

#[derive(PageProps)]
pub struct Console1500Props {
    title: String,
    nav: Vec<Link>,
    rows: Vec<TableRow>,
    tiles: Vec<Tile>,
}

#[derive(PageProps)]
pub struct Line {
    id: u32,
    text: String,
    note: String,
}

#[derive(PageProps)]
pub struct Doc10000Props {
    title: String,
    lines: Vec<Line>,
    tiles: Vec<Tile>,
}

#[derive(PageProps)]
pub struct Cell {
    id: u32,
    text: String,
}

#[derive(PageProps)]
pub struct Module {
    id: u32,
    title: String,
    count: u32,
    on: bool,
    cells: Vec<Cell>,
}

#[derive(PageProps)]
pub struct Canvas15000Props {
    title: String,
    modules: Vec<Module>,
}

#[derive(PageProps)]
pub struct Txn {
    id: u32,
    date: String,
    payee: String,
    category: String,
    amount: String,
}

#[derive(PageProps)]
pub struct Ledger20000Props {
    title: String,
    transactions: Vec<Txn>,
    tiles: Vec<Tile>,
}

#[derive(PageProps)]
pub struct Islands100Props {
    title: String,
    tiles: Vec<Tile>,
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

pub fn login_props() -> Login300Props {
    Login300Props {
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
    }
}

pub fn console_props() -> Console1500Props {
    console_with_rows(CONSOLE_ROWS)
}

pub fn console_with_rows(row_count: u32) -> Console1500Props {
    Console1500Props {
        title: "Operations console".into(),
        nav: links(CONSOLE_NAV),
        rows: (0..row_count)
            .map(|id| TableRow {
                id,
                name: phrase(id),
                status: word(id + 31).into(),
                owner: word(id + 57).into(),
                updated: format!("2026-09-{:02}", id % 28 + 1),
            })
            .collect(),
        tiles: tiles(10),
    }
}

pub fn document_props() -> Doc10000Props {
    Doc10000Props {
        title: "Field notes".into(),
        lines: (0..DOCUMENT_LINES)
            .map(|id| Line {
                id,
                text: format!("{} {} {}", phrase(id), word(id + 3), word(id + 5)),
                note: word(id + 11).into(),
            })
            .collect(),
        tiles: tiles(5),
    }
}

pub fn canvas_props() -> Canvas15000Props {
    Canvas15000Props {
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
    }
}

pub fn ledger_props() -> Ledger20000Props {
    Ledger20000Props {
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
    }
}

pub fn islands_props() -> Islands100Props {
    Islands100Props {
        title: "One hundred islands".into(),
        tiles: tiles(ISLANDS),
    }
}
