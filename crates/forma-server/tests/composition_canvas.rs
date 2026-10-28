//! FORMA-246's derived Rust half consumes the compiler's named canvas and shared states.
use axum::{body::to_bytes, response::IntoResponse};
use forma_ir::PageProps;
use forma_server::{assets::try_load_manifest, load_ir_modules, RenderCtx};
use rust_embed::Embed;
use serde::Deserialize;

#[derive(Embed)]
#[folder = "tests/fixtures/composition-canvas/"]
struct Assets;

#[derive(PageProps, Deserialize)]
struct Cell {
    id: String,
    text: String,
}
#[derive(PageProps, Deserialize)]
struct Row {
    id: String,
    cells: Vec<Cell>,
}
#[derive(PageProps, Deserialize)]
struct Bar {
    id: String,
    x: String,
    height: String,
    label: String,
}
#[derive(PageProps, Deserialize)]
struct Choice {
    id: String,
    label: String,
}
#[derive(PageProps, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Field {
    id: String,
    label: String,
    is_text: bool,
    is_enum: bool,
    choices: Vec<Choice>,
}
#[derive(PageProps, Deserialize)]
struct Item {
    id: String,
    label: String,
    value: String,
}
#[derive(PageProps, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    #[props(rename = "summary")]
    Summary,
    #[props(rename = "table")]
    Table,
    #[props(rename = "timeline")]
    Timeline,
    #[props(rename = "form")]
    Form,
}
#[derive(PageProps, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Card {
    id: String,
    title: String,
    kind: Kind,
    is_summary: bool,
    is_table: bool,
    is_timeline: bool,
    is_form: bool,
    style: String,
    items: Vec<Item>,
    rows: Vec<Row>,
    bars: Vec<Bar>,
    fields: Vec<Field>,
}
#[derive(PageProps, Deserialize)]
struct CanvasProps {
    cards: Vec<Card>,
}
fn states() -> Vec<CanvasProps> {
    serde_json::from_str(include_str!(
        "../../../packages/compiler/tests/fixtures/conformance/composition-canvas/states.json"
    ))
    .unwrap()
}
fn escaped(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[tokio::test]
async fn composition_canvas_binds_finalizes_and_renders_all_values_with_response_policy() {
    let pages = load_ir_modules::<Assets>(&try_load_manifest::<Assets>().unwrap()).unwrap();
    let page = pages.bind::<CanvasProps>("home").unwrap();
    assert!(page.warnings().is_empty(), "{:?}", page.warnings());
    pages.finalize().unwrap();
    let states = states();
    assert_eq!(
        states
            .iter()
            .map(|state| state.cards.len())
            .collect::<Vec<_>>(),
        [8, 0, 12, 8]
    );
    let mut previous_nonce = String::new();
    for state in &states {
        let parts = page
            .render(state, &RenderCtx::new())
            .unwrap()
            .into_parts_unchecked();
        let html = &parts.html;
        assert_eq!(html.matches("data-island-state").count(), 1, "{html}");
        // Assert visible native markup, never a value merely present in inert JSON.
        let html = html.split("<body>").nth(1).unwrap();
        assert_eq!(html.matches("data-forma-island=").count(), 1, "{html}");
        assert!(html.contains("data-selected data-forma-island="), "{html}");
        assert_eq!(
            html.matches("class=\"card\"").count(),
            state.cards.len(),
            "{html}"
        );
        for card in &state.cards {
            assert!(
                html.contains(&format!("style=\"{}\"", card.style)),
                "{}",
                card.id
            );
            assert!(html.contains(&escaped(&card.title)), "{}", card.title);
            for item in &card.items {
                assert!(html.contains(&escaped(&item.label)), "{}", item.label);
                assert!(html.contains(&escaped(&item.value)), "{}", item.value);
            }
            for row in &card.rows {
                for cell in &row.cells {
                    assert!(html.contains(&escaped(&cell.text)), "{}", cell.text);
                }
            }
            for bar in &card.bars {
                assert!(html.contains(&format!("x=\"{}\"", bar.x)), "{}", bar.x);
                assert!(
                    html.contains(&format!("height=\"{}\"", bar.height)),
                    "{}",
                    bar.height
                );
                assert!(html.contains(&escaped(&bar.label)), "{}", bar.label);
            }
            for field in &card.fields {
                assert!(
                    html.contains(&format!("for=\"{}\"", field.id)),
                    "{}",
                    field.id
                );
                assert!(
                    html.contains(&format!("id=\"{}\"", field.id)),
                    "{}",
                    field.id
                );
                assert!(html.contains(&escaped(&field.label)), "{}", field.label);
                for choice in &field.choices {
                    assert!(
                        html.contains(&format!("value=\"{}\"", choice.id)),
                        "{}",
                        choice.id
                    );
                    assert!(html.contains(&escaped(&choice.label)), "{}", choice.label);
                }
            }
        }
        assert_ne!(parts.nonce.to_string(), previous_nonce);
        previous_nonce = parts.nonce.to_string();
        let response = page
            .render(state, &RenderCtx::new())
            .unwrap()
            .into_response();
        assert_eq!(response.headers()["cache-control"], "no-store");
        let csp = response.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .to_owned();
        assert!(csp.contains("'strict-dynamic'"), "{csp}");
        assert!(csp.contains("require-trusted-types-for 'script'"), "{csp}");
        let body = String::from_utf8(
            to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        let nonce = body
            .split("nonce=\"")
            .nth(1)
            .unwrap()
            .split('"')
            .next()
            .unwrap();
        assert!(csp.contains(&format!("'nonce-{nonce}'")), "{csp}");
        assert!(!csp.contains(&previous_nonce));
        assert!(body.contains("composition-canvas"));
    }
}
