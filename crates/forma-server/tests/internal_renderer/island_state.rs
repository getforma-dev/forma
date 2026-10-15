//! The private document seam exercised with actual validated native modules.
use crate::{AssetManifest, PageConfig, PageResponse, RenderCtx, RenderError, WalkLimits};
use forma_ir::parser::test_helpers::{
    build_declared_fixture, build_minimal_ir, encode_close_tag, encode_open_tag,
};
use forma_ir::{IrModule, SlotData, SlotValue};
use std::collections::HashMap;

fn module() -> IrModule {
    let ops = [
        vec![11, 0, 0],
        encode_open_tag(0, &[]),
        encode_close_tag(0),
        vec![12, 0, 0],
    ]
    .concat();
    IrModule::parse(&build_declared_fixture(
        &["div", "Panel", "value"],
        &[(0, 2, 1, 0, &[])],
        &ops,
        &[(0, 1, 0, 1, 0, &[0])],
    ))
    .unwrap()
}
fn manifest() -> AssetManifest {
    AssetManifest {
        version: 2,
        writer: "3.0.0".into(),
        app: "ledger".into(),
        build: "state".into(),
        aliases: HashMap::new(),
        assets: HashMap::new(),
        routes: HashMap::new(),
    }
}
fn render(
    module: &IrModule,
    value: SlotValue,
    ctx: &RenderCtx,
) -> Result<PageResponse, RenderError> {
    let manifest = manifest();
    let config = PageConfig {
        title: ctx.title().unwrap_or("State"),
        route_pattern: "/state",
        manifest: &manifest,
        config_json: ctx.config_json(),
        body_class: ctx.body_class(),
        personality_css: ctx.personality_css(),
        body_prefix: ctx.body_prefix(),
    };
    let mut slots = SlotData::new_from_defaults(&module.slots);
    slots.set(0, value);
    crate::render::render_bound(
        &config,
        ctx,
        Some(module),
        Some(&slots),
        ctx.limits(WalkLimits::default()),
    )
}
fn budget(bytes: usize) -> RenderCtx {
    RenderCtx::new().with_limits(WalkLimits {
        max_output_bytes: bytes,
        ..WalkLimits::default()
    })
}
const OPEN: &str = "<script type=\"application/json\" data-island-state>";
fn state(html: &str) -> serde_json::Value {
    let begin = html.find(OPEN).unwrap() + OPEN.len();
    let end = html[begin..].find("</script>").unwrap() + begin;
    assert!(end < html.find("</head>").unwrap());
    serde_json::from_str(&html[begin..end]).unwrap()
}
#[test]
fn one_head_state_block_precedes_body_and_preserves_the_checked_values() {
    let page = render(
        &module(),
        SlotValue::Text("</script>é😀".into()),
        &RenderCtx::new(),
    )
    .unwrap()
    .into_parts_unchecked();
    assert_eq!(page.html.matches(OPEN).count(), 1);
    assert_eq!(state(&page.html)["i"][0]["p"]["value"], "</script>é😀");
    assert!(page.html.contains("\\u003c/script>é😀"));
    assert!(!page.html.contains("data-forma-props"));
    assert!(!page.html.contains("__forma_islands"));
    assert!(page.html.find("data-island-state").unwrap() < page.html.find("<body").unwrap());
    assert!(page.counts.bytes < page.html.len());
}
#[test]
fn empty_ssr_still_has_one_envelope_but_browser_shell_has_none() {
    let empty = IrModule::parse(&build_minimal_ir(&[], &[], &[], &[])).unwrap();
    let page = render(&empty, SlotValue::Null, &RenderCtx::new())
        .unwrap()
        .into_parts_unchecked();
    assert_eq!(page.html.matches(OPEN).count(), 1);
    assert_eq!(state(&page.html), serde_json::json!({"v":1,"s":[],"i":[]}));
    let manifest = manifest();
    let input = super::RenderFixture {
        title: "Shell",
        route_pattern: "/shell",
        manifest: &manifest,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
        render_mode: super::RenderPath::Phase1ClientMount,
        ir_module: None,
        slots: None,
    };
    let shell = super::render_shell(&input, &RenderCtx::new())
        .unwrap()
        .into_parts_unchecked();
    assert!(!shell.html.contains("data-island-state"));
    assert!(!shell.html.contains("data-forma-ssr"));
}
#[test]
fn state_failures_have_distinct_codes_route_component_and_field_path() {
    let invalid = render(&module(), SlotValue::Null, &RenderCtx::new()).unwrap_err();
    assert_eq!(invalid.code(), "RENDER-501");
    assert_eq!(invalid.route(), "/state");
    assert_eq!(invalid.component_path(), ["Panel"]);
    assert_eq!(invalid.property_path(), Some("$[\"value\"]"));
    assert!(matches!(
        invalid,
        RenderError::IslandState {
            cause: forma_ir::IrError::InvalidIslandState(_),
            ..
        }
    ));
    // The body fits this small limit, but projection refuses first at its own
    // fixed bound before complete-document accounting can return RENDER-301.
    let huge = render(
        &module(),
        SlotValue::Text("<".repeat(200_000)),
        &budget(100),
    )
    .unwrap_err();
    assert_eq!(huge.code(), "RENDER-502");
    assert_eq!(huge.route(), "/state");
    assert_eq!(huge.component_path(), ["Panel"]);
}
#[test]
fn complete_document_limit_is_exact_and_counts_the_escaped_state_and_tags() {
    let module = module();
    let value = || SlotValue::Text("<é😀".repeat(64));
    let first = render(&module, value(), &RenderCtx::new())
        .unwrap()
        .into_parts_unchecked();
    let exact = first.html.len();
    let page = render(&module, value(), &budget(exact))
        .unwrap()
        .into_parts_unchecked();
    assert_eq!(page.html.len(), exact);
    assert_eq!(page.counts.bytes, first.counts.bytes);
    let error = render(&module, value(), &budget(exact - 1)).unwrap_err();
    assert_eq!(error.code(), "RENDER-301");
    assert_eq!(error.route(), "/state");
    assert_eq!(error.counts().unwrap().bytes, first.counts.bytes);
    assert!(error.counts().unwrap().bytes < exact - 1);
    assert!(render(&module, value(), &budget(exact + 1)).is_ok());
}
#[test]
fn head_and_state_can_exceed_budget_without_body_growth_and_override_is_local() {
    let module = module();
    let value = || SlotValue::Text("payload".into());
    let small = render(&module, value(), &RenderCtx::new())
        .unwrap()
        .into_parts_unchecked();
    let ceiling = small.html.len() + 100;
    let ctx = budget(ceiling)
        .with_title("<&\"".repeat(500))
        .with_config_json(serde_json::json!({"description":"<".repeat(500)}));
    let error = render(&module, value(), &ctx).unwrap_err();
    assert_eq!(error.code(), "RENDER-301");
    assert_eq!(error.counts().unwrap().bytes, small.counts.bytes);
    let loose = ctx.clone().with_limits(WalkLimits::default());
    assert!(render(&module, value(), &loose).is_ok());
    assert_eq!(
        render(&module, value(), &ctx).unwrap_err().code(),
        "RENDER-301"
    );
    let state_only = render(
        &module,
        SlotValue::Text("<".repeat(1_000)),
        &budget(ceiling),
    )
    .unwrap_err();
    assert_eq!(state_only.code(), "RENDER-301");
    assert_eq!(state_only.counts().unwrap().bytes, small.counts.bytes);
}

#[test]
fn default_eight_mib_limit_includes_large_head_metadata_exactly() {
    let module = module();
    let small = render(&module, SlotValue::Text("value".into()), &RenderCtx::new())
        .unwrap()
        .into_parts_unchecked();
    let limit = forma_ir::DEFAULT_MAX_OUTPUT_BYTES;
    let padding = limit - small.html.len() + "State".len();
    let exact = RenderCtx::new().with_title("x".repeat(padding));
    let page = render(&module, SlotValue::Text("value".into()), &exact)
        .unwrap()
        .into_parts_unchecked();
    assert_eq!(page.html.len(), limit);
    let over = RenderCtx::new().with_title("x".repeat(padding + 1));
    let error = render(&module, SlotValue::Text("value".into()), &over).unwrap_err();
    assert_eq!(error.code(), "RENDER-301");
    assert_eq!(error.counts().unwrap().bytes, small.counts.bytes);
}
