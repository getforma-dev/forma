//! Contracts compare derived Rust metadata against independently assembled FMIR bytes.
use forma_ir::{
    format::*,
    parser::test_helpers::{build_ir_sections, build_string_table},
    props::{compare_schema, encode_props},
    schema::PropType,
    IrModule, PageProps,
};
use serde_json::json;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn module(strings: &[&str], objects: &[Vec<(u32, PropType)>]) -> IrModule {
    fn ty(bytes: &mut Vec<u8>, kind: &PropType) {
        match kind {
            PropType::Boolean => bytes.push(SCHEMA_BOOLEAN),
            PropType::String => bytes.push(SCHEMA_STRING),
            PropType::Number => bytes.push(SCHEMA_NUMBER),
            PropType::Date => bytes.push(SCHEMA_DATE),
            PropType::Object(id) => {
                bytes.push(SCHEMA_OBJECT);
                bytes.extend(id.to_le_bytes());
            }
            PropType::Array(inner) => {
                bytes.push(SCHEMA_ARRAY);
                ty(bytes, inner);
            }
            PropType::Optional(inner) => {
                bytes.push(SCHEMA_OPTIONAL);
                ty(bytes, inner);
            }
            PropType::Enum(literals) => {
                bytes.push(SCHEMA_ENUM);
                bytes.extend((literals.len() as u16).to_le_bytes());
                for id in literals {
                    bytes.extend(id.to_le_bytes());
                }
            }
        }
    }
    let mut schema = (objects.len() as u16).to_le_bytes().to_vec();
    for fields in objects {
        schema.extend((fields.len() as u16).to_le_bytes());
        for (index, (name, kind)) in fields.iter().enumerate() {
            schema.extend(name.to_le_bytes());
            schema.extend(0u32.to_le_bytes());
            schema.extend((index as u32 + 11).to_le_bytes());
            schema.extend(5u32.to_le_bytes());
            ty(&mut schema, kind);
        }
    }
    let bytes = build_ir_sections(&[
        (SECTION_BYTECODE, 1, &[]),
        (SECTION_STRINGS, 1, &build_string_table(strings)),
        (SECTION_SLOTS, 1, &[0, 0]),
        (SECTION_ISLANDS, 1, &[0, 0]),
        (SECTION_PROPS_SCHEMA, 1, &schema),
    ]);
    IrModule::parse(&bytes).expect("valid independent declared schema")
}
fn one(kind: PropType) -> IrModule {
    module(&["pages/example.tsx", "value"], &[vec![(1, kind)]])
}
fn optional(kind: PropType) -> PropType {
    PropType::Optional(Box::new(kind))
}
fn array(kind: PropType) -> PropType {
    PropType::Array(Box::new(kind))
}

#[derive(PageProps)]
struct Nested {
    label: String,
    secret: u64,
}
#[derive(PageProps)]
enum Status {
    #[props(rename = "active")]
    Active,
    #[props(rename = "paused")]
    Paused,
}
#[derive(PageProps)]
struct Complex {
    // Different order from the TypeScript declaration is intentional.
    status: Status,
    optional_note: Option<String>,
    rows: Vec<Nested>,
    #[props(rename = "display-name")]
    display_name: String,
    nullable_rows: Vec<Option<u32>>,
    ignored: f64,
}
fn complex_module() -> IrModule {
    module(
        &[
            "pages/example.tsx",
            "display-name",
            "rows",
            "label",
            "optionalNote",
            "status",
            "active",
            "paused",
            "nullableRows",
        ],
        &[
            vec![
                (1, PropType::String),
                (2, array(PropType::Object(1))),
                (4, optional(PropType::String)),
                (5, PropType::Enum(vec![7, 6])),
                (8, array(optional(PropType::Number))),
            ],
            vec![(3, PropType::String)],
        ],
    )
}
#[test]
fn name_comparison_and_projection_do_not_leak_extra_rust_fields() {
    let m = complex_module();
    let warnings = compare_schema(&m, &Complex::rust_type().unwrap(), "/example").unwrap();
    assert_eq!(
        warnings.iter().map(|w| w.path.as_str()).collect::<Vec<_>>(),
        ["ignored", "rows[].secret"]
    );
    assert!(warnings.iter().all(|w| w.code == "BIND-201"));
    let value = Complex {
        status: Status::Active,
        optional_note: None,
        rows: vec![Nested {
            label: "one".into(),
            secret: u64::MAX,
        }],
        display_name: "Ada".into(),
        nullable_rows: vec![Some(1), None, Some(3)],
        ignored: f64::NAN,
    };
    assert_eq!(
        encode_props(&m, &value, "/example").unwrap(),
        json!({"status":"active","rows":[{"label":"one"}],"display-name":"Ada","nullableRows":[1,null,3]})
    );
    let value = Complex {
        status: Status::Paused,
        optional_note: Some("hello".into()),
        ..value
    };
    assert_eq!(
        encode_props(&m, &value, "/example").unwrap()["optionalNote"],
        "hello"
    );
}
#[derive(PageProps)]
struct Empty {}
#[derive(PageProps)]
struct Number {
    value: i64,
}
#[derive(PageProps)]
struct OptionalNumber {
    value: Option<i64>,
}
#[derive(PageProps)]
struct Text {
    value: String,
}
#[test]
fn missing_optional_field_fails_but_present_option_none_omits() {
    let m = one(optional(PropType::Number));
    let errors = compare_schema(&m, &Empty::rust_type().unwrap(), "/missing").unwrap_err();
    assert_eq!((errors[0].code(), errors[0].path()), ("BIND-101", "value"));
    assert!(errors[0].to_string().contains("pages/example.tsx:11:5"));
    assert_eq!(
        encode_props(&m, &OptionalNumber { value: None }, "/missing").unwrap(),
        json!({})
    );
    assert_eq!(
        encode_props(&m, &Number { value: 1 }, "/required").unwrap(),
        json!({"value":1})
    );
    let errors = compare_schema(
        &one(PropType::Number),
        &OptionalNumber::rust_type().unwrap(),
        "/wrong",
    )
    .unwrap_err();
    assert_eq!(errors[0].code(), "BIND-103");
}
#[test]
fn errors_retain_route_path_and_both_actual_declarations() {
    let error = compare_schema(
        &one(PropType::Number),
        &Text::rust_type().unwrap(),
        "/typed",
    )
    .unwrap_err()
    .remove(0);
    assert_eq!(
        (error.code(), error.route(), error.path()),
        ("BIND-102", "/typed", "value")
    );
    let rust = error.rust.unwrap();
    assert!(std::path::Path::new(&rust.file)
        .ends_with(std::path::Path::new("tests").join("page_props.rs")));
    let source = include_str!("page_props.rs");
    let field_line = source
        .lines()
        .position(|line| line == "struct Text {")
        .unwrap()
        + 2;
    assert_eq!(rust.line as usize, field_line);
    assert_eq!(
        rust.column as usize,
        source
            .lines()
            .nth(rust.line as usize - 1)
            .unwrap()
            .find("value:")
            .unwrap()
            + 1
    );
}
#[derive(PageProps)]
struct EnumValue {
    value: Status,
}
#[test]
fn enum_literal_sets_must_be_exact_but_order_is_irrelevant() {
    let m = module(
        &["pages/example.tsx", "value", "active", "paused"],
        &[vec![(1, PropType::Enum(vec![3, 2]))]],
    );
    assert!(compare_schema(&m, &EnumValue::rust_type().unwrap(), "/enum").is_ok());
    let m = module(
        &["pages/example.tsx", "value", "active"],
        &[vec![(1, PropType::Enum(vec![2]))]],
    );
    assert_eq!(
        compare_schema(&m, &EnumValue::rust_type().unwrap(), "/enum").unwrap_err()[0].code(),
        "BIND-104"
    );
}
#[derive(PageProps)]
struct Unsigned {
    value: u64,
}
#[derive(PageProps)]
struct Float {
    value: f64,
}
#[test]
fn integer_checks_happen_before_rounding_and_floats_must_be_finite() {
    let m = one(PropType::Number);
    for value in [-9_007_199_254_740_991, 9_007_199_254_740_991] {
        assert_eq!(
            encode_props(&m, &Number { value }, "/number").unwrap()["value"],
            json!(value)
        );
    }
    for value in [
        i64::MIN,
        -9_007_199_254_740_992,
        9_007_199_254_740_992,
        i64::MAX,
    ] {
        assert_eq!(
            encode_props(&m, &Number { value }, "/number")
                .unwrap_err()
                .code(),
            "RENDER-401"
        );
    }
    for value in [9_007_199_254_740_992, u64::MAX] {
        assert_eq!(
            encode_props(&m, &Unsigned { value }, "/number")
                .unwrap_err()
                .code(),
            "RENDER-401"
        );
    }
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            encode_props(&m, &Float { value }, "/number")
                .unwrap_err()
                .code(),
            "RENDER-402"
        );
    }
    assert_eq!(
        encode_props(&m, &Float { value: 1.25 }, "/number").unwrap(),
        json!({"value":1.25})
    );
}
#[derive(PageProps)]
struct Date {
    value: SystemTime,
}
#[test]
fn dates_are_signed_epoch_milliseconds_truncated_toward_zero() {
    let m = one(PropType::Date);
    for (value, expected) in [
        (UNIX_EPOCH, 0),
        (UNIX_EPOCH + Duration::from_nanos(1_999_999), 1),
        (UNIX_EPOCH - Duration::from_nanos(1_999_999), -1),
        (UNIX_EPOCH - Duration::from_nanos(999_999), 0),
    ] {
        assert_eq!(
            encode_props(&m, &Date { value }, "/date").unwrap(),
            json!({"value":expected})
        );
    }
    assert!(encode_props(
        &m,
        &Date {
            value: SystemTime::now()
        },
        "/date"
    )
    .is_ok());
    for negative in [false, true] {
        let boundary = Duration::from_millis(8_640_000_000_000_000);
        let accepted = if negative {
            UNIX_EPOCH.checked_sub(boundary)
        } else {
            UNIX_EPOCH.checked_add(boundary)
        };
        if let Some(value) = accepted {
            assert!(encode_props(&m, &Date { value }, "/date").is_ok());
        }
        let outside = boundary + Duration::from_millis(1);
        let rejected = if negative {
            UNIX_EPOCH.checked_sub(outside)
        } else {
            UNIX_EPOCH.checked_add(outside)
        };
        if let Some(value) = rejected {
            assert_eq!(
                encode_props(&m, &Date { value }, "/date")
                    .unwrap_err()
                    .code(),
                "RENDER-403"
            );
        }
    }
}
#[derive(PageProps)]
struct Recursive {
    children: Vec<Recursive>,
}
#[test]
fn recursive_rust_shapes_are_refused_and_empty_objects_are_valid() {
    assert_eq!(Recursive::rust_type().unwrap_err().code(), "BIND-105");
    assert_eq!(
        encode_props(&module(&["page.tsx"], &[vec![]]), &Empty {}, "/").unwrap(),
        json!({})
    );
}
#[derive(PageProps)]
struct Rows {
    value: Vec<Number>,
}
#[test]
fn nested_value_error_has_indexed_path_and_declaration_sources() {
    let m = module(
        &["page.tsx", "value"],
        &[
            vec![(1, array(PropType::Object(1)))],
            vec![(1, PropType::Number)],
        ],
    );
    let error = encode_props(
        &m,
        &Rows {
            value: vec![Number { value: 0 }, Number { value: i64::MAX }],
        },
        "/rows",
    )
    .unwrap_err();
    assert_eq!(
        (error.code(), error.route(), error.path()),
        ("RENDER-401", "/rows", "value[1].value")
    );
    assert_eq!(error.typescript.unwrap().file, "page.tsx");
    assert!(error.rust.unwrap().file.ends_with("page_props.rs"));
}

#[test]
fn bound_props_derives_once_and_keeps_its_verified_module() {
    use forma_ir::props::{BoundProps, EncodeContext, PropValue, PropsError, SchemaBuilder};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    static DESCRIBED: AtomicUsize = AtomicUsize::new(0);
    struct Counted(Number);
    impl PropValue for Counted {
        fn describe(builder: &mut SchemaBuilder) -> Result<PropType, PropsError> {
            DESCRIBED.fetch_add(1, Ordering::SeqCst);
            Number::describe(builder)
        }
        fn encode_value(
            &self,
            ctx: &EncodeContext<'_>,
            kind: &PropType,
            path: &str,
        ) -> Result<Option<serde_json::Value>, PropsError> {
            self.0.encode_value(ctx, kind, path)
        }
    }
    impl PageProps for Counted {}
    let m = Arc::new(one(PropType::Number));
    let bound = BoundProps::<Counted>::bind(m.clone(), "/bound").unwrap();
    assert_eq!(DESCRIBED.load(Ordering::SeqCst), 1);
    assert!(Arc::ptr_eq(bound.module_arc(), &m));
    assert!(bound.warnings().is_empty());
    for value in 0..3 {
        assert_eq!(
            bound.encode(&Counted(Number { value })).unwrap(),
            json!({"value":value})
        );
    }
    assert_eq!(
        DESCRIBED.load(Ordering::SeqCst),
        1,
        "per-request encoding must not re-derive metadata"
    );
    assert_eq!(
        bound
            .encode(&Counted(Number { value: i64::MAX }))
            .unwrap_err()
            .code(),
        "RENDER-401"
    );
    assert!(BoundProps::<Counted>::bind(Arc::new(one(PropType::String)), "/bound").is_err());
    assert_eq!(
        bound.encode(&Counted(Number { value: 1 })).unwrap(),
        json!({"value":1})
    );
}

#[test]
fn raw_identifiers_and_leading_underscores_have_stable_camel_case_names() {
    #[derive(PageProps)]
    struct Names {
        r#type: String,
        _first_name: String,
    }
    let m = module(
        &["page.tsx", "type", "firstName"],
        &[vec![(1, PropType::String), (2, PropType::String)]],
    );
    assert_eq!(
        encode_props(
            &m,
            &Names {
                r#type: "example".into(),
                _first_name: "Ada".into()
            },
            "/names"
        )
        .unwrap(),
        json!({"type":"example","firstName":"Ada"})
    );
}

// -- FORMA-182 rules 3 and 4: the shared value-rule vectors ------------------
//
// `tests/fixtures/parity/integers.json` and `dates.json` are read here and by
// @getforma/core's suite (packages/core/src/dom/__tests__/value-rules.test.ts),
// so the admission boundary has one source of truth on both sides.
mod value_rule_vectors {
    use super::*;
    use serde_json::Value;

    const INTEGERS: &str = include_str!("fixtures/parity/integers.json");
    const DATES: &str = include_str!("fixtures/parity/dates.json");

    fn cases(file: &str, section: &str) -> Vec<Value> {
        let all: Value = serde_json::from_str(file).unwrap();
        all[section].as_array().unwrap().clone()
    }

    fn finish(failures: Vec<String>) {
        assert!(
            failures.is_empty(),
            "{} disagreeing vector(s):\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    #[test]
    fn integer_vectors_are_admitted_or_refused_in_the_integer_domain() {
        let m = one(PropType::Number);
        let mut failures = Vec::new();
        for case in cases(INTEGERS, "exact") {
            let id = case["id"].as_str().unwrap();
            let lexeme = case["lexeme"].as_str().unwrap();
            let admitted = case["admitted"].as_bool().unwrap();
            let result = match case["kind"].as_str().unwrap() {
                "i64" => encode_props(
                    &m,
                    &Number {
                        value: lexeme.parse().unwrap(),
                    },
                    "/n",
                ),
                "u64" => encode_props(
                    &m,
                    &Unsigned {
                        value: lexeme.parse().unwrap(),
                    },
                    "/n",
                ),
                other => panic!("unknown integer origin {other}"),
            };
            match (result, admitted) {
                (Ok(value), true) => {
                    // Exact: the envelope carries the digits, not a rounded f64.
                    let written = value["value"].to_string();
                    if written != lexeme {
                        failures.push(format!(
                            "integers/exact/{id}: encoded as {written}, expected {lexeme}"
                        ));
                    }
                }
                (Ok(value), false) => failures.push(format!(
                    "integers/exact/{id}: admitted as {value}, expected RENDER-401"
                )),
                (Err(error), true) => failures.push(format!(
                    "integers/exact/{id}: refused with {}, expected admission",
                    error.code()
                )),
                (Err(error), false) if error.code() != "RENDER-401" => failures.push(format!(
                    "integers/exact/{id}: refused with {}, expected RENDER-401",
                    error.code()
                )),
                (Err(_), false) => {}
            }
        }
        for case in cases(INTEGERS, "floatOrigin") {
            let id = case["id"].as_str().unwrap();
            let lexeme = case["lexeme"].as_str().unwrap();
            let value: f64 = lexeme.parse().unwrap();
            match encode_props(&m, &Float { value }, "/n") {
                Ok(encoded) => {
                    // A float origin is admitted whatever its magnitude; the
                    // envelope's number parses back to the same binary64.
                    let back = encoded["value"].as_f64().unwrap();
                    if back != value {
                        failures.push(format!(
                            "integers/floatOrigin/{id}: envelope {} does not round-trip {lexeme}",
                            encoded["value"]
                        ));
                    }
                }
                Err(error) => failures.push(format!(
                    "integers/floatOrigin/{id}: refused with {}, expected admission",
                    error.code()
                )),
            }
        }
        finish(failures);
    }
}
