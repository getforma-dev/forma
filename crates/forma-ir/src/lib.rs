//! Forma Module IR: binary format definitions and parsers.
//!
//! This crate provides the core IR types and parsing logic that can be compiled
//! to both native Rust and WebAssembly targets.

#![allow(clippy::type_complexity)]

pub mod format;
pub mod parser;
pub mod slot;
pub mod walker;

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
pub use walker::{walk_island, walk_to_html};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// Full page render: parse IR bytes + JSON slots → HTML string.
/// Panics on error (throws JS exception in WASM — client loader catches and falls back).
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn render(ir_bytes: &[u8], slots_json: &str) -> String {
    let module = parser::IrModule::parse(ir_bytes)
        .unwrap_or_else(|e| panic!("IR parse: {e}"));
    let slots = slot::SlotData::from_json(slots_json, &module)
        .unwrap_or_else(|e| panic!("slots: {e}"));
    walker::walk_to_html(&module, &slots)
        .unwrap_or_else(|e| panic!("walk: {e}"))
}

/// Fragment render: parse IR bytes + JSON slots → island inner HTML.
/// Panics on error (throws JS exception in WASM — client loader catches and falls back).
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn render_island(ir_bytes: &[u8], slots_json: &str, island_id: u16) -> String {
    let module = parser::IrModule::parse(ir_bytes)
        .unwrap_or_else(|e| panic!("IR parse: {e}"));
    let slots = slot::SlotData::from_json(slots_json, &module)
        .unwrap_or_else(|e| panic!("slots: {e}"));
    walker::walk_island(&module, &slots, island_id)
        .unwrap_or_else(|e| panic!("walk island: {e}"))
}
