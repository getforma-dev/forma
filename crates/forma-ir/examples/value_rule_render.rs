//! Bounded JSON batches for FORMA-182's differential value-rule campaign.
//! This is an internal test executable: real checked props and real FMIR writer,
//! with no alternate implementation of text normalization or number formatting.
#![allow(clippy::print_stdout, clippy::print_stderr)]
use forma_ir::format::*;
use forma_ir::parser::test_helpers::*;
use forma_ir::props::encode_props;
use forma_ir::{walk_to_html, IrModule, PageProps, SlotData, SlotValue};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Read, Write};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(PageProps)]
struct Signed {
    value: i64,
}
#[derive(PageProps)]
struct Unsigned {
    value: u64,
}
#[derive(PageProps)]
struct Date {
    value: SystemTime,
}

fn encode_dyn_text(slot_id: u16, marker_id: u16) -> Vec<u8> {
    let mut bytes = vec![Opcode::DynText as u8];
    bytes.extend(slot_id.to_le_bytes());
    bytes.extend(marker_id.to_le_bytes());
    bytes
}

fn encode_dyn_attr(attr_str_idx: u32, slot_id: u16) -> Vec<u8> {
    let mut bytes = vec![Opcode::DynAttr as u8];
    bytes.extend(attr_str_idx.to_le_bytes());
    bytes.extend(slot_id.to_le_bytes());
    bytes
}

fn schema(kind: u8) -> IrModule {
    let mut fields = vec![1, 0, 1, 0]; // one object, one field
    fields.extend(0u32.to_le_bytes()); // value
    fields.extend(1u32.to_le_bytes()); // source file
    fields.extend(1u32.to_le_bytes());
    fields.extend(1u32.to_le_bytes());
    fields.push(kind);
    IrModule::parse(&build_ir_sections(&[
        (SECTION_BYTECODE, 1, &[]),
        (
            SECTION_STRINGS,
            1,
            &build_string_table(&["value", "value-rule-render.ts"]),
        ),
        (SECTION_SLOTS, 1, &[0, 0]),
        (SECTION_ISLANDS, 1, &[0, 0]),
        (SECTION_PROPS_SCHEMA, 1, &fields),
    ]))
    .unwrap()
}

fn module(tag: &str, attr: &str, condition: bool) -> IrModule {
    let strings = [
        tag,
        attr,
        "value",
        "before",
        "text",
        "after",
        "condition",
        "yes",
        "no",
        "span",
    ];
    let mut ops = encode_open_tag(0, &[]);
    if condition {
        let branch = |slot| {
            let mut body = encode_open_tag(9, &[]);
            body.extend(encode_dyn_text(slot, slot));
            body.extend(encode_close_tag(9));
            body
        };
        ops.extend(encode_show_if(4, &branch(5), &branch(6)));
    } else {
        ops.extend(encode_dyn_attr(1, 0));
        for slot in 1..=3 {
            ops.extend(encode_dyn_text(slot, slot));
        }
    }
    ops.extend(encode_close_tag(0));
    let slots: Vec<_> = (0..7u16)
        .map(|id| (id, u32::from(id) + 2, 1, 0, &[][..]))
        .collect();
    IrModule::parse(&build_minimal_ir(&strings, &slots, &ops, &[])).unwrap()
}
fn field<'a>(case: &'a Value, name: &str) -> &'a str {
    case[name].as_str().expect("string field")
}
fn render(
    case: &Value,
    modules: &mut HashMap<String, IrModule>,
    integer: &IrModule,
    date: &IrModule,
) -> Value {
    let rule = case["rule"].as_u64().unwrap();
    let checked = match rule {
        3 => {
            let text = field(case, "value");
            if text.starts_with('-') {
                encode_props(
                    integer,
                    &Signed {
                        value: text.parse().unwrap(),
                    },
                    "/fuzz",
                )
            } else {
                encode_props(
                    integer,
                    &Unsigned {
                        value: text.parse().unwrap(),
                    },
                    "/fuzz",
                )
            }
        }
        4 => {
            let nanos: i128 = field(case, "value").parse().unwrap();
            let magnitude = nanos.unsigned_abs();
            let duration = Duration::new(
                u64::try_from(magnitude / 1_000_000_000).unwrap(),
                u32::try_from(magnitude % 1_000_000_000).unwrap(),
            );
            let instant = if nanos < 0 {
                UNIX_EPOCH.checked_sub(duration)
            } else {
                UNIX_EPOCH.checked_add(duration)
            }
            .expect("campaign instant representable on this platform");
            encode_props(date, &Date { value: instant }, "/fuzz")
        }
        _ => Ok(Value::Null),
    };
    let checked = match checked {
        Ok(value) => value,
        Err(error) => return json!({"refused": error.code, "path": error.path}),
    };
    let value = match rule {
        1 => SlotValue::Text(field(case, "value").into()),
        2 => SlotValue::Number(field(case, "value").parse().unwrap()),
        3 | 4 => SlotValue::Number(checked["value"].as_f64().unwrap()),
        5 => SlotValue::Null,
        6 | 7 => SlotValue::Bool(case["value"].as_bool().unwrap()),
        _ => panic!("unknown rule"),
    };
    let tag = field(case, "tag");
    let attr = field(case, "attr");
    let key = format!("{tag}/{attr}/{}", rule == 7);
    let module = modules
        .entry(key)
        .or_insert_with(|| module(tag, attr, rule == 7));
    let mut slots = SlotData::new(7);
    slots.set(0, value.clone());
    slots.set(1, SlotValue::Text(field(case, "before").into()));
    // Rule6's admitted text form is explicitly String(flag), while its
    // attribute is the boolean itself. Bare boolean text is a compiler refusal.
    slots.set(
        2,
        if rule == 6 {
            SlotValue::Text(case["value"].to_string())
        } else {
            value.clone()
        },
    );
    slots.set(3, SlotValue::Text(field(case, "after").into()));
    slots.set(4, value);
    slots.set(5, SlotValue::Text(field(case, "before").into()));
    slots.set(6, SlotValue::Text(field(case, "after").into()));
    match walk_to_html(module, &slots) {
        Ok(html) => json!({"html": html, "wire": checked.get("value")}),
        Err(error) => json!({"error": error.to_string()}),
    }
}
fn render_batch(
    input: &str,
    modules: &mut HashMap<String, IrModule>,
    integer: &IrModule,
    date: &IrModule,
) -> Vec<Value> {
    assert!(input.len() <= 16 * 1024 * 1024, "bounded input only");
    let cases: Vec<Value> = serde_json::from_str(input).unwrap();
    assert!(cases.len() <= 10_000, "bounded batches only");
    cases
        .iter()
        .map(|case| render(case, modules, integer, date))
        .collect()
}
fn main() {
    let (integer, date) = (schema(SCHEMA_NUMBER), schema(SCHEMA_DATE));
    let mut modules = HashMap::new();
    if std::env::args().any(|arg| arg == "--stream") {
        let stdin = std::io::stdin();
        let stdout = std::io::stdout();
        let mut output = stdout.lock();
        for line in stdin.lock().lines() {
            let values = render_batch(&line.unwrap(), &mut modules, &integer, &date);
            serde_json::to_writer(&mut output, &values).unwrap();
            writeln!(output).unwrap();
            output.flush().unwrap();
        }
    } else {
        // Keep the single-batch replay mode for saved regression inputs.
        let mut input = String::new();
        std::io::stdin().read_to_string(&mut input).unwrap();
        let values = render_batch(&input, &mut modules, &integer, &date);
        println!("{}", serde_json::to_string(&values).unwrap());
    }
}
