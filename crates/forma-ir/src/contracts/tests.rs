use super::*;
use crate::format::{Opcode, SlotType};
use crate::parser::test_helpers::{
    build_ir_sections, build_slot_table, build_string_table, encode_show_if,
};
use crate::slot::SlotData;

fn constant(value: &[u8], id: u16) -> Vec<u8> {
    let mut out = vec![0, 0, 1, 0];
    out.extend(id.to_le_bytes());
    out.extend((value.len() as u32).to_le_bytes());
    out.extend(value);
    out
}
fn primitive_module(
    kind: u8,
    fallback: &[u8],
    target_hint: u8,
    ops: &[u8],
    extras: &[(u16, u32, u8, u8, &[u8])],
) -> Vec<u8> {
    let strings = build_string_table(&["hits", "Fixture.ts", "fallback", "result", "conditional"]);
    let mut slots = vec![
        (0, 0, kind, 0, &[][..]),
        (1, 2, kind, 1, &[][..]),
        (2, 3, target_hint, 1, &[][..]),
    ];
    slots.extend(extras);
    let slots = build_slot_table(&slots);
    let mut schema = vec![1, 0, 1, 0];
    schema.extend(0u32.to_le_bytes());
    schema.extend(1u32.to_le_bytes());
    schema.extend(1u32.to_le_bytes());
    schema.extend(1u32.to_le_bytes());
    schema.extend([
        7,
        match kind {
            1 => 2,
            2 => 1,
            3 => 3,
            _ => panic!("unsupported fixture"),
        },
    ]);
    build_ir_sections(&[
        (1, 1, ops),
        (2, 1, &strings),
        (3, 1, &slots),
        (4, 1, &[0, 0]),
        (5, 1, &schema),
        (10, 1, &constant(fallback, 1)),
    ])
}
fn encode_dyn_text(slot: u16, marker: u16) -> Vec<u8> {
    let mut out = vec![5];
    out.extend(slot.to_le_bytes());
    out.extend(marker.to_le_bytes());
    out
}
fn coal(a: u16, b: u16, c: u16) -> Vec<u8> {
    let mut out = vec![19];
    out.extend(a.to_le_bytes());
    out.extend(b.to_le_bytes());
    out.extend(c.to_le_bytes());
    out
}
#[test]
fn real_reader_and_walker_coalesce_null_but_keep_zero_false_and_empty_string() {
    for (kind, fallback, present, expected) in [
        (
            3,
            {
                let mut b = vec![3];
                b.extend(42f64.to_le_bytes());
                b
            },
            SlotValue::Number(0.0),
            "0",
        ),
        (2, vec![2], SlotValue::Bool(false), "false"),
        (
            1,
            vec![4, 8, 0, b'f', b'a', b'l', b'l', b'b', b'a', b'c', b'k'],
            SlotValue::Text(String::new()),
            "",
        ),
    ] {
        let ops = [coal(0, 1, 2), encode_dyn_text(2, 0)].concat();
        let module = IrModule::parse(&primitive_module(kind, &fallback, kind, &ops, &[])).unwrap();
        let mut slots = SlotData::new_from_defaults(&module.slots);
        slots.set(0, present);
        let rendered = crate::walk_to_html(&module, &slots).unwrap();
        assert_eq!(
            rendered,
            format!(
                "<!--f:t0-->{}<!--/f:t0-->",
                if expected.is_empty() {
                    "\u{200b}"
                } else {
                    expected
                }
            )
        );
        slots.set(0, SlotValue::Null);
        let rendered = crate::walk_to_html(&module, &slots).unwrap();
        assert!(rendered.contains(match kind {
            3 => "42",
            2 => "true",
            _ => "fallback",
        }));
    }
    let ops = [coal(0, 1, 2), encode_dyn_text(2, 0)].concat();
    let module = IrModule::parse(&primitive_module(1, &[4, 0, 0], 1, &ops, &[])).unwrap();
    assert_eq!(
        crate::walk_to_html(&module, &SlotData::new_from_defaults(&module.slots)).unwrap(),
        "<!--f:t0-->\u{200b}<!--/f:t0-->"
    );
}
#[test]
fn coalesce_refuses_wrong_fallback_hint_ownership_and_multiple_definition() {
    let mut number = vec![3];
    number.extend(42f64.to_le_bytes());
    for (fallback, hint, ops) in [
        (vec![2], 3, coal(0, 1, 2)),
        (number.clone(), SlotType::Text as u8, coal(0, 1, 2)),
        (vec![0], 3, coal(0, 1, 2)),
        (number.clone(), 3, coal(0, 1, 0)),
        (number.clone(), 3, [coal(0, 1, 2), coal(0, 1, 2)].concat()),
        (number, 3, coal(0, 1, 1)),
    ] {
        assert_eq!(
            IrModule::parse(&primitive_module(3, &fallback, hint, &ops, &[]))
                .unwrap_err()
                .code(),
            "LOAD-103"
        );
    }
}
#[test]
fn branch_temporary_does_not_dominate_a_join_or_sibling() {
    let mut number = vec![3];
    number.extend(42f64.to_le_bytes());
    let write = coal(0, 1, 2);
    let read = encode_dyn_text(2, 0);
    for ops in [
        [encode_show_if(0, &write, &[]), read.clone()].concat(),
        encode_show_if(0, &write, &read),
    ] {
        let error = IrModule::parse(&primitive_module(3, &number, 3, &ops, &[])).unwrap_err();
        assert!(error.to_string().contains("dominate"), "{error}");
    }
}
#[test]
fn nonisland_old_module_survives_but_new_opcode_requires_contract_section() {
    let old = crate::parser::test_helpers::build_minimal_ir(&[], &[], &[], &[]);
    assert!(IrModule::parse(&old).is_ok());
    let old = crate::parser::test_helpers::build_minimal_ir(
        &["a", "b", "c"],
        &[(0, 0, 3, 1, &[]), (1, 1, 3, 1, &[]), (2, 2, 3, 1, &[])],
        &coal(0, 1, 2),
        &[],
    );
    assert_eq!(
        IrModule::parse(&old).unwrap_err(),
        IrError::MissingSection(10)
    );
    assert_eq!(Opcode::from_byte(19).unwrap(), Opcode::Coalesce);
}

fn bytes(hex: &str) -> Vec<u8> {
    hex.as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}
fn island(id: u16, offset: u32, schema: u16, digest: &[u8], inputs: &[u16]) -> Vec<u8> {
    let mut record = Vec::new();
    record.extend(id.to_le_bytes());
    record.extend([1, 0]);
    record.extend(0u32.to_le_bytes());
    record.extend(offset.to_le_bytes());
    record.extend(schema.to_le_bytes());
    record.push(digest.len() as u8);
    record.extend(digest);
    record.extend((inputs.len() as u16).to_le_bytes());
    for id in inputs {
        record.extend(id.to_le_bytes());
    }
    let mut out = vec![1, 0];
    out.extend((record.len() as u16).to_le_bytes());
    out.extend(record);
    out
}
fn global_schema(fields: &[(u32, &[u8])]) -> Vec<u8> {
    let mut out = vec![1, 0];
    out.extend((fields.len() as u16).to_le_bytes());
    for (name, kind) in fields {
        out.extend(name.to_le_bytes());
        out.extend(1u32.to_le_bytes());
        out.extend(1u32.to_le_bytes());
        out.extend(1u32.to_le_bytes());
        out.extend(*kind);
    }
    out
}
#[test]
fn repeated_ordered_input_is_valid_and_contract_schema_must_match_global() {
    let all: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../docs/proposals/FORMA-103-WIRE-VECTORS.json"
    ))
    .unwrap();
    let v = all["vectors"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["name"] == "repeated-call-input")
        .unwrap();
    let section = bytes(v["sectionHex"].as_str().unwrap());
    let digest = bytes(v["digestHex"].as_str().unwrap());
    let strings = build_string_table(&["Pair", "Fixture.ts", "left", "right", "shared", "div"]);
    let slots = build_slot_table(&[(7, 4, 1, 1, b"x")]);
    let ops = [
        vec![11, 7, 0],
        crate::parser::test_helpers::encode_open_tag(5, &[]),
        crate::parser::test_helpers::encode_close_tag(5),
        vec![12, 7, 0],
    ]
    .concat();
    let islands = island(7, 0, 0, &digest, &[7, 7]);
    let schema = global_schema(&[(2, &[2]), (3, &[2])]);
    let make = |schema: &[u8], section: &[u8], flags| {
        build_ir_sections(&[
            (1, 1, &ops),
            (2, 1, &strings),
            (3, 1, &slots),
            (4, 1, &islands),
            (5, 1, schema),
            (10, flags, section),
        ])
    };
    let module = IrModule::parse(&make(&schema, &section, 1)).unwrap();
    assert_eq!(
        module.island_contract_bytes(7),
        Some((
            bytes(v["bindingHex"].as_str().unwrap()).as_slice(),
            bytes(v["schemaHex"].as_str().unwrap()).as_slice()
        ))
    );
    assert!(crate::dump::dump_ir(&module)
        .contains(&format!("HEX {}", v["sectionHex"].as_str().unwrap())));
    let changed = global_schema(&[(2, &[2]), (3, &[3])]);
    assert_eq!(
        IrModule::parse(&make(&changed, &section, 1))
            .unwrap_err()
            .code(),
        "LOAD-103"
    );
    assert_eq!(
        IrModule::parse(&make(&schema, &section, 0))
            .unwrap_err()
            .code(),
        "LOAD-103"
    );
    let old = build_ir_sections(&[
        (1, 1, &ops),
        (2, 1, &strings),
        (3, 1, &slots),
        (4, 1, &islands),
        (5, 1, &schema),
    ]);
    assert_eq!(
        IrModule::parse(&old).unwrap_err(),
        IrError::MissingSection(10)
    );
}
#[test]
fn explicit_constants_preserve_null_keys_without_schema_projection() {
    let value = bytes("0601000b00636f6e7374727563746f7200");
    let parsed = constant::read(&mut Cursor::new(&value)).unwrap();
    assert!(
        matches!(parsed,SlotValue::Object(values) if values.len()==1 && values[0].0=="constructor" && matches!(values[0].1,SlotValue::Null))
    );
}
