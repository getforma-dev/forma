//! Executable byte-layout contract for docs/FMIR-FORMAT.md.
use forma_ir::format::{crc32, reader_version};
use forma_ir::parser::test_helpers::{build_minimal_ir, restamp};
use forma_ir::{
    IrModule, HEADER_SIZE, IR_VERSION, SECTION_ENTRY_SIZE, SIGNATURE, TABLE_PREFIX_SIZE,
};

#[test]
fn frozen_header_layout_matches_document_and_package_version() {
    let bytes = include_bytes!("fixtures/fmir-v3/PASS-good-a.ir");
    let m = IrModule::parse(bytes).unwrap();
    assert_eq!(IR_VERSION, 3);
    assert_eq!(HEADER_SIZE, 24);
    assert_eq!(SIGNATURE, [0x89, 0x46, 0x4d, 0x49, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert_eq!(&bytes[..8], &SIGNATURE);
    // The independent byte oracle retains its original writer on every release.
    for (i, expected) in [3_u16, 0, 0].iter().enumerate() {
        assert_eq!(
            u16::from_le_bytes([bytes[8 + i * 2], bytes[9 + i * 2]]),
            *expected
        );
    }
    let current = build_minimal_ir(&[], &[], &[], &[]);
    assert_eq!(
        IrModule::parse(&current).unwrap().header.writer,
        reader_version()
    );
    assert_eq!(m.header.body_len as usize, bytes.len() - HEADER_SIZE);
    assert_eq!(m.header.crc, crc32(&[&bytes[..18], &bytes[22..]]));
    assert_eq!(&bytes[22..24], &[0, 0]);
    let doc = include_str!("../../../docs/FMIR-FORMAT.md");
    let layout = doc
        .split("## 3. Header (24 bytes)")
        .nth(1)
        .unwrap()
        .split("```")
        .nth(1)
        .unwrap();
    let rows: Vec<_> = layout
        .lines()
        .filter_map(|line| {
            let mut cols = line.split_whitespace();
            let offset = cols.next()?.parse::<usize>().ok()?;
            let size = cols.next()?.parse::<usize>().ok()?;
            Some((offset, size, cols.next().unwrap_or_default()))
        })
        .collect();
    assert_eq!(
        rows,
        [
            (0, 8, "signature:"),
            (8, 6, "writer"),
            (14, 4, "body_len"),
            (18, 4, "crc"),
            (22, 2, "reserved:")
        ]
    );
}
#[test]
fn variable_sections_tile_exactly_and_reserved_fields_fail_closed() {
    let mut bytes = build_minimal_ir(&[], &[], &[], &[]);
    let module = IrModule::parse(&bytes).unwrap();
    assert_eq!(TABLE_PREFIX_SIZE, 4);
    assert_eq!(SECTION_ENTRY_SIZE, 12);
    assert_eq!(module.sections.sections.len(), 5);
    assert_eq!(
        module.sections.sections[0].offset as usize,
        HEADER_SIZE + TABLE_PREFIX_SIZE + 5 * SECTION_ENTRY_SIZE
    );
    assert_eq!(
        module.sections.sections.last().map(|s| s.offset + s.size),
        Some(bytes.len() as u32)
    );
    bytes[26] = 1;
    restamp(&mut bytes);
    assert_eq!(IrModule::parse(&bytes).unwrap_err().code(), "LOAD-103");
    bytes[26] = 0;
    bytes[22] = 1;
    restamp(&mut bytes);
    assert_eq!(IrModule::parse(&bytes).unwrap_err().code(), "LOAD-103");
}
#[test]
fn legacy_and_newer_minor_are_rebuild_errors() {
    let mut legacy = vec![0; 48];
    legacy[..4].copy_from_slice(b"FMIR");
    legacy[4] = 2;
    let err = IrModule::parse(&legacy).unwrap_err();
    assert_eq!(err.code(), "LOAD-102");
    assert!(err.to_string().contains("header version 2"));
    assert!(err.to_string().contains("rebuild"));
    let mut bytes = build_minimal_ir(&[], &[], &[], &[]);
    let reader = reader_version();
    let mut future = reader;
    future[1] = future[1].checked_add(1).unwrap();
    bytes[10..12].copy_from_slice(&future[1].to_le_bytes());
    restamp(&mut bytes);
    let err = IrModule::parse(&bytes).unwrap_err();
    assert_eq!(err.code(), "LOAD-108");
    for version in [future, reader] {
        assert!(err
            .to_string()
            .contains(&format!("{}.{}.{}", version[0], version[1], version[2])));
    }
}
