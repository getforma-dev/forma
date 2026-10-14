//! Forma Module IR: binary format definitions and parsers.
//!
//! This crate provides the core IR types and parsing logic that can be compiled
//! to both native Rust and WebAssembly targets.

// README.md and SECURITY.md both promise "Zero `unsafe` blocks". This is what
// makes that a compiler-enforced property of the shipped library rather than a
// claim. It is crate-root rather than a `[lints]` entry because `[lints]`
// covers every target in the package, and the allocation-counting harness in
// `tests/list_scaling.rs` must implement `GlobalAlloc` — a separate crate, not
// code that ships.
#![forbid(unsafe_code)]
#![allow(clippy::type_complexity)]
// No `unwrap`, `expect` or `panic!` in the code that ships (DR-12, SR44): a
// walk returns its failure, it does not take the request down. Tests may.
// The wasm exports below are the documented exception.
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

/// On-disk FMIR layout: header, section table, opcodes, and the table entry
/// types. See `docs/FMIR-FORMAT.md` for the stability contract.
pub mod format;
/// Bounds-checked parsing and one-shot structural validation of an FMIR file.
pub mod parser;
/// Runtime slot values and the dense `SlotData` a page handler populates.
pub mod slot;
/// The SSR walker: opcode stream plus slot values in, HTML out.
pub mod walker;

/// Human-readable text dump of a module, for debugging and diffing.
#[cfg(feature = "dump")]
pub mod dump;

// Re-exports for convenience
pub use format::{
    IrError, IrHeader, IslandEntry, IslandTrigger, Opcode, PropsMode, SectionDescriptor,
    SectionTable, SlotEntry, SlotSource, SlotType, HEADER_SIZE, IR_VERSION, MAGIC,
    SECTION_TABLE_SIZE,
};
pub use parser::{IrModule, IslandTableParsed, SlotTable, StringTable};
pub use slot::{json_to_slot_value, SlotData, SlotValue};
pub use walker::{
    walk_island, walk_island_with_limits, walk_to_html, walk_to_html_counted,
    walk_to_html_with_limits, WalkCounts, WalkFailure, WalkLimits, WalkOutput,
    DEFAULT_MAX_LIST_ITERATIONS, DEFAULT_MAX_OUTPUT_BYTES,
};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// Full page render: parse IR bytes + JSON slots → HTML string.
///
/// Panics on error (throws a JS exception in WASM — the client loader catches
/// it and falls back to Phase 1). That set of errors now includes the walker's
/// resource budgets ([`WalkLimits`]): an over-limit render throws here rather
/// than aborting the wasm instance, and malformed control-flow lengths that
/// used to render garbage now throw too. The client loader must have a
/// rejection handler on this call — that is pre-existing behavior for parse
/// errors, but the set of inputs that reach it is wider.
#[cfg(feature = "wasm")]
#[wasm_bindgen]
// The panic is this export's contract: wasm-bindgen turns it into the JS
// exception the client loader catches. The `wasm` feature goes in 3.0.0
// (DR-23); until then it is the one place this crate panics by design.
#[allow(clippy::panic)]
pub fn render(ir_bytes: &[u8], slots_json: &str) -> String {
    let module = parser::IrModule::parse(ir_bytes).unwrap_or_else(|e| panic!("IR parse: {e}"));
    let slots =
        slot::SlotData::from_json(slots_json, &module).unwrap_or_else(|e| panic!("slots: {e}"));
    walker::walk_to_html(&module, &slots).unwrap_or_else(|e| panic!("walk: {e}"))
}

/// Fragment render: parse IR bytes + JSON slots → the island's ROOT element,
/// carrying its full `data-forma-*` attribute set (including `data-forma-props`
/// when the island has props). Swap it in with `replaceWith`/`outerHTML`, never
/// `innerHTML` — that would discard the attributes the runtime selects on.
///
/// Panics on error (throws a JS exception in WASM — client loader catches and
/// falls back). See [`render`] for the widened error set.
#[cfg(feature = "wasm")]
#[wasm_bindgen]
#[allow(clippy::panic)] // as `render`: the panic is the JS exception
pub fn render_island(ir_bytes: &[u8], slots_json: &str, island_id: u16) -> String {
    let module = parser::IrModule::parse(ir_bytes).unwrap_or_else(|e| panic!("IR parse: {e}"));
    let slots =
        slot::SlotData::from_json(slots_json, &module).unwrap_or_else(|e| panic!("slots: {e}"));
    walker::walk_island(&module, &slots, island_id).unwrap_or_else(|e| panic!("walk island: {e}"))
}
