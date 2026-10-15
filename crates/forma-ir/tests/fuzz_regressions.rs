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
