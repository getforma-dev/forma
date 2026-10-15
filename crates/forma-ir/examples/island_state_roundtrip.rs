//! Fixed native-to-browser state inputs. Emits actual walker HTML/state plus
//! separately projected expected values for the browser acceptance harness.
use forma_ir::{walk_to_html_counted, IrModule, SlotData, SlotValue, WalkLimits};
use serde_json::{json, Value};

fn main() {
    let bytes = include_bytes!("../tests/fixtures/island-emitter/roundtrip.ir");
    let module = IrModule::parse(bytes).expect("reviewed actual compiler output");
    let mut cases = Vec::new();
    for index in 0..100 {
        let label = match index {
            0 => "</script>".into(),
            1 => "\0".into(),
            2 => "😀 astral é".into(),
            3 => String::new(),
            4 => "quote\" backslash\\ newline\n".into(),
            _ => format!("fixed-{index}"),
        };
        let value = match index {
            0 => 9_007_199_254_740_991.0,
            1 => 9_007_199_254_740_992.0,
            2 => f64::MAX,
            3 => -f64::MAX,
            4 => f64::MIN_POSITIVE,
            5 => f64::from_bits(1),
            6 => -0.0,
            _ => (f64::from(index) - 50.0) / 10.0,
        };
        let date = match index {
            0 => -8_640_000_000_000_000_i64,
            1 => 8_640_000_000_000_000,
            _ => i64::from(index) - 50,
        };
        let maybe = if index % 2 == 0 {
            Value::String(label.clone())
        } else {
            Value::Null
        };
        let input = json!({
            "label": label, "value": value, "date": date,
            "mode": if index % 2 == 0 { "a" } else { "b" },
            "maybe": maybe, "list": [value, null, 0],
            "nested": { "active": index % 2 == 0, "secret": "UNDECLARED_NESTED_SENTINEL" },
            "secret": "UNDECLARED_HANDLER_SENTINEL"
        });
        // Preserve the actual Rust f64 bits. This is native handler data, not
        // the separate low-level JSON text importer (whose parser is not the
        // state encoder under test).
        let mut slots = SlotData::new_from_defaults(&module.slots);
        for (name, value) in input.as_object().unwrap() {
            if let Some(id) = module.slot_id_by_name(name) {
                slots.set(id, slot_value(value));
            }
        }
        let rendered =
            walk_to_html_counted(&module, &slots, WalkLimits::default()).expect("native snapshot");
        let state = rendered.island_state.as_json();
        assert!(
            !state.contains('<'),
            "encoded state escapes every literal less-than"
        );
        assert!(
            !state.contains("SENTINEL"),
            "declared disclosure projection"
        );
        let mut expected = input;
        expected.as_object_mut().unwrap().remove("secret");
        expected["nested"].as_object_mut().unwrap().remove("secret");
        if expected["maybe"].is_null() {
            expected.as_object_mut().unwrap().remove("maybe");
        }
        cases.push(
            json!({"index": index, "expected": expected, "state": state, "body": rendered.html}),
        );
    }
    println!("{}", Value::Array(cases));
}

// Only the fixed shallow values above enter this test utility. Projection and
// bounded state encoding are exercised in the production walker, not here.
fn slot_value(value: &Value) -> SlotValue {
    match value {
        Value::Null => SlotValue::Null,
        Value::Bool(value) => SlotValue::Bool(*value),
        Value::Number(value) => SlotValue::Number(value.as_f64().expect("finite fixed number")),
        Value::String(value) => SlotValue::Text(value.clone()),
        Value::Array(values) => SlotValue::array(values.iter().map(slot_value).collect()),
        Value::Object(values) => SlotValue::object(
            values
                .iter()
                .map(|(name, value)| (name.clone(), slot_value(value)))
                .collect(),
        ),
    }
}
