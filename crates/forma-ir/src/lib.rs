//! Forma Module IR: binary format definitions and parsers.
//!
//! This crate provides the IR parser and native server-side HTML walker.
//!
//! Fragment walking is internal; server consumers render the page with
//! [`walk_to_html`] or [`walk_to_html_counted`]. Neither historical path is public:
//!
//! ```compile_fail
//! use forma_ir::walk_island;
//! ```
//! ```compile_fail
//! use forma_ir::walker::walk_island;
//! ```
//! ```compile_fail
//! use forma_ir::walker::walk_island_with_limits;
//! ```
//! Test features do not expose a fragment renderer either:
//! ```compile_fail
//! use forma_ir::parser::test_helpers::walk_island;
//! ```

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
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

/// On-disk FMIR layout: header, section table, opcodes, and the table entry
/// types. See `docs/FMIR-FORMAT.md` for the stability contract.
pub mod format;
/// Bounds-checked parsing and one-shot structural validation of an FMIR file.
pub mod parser;
/// Typed props schema, key paths and source positions carried by FMIR v3.
pub mod schema;
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

/// Internal property-test adapters; absent from ordinary dependency builds.
#[cfg(any(test, feature = "__fuzzing"))]
#[doc(hidden)]
pub mod fuzz_support;

/// Human-readable text dump of a module, for debugging and diffing.
#[cfg(feature = "dump")]
pub mod dump;

// Re-exports for convenience
pub use format::{
    IrError, IrHeader, IslandEntry, IslandTrigger, Opcode, SectionDescriptor, SectionTable,
    SlotEntry, SlotSource, SlotType, HEADER_SIZE, IR_VERSION, SECTION_ENTRY_SIZE, SIGNATURE,
    TABLE_PREFIX_SIZE,
};
pub use parser::{IrModule, IslandTableParsed, SlotTable, StringTable};
pub use slot::{json_to_slot_value, SlotData, SlotValue};
pub use walker::{
    walk_to_html, walk_to_html_counted, walk_to_html_with_limits, WalkCounts, WalkFailure,
    WalkLimits, WalkOutput, DEFAULT_MAX_LIST_ITERATIONS, DEFAULT_MAX_OUTPUT_BYTES,
};

// The combined page/fragment corpus has private access to the internal walker.
// No feature exports a fragment renderer to consumers.
#[cfg(test)]
mod js_emitter_contract;
