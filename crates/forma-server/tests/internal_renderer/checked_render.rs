//! `try_render` and `render_browser_shell`: a render returns the page with
//! its counts, or a coded `RenderError` the handler answers (DR-11, DR-12,
//! L-3; FORMA-120).
//!
//! The fixture is a multi-tenant page in the shape of GateWASM's: one route,
//! `/t/:tenant`, whose "Branding" island writes the tenant's name and one
//! swatch per brand colour. The handler below is the A2 handler shape:
//! `try_render`, then `Ok(page) => page`, `Err(e) =>` the application's own
//! error page.

use super::{
    render_shell as render_browser_shell, render_ssr as try_render, RenderFixture as PageConfig,
    RenderPath as RenderMode,
};
use crate as forma_server;
use axum::body::to_bytes;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use forma_ir::fault_injection::FAULT_TRIGGER;
use forma_ir::parser::test_helpers::{
    build_declared_fixture, encode_close_tag, encode_list, encode_open_tag, encode_text,
};
use forma_ir::{IrModule, SlotData, SlotValue, WalkLimits};
use forma_server::{AssetManifest, PolicyExtensions, RenderCtx, RenderError, RouteAssets};
use std::collections::HashMap;

const ROUTE: &str = "/t/:tenant";

// -- Fixtures ---------------------------------------------------------------

#[allow(deprecated)] // `wasm` is named by every 0.2.x `AssetManifest` literal (DR-23)
fn manifest() -> AssetManifest {
    let mut routes = HashMap::new();
    routes.insert(
        ROUTE.to_string(),
        RouteAssets {
            mode: forma_server::RouteMode::Ssr,
            modulepreload: Vec::new(),
            js: vec!["app.a1b2c3d4.js".to_string()],
            css: vec![],
            fonts: vec![],
            total_size_br: 0,
            budget_warn_threshold: 0,
            ir: Some("tenant.e5f6.ir".to_string()),
        },
    );
    AssetManifest {
        version: 2,
        writer: "3.0.0".into(),
        app: "ledger".into(),
        aliases: HashMap::new(),
        build: "test".to_string(),
        assets: super::fixture_assets(&routes),
        routes,
    }
}

fn dyn_text(slot: u16, marker: u16) -> Vec<u8> {
    let mut b = vec![0x05];
    b.extend_from_slice(&slot.to_le_bytes());
    b.extend_from_slice(&marker.to_le_bytes());
    b
}

fn island(id: u16, body: &[u8], close: bool) -> Vec<u8> {
    let mut b = vec![0x0B];
    b.extend_from_slice(&id.to_le_bytes());
    b.extend_from_slice(body);
    if close {
        b.push(0x0C);
        b.extend_from_slice(&id.to_le_bytes());
    }
    b
}

/// The "Branding" island. Strings: 0 div, 1 Branding, 2 i, 3 name, 4 colors,
/// 5 color. Slots: 0 the tenant's name, 1 its colours, 2 one colour (a row).
fn branding_module() -> IrModule {
    let mut row = encode_open_tag(2, &[]);
    row.extend_from_slice(&dyn_text(2, 1));
    row.extend_from_slice(&encode_close_tag(2));
    let mut body = encode_open_tag(0, &[]);
    body.extend_from_slice(&dyn_text(0, 0));
    body.extend_from_slice(&encode_list(1, 2, &row));
    body.extend_from_slice(&encode_close_tag(0));
    let data = build_declared_fixture(
        &["div", "Branding", "i", "name", "colors", "color"],
        &[
            (0, 3, 0x01, 0x00, &[]),
            (1, 4, 0x04, 0x00, &[]),
            (2, 5, 0x01, 0x01, &[]),
        ],
        &island(0, &body, true),
        &[(0, 0x01, 0x01, 1, 0, &[])],
    );
    IrModule::parse(&data).expect("branding module")
}

/// A tenant's branding as slot data.
fn branding(name: &str, colors: usize) -> SlotData {
    let mut slots = SlotData::new(3);
    slots.set(0, SlotValue::Text(name.to_string()));
    slots.set(
        1,
        SlotValue::array(
            (0..colors)
                .map(|i| SlotValue::Text(format!("#{i:06x}")))
                .collect(),
        ),
    );
    slots
}

#[allow(deprecated)] // `config_script` is named by every 0.2.x literal
fn config<'a>(
    manifest: &'a AssetManifest,
    module: Option<&'a IrModule>,
    slots: Option<&'a SlotData>,
) -> PageConfig<'a> {
    PageConfig {
        title: "Tenant",
        route_pattern: ROUTE,
        manifest,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
        render_mode: RenderMode::Phase2SsrReconcile,
        ir_module: module,
        slots,
    }
}

/// The application: a tenant's page, or its error page naming the failure.
struct App {
    manifest: AssetManifest,
    module: IrModule,
    tenants: HashMap<&'static str, SlotData>,
    ctx: RenderCtx,
}

impl App {
    fn new() -> Self {
        let mut tenants = HashMap::new();
        tenants.insert("acme", branding("Acme", 3));
        // A stand-in component that panics on this tenant's branding.
        tenants.insert("broken", branding(FAULT_TRIGGER, 3));
        // Sixty colours against this route's fifty-row budget.
        tenants.insert("loud", branding("Loud", 60));
        App {
            manifest: manifest(),
            module: branding_module(),
            tenants,
            ctx: RenderCtx::new().with_limits(WalkLimits {
                max_list_iterations: 50,
                ..WalkLimits::default()
            }),
        }
    }

    fn get(&self, tenant: &str) -> Response {
        let slots = &self.tenants[tenant];
        match try_render(
            &config(&self.manifest, Some(&self.module), Some(slots)),
            &self.ctx,
        ) {
            Ok(page) => page.into_response(),
            Err(error) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!(
                    "error page: {} on {} in [{}]",
                    error.code(),
                    error.route(),
                    error.component_path().join(" > ")
                ),
            )
                .into_response(),
        }
    }
}

async fn body(response: Response) -> (StatusCode, String) {
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("in-memory body");
    (status, String::from_utf8(bytes.to_vec()).expect("utf-8"))
}

// -- SR44 and S2 --------------------------------------------------------------

#[tokio::test]
async fn a_panicking_component_returns_fault_the_handler_answers_500_and_the_next_request_renders()
{
    let app = App::new();

    let (status, html) = body(app.get("acme")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(html.contains("Acme"));

    // The panic is caught inside the render: the handler gets a value, and
    // answers it, rather than the connection dropping with no response.
    let (status, page) = body(app.get("broken")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(page, "error page: RENDER-399 on /t/:tenant in [Branding]");

    // The process, the module and every other tenant carry on.
    let (status, html) = body(app.get("acme")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(html.contains("Acme") && html.contains("data-forma-ssr"));
    // A server-rendered page names the build too, on the same root (FORMA-186, DR-29).
    assert!(html.contains(&format!(
        "<div id=\"app\" data-forma-build=\"{}\" data-forma-ssr>",
        app.manifest.build
    )));
}

#[tokio::test]
async fn a_component_failing_on_one_tenants_branding_fails_that_request_alone() {
    // S2: one tenant's branding is over the page's budget; that request alone
    // gets the application's error page, naming page and component.
    let app = App::new();
    let (status, _) = body(app.get("acme")).await;
    assert_eq!(status, StatusCode::OK);

    let (status, page) = body(app.get("loud")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(page, "error page: RENDER-302 on /t/:tenant in [Branding]");

    let (status, html) = body(app.get("acme")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(html.contains("Acme"));
}

// -- Every code: raised, with code, route and component path (N12) ------------

fn err(config: &PageConfig, ctx: &RenderCtx) -> RenderError {
    try_render(config, ctx).expect_err("this render must fail")
}

#[test]
fn render_101_a_server_render_without_its_module() {
    let manifest = manifest();
    let module = branding_module();
    let slots = branding("Acme", 1);
    for (module, slots) in [(None, Some(&slots)), (Some(&module), None)] {
        let error = err(&config(&manifest, module, slots), &RenderCtx::new());
        assert_eq!(error.code(), "RENDER-101");
        assert_eq!(error.route(), ROUTE);
        assert!(error.component_path().is_empty());
        assert!(matches!(error, RenderError::MissingModule { .. }));
    }
}

#[test]
fn render_102_a_module_the_walk_refuses_names_its_island() {
    // All string references are load-validated. An invalid HTML name inside
    // "Branding" still reaches the renderer's semantic check and names its island.
    let body = encode_open_tag(0, &[]);
    let data = build_declared_fixture(
        &["bad tag", "Branding"],
        &[],
        &island(0, &body, true),
        &[(0, 0x01, 0x01, 1, 0, &[])],
    );
    let module = IrModule::parse(&data).expect("parses");
    let slots = SlotData::new(0);
    let manifest = manifest();
    let error = err(
        &config(&manifest, Some(&module), Some(&slots)),
        &RenderCtx::new(),
    );
    assert_eq!(error.code(), "RENDER-102");
    assert_eq!(error.route(), ROUTE);
    assert_eq!(error.component_path(), ["Branding"]);
    assert!(
        error.to_string().contains("RENDER-102") && error.to_string().contains(ROUTE),
        "{error}"
    );
}

#[test]
fn render_201_an_invalid_policy_extension() {
    let manifest = manifest();
    let module = branding_module();
    let slots = branding("Acme", 1);
    let ctx = RenderCtx::new().with_policy(PolicyExtensions::new().img_src("'unsafe-inline'"));
    let error = err(&config(&manifest, Some(&module), Some(&slots)), &ctx);
    assert_eq!(error.code(), "RENDER-201");
    assert_eq!(error.route(), ROUTE);
    assert!(error.component_path().is_empty());
    match &error {
        RenderError::Policy { cause, .. } => assert_eq!(cause.directive(), "img-src"),
        other => panic!("expected Policy, got {other:?}"),
    }
}

// RENDER-202 (a failed nonce draw) cannot be raised through the OS random
// source from a test; `render::tests::render_202_a_failed_nonce_draw` raises it
// through the render's own seam.

#[test]
fn render_301_the_output_budget_with_the_counts_reached() {
    let manifest = manifest();
    let module = branding_module();
    let slots = branding("Acme", 50);
    let ctx = RenderCtx::new().with_limits(WalkLimits {
        max_output_bytes: 400,
        ..WalkLimits::default()
    });
    let error = err(&config(&manifest, Some(&module), Some(&slots)), &ctx);
    assert_eq!(error.code(), "RENDER-301");
    assert_eq!(error.route(), ROUTE);
    assert_eq!(error.component_path(), ["Branding"]);
    // SR22: it never aborts, and it says how far it got.
    let counts = error.counts().expect("a budget error carries its counts");
    assert!(counts.bytes > 300 && counts.bytes <= 400, "{counts:?}");
    assert!(counts.nodes > 2 && counts.list_iterations > 1, "{counts:?}");
}

#[test]
fn render_302_the_list_budget_with_the_counts_reached() {
    let manifest = manifest();
    let module = branding_module();
    let slots = branding("Acme", 60);
    let ctx = RenderCtx::new().with_limits(WalkLimits {
        max_list_iterations: 50,
        ..WalkLimits::default()
    });
    let error = err(&config(&manifest, Some(&module), Some(&slots)), &ctx);
    assert_eq!(error.code(), "RENDER-302");
    assert_eq!(error.route(), ROUTE);
    assert_eq!(error.component_path(), ["Branding"]);
    let counts = error.counts().expect("counts");
    // Refused before its first row (FORMA-122): 60 rows against 50 left.
    assert_eq!(counts.list_iterations, 0, "no row was walked");
    assert_eq!(counts.nodes, 2, "the div and the name, then the refusal");
}

#[test]
fn render_302_a_60_000_row_list_fails_before_its_first_row_in_under_a_millisecond() {
    // SR38's first half (DR-13). At 0.2.1 this walked 50,000 rows first:
    // 23.6 to 24.9 ms to the error in a release build (TH17, AR1).
    let manifest = manifest();
    let module = branding_module();
    let slots = branding("Acme", 60_000);
    let mut fastest = std::time::Duration::MAX;
    for _ in 0..5 {
        let error = err(
            &config(&manifest, Some(&module), Some(&slots)),
            &RenderCtx::new(),
        );
        assert_eq!(error.code(), "RENDER-302");
        assert_eq!(error.route(), ROUTE);
        assert_eq!(error.component_path(), ["Branding"]);
        let counts = error.counts().expect("counts");
        // The deterministic half: not one of the 60,000 rows was walked.
        assert_eq!(counts.list_iterations, 0);
        assert_eq!(counts.nodes, 2);
        fastest = fastest.min(counts.walk_time);
    }
    // The timed half, as the walk measured itself; the best of five, so one
    // preempted slice on a loaded runner does not decide it.
    assert!(
        fastest < std::time::Duration::from_millis(1),
        "the refusal took {fastest:?}"
    );

    // A list exactly at the default budget still renders.
    let slots = branding("Acme", forma_ir::DEFAULT_MAX_LIST_ITERATIONS);
    let page = try_render(
        &config(&manifest, Some(&module), Some(&slots)),
        &RenderCtx::new(),
    )
    .expect("50,000 rows is within the default budget");
    assert_eq!(page.counts().list_iterations, 50_000);
}

#[test]
fn render_303_nesting_past_the_walker_s_depth() {
    // Five LISTs nested over the same one-row array, inside a "Deep" island:
    // past the walker's list depth of four.
    let mut ops = encode_text(2);
    for item in 1..=5 {
        ops = encode_list(0, item, &ops);
    }
    let mut root = encode_open_tag(4, &[]);
    root.extend_from_slice(&ops);
    root.extend_from_slice(&encode_close_tag(4));
    let data = build_declared_fixture(
        &["items", "item", "x", "Deep", "div"],
        &[
            (0, 0, 0x04, 0x00, &[]),
            (1, 1, 0x01, 0x01, &[]),
            (2, 1, 0x01, 0x01, &[]),
            (3, 1, 0x01, 0x01, &[]),
            (4, 1, 0x01, 0x01, &[]),
            (5, 1, 0x01, 0x01, &[]),
        ],
        &island(0, &root, true),
        &[(0, 0x01, 0x01, 3, 0, &[])],
    );
    let module = IrModule::parse(&data).expect("parses");
    let mut slots = SlotData::new(6);
    slots.set(0, SlotValue::array(vec![SlotValue::Text("a".into())]));
    let manifest = manifest();
    let error = err(
        &config(&manifest, Some(&module), Some(&slots)),
        &RenderCtx::new(),
    );
    assert_eq!(error.code(), "RENDER-303");
    assert_eq!(error.route(), ROUTE);
    assert_eq!(error.component_path(), ["Deep"]);
}

#[test]
fn render_399_a_panic_inside_the_walk() {
    let manifest = manifest();
    let module = branding_module();
    let slots = branding(FAULT_TRIGGER, 2);
    let error = err(
        &config(&manifest, Some(&module), Some(&slots)),
        &RenderCtx::new(),
    );
    assert_eq!(error.code(), "RENDER-399");
    assert_eq!(error.route(), ROUTE);
    assert_eq!(error.component_path(), ["Branding"]);
    assert!(matches!(error, RenderError::Fault { .. }));
}

// -- What a successful render returns ----------------------------------------

#[tokio::test]
async fn try_render_writes_the_document_and_counts_the_walk() {
    let manifest = manifest();
    let module = branding_module();
    let slots = branding("Acme", 3);
    let page = try_render(
        &config(&manifest, Some(&module), Some(&slots)),
        &RenderCtx::new(),
    )
    .expect("renders");

    let counts = page.counts();
    assert_eq!(counts.nodes, 2 + 3 * 2);
    assert_eq!(counts.list_iterations, 3);
    let parts = page.into_parts_unchecked();
    let root_start =
        parts.html.find("data-forma-ssr>").expect("ssr root") + "data-forma-ssr>".len();
    let root_end = parts.html[root_start..].find("</div>\n").expect("root end") + root_start;
    // `bytes` is the walk's HTML: the root's contents, not the document.
    assert_eq!(counts.bytes, root_end - root_start);

    // And the response's headers bless that nonce, with no-store.
    let csp = parts
        .headers
        .iter()
        .find(|(n, _)| n.as_str() == "content-security-policy")
        .map(|(_, v)| v.to_str().expect("ascii").to_string())
        .expect("policy");
    assert!(csp.contains(&format!("'nonce-{}'", parts.nonce)));
    assert!(parts
        .headers
        .iter()
        .any(|(n, v)| n.as_str() == "cache-control" && v == "no-store"));

    // Each render draws its own nonce.
    let again = try_render(
        &config(&manifest, Some(&module), Some(&slots)),
        &RenderCtx::new(),
    )
    .expect("renders")
    .into_parts_unchecked();
    assert_ne!(again.nonce, parts.nonce);
}

#[test]
fn try_render_never_serves_a_shell_in_place_of_a_failure() {
    let manifest = manifest();
    let module = branding_module();
    let slots = branding(FAULT_TRIGGER, 1);
    let walk_error = encode_open_tag(0, &[]);
    let bad = IrModule::parse(&build_declared_fixture(&["bad tag"], &[], &walk_error, &[]))
        .expect("parses");
    let empty = SlotData::new(0);

    // Every failure class returns an error rather than a successful shell.
    assert!(try_render(
        &config(&manifest, Some(&bad), Some(&empty)),
        &RenderCtx::new()
    )
    .is_err());
    assert!(try_render(&config(&manifest, None, Some(&empty)), &RenderCtx::new()).is_err());
    assert!(try_render(
        &config(&manifest, Some(&module), Some(&slots)),
        &RenderCtx::new()
    )
    .is_err());
}

#[tokio::test]
async fn render_browser_shell_serves_the_bundle_around_an_empty_root_with_the_page_headers() {
    // A route the build declares `ssr: false`: no walk, by declaration, even
    // when a module is at hand.
    let manifest = manifest();
    let module = branding_module();
    let slots = branding("Acme", 3);
    let page = render_browser_shell(
        &config(&manifest, Some(&module), Some(&slots)),
        &RenderCtx::new().with_policy(PolicyExtensions::new().frame_src("blob:")),
    )
    .expect("a shell");
    assert_eq!(page.counts(), forma_server::RenderCounts::default());

    let response = page.into_response();
    let headers = response.headers().clone();
    let (status, html) = body(response).await;
    assert_eq!(status, StatusCode::OK);
    // The shell's root names the build the manifest names (FORMA-186, DR-29).
    assert!(html.contains(&format!(
        "<div id=\"app\" data-forma-build=\"{}\"></div>",
        manifest.build
    )));
    assert!(!html.contains("data-forma-ssr") && !html.contains("Acme"));
    let start = html
        .find("<script type=\"module\" nonce=\"")
        .expect("bundle")
        + "<script type=\"module\" nonce=\"".len();
    let nonce = &html[start..start + 44];
    assert!(html.contains("src=\"/_assets/app.a1b2c3d4.js\""));
    assert_eq!(headers["cache-control"], "no-store");
    let csp = headers["content-security-policy"].to_str().expect("ascii");
    assert!(csp.contains(&format!("'nonce-{nonce}'")), "{csp}");
    assert!(csp.contains("frame-src blob:"), "{csp}");

    // A shell is still a page: an invalid extension fails it too.
    let error = render_browser_shell(
        &config(&manifest, None, None),
        &RenderCtx::new().with_policy(PolicyExtensions::new().frame_src("*")),
    )
    .expect_err("invalid extension");
    assert_eq!(error.code(), "RENDER-201");
}
