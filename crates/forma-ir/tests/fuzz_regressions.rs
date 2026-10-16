//! Stable replay uses exactly the same input adapters as nightly libFuzzer.
use forma_ir::fuzz_support::{bounded_slots, exercise, Target, MAX_INPUT, SEEDS};
use forma_ir::{parser::test_helpers::*, IrModule, SlotValue};
use std::{fs, path::Path};

#[test]
fn replay_every_committed_regression_with_its_real_adapter() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fuzz/regressions");
    for (name, target) in [
        ("parse_raw", Target::ParseRaw),
        ("parse_body", Target::ParseBody),
        ("parse_mutated", Target::ParseMutated),
        ("walk", Target::Walk),
    ] {
        let mut count = 0;
        for entry in fs::read_dir(root.join(name)).unwrap() {
            let path = entry.unwrap().path();
            if !path.is_file() {
                continue;
            }
            let bytes = fs::read(&path).unwrap();
            let result = std::panic::catch_unwind(|| exercise(target, &bytes));
            assert!(result.is_ok(), "regression panicked: {}", path.display());
            count += 1;
        }
        assert!(count > 0, "missing {name} regression corpus");
    }
}

/// The seeded-bug qualification (FMIR-FORMAT §11.4): each input below was produced by the
/// nightly targets against a scratch reader carrying one deliberate defect, and each
/// assertion states the guarantee that defect removed. With the defect re-applied, the
/// matching assertion panics or fails, so a regression of that check is caught on every PR.
#[test]
fn seeded_decoder_defects_are_caught_deterministically() {
    use forma_ir::fuzz_support::stamp_body;
    use forma_ir::{IrError, SectionTable, StringTable, HEADER_SIZE};
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fuzz/regressions");
    let read = |path: &str| fs::read(root.join(path)).unwrap();

    // Seed A: the CRC-32 comparison skipped. A length-exact module whose CRC field is
    // wrong must be refused with the checksum code, and never reach the dump oracle.
    let crc_flipped = read("parse_raw/seeded-crc-check-skipped");
    assert_eq!(crc_flipped.len(), 183);
    assert!(matches!(
        IrModule::parse(&crc_flipped),
        Err(IrError::ChecksumMismatch { .. })
    ));
    assert!(!exercise(Target::ParseRaw, &crc_flipped));

    // Seed B: the section-table end bound off by one. A body of three bytes declares
    // zero sections but has no room for the four-byte table prefix.
    let short_table = read("parse_body/seeded-section-table-end-off-by-one");
    assert_eq!(short_table.len(), 3);
    assert!(matches!(
        SectionTable::parse(&short_table),
        Err(IrError::BufferTooShort {
            expected: 4,
            actual: 3
        })
    ));
    assert!(!exercise(Target::ParseBody, &short_table));

    // Seed C: a string entry's length not checked against the bytes left. The string
    // section declares one string of 65,535 bytes and ends after the length prefix.
    let overrun = read("parse_body/seeded-string-length-unchecked");
    assert_eq!(overrun.len(), 70);
    let table = SectionTable::parse(&overrun).unwrap();
    let strings = table.get(2).unwrap();
    let start = strings.offset as usize - HEADER_SIZE;
    let payload = &overrun[start..start + strings.size as usize];
    assert!(matches!(
        StringTable::parse(payload),
        Err(IrError::BufferTooShort {
            expected: 65_541,
            actual: 6
        })
    ));
    assert!(matches!(
        IrModule::parse(&stamp_body(&overrun)),
        Err(IrError::BufferTooShort { .. })
    ));
    assert!(!exercise(Target::ParseBody, &overrun));
    // The same defect reached through a near-valid mutation of a frozen module.
    let mutated = read("parse_mutated/seeded-string-length-unchecked");
    assert_eq!(mutated.len(), 4);
    assert!(!exercise(Target::ParseMutated, &mutated));
}

#[test]
fn frozen_modules_reach_all_four_adapters_and_the_bounded_walker() {
    assert_eq!(SEEDS.len(), 14);
    for (index, bytes) in SEEDS.iter().enumerate() {
        assert!(exercise(Target::ParseRaw, bytes));
        assert!(exercise(Target::ParseBody, &bytes[24..]));
        assert!(exercise(Target::ParseMutated, &[index as u8]));
        let mut walk = (bytes.len() as u32).to_le_bytes().to_vec();
        walk.extend_from_slice(bytes);
        assert!(exercise(Target::Walk, &walk));
    }
}

#[test]
fn fault_corpus_is_total_and_accepted_cases_walk() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fmir-v3");
    let mut count = 0;
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|s| s.to_str()) != Some("ir") {
            continue;
        }
        let bytes = fs::read(path).unwrap();
        let accepted = exercise(Target::ParseRaw, &bytes);
        if accepted {
            let mut walk = (bytes.len() as u32).to_le_bytes().to_vec();
            walk.extend_from_slice(&bytes);
            assert!(exercise(Target::Walk, &walk));
        }
        count += 1;
    }
    assert_eq!(count, 67);
}

#[test]
fn malformed_and_oversized_input_never_looks_like_a_successful_replay() {
    for target in [
        Target::ParseRaw,
        Target::ParseBody,
        Target::ParseMutated,
        Target::Walk,
    ] {
        assert!(!exercise(target, &vec![0; MAX_INPUT + 1]));
    }
    assert!(!exercise(Target::Walk, &[255; 4]));
    assert!(!exercise(Target::ParseRaw, &SEEDS[0][..23]));
    let mut corrupt = SEEDS[0].to_vec();
    corrupt[18] ^= 1;
    assert!(!exercise(Target::ParseRaw, &corrupt));
}

#[test]
fn slot_adapter_uses_declared_order_bounded_lengths_and_null_for_truncation() {
    let slots = vec![(1, 1, 1, 0, &[][..]), (0, 0, 3, 0, &[][..])];
    let bytes = build_minimal_ir(&["number", "text"], &slots, &[], &[]);
    let module = IrModule::parse(&bytes).unwrap();
    let data = bounded_slots(&module, &[1, 0, 7, 2, 0, b'<', b'>']);
    assert!(matches!(data.get(0), SlotValue::Number(n) if *n == 7.0));
    assert!(matches!(data.get(1), SlotValue::Text(s) if s == "<>"));
    let truncated = bounded_slots(&module, &[1, 0, 9, 5, 0, b'x']);
    assert!(matches!(truncated.get(0), SlotValue::Number(n) if *n == 9.0));
    assert!(matches!(truncated.get(1), SlotValue::Null));
}
