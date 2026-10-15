//! Actual TypeScript writer output paired with the native reader and walker.
use forma_ir::{walk_to_html_counted, IrError, IrModule, SlotData, WalkLimits};
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
        // FORMA-181: the four list fixtures as they were before section 6 (unkeyed/README.md).
        "unkeyed/rows" => include_bytes!("fixtures/island-emitter/unkeyed/rows.ir"),
        "unkeyed/local-inputs" => include_bytes!("fixtures/island-emitter/unkeyed/local-inputs.ir"),
        "unkeyed/local-aggregates" => {
            include_bytes!("fixtures/island-emitter/unkeyed/local-aggregates.ir")
        }
        "unkeyed/aggregate-fallback" => {
            include_bytes!("fixtures/island-emitter/unkeyed/aggregate-fallback.ir")
        }
        _ => panic!("unknown fixed writer fixture"),
    };
    let module = parse(name, bytes);
    let slots = SlotData::from_json(&props.to_string(), &module).unwrap();
    let output = walk_to_html_counted(&module, &slots, WalkLimits::default()).unwrap();
    let state = serde_json::from_str(output.island_state.as_json()).unwrap();
    (output.html, state)
}

fn parse(name: &str, bytes: &[u8]) -> IrModule {
    IrModule::parse(bytes).unwrap_or_else(|error| panic!("{name}: {error}"))
}

/// The key paths a keyed fixture declares, as (LIST offset, resolved segment names).
fn key_paths(name: &str) -> Vec<(u32, Vec<String>)> {
    let bytes: &[u8] = match name {
        "rows" => include_bytes!("fixtures/island-emitter/rows.ir"),
        "local-inputs" => include_bytes!("fixtures/island-emitter/local-inputs.ir"),
        "local-aggregates" => include_bytes!("fixtures/island-emitter/local-aggregates.ir"),
        "aggregate-fallback" => include_bytes!("fixtures/island-emitter/aggregate-fallback.ir"),
        _ => panic!("not a keyed fixture"),
    };
    let module = parse(name, bytes);
    module
        .key_paths
        .iter()
        .map(|path| {
            let segments = path
                .segments
                .iter()
                .map(|index| module.strings.get(*index).unwrap().to_string())
                .collect();
            (path.list_offset, segments)
        })
        .collect()
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
    // FORMA-181: the compiler no longer produces a list keyed by a scalar row, so the
    // scalar-row hint evidence lives on the archived unkeyed binary (unkeyed/README.md).
    let (html, _) = render("unkeyed/aggregate-fallback", json!({}));
    assert!(html.contains("fallback"));
    let (html, _) = render("unkeyed/aggregate-fallback", json!({"rows":[]}));
    assert!(!html.contains("fallback"));
    let (html, state) = render(
        "unkeyed/aggregate-fallback",
        json!({"rows":["provided","kept"]}),
    );
    assert!(html.contains("provided"));
    assert!(html.contains("kept"));
    assert!(!html.contains("fallback"));
    assert_eq!(state["i"][0]["p"]["rows"], json!(["provided", "kept"]));
}

#[test]
fn declared_aggregate_fallback_keeps_empty_arrays_and_keyed_object_rows() {
    let (html, _) = render("aggregate-fallback", json!({}));
    assert!(html.contains("fallback"));
    let (html, _) = render("aggregate-fallback", json!({"rows":[]}));
    assert!(!html.contains("fallback"));
    let rows = json!([{"id":"provided"},{"id":"kept"}]);
    let (html, state) = render("aggregate-fallback", json!({"rows":rows}));
    assert!(html.contains("provided"));
    assert!(html.contains("kept"));
    assert!(!html.contains("fallback"));
    assert_eq!(state["i"][0]["p"]["rows"], rows);
    assert_eq!(
        key_paths("aggregate-fallback"),
        vec![(key_paths("aggregate-fallback")[0].0, vec!["id".to_string()])]
    );
}

/// The `data-forma-key` attributes of a rendering, in document order, and the rendering
/// with them removed.
fn keys_in(html: &str) -> (Vec<String>, String) {
    let marker = " data-forma-key=\"";
    let mut keys = Vec::new();
    let mut stripped = String::new();
    let mut rest = html;
    while let Some(at) = rest.find(marker) {
        stripped.push_str(&rest[..at]);
        let after = &rest[at + marker.len()..];
        let end = after.find('"').expect("a closed attribute");
        keys.push(after[..end].to_string());
        rest = &after[end + 1..];
    }
    stripped.push_str(rest);
    (keys, stripped)
}

/// The refusal a render of `name` with `props` ends in.
fn refusal(name: &str, props: Value) -> String {
    let bytes: &[u8] = match name {
        "rows" => include_bytes!("fixtures/island-emitter/rows.ir"),
        "aggregate-fallback" => include_bytes!("fixtures/island-emitter/aggregate-fallback.ir"),
        _ => panic!("not a keyed declared-props fixture"),
    };
    let module = parse(name, bytes);
    let slots = SlotData::from_json(&props.to_string(), &module).unwrap();
    let failure = walk_to_html_counted(&module, &slots, WalkLimits::default())
        .err()
        .unwrap_or_else(|| panic!("{name}: the render was expected to refuse"));
    assert!(
        matches!(failure.error, IrError::InvalidListKey(_)),
        "{name}: {:?}",
        failure.error
    );
    failure.error.to_string()
}

/// FORMA-181 checkpoint B: the walker reads section 6 and writes each keyed row's canonical
/// key on its root. The pre-181 binaries stay valid low-level unkeyed input and render the
/// same state and the same HTML minus the key attributes; the four keyed fixtures declare
/// their paths and carry exactly the keys their rows' data holds.
#[test]
fn keyed_fixtures_render_their_unkeyed_originals_plus_exactly_the_row_keys() {
    // `rows` and `local-inputs` kept their source: same digest and state, plus section 6 and
    // one key per row. `rows` keys are numbers (decimal text); `local-inputs` rows are closed
    // literals keyed 1 and 2.
    let cases: [(&str, Value, &[&str]); 2] = [
        (
            "rows",
            json!({"rows":[{"id":1,"user":{"name":"first"}},{"id":2,"user":{"name":"second"}}]}),
            &["1", "2"],
        ),
        ("local-inputs", json!({}), &["1", "2"]),
    ];
    for (name, props, expected) in cases {
        let (keyed_html, keyed_state) = render(name, props.clone());
        let (unkeyed_html, unkeyed_state) = render(&format!("unkeyed/{name}"), props);
        let (keys, stripped) = keys_in(&keyed_html);
        assert_eq!(keys, expected, "{name}");
        assert_eq!(stripped, unkeyed_html, "{name}");
        assert_eq!(keyed_state, unkeyed_state, "{name}");
        assert!(!unkeyed_html.contains("data-forma-key"), "{name}");
        let paths = key_paths(name);
        assert_eq!(paths.len(), 1, "{name}");
        assert_eq!(paths[0].1, vec!["id".to_string()], "{name}");
    }
    // The row key sits on the row's root, which for `rows` is the registered child's own
    // island host: one element carries both the island attribute set and the identity.
    let (html, _) = render(
        "rows",
        json!({"rows":[{"id":1,"user":{"name":"first"}},{"id":2,"user":{"name":"second"}}]}),
    );
    assert!(
        html.contains("data-forma-h=\"b234ea7503d2b4c8\" data-forma-key=\"1\"><!--f:t0-->first")
    );
    assert!(html.contains(
        "data-forma-state=\"1\" data-forma-h=\"b234ea7503d2b4c8\" data-forma-key=\"2\">"
    ));

    // `local-aggregates` and `aggregate-fallback` migrated scalar keys to `{id}` rows, so their
    // digests differ from the archived binaries by design. Every list in both (four and one)
    // is keyed by `id`, at ascending offsets; the keys are the rows' own ids, the nested
    // `tags` lists under two different outer rows reuse nothing, and the empty list renders no
    // key.
    for (name, lists, expected) in [
        ("local-aggregates", 4, vec!["1", "x", "y", "2", "z", "3"]),
        ("aggregate-fallback", 1, vec!["fallback"]),
    ] {
        let paths = key_paths(name);
        assert_eq!(paths.len(), lists, "{name}");
        assert!(paths.windows(2).all(|pair| pair[0].0 < pair[1].0), "{name}");
        assert!(
            paths.iter().all(|(_, path)| path == &["id".to_string()]),
            "{name}"
        );
        let (html, _) = render(name, json!({}));
        let (keys, _) = keys_in(&html);
        assert_eq!(keys, expected, "{name}");
        // Their sources changed at checkpoint A (scalar rows became `{id}` rows), so the
        // unkeyed controls differ in digest, slot numbering and row shape and are compared
        // only for the absence of any key; their own content assertions run above.
        let (unkeyed, _) = render(&format!("unkeyed/{name}"), json!({}));
        assert!(!unkeyed.contains("data-forma-key"), "{name}");
    }
    // A string key is written escaped and normalized (value rule 1): the handler's data is the
    // identity, the attribute is what the browser decodes back to it.
    let rows = json!([{"id":"a&b<\"c\">"},{"id":"line\r\nbreak"},{"id":"nul\u{0000}here"}]);
    let (html, state) = render("aggregate-fallback", json!({"rows":rows}));
    let (keys, _) = keys_in(&html);
    assert_eq!(
        keys,
        [
            "a&amp;b&lt;&quot;c&quot;&gt;",
            "line\nbreak",
            "nul\u{FFFD}here"
        ]
    );
    assert_eq!(state["i"][0]["p"]["rows"], rows, "keys as data stay exact");
}

/// FORMA-181 checkpoint B: a keyed row without a usable identity, or a key two rows share,
/// refuses the whole render with RENDER-503, naming the LIST, the row ordinals and the path.
#[test]
fn keyed_fixtures_refuse_duplicate_missing_and_non_identity_keys_as_render_503() {
    let offset = key_paths("aggregate-fallback")[0].0;
    // The diagnostic names the LIST, both row ordinals and the path, never the key: it is the
    // row's data (here a stand-in for a private value).
    let duplicate = refusal(
        "aggregate-fallback",
        json!({"rows":[{"id":"secret-7"},{"id":"b"},{"id":"secret-7"}]}),
    );
    assert_eq!(
        duplicate,
        format!("RENDER-503: LIST at bytecode offset {offset}, row 2, key path `id`: the row repeats the key row 0 already rendered")
    );
    assert!(!duplicate.contains("secret"), "{duplicate}");
    // CRLF and LF are one identity (a number and its decimal string are pinned in the walker's
    // own tests: the declared schema types this fixture's `id` as a string).
    for rows in [
        json!([{"id":"a\r\nb"},{"id":"a\nb"}]),
        json!([{"id":"a\rb"},{"id":"a\nb"}]),
    ] {
        assert!(refusal("aggregate-fallback", json!({"rows":rows}))
            .contains("row 1, key path `id`: the row repeats the key row 0 already rendered"));
    }
    // `-0` and `0` collide; `"1"` and `"01"` do not.
    assert!(refusal(
        "rows",
        json!({"rows":[{"id":0,"user":{"name":"a"}},{"id":-0.0,"user":{"name":"b"}}]})
    )
    .contains("row 1, key path `id`: the row repeats the key row 0 already rendered"));
    let (html, _) = render(
        "aggregate-fallback",
        json!({"rows":[{"id":"01"},{"id":"1"}]}),
    );
    assert_eq!(keys_in(&html).0, ["01", "1"]);

    let rows_offset = key_paths("rows")[0].0;
    let missing = refusal(
        "rows",
        json!({"rows":[{"id":1,"user":{"name":"a"}},{"user":{"name":"b"}}]}),
    );
    assert_eq!(
        missing,
        format!("RENDER-503: LIST at bytecode offset {rows_offset}, row 1, key path `id`: the row has no field `id`")
    );
    for (rows, reason) in [
        (
            json!([{"id":null,"user":{"name":"a"}}]),
            "the key is null, not a string or a safe integer",
        ),
        (
            json!([{"id":true,"user":{"name":"a"}}]),
            "the key is a boolean, not a string or a safe integer",
        ),
        (
            json!([{"id":{"n":1},"user":{"name":"a"}}]),
            "the key is an object, not a string or a safe integer",
        ),
        (
            json!([{"id":[1],"user":{"name":"a"}}]),
            "the key is an array, not a string or a safe integer",
        ),
        (
            json!([{"id":1.5,"user":{"name":"a"}}]),
            "the key number is not an integer within the safe range",
        ),
        (
            json!([{"id":9007199254740992.0,"user":{"name":"a"}}]),
            "the key number is not an integer within the safe range",
        ),
    ] {
        let text = refusal("rows", json!({"rows":rows}));
        assert!(text.contains(reason), "{text}");
        assert!(
            text.starts_with(&format!(
                "RENDER-503: LIST at bytecode offset {rows_offset}, row 0, key path `id`: "
            )),
            "{text}"
        );
    }
    // The refusal is before any output: a page with a bad row leaves no HTML and no state.
    let module = parse("rows", include_bytes!("fixtures/island-emitter/rows.ir"));
    let slots = SlotData::from_json(
        &json!({"rows":[{"user":{"name":"a"}}]}).to_string(),
        &module,
    )
    .unwrap();
    let failure = walk_to_html_counted(&module, &slots, WalkLimits::default())
        .err()
        .unwrap();
    assert_eq!(failure.counts.list_iterations, 1);
    assert_eq!(failure.component_path, Vec::<String>::new());
}
