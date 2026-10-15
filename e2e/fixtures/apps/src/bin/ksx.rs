//! The ksx fixture application: a controller button-check screen shaped like a desktop
//! studio's: a nested roster payload, derived booleans the old server injected by name, and
//! a grid of chips. The roster is fixed data standing in for the studio's mapper snapshot.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use forma_fixture_apps as fixture;
use forma_ir::PageProps;
use forma_server::{PageHandle, RenderCtx};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "out/ksx/dist/"]
struct Assets;

#[derive(PageProps)]
struct Binding {
    control: String,
    keys: Vec<String>,
}

#[derive(PageProps)]
struct Slot {
    number: u32,
    persona: String,
    persona_label: String,
    preset: String,
    keyboard: String,
    summary: String,
    bindings: Vec<Binding>,
}

#[derive(PageProps)]
struct Mapper {
    generated_at: String,
    source: String,
    slots: Vec<Slot>,
}

#[derive(PageProps)]
struct Session {
    reachable: bool,
    running: bool,
    line: String,
    profile: Option<String>,
}

#[derive(PageProps)]
struct Chip {
    id: u32,
    slot: String,
    player: String,
    control: String,
    label: String,
    keys: String,
}

#[derive(PageProps)]
struct CheckProps {
    mapper: Mapper,
    session: Session,
    feed_hint: String,
    feed_line: String,
    loss_line: String,
    frames_seen: u32,
    chips: Vec<Chip>,
    has_slots: bool,
    no_slots: bool,
    has_loss: bool,
    quiet: bool,
    empty_heading: String,
    empty_line: String,
}

struct App {
    check: PageHandle<CheckProps>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let start = fixture::load::<Assets>();
    let check = fixture::bind::<CheckProps>(&start.pages, "/check");
    fixture::finalize(&start.pages);
    let router = Router::new()
        .route("/check", get(check_page))
        .with_state(Arc::new(App { check }));
    fixture::serve(fixture::with_assets::<Assets>(router)).await;
}

/// (control, label, keys) for one controller.
const XBOX: &[(&str, &str, &[&str])] = &[
    ("A", "A", &["G"]),
    ("B", "B", &["H"]),
    ("dpad.up", "D-pad \u{2191}", &["W", "ArrowUp"]),
    ("lt", "LT", &[]),
];
const PLAYSTATION: &[(&str, &str, &[&str])] =
    &[("A", "\u{2715}", &["G"]), ("B", "\u{25cb}", &["H"])];

fn slot(
    number: u32,
    persona: &str,
    label: &str,
    preset: &str,
    controls: &[(&str, &str, &[&str])],
) -> Slot {
    Slot {
        number,
        persona: persona.into(),
        persona_label: label.into(),
        preset: preset.into(),
        keyboard: "left hand".into(),
        summary: format!("{} controls", controls.len()),
        bindings: controls
            .iter()
            .map(|(control, _, keys)| Binding {
                control: (*control).into(),
                keys: keys.iter().map(|key| (*key).into()).collect(),
            })
            .collect(),
    }
}

async fn check_page(
    State(app): State<Arc<App>>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    // `?state=empty` is the studio with no controller yet: the other branch of every condition.
    let empty = query.get("state").map(String::as_str) == Some("empty");
    let slots = if empty {
        Vec::new()
    } else {
        vec![
            slot(1, "xbox-series", "Xbox Series", "arcade", XBOX),
            slot(2, "dualsense", "DualSense", "arcade", PLAYSTATION),
        ]
    };
    let mut chips = Vec::new();
    for (number, controls) in [(1_u32, XBOX), (2_u32, PLAYSTATION)] {
        if empty {
            break;
        }
        for (control, label, keys) in controls {
            chips.push(Chip {
                id: chips.len() as u32 + 1,
                slot: number.to_string(),
                player: format!("P{number}"),
                control: (*control).into(),
                label: (*label).into(),
                keys: keys.join(" "),
            });
        }
    }
    let props = CheckProps {
        mapper: Mapper {
            generated_at: "2026-10-15T12:00:00Z".into(),
            source: "fixture".into(),
            slots,
        },
        session: Session {
            reachable: true,
            running: false,
            line: "Idle.".into(),
            profile: None,
        },
        feed_hint: "Press a key to see which inputs respond.".into(),
        feed_line: "Waiting for input.".into(),
        loss_line: "2 frames skipped.".into(),
        frames_seen: 1001,
        has_slots: !chips.is_empty(),
        no_slots: chips.is_empty(),
        chips,
        has_loss: true,
        quiet: true,
        empty_heading: if empty {
            "No device configured".into()
        } else {
            String::new()
        },
        empty_line: if empty {
            "Add a device, then return to this page.".into()
        } else {
            String::new()
        },
    };
    fixture::respond(
        app.check
            .render(&props, &RenderCtx::new().with_title("Input monitor")),
    )
}
