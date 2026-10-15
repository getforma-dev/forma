//! Internal, bounded adapters shared by libFuzzer and stable regression replay.
//!
//! This module is compiled only for the crate's own tests or `__fuzzing`. It adds
//! no CRC bypass to the shipped reader. See `fuzz/README.md` and FMIR-FORMAT §11.3.
#![allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]

use crate::format::{crc32, reader_version, SlotType, HEADER_SIZE, SIGNATURE};
use crate::{IrModule, SlotData, SlotValue, WalkLimits};
use std::sync::Arc;

/// Harness cap, independent of the format's 16 MiB acceptance ceiling.
pub const MAX_INPUT: usize = 65_536;
/// Per-render output cap for the fuzz harness.
pub const OUTPUT_BUDGET: usize = 65_536;
/// Per-render list iteration cap for the fuzz harness.
pub const ITERATION_BUDGET: usize = 256;

/// Input layout to use in both the fuzz target and stable replay.
#[derive(Clone, Copy, Debug)]
pub enum Target {
    /// Arbitrary bytes, including invalid signatures and checksums.
    ParseRaw,
    /// Arbitrary section-table/body bytes with a correctly stamped header.
    ParseBody,
    /// Seed selector followed by `(u16 offset, u8 XOR)` mutations.
    ParseMutated,
    /// LE u32 module length, module bytes, then bounded slot values.
    Walk,
}

/// The compiler's frozen FMIR v3 corpus, also used to seed near-valid mutations.
pub const SEEDS: &[&[u8]] = &[
    include_bytes!("../tests/fixtures/js-emitter/barrel-exports.ir"),
    include_bytes!("../tests/fixtures/js-emitter/create-show.ir"),
    include_bytes!("../tests/fixtures/js-emitter/dynamic-attrs.ir"),
    include_bytes!("../tests/fixtures/js-emitter/dynamic-text.ir"),
    include_bytes!("../tests/fixtures/js-emitter/eager-concat.ir"),
    include_bytes!("../tests/fixtures/js-emitter/imported-const-table.ir"),
    include_bytes!("../tests/fixtures/js-emitter/imported-signal-defaults.ir"),
    include_bytes!("../tests/fixtures/js-emitter/jsx-page.ir"),
    include_bytes!("../tests/fixtures/js-emitter/list-same-source.ir"),
    include_bytes!("../tests/fixtures/js-emitter/nested-islands.ir"),
    include_bytes!("../tests/fixtures/js-emitter/static-page.ir"),
    include_bytes!("../tests/fixtures/js-emitter/sub-component-scopes.ir"),
    include_bytes!("../tests/fixtures/js-emitter/ternary-asymmetric.ir"),
    include_bytes!("../tests/fixtures/js-emitter/unicode-emoji.ir"),
];

/// Wrap body bytes with a valid signature, exact current writer and CRC.
pub fn stamp_body(body: &[u8]) -> Vec<u8> {
    let body = &body[..body.len().min(MAX_INPUT)];
    let mut bytes = vec![0; HEADER_SIZE];
    bytes[..8].copy_from_slice(&SIGNATURE);
    for (index, component) in reader_version().iter().enumerate() {
        bytes[8 + index * 2..10 + index * 2].copy_from_slice(&component.to_le_bytes());
    }
    bytes[14..18].copy_from_slice(&(body.len() as u32).to_le_bytes());
    bytes.extend_from_slice(body);
    restamp_crc(&mut bytes);
    bytes
}

fn restamp_crc(bytes: &mut [u8]) {
    if bytes.len() >= HEADER_SIZE {
        let crc = crc32(&[&bytes[..18], &bytes[22..]]);
        bytes[18..22].copy_from_slice(&crc.to_le_bytes());
    }
}

/// Decode at most one length-prefixed value per declared slot in ascending id order.
/// Truncation stops decoding; undecoded slots stay Null. Arrays/objects are empty,
/// so no recursive input parser or attacker-controlled allocation multiplier exists.
pub fn bounded_slots(module: &IrModule, bytes: &[u8]) -> SlotData {
    let mut slots = SlotData::new(0);
    let mut entries: Vec<_> = module.slots.entries().iter().collect();
    entries.sort_by_key(|entry| entry.slot_id);
    let mut cursor = 0;
    for entry in entries {
        if bytes.len().saturating_sub(cursor) < 2 {
            break;
        }
        let size = u16::from_le_bytes([bytes[cursor], bytes[cursor + 1]]) as usize;
        cursor += 2;
        if size > bytes.len() - cursor {
            break;
        }
        let value = &bytes[cursor..cursor + size];
        cursor += size;
        let value = match entry.type_hint {
            SlotType::Text => SlotValue::Text(String::from_utf8_lossy(value).into_owned()),
            SlotType::Bool => SlotValue::Bool(value.first().copied().unwrap_or(0) % 2 != 0),
            SlotType::Number => {
                let mut number = [0; 4];
                let count = value.len().min(4);
                number[..count].copy_from_slice(&value[..count]);
                SlotValue::Number(f64::from(i32::from_le_bytes(number)))
            }
            SlotType::Array => SlotValue::Array(Arc::from([])),
            SlotType::Object => SlotValue::Object(Arc::from([])),
        };
        slots.set(entry.slot_id, value);
    }
    slots
}

fn check_module(bytes: &[u8]) -> Option<IrModule> {
    let module = IrModule::parse(bytes).ok()?;
    assert!(
        module.sections.validate(bytes.len()).is_ok(),
        "accepted non-tiling sections"
    );
    assert!(
        module.validate().is_ok(),
        "parse accepted invalid structure"
    );
    assert_eq!(module.raw_bytes(), bytes);
    let dump = crate::dump::dump_ir(&module);
    assert!(
        dump.len() <= bytes.len() * 2 + 128 * 65,
        "canonical dump exceeded its linear bound"
    );
    // Decode the canonical dump's hex, reconstruct the table/header independently,
    // and demand an exact roundtrip, including optional unknown section payloads.
    let mut body = Vec::new();
    body.extend_from_slice(&(module.sections.sections.len() as u16).to_le_bytes());
    body.extend_from_slice(&[0, 0]);
    for section in &module.sections.sections {
        body.extend_from_slice(&section.id.to_le_bytes());
        body.extend_from_slice(&section.flags.to_le_bytes());
        body.extend_from_slice(&section.offset.to_le_bytes());
        body.extend_from_slice(&section.size.to_le_bytes());
    }
    let mut payload_count = 0;
    for line in dump.lines().filter_map(|line| line.strip_prefix("HEX ")) {
        assert_eq!(line.len() % 2, 0);
        for pair in line.as_bytes().chunks_exact(2) {
            let hex = std::str::from_utf8(pair).expect("dump emits ASCII hex");
            body.push(u8::from_str_radix(hex, 16).expect("dump emits valid hex"));
        }
        payload_count += 1;
    }
    assert_eq!(payload_count, module.sections.sections.len());
    assert_eq!(stamp_body(&body), bytes, "canonical dump lost module bytes");
    Some(module)
}

fn walk(bytes: &[u8], values: &[u8]) -> bool {
    let Some(module) = check_module(bytes) else {
        return false;
    };
    let slots = bounded_slots(&module, values);
    let limits = WalkLimits {
        max_output_bytes: OUTPUT_BUDGET,
        max_list_iterations: ITERATION_BUDGET,
    };
    // The direct entrypoint does not catch a panic, so libFuzzer/stable tests see it.
    if let Ok(html) = crate::walk_to_html_with_limits(&module, &slots, limits) {
        assert!(
            html.len() <= OUTPUT_BUDGET + 6,
            "walker exceeded output budget"
        );
    }
    let counts = match crate::walk_to_html_counted(&module, &slots, limits) {
        Ok(output) => {
            assert_eq!(output.html.len(), output.counts.bytes);
            output.counts
        }
        Err(failure) => failure.counts,
    };
    assert!(
        counts.bytes <= OUTPUT_BUDGET + 6,
        "counted walker exceeded output budget"
    );
    assert!(
        counts.list_iterations <= ITERATION_BUDGET,
        "walker exceeded iteration budget"
    );
    true
}

/// Exercise one bounded input; `true` means a validated module reached the oracle.
/// Parse/render errors are valid outcomes; panics and invariant violations are findings.
pub fn exercise(target: Target, input: &[u8]) -> bool {
    if input.len() > MAX_INPUT {
        return false;
    }
    match target {
        Target::ParseRaw => check_module(input).is_some(),
        Target::ParseBody => check_module(&stamp_body(input)).is_some(),
        Target::ParseMutated => {
            let Some((&selector, mutations)) = input.split_first() else {
                return false;
            };
            let mut bytes = SEEDS[usize::from(selector) % SEEDS.len()].to_vec();
            for triple in mutations.chunks_exact(3) {
                let offset = usize::from(u16::from_le_bytes([triple[0], triple[1]])) % bytes.len();
                bytes[offset] ^= triple[2];
            }
            restamp_crc(&mut bytes);
            check_module(&bytes).is_some()
        }
        Target::Walk => {
            if input.len() < 4 {
                return false;
            }
            let length = u32::from_le_bytes([input[0], input[1], input[2], input[3]]) as usize;
            if length > input.len() - 4 {
                return false;
            }
            walk(&input[4..4 + length], &input[4 + length..])
        }
    }
}
