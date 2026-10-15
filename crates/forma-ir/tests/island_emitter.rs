//! Actual TypeScript writer output paired with the native reader and walker.
use forma_ir::{walk_to_html_counted, IrModule, SlotData, WalkLimits};
use serde_json::{json, Value};

fn render(name: &str, props: Value) -> (String, Value) {
    let bytes: &[u8] = match name {
        "repeated" => include_bytes!("fixtures/island-emitter/repeated.ir"),
        "nullish" => include_bytes!("fixtures/island-emitter/nullish.ir"),
        "closed-nullish" => include_bytes!("fixtures/island-emitter/closed-nullish.ir"),
        "optional-root" => include_bytes!("fixtures/island-emitter/optional-root.ir"),
        "rows" => include_bytes!("fixtures/island-emitter/rows.ir"),
        "local-aggregates" => include_bytes!("fixtures/island-emitter/local-aggregates.ir"),
        "nested-closed-nullish" => {
            include_bytes!("fixtures/island-emitter/nested-closed-nullish.ir")
        }
        "local-inputs" => include_bytes!("fixtures/island-emitter/local-inputs.ir"),
        "aggregate-fallback" => include_bytes!("fixtures/island-emitter/aggregate-fallback.ir"),
        "aggregate" => include_bytes!("fixtures/island-emitter/aggregate.ir"),
        "browser" => include_bytes!("fixtures/island-emitter/browser.ir"),
        _ => panic!("unknown fixed writer fixture"),
    };
    let module = IrModule::parse(bytes).unwrap_or_else(|error| panic!("{name}: {error}"));
    let slots = SlotData::from_json(&props.to_string(), &module).unwrap();
    let output = walk_to_html_counted(&module, &slots, WalkLimits::default()).unwrap();
    let state = serde_json::from_str(output.island_state.as_json()).unwrap();
    (output.html, state)
}

#[test]
fn repeated_fields_keep_the_ordered_input_mapping() {
    let (html, state) = render("repeated", json!({"title":"shared"}));
    assert_eq!(html.matches("shared").count(), 3);
    assert_eq!(
        state["i"][0]["p"],
        json!({"left":"shared","right":"shared"})
    );
    assert_eq!(state["s"], json!([]));
    assert!(!html.contains("data-forma-props"));
}

#[test]
fn declared_coalesce_only_replaces_null_and_keeps_original_input_state() {
    let (empty, state) = render("nullish", json!({"label":"","count":0,"ready":false}));
    assert!(!empty.contains("fallback"));
    assert!(!empty.contains("data-ready"));
    assert!(empty.contains('0'));
    assert_eq!(
        state["i"][0]["p"],
        json!({"label":"","count":0,"ready":false})
    );
    let (missing, state) = render("nullish", json!({}));
    assert!(missing.contains("fallback"));
    assert!(missing.contains("42"));
    assert!(missing.contains("data-ready"));
    assert_eq!(state["i"][0]["p"], json!({}));
}

#[test]
fn closed_optional_inputs_fold_before_native_coalesce_type_validation() {
    let (html, state) = render("closed-nullish", json!({}));
    assert_eq!(html.matches("fallback").count(), 2);
    assert_eq!(html.matches("42").count(), 2);
    assert_eq!(html.matches("data-ready").count(), 2);
    assert_eq!(state["i"][0]["p"], json!({}));
    assert_eq!(state["i"][1]["p"], json!({}));
    assert_eq!(
        state["i"][2]["p"],
        json!({"label":"","count":0,"ready":false})
    );
}

#[test]
fn optional_root_access_keeps_the_handler_value_and_only_defaults_null() {
    let (html, state) = render("optional-root", json!({"count":1001}));
    assert!(html.contains("1001"));
    assert!(!html.contains("42"));
    assert_eq!(state["i"][0]["p"], json!({"count":1001}));
    for missing in [json!({}), json!({"count":null})] {
        let (html, state) = render("optional-root", missing);
        assert!(html.contains("42"));
        assert_eq!(state["i"][0]["p"], json!({}));
    }
}

#[test]
fn repeated_list_entries_snapshot_the_current_nested_row() {
    let (html, state) = render(
        "rows",
        json!({"rows":[
            {"id":1,"user":{"name":"first"}}, {"id":2,"user":{"name":"second"}}
        ]}),
    );
    assert_eq!(state["i"].as_array().unwrap().len(), 2);
    assert_eq!(state["i"][0]["p"], json!({"label":"first"}));
    assert_eq!(state["i"][1]["p"], json!({"label":"second"}));
    assert_eq!(state["i"][0]["h"], state["i"][1]["h"]);
    assert!(html.contains("data-forma-state=\"0\""));
    assert!(html.contains("data-forma-state=\"1\""));
}

#[test]
fn closed_aggregate_projection_preserves_array_positions_and_strips_extras() {
    let (_, state) = render("aggregate", json!({}));
    assert_eq!(
        state["i"][0]["p"],
        json!({"data":{"names":["first",null,"last"]}})
    );
}

#[test]
fn browser_only_contract_renders_only_its_empty_host_and_declared_state() {
    let (html, state) = render("browser", json!({"label":"browser input"}));
    assert!(!html.contains("browser input"));
    assert_eq!(state["i"][0]["p"], json!({"label":"browser input"}));
    assert!(html.contains("<div "));
}

#[test]
fn closed_local_aggregate_defaults_render_rows_without_handler_slots() {
    let (html, state) = render("local-aggregates", json!({}));
    assert!(html.contains("data-title=\"local\""));
    assert!(html.contains("data-id=\"1\""));
    assert!(html.contains("data-id=\"2\""));
    assert!(html.contains("first"));
    assert!(html.contains("second"));
    assert!(html.contains("capture"));
    assert!(html.contains("x"));
    assert!(html.contains("y"));
    assert!(html.contains("z"));
    assert!(!html.contains("never"));
    assert_eq!(state["i"][0]["p"], json!({}));
}

#[test]
fn closed_nested_optional_projection_folds_without_inventing_native_type() {
    let (html, state) = render("nested-closed-nullish", json!({}));
    assert!(html.contains("fallback"));
    assert!(html.contains("kept"));
    assert_eq!(state["i"][0]["p"], json!({"data":{}}));
    assert_eq!(state["i"][1]["p"], json!({"data":{"title":"kept"}}));
    assert_eq!(state["i"][2]["p"], json!({"data":{}}));
}

#[test]
fn closed_rows_project_each_registered_input_at_the_current_occurrence() {
    let (html, state) = render("local-inputs", json!({}));
    assert!(html.contains("one"));
    assert!(html.contains("two"));
    assert_eq!(state["i"][0]["p"], json!({"label":"one"}));
    assert_eq!(state["i"][1]["p"], json!({"label":"two"}));
}

#[test]
fn declared_aggregate_fallback_keeps_empty_arrays_and_scalar_row_hints() {
    let (html, _) = render("aggregate-fallback", json!({}));
    assert!(html.contains("fallback"));
    let (html, _) = render("aggregate-fallback", json!({"rows":[]}));
    assert!(!html.contains("fallback"));
    let (html, state) = render("aggregate-fallback", json!({"rows":["provided","kept"]}));
    assert!(html.contains("provided"));
    assert!(html.contains("kept"));
    assert!(!html.contains("fallback"));
    assert_eq!(state["i"][0]["p"]["rows"], json!(["provided", "kept"]));
}
