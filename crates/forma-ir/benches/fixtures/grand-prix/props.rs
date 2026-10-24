// Grand Prix dashboard presentation props, derived from the frozen FORMA-254 fixture.
use forma_ir::PageProps;

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
pub(crate) struct Props {
    count: String,
    open: String,
    total: String,
    average: String,
    rows: Vec<Row>,
}

// ---- exact port of shared/dataset.mjs ----
const ADJ: [&str; 25] = [
    "pretty",
    "large",
    "big",
    "small",
    "tall",
    "short",
    "long",
    "handsome",
    "plain",
    "quaint",
    "clean",
    "elegant",
    "easy",
    "angry",
    "crazy",
    "helpful",
    "mushy",
    "odd",
    "unsightly",
    "adorable",
    "important",
    "inexpensive",
    "cheap",
    "expensive",
    "fancy",
];
const COLOR: [&str; 11] = [
    "red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black",
    "orange",
];
const NOUN: [&str; 13] = [
    "table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger",
    "pizza", "mouse", "keyboard",
];
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

pub(crate) fn build(n: usize) -> Props {
    let mut rows = Vec::with_capacity(n);
    let (mut total, mut open) = (0u64, 0u64);
    for i in 1..=n {
        let amount = ((i * 7919) % 100000) as u64;
        let is_open = i % 3 != 0;
        total += amount;
        if is_open {
            open += 1;
        }
        let status = if is_open { "open" } else { "closed" };
        rows.push(Row {
            id: i.to_string(),
            label: format!(
                "{} {} {}",
                ADJ[(i * 7) % ADJ.len()],
                COLOR[(i * 11) % COLOR.len()],
                NOUN[(i * 13) % NOUN.len()]
            ),
            owner: OWNERS[i % OWNERS.len()].to_string(),
            amount: money(amount),
            status: status.to_string(),
            badge: format!("badge {status}"),
            updated: format!("2026-10-{:02}", (i % 28) + 1),
        });
    }
    let average = if n > 0 { total / n as u64 } else { 0 };
    Props {
        count: n.to_string(),
        open: open.to_string(),
        total: money(total),
        average: money(average),
        rows,
    }
}
