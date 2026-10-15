//! Fixed public JSON-import controls, separate from native state serialization.
use forma_ir::{IrModule, SlotData, SlotValue};

#[test]
fn public_json_import_preserves_fixed_finite_decimal_values() {
    let module = IrModule::parse(include_bytes!("fixtures/island-emitter/roundtrip.ir")).unwrap();
    let slot = module.slot_id_by_name("value").unwrap();
    for expected in [
        9_007_199_254_740_991.0_f64,
        9_007_199_254_740_992.0,
        f64::MAX,
        -f64::MAX,
        f64::MIN_POSITIVE,
        f64::from_bits(1),
        -0.0,
        0.1,
    ] {
        let json = serde_json::json!({ "value": expected }).to_string();
        let data =
            SlotData::from_json(&json, &module).expect("finite serialized f64 remains accepted");
        let SlotValue::Number(actual) = data.get(slot) else {
            panic!("number required")
        };
        assert_eq!(
            actual.to_bits(),
            expected.to_bits(),
            "public JSON input: {json}"
        );
    }
}

#[test]
fn public_json_import_accepts_the_exact_integer_spelling() {
    let module = IrModule::parse(include_bytes!("fixtures/island-emitter/roundtrip.ir")).unwrap();
    let slot = module.slot_id_by_name("value").unwrap();
    let data = SlotData::from_json(r#"{"value":9007199254740991}"#, &module).unwrap();
    let SlotValue::Number(actual) = data.get(slot) else {
        panic!("number required")
    };
    assert_eq!(*actual, 9_007_199_254_740_991.0);
}
