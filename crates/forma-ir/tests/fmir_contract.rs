//! Executable form of `docs/FMIR-FORMAT.md`.
//!
//! The document makes four promises that are frozen across every future FMIR
//! version — magic at offset 0, u16 LE version at offset 4, a 16-byte header
//! plus a 32-byte section table, and section data starting at offset 48. ksx
//! Studio already byte-guards the first two (`assert_eq!(&bytes[0..6],
//! b"FMIR\x02\x00")`) against a contract that, until that document existed,
//! was published nowhere.
//!
//! This file is what makes those promises testable from the consumer's side:
//! it reads the bytes exactly as an external guard would, with no help from
//! the parser.

use forma_ir::parser::test_helpers::build_minimal_ir;
use forma_ir::{IrError, IrModule, HEADER_SIZE, IR_VERSION, MAGIC, SECTION_TABLE_SIZE};

/// A minimal but complete module: one string, one slot, one TEXT opcode.
fn sample_module_bytes() -> Vec<u8> {
    let opcodes = {
        let mut b = vec![0x04]; // TEXT
        b.extend_from_slice(&0u32.to_le_bytes());
        b
    };
    build_minimal_ir(&["hi"], &[(0, 0, 0x01, 0x00, b"")], &opcodes, &[])
}

#[test]
fn frozen_magic_and_version_position() {
    // docs/FMIR-FORMAT.md §1. These four bytes and the two after them are the
    // only thing a reader may inspect before it knows the version.
    assert_eq!(MAGIC, b"FMIR");
    assert_eq!(IR_VERSION, 2);

    let bytes = sample_module_bytes();
    assert_eq!(&bytes[0..4], MAGIC, "magic must be at offset 0");
    assert_eq!(
        u16::from_le_bytes([bytes[4], bytes[5]]),
        IR_VERSION,
        "version must be a u16 LE at offset 4"
    );

    // The exact guard ksx Studio compiles into its test suite.
    assert_eq!(&bytes[0..6], b"FMIR\x02\x00");
}

#[test]
fn frozen_header_and_section_table_sizes() {
    // docs/FMIR-FORMAT.md §2: 16-byte header, 32-byte section table, section
    // data at 48.
    assert_eq!(HEADER_SIZE, 16);
    assert_eq!(SECTION_TABLE_SIZE, 32);
    assert_eq!(HEADER_SIZE + SECTION_TABLE_SIZE, 48);

    let bytes = sample_module_bytes();
    // Section 0 (bytecode) is the first payload, so its declared offset is
    // where section data begins.
    let bytecode_offset = u32::from_le_bytes(bytes[16..20].try_into().unwrap());
    assert_eq!(
        bytecode_offset as usize, 48,
        "section data must start at offset 48"
    );
}

#[test]
fn frozen_section_order_is_bytecode_strings_slots_islands() {
    // docs/FMIR-FORMAT.md §2.2. Descriptors are (offset u32, size u32) pairs
    // in a fixed order, so the payloads appear in that order too.
    let bytes = sample_module_bytes();
    let descriptor = |i: usize| -> (u32, u32) {
        let base = HEADER_SIZE + i * 8;
        (
            u32::from_le_bytes(bytes[base..base + 4].try_into().unwrap()),
            u32::from_le_bytes(bytes[base + 4..base + 8].try_into().unwrap()),
        )
    };

    let mut cursor = 48u32;
    for i in 0..4 {
        let (offset, size) = descriptor(i);
        assert_eq!(
            offset,
            cursor,
            "section {i} does not follow section {}",
            i - 1
        );
        cursor += size;
    }
    assert_eq!(cursor as usize, bytes.len(), "sections must tile the file");
}

#[test]
fn reserved_flags_fail_closed() {
    // docs/FMIR-FORMAT.md §2.1: an unknown flag bit is a hard error, so a
    // reader that predates an extension refuses the file rather than
    // mis-parsing it.
    let mut bytes = sample_module_bytes();
    bytes[6] = 0x01;
    assert_eq!(
        IrModule::parse(&bytes).unwrap_err(),
        IrError::UnsupportedFlags(1)
    );
}

#[test]
fn a_different_version_is_rejected_outright() {
    // docs/FMIR-FORMAT.md §4: there is no compatibility window. A v3 file is
    // refused by a v2 reader, which is what makes "recompile everything
    // together" the contract rather than a suggestion.
    let mut bytes = sample_module_bytes();
    bytes[4..6].copy_from_slice(&3u16.to_le_bytes());
    assert_eq!(
        IrModule::parse(&bytes).unwrap_err(),
        IrError::UnsupportedVersion(3)
    );
}

#[test]
fn the_documented_consumer_guard_compiles_and_passes() {
    // docs/FMIR-FORMAT.md §5, verbatim. If this stops working the document is
    // wrong, not the caller.
    let ir_bytes = sample_module_bytes();

    assert_eq!(&ir_bytes[0..4], MAGIC);
    assert_eq!(u16::from_le_bytes([ir_bytes[4], ir_bytes[5]]), IR_VERSION,);
    let module = IrModule::parse(&ir_bytes).expect("sample module parses");
    assert_eq!(module.header.version, IR_VERSION);
    assert_eq!(module.header.flags, 0);
}
