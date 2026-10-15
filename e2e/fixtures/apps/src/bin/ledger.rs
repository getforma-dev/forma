//! The ledger fixture application: a household finance page whose arrival island is
//! seeded from the server's snapshot (shaped after a household finance app's arrival route, with synthetic values).

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
#[folder = "out/ledger/dist/"]
struct Assets;

#[derive(PageProps)]
struct ArrivalProps {
    arrival_title: String,
    arrival_date: String,
    arrival_cash: String,
    arrival_bills: String,
    arrival_income: String,
    arrival_status: String,
    arrival_summary: bool,
}

struct App {
    household: PageHandle<ArrivalProps>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let start = fixture::load::<Assets>();
    let household = fixture::bind::<ArrivalProps>(&start.pages, "/household");
    fixture::finalize(&start.pages);
    let router = Router::new()
        .route("/household", get(household_page))
        .route("/api/status", get(fixture::instance))
        .with_state(Arc::new(App { household }));
    fixture::serve(fixture::with_assets::<Assets>(router)).await;
}

async fn household_page(State(app): State<Arc<App>>) -> Response {
    // The snapshot a household route would take from its store: fixed here.
    let props = ArrivalProps {
        arrival_title: "Rivera household".into(),
        arrival_date: "2026-09-13".into(),
        arrival_cash: "$12,345.67".into(),
        arrival_bills: "$34.00".into(),
        arrival_income: "$2,000.00".into(),
        arrival_status: "Loading".into(),
        arrival_summary: true,
    };
    fixture::respond(
        app.household
            .render(&props, &RenderCtx::new().with_title("Household")),
    )
}
