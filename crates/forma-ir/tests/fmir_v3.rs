//! Frozen, independently reviewed v3 modules and fault cases (FORMA-185).
use forma_ir::{
    format::{crc32, reader_version},
    IrModule,
};
use std::{fs, path::Path};

#[test]
fn reviewed_v3_fixture_codes_are_exact() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fmir-v3");
    let index = fs::read_to_string(root.join("index.tsv")).unwrap();
    let mut checked = 0;
    for row in index.lines().skip(1) {
        let fields: Vec<_> = row.split('\t').collect();
        let bytes = fs::read(root.join(fields[0])).unwrap();
        let result = IrModule::parse(&bytes);
        let code = match &result {
            Ok(_) => "PASS",
            Err(e) => e.code(),
        };
        assert_eq!(code, fields[1], "{}: {result:?}", fields[0]);
        if let Ok(module) = result {
            assert_eq!(module.raw_bytes(), bytes);
            assert_eq!(module.header.writer, reader_version());
        }
        checked += 1;
    }
    assert_eq!(checked, 67);
}
#[test]
fn crc_standard_vector_and_example_match() {
    assert_eq!(crc32(&[b"123456789"]), 0xcbf43926);
    let bytes = include_bytes!("fixtures/fmir-v3/PASS-good-a.ir");
    let m = IrModule::parse(bytes).unwrap();
    assert_eq!(bytes.len(), 183);
    assert_eq!(m.header.body_len, 159);
    assert_eq!(m.header.crc, 0xfa39788c);
    assert_eq!(
        m.sections
            .sections
            .iter()
            .map(|s| s.offset)
            .collect::<Vec<_>>(),
        [88, 117, 148, 160, 162]
    );
}

#[test]
fn every_removed_opcode_is_reserved_and_refused_at_load() {
    use forma_ir::parser::test_helpers::build_minimal_ir;
    for byte in [0x09, 0x0d, 0x0e, 0x0f, 0x10, 0x11] {
        let data = build_minimal_ir(&["benign"], &[], &[byte], &[]);
        assert_eq!(
            IrModule::parse(&data).unwrap_err(),
            forma_ir::IrError::InvalidOpcode(byte)
        );
    }
    let data = build_minimal_ir(&["benign"], &[], &[0x04, 0, 0, 0, 0], &[]);
    let module = IrModule::parse(&data).unwrap();
    assert_eq!(
        forma_ir::walk_to_html(&module, &forma_ir::SlotData::new(0)).unwrap(),
        "benign"
    );
}

#[test]
fn all_bytecode_string_operand_shapes_are_validated_before_render() {
    use forma_ir::parser::test_helpers::*;
    let mut cases = Vec::new();
    for (name, encode) in [
        (
            "OPEN_TAG",
            encode_open_tag as fn(u32, &[(u32, u32)]) -> Vec<u8>,
        ),
        ("VOID_TAG", encode_void_tag),
    ] {
        cases.push((name, encode(9, &[]), encode(0, &[])));
        cases.push((name, encode(0, &[(9, 0)]), encode(0, &[(0, 0)])));
        cases.push((name, encode(0, &[(0, 9)]), encode(0, &[(0, 0)])));
    }
    for (name, op) in [("CLOSE_TAG", 2), ("TEXT", 4), ("DYN_ATTR", 6)] {
        let mut valid = vec![op, 0, 0, 0, 0];
        if op == 6 {
            valid.extend_from_slice(&[0, 0]);
        }
        let mut bad = valid.clone();
        bad[1] = 9;
        cases.push((name, bad, valid));
    }
    cases.push((
        "PROP",
        vec![0x12, 0, 0, 9, 0, 0, 0, 0, 0],
        vec![0x12, 0, 0, 0, 0, 0, 0, 0, 0],
    ));
    for (name, bad, valid) in cases {
        let rejected = build_minimal_ir(&["x"], &[(0, 0, 1, 0, &[])], &bad, &[]);
        assert_eq!(
            IrModule::parse(&rejected).unwrap_err(),
            forma_ir::IrError::StringIndexOutOfBounds { index: 9, len: 1 },
            "{name}"
        );
        let accepted = build_minimal_ir(&["x"], &[(0, 0, 1, 0, &[])], &valid, &[]);
        assert_eq!(
            IrModule::parse(&accepted).unwrap().raw_bytes(),
            accepted,
            "{name}"
        );
    }
}

#[test]
fn recursive_inputs_are_bounded_at_the_contract_and_at_ten_thousand_levels() {
    use forma_ir::parser::test_helpers::*;
    for depth in [64usize, 65, 10_000] {
        // Build iteratively: this test must not overflow before it reaches the reader.
        let mut ops = Vec::with_capacity(depth * 9);
        for i in 0..depth {
            ops.extend_from_slice(&[0x0a, 0, 0, 0, 0]);
            ops.extend_from_slice(&(((depth - i - 1) * 9) as u32).to_le_bytes());
        }
        let data = build_minimal_ir(&["items"], &[(0, 0, 4, 0, &[])], &ops, &[]);
        let result = IrModule::parse(&data);
        if depth == 64 {
            assert_eq!(result.unwrap().opcodes, ops);
        } else {
            assert_eq!(
                result.unwrap_err().code(),
                "LOAD-107",
                "control depth {depth}"
            );
        }
    }
    for depth in [16usize, 17, 10_000] {
        let mut schema = vec![1, 0, 1, 0];
        for n in [0u32, 0, 1, 1] {
            schema.extend_from_slice(&n.to_le_bytes());
        }
        schema.extend(std::iter::repeat(6).take(depth)); // arrays
        schema.push(2); // string leaf
        let strings = build_string_table(&["x"]);
        let data = build_ir_sections(&[
            (1, 1, &[]),
            (2, 1, &strings),
            (3, 1, &[0, 0]),
            (4, 1, &[0, 0]),
            (5, 1, &schema),
        ]);
        let result = IrModule::parse(&data);
        if depth == 16 {
            assert_eq!(result.unwrap().schema.objects[0].len(), 1);
        } else {
            assert_eq!(
                result.unwrap_err().code(),
                "LOAD-107",
                "schema depth {depth}"
            );
        }
    }
}

#[test]
fn module_ceiling_is_checked_before_decoding_but_includes_its_boundary() {
    use forma_ir::{format::MAX_MODULE_SIZE, parser::test_helpers::build_ir_sections};
    let bad = vec![b'x'; MAX_MODULE_SIZE + 1];
    assert_eq!(IrModule::parse(&bad).unwrap_err().code(), "LOAD-107");
    let bytes = include_bytes!("fixtures/fmir-v3/PASS-good-a.ir");
    let m = IrModule::parse(bytes).unwrap();
    let extra = vec![0; MAX_MODULE_SIZE - bytes.len() - 12];
    let mut sections: Vec<_> = m
        .sections
        .sections
        .iter()
        .map(|s| {
            (
                s.id,
                s.flags,
                &bytes[s.offset as usize..(s.offset + s.size) as usize],
            )
        })
        .collect();
    sections.push((0x8000, 0, &extra));
    let exactly = build_ir_sections(&sections);
    assert_eq!(exactly.len(), MAX_MODULE_SIZE);
    assert_eq!(IrModule::parse(&exactly).unwrap().raw_bytes(), exactly);
}

#[cfg(feature = "dump")]
#[test]
fn canonical_dump_losslessly_rebuilds_every_accepted_review_fixture() {
    use forma_ir::parser::test_helpers::build_ir_sections;
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fmir-v3");
    let index = fs::read_to_string(root.join("index.tsv")).unwrap();
    for row in index.lines().skip(1) {
        let fields: Vec<_> = row.split('\t').collect();
        if fields[1] != "PASS" {
            continue;
        }
        let original = fs::read(root.join(fields[0])).unwrap();
        let module = IrModule::parse(&original).unwrap();
        let text = forma_ir::dump::dump_ir(&module);
        let mut lines = text.lines();
        let header = lines.next().unwrap();
        assert!(header.starts_with("FMIR v3 writer=3.0.0 "));
        let mut sections = Vec::new();
        while let Some(descriptor) = lines.next() {
            let fields: Vec<_> = descriptor.split_whitespace().collect();
            let id = u16::from_str_radix(fields[1].strip_prefix("id=").unwrap(), 16).unwrap();
            let flags = u16::from_str_radix(fields[2].strip_prefix("flags=").unwrap(), 16).unwrap();
            let hex = lines.next().unwrap().strip_prefix("HEX ").unwrap();
            let bytes = (0..hex.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                .collect::<Vec<_>>();
            sections.push((id, flags, bytes));
        }
        let refs: Vec<_> = sections
            .iter()
            .map(|(id, flags, bytes)| (*id, *flags, bytes.as_slice()))
            .collect();
        assert_eq!(build_ir_sections(&refs), original, "{}", fields[0]);
    }
}
