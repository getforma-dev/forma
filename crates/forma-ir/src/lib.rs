//! Forma Module IR: binary format definitions and parsers.
//!
//! This crate provides the core IR types and parsing logic that can be compiled
//! to both native Rust and WebAssembly targets.
//!
//! The `wasm` feature, which exports `render` and `render_island` for the
//! browser's WASM walker (`@getforma/core/wasm`), is deprecated since 0.2.2 and
//! is removed in 3.0.0 (DR-23): islands re-render in the browser with
//! `@getforma/core`'s `h()`. Both exports still build and work through 0.2.x.

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

/// INTERNAL, behind the `__fault-injection` feature: the stand-in component
/// that panics, for SR44's tests. Never in a build that ships.
#[cfg(any(test, feature = "__fault-injection"))]
#[doc(hidden)]
pub mod fault_injection {
    /// A DYN_TEXT value equal to this makes the walk panic, but only inside
    /// [`crate::walker::walk_to_html_counted`], which catches it: the
    /// uncaught `walk_to_html` path never arms the trigger. It lets a test
    /// show that a panic inside the walk becomes an error naming its island,
    /// and that the next render works. Compiled only for this crate's tests
    /// and under the internal `__fault-injection` feature, which only the two
    /// crates' own dev-dependencies enable; `test-helpers` does not.
    pub const FAULT_TRIGGER: &str = "\u{0}forma-test-fault\u{0}";
}

/// Human-readable text dump of a module, for debugging and diffing.
#[cfg(feature = "dump")]
pub mod dump;

/// Doctests pinning the `wasm` exports' deprecation; built only by
/// `cargo test --doc --features wasm`.
#[cfg(all(doctest, feature = "wasm"))]
mod deprecations;

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
///
/// Deprecated with the `wasm` feature, which 3.0.0 removes (DR-23).
#[cfg(feature = "wasm")]
#[deprecated(
    since = "0.2.2",
    note = "the WASM walker goes with the `wasm` feature: re-render an island in the browser \
            with @getforma/core's `h()`, as islands already do. Removed in 3.0.0 (DR-23)"
)]
// wasm-bindgen's generated export calls this function; the allow keeps that
// call quiet. A caller's own use still warns: the lint fires at the caller.
// Verified by: crates/forma-ir/src/deprecations.rs > "WasmRender"
#[allow(deprecated)]
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
///
/// Deprecated with the `wasm` feature, which 3.0.0 removes (DR-23).
#[cfg(feature = "wasm")]
#[deprecated(
    since = "0.2.2",
    note = "the WASM walker goes with the `wasm` feature: re-render an island in the browser \
            with @getforma/core's `h()`, as islands already do. Removed in 3.0.0 (DR-23)"
)]
#[allow(deprecated)] // as `render`: wasm-bindgen's generated export calls it
#[wasm_bindgen]
#[allow(clippy::panic)] // as `render`: the panic is the JS exception
pub fn render_island(ir_bytes: &[u8], slots_json: &str, island_id: u16) -> String {
    let module = parser::IrModule::parse(ir_bytes).unwrap_or_else(|e| panic!("IR parse: {e}"));
    let slots =
        slot::SlotData::from_json(slots_json, &module).unwrap_or_else(|e| panic!("slots: {e}"));
    walker::walk_island(&module, &slots, island_id).unwrap_or_else(|e| panic!("walk island: {e}"))
}
