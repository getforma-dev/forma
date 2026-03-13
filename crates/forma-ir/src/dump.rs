//! Human-readable text dump of an IR module for debugging and diffing.
//!
//! Produces a deterministic, line-oriented representation of the opcode
//! stream that can be compared across builds or used to diagnose hydration
//! mismatches.

use crate::format::Opcode;
use crate::parser::IrModule;
use crate::walker::{read_u16, read_u32, read_tag_with_attrs};
use std::fmt::Write;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Produce a deterministic text dump of an IR module for debugging and diffing.
pub fn dump_ir(module: &IrModule) -> String {
    let mut out = String::with_capacity(module.opcodes.len() * 8);

    // Header line
    writeln!(
        out,
        "FMIR v{}  source_hash={:016x}  strings={}  slots={}  islands={}",
        module.header.version,
        module.header.source_hash,
        module.strings.len(),
        module.slots.len(),
        module.islands.len(),
    )
    .unwrap();

    // Walk opcodes — must advance pos by the same amounts as walker.rs
    let ops = &module.opcodes;
    let strings = &module.strings;
    let len = ops.len();
    let mut pos: usize = 0;

    while pos < len {
        let offset = pos;
        let opcode = match Opcode::from_byte(ops[pos]) {
            Ok(op) => op,
            Err(_) => {
                writeln!(out, "{:04x}: UNKNOWN       0x{:02x}", offset, ops[pos]).unwrap();
                pos += 1;
                continue;
            }
        };
        pos += 1; // advance past opcode byte

        match opcode {
            Opcode::OpenTag => {
                let (tag_str_idx, attrs, new_pos) =
                    match read_tag_with_attrs(ops, pos, strings) {
                        Ok(v) => v,
                        Err(e) => {
                            writeln!(out, "{:04x}: OPEN_TAG      <error: {}>", offset, e).unwrap();
                            break;
                        }
                    };
                let tag = strings.get(tag_str_idx).unwrap_or("?");
                write!(out, "{:04x}: OPEN_TAG      \"{}\" attrs={}", offset, tag, attrs.len())
                    .unwrap();
                if !attrs.is_empty() {
                    write!(out, " [").unwrap();
                    for (i, (key, val)) in attrs.iter().enumerate() {
                        if i > 0 {
                            write!(out, ", ").unwrap();
                        }
                        write!(out, "(\"{}\",\"{}\")", key, val).unwrap();
                    }
                    write!(out, "]").unwrap();
                }
                writeln!(out).unwrap();
                pos = new_pos;
            }

            Opcode::CloseTag => {
                let str_idx = match read_u32(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: CLOSE_TAG     <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 4;
                let tag = strings.get(str_idx).unwrap_or("?");
                writeln!(out, "{:04x}: CLOSE_TAG     \"{}\"", offset, tag).unwrap();
            }

            Opcode::VoidTag => {
                let (tag_str_idx, attrs, new_pos) =
                    match read_tag_with_attrs(ops, pos, strings) {
                        Ok(v) => v,
                        Err(e) => {
                            writeln!(out, "{:04x}: VOID_TAG      <error: {}>", offset, e).unwrap();
                            break;
                        }
                    };
                let tag = strings.get(tag_str_idx).unwrap_or("?");
                write!(out, "{:04x}: VOID_TAG      \"{}\" attrs={}", offset, tag, attrs.len())
                    .unwrap();
                if !attrs.is_empty() {
                    write!(out, " [").unwrap();
                    for (i, (key, val)) in attrs.iter().enumerate() {
                        if i > 0 {
                            write!(out, ", ").unwrap();
                        }
                        write!(out, "(\"{}\",\"{}\")", key, val).unwrap();
                    }
                    write!(out, "]").unwrap();
                }
                writeln!(out).unwrap();
                pos = new_pos;
            }

            Opcode::Text => {
                let str_idx = match read_u32(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: TEXT          <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 4;
                let text = strings.get(str_idx).unwrap_or("?");
                writeln!(out, "{:04x}: TEXT          \"{}\"", offset, text).unwrap();
            }

            Opcode::DynText => {
                // slot_id(u16) + marker_id(u16)
                let slot_id = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: DYN_TEXT      <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                let marker_id = match read_u16(ops, pos + 2) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: DYN_TEXT      <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 4;
                writeln!(
                    out,
                    "{:04x}: DYN_TEXT      slot={} marker=t{}",
                    offset, slot_id, marker_id
                )
                .unwrap();
            }

            Opcode::DynAttr => {
                // attr_str_idx(u32) + slot_id(u16) = 6 bytes
                let attr_str_idx = match read_u32(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: DYN_ATTR      <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                let slot_id = match read_u16(ops, pos + 4) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: DYN_ATTR      <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 6;
                let attr_name = strings.get(attr_str_idx).unwrap_or("?");
                writeln!(
                    out,
                    "{:04x}: DYN_ATTR      \"{}\" slot={}",
                    offset, attr_name, slot_id
                )
                .unwrap();
            }

            Opcode::ShowIf => {
                // slot_id(2) + then_len(4) + else_len(4) = 10 bytes
                let slot_id = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: SHOW_IF       <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                let then_len = match read_u32(ops, pos + 2) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: SHOW_IF       <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                let else_len = match read_u32(ops, pos + 6) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: SHOW_IF       <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 10;
                writeln!(
                    out,
                    "{:04x}: SHOW_IF       slot={} then_len={} else_len={}",
                    offset, slot_id, then_len, else_len
                )
                .unwrap();
            }

            Opcode::ShowElse => {
                // No operands
                writeln!(out, "{:04x}: SHOW_ELSE", offset).unwrap();
            }

            Opcode::Switch => {
                // slot_id(2) + case_count(2) = 4 bytes header
                let slot_id = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: SWITCH        <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                let case_count = match read_u16(ops, pos + 2) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: SWITCH        <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 4;
                // Skip case headers: case_count x (val_str_idx(4) + body_len(4)) = 8 bytes each
                pos += (case_count as usize) * 8;
                writeln!(
                    out,
                    "{:04x}: SWITCH        slot={} cases={}",
                    offset, slot_id, case_count
                )
                .unwrap();
            }

            Opcode::List => {
                // slot_id(2) + item_slot_id(2) + body_len(4) = 8 bytes
                let slot_id = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: LIST          <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                let item_slot_id = match read_u16(ops, pos + 2) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: LIST          <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                let body_len = match read_u32(ops, pos + 4) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: LIST          <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 8;
                writeln!(
                    out,
                    "{:04x}: LIST          slot={} item_slot={} body_len={}",
                    offset, slot_id, item_slot_id, body_len
                )
                .unwrap();
            }

            Opcode::IslandStart => {
                // island_id(u16)
                let island_id = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: ISLAND_START  <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 2;
                writeln!(out, "{:04x}: ISLAND_START  id={}", offset, island_id).unwrap();
            }

            Opcode::IslandEnd => {
                // island_id(u16)
                let island_id = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: ISLAND_END    <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 2;
                writeln!(out, "{:04x}: ISLAND_END    id={}", offset, island_id).unwrap();
            }

            Opcode::TryStart => {
                // fallback_len(4) = 4 bytes
                let fallback_len = match read_u32(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: TRY_START     <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 4;
                writeln!(
                    out,
                    "{:04x}: TRY_START     fallback_len={}",
                    offset, fallback_len
                )
                .unwrap();
            }

            Opcode::Fallback => {
                // No operands
                writeln!(out, "{:04x}: FALLBACK", offset).unwrap();
            }

            Opcode::Preload => {
                // resource_type(1) + url_str_idx(4) = 5 bytes
                let resource_type = ops[pos];
                let url_str_idx = match read_u32(ops, pos + 1) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: PRELOAD       <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 5;
                let url = strings.get(url_str_idx).unwrap_or("?");
                writeln!(
                    out,
                    "{:04x}: PRELOAD       type={} url=\"{}\"",
                    offset, resource_type, url
                )
                .unwrap();
            }

            Opcode::Comment => {
                // str_idx(u32)
                let str_idx = match read_u32(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: COMMENT       <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 4;
                let text = strings.get(str_idx).unwrap_or("?");
                writeln!(out, "{:04x}: COMMENT       \"{}\"", offset, text).unwrap();
            }

            Opcode::ListItemKey => {
                // key_str_idx(u32)
                let str_idx = match read_u32(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: LIST_ITEM_KEY <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 4;
                let key = strings.get(str_idx).unwrap_or("?");
                writeln!(out, "{:04x}: LIST_ITEM_KEY \"{}\"", offset, key).unwrap();
            }

            Opcode::Prop => {
                // src_slot_id(u16) + prop_str_idx(u32) + target_slot_id(u16) = 8 bytes
                let src = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: PROP <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                let prop_idx = match read_u32(ops, pos + 2) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: PROP <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                let target = match read_u16(ops, pos + 6) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: PROP <error: {}>", offset, e).unwrap();
                        break;
                    }
                };
                pos += 8;
                let prop_name = strings.get(prop_idx).unwrap_or("?");
                writeln!(out, "{:04x}: PROP slot[{}].\"{}\" -> slot[{}]", offset, src, prop_name, target).unwrap();
            }
        }
    }

    out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::test_helpers::{
        build_minimal_ir, encode_close_tag, encode_open_tag, encode_text, encode_void_tag,
    };

    // -- Encoding helpers local to dump tests --------------------------------

    /// Encode a DYN_TEXT opcode: opcode(1) + slot_id(2) + marker_id(2)
    fn encode_dyn_text(slot_id: u16, marker_id: u16) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(0x05); // Opcode::DynText
        buf.extend_from_slice(&slot_id.to_le_bytes());
        buf.extend_from_slice(&marker_id.to_le_bytes());
        buf
    }

    /// Helper: build an IrModule from strings/slots/opcodes and dump it.
    fn dump_static(strings: &[&str], opcodes: &[u8]) -> String {
        let data = build_minimal_ir(strings, &[], opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        dump_ir(&module)
    }

    // -- Test 1: dump_static_div --------------------------------------------

    #[test]
    fn dump_static_div() {
        // <div class="container">Hello</div>
        // strings: 0="div", 1="class", 2="container", 3="Hello"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[(1, 2)]));
        opcodes.extend_from_slice(&encode_text(3));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let output = dump_static(&["div", "class", "container", "Hello"], &opcodes);

        assert!(output.contains("OPEN_TAG"), "should contain OPEN_TAG");
        assert!(output.contains("\"div\""), "should contain tag name");
        assert!(output.contains("\"class\""), "should contain attr key");
        assert!(output.contains("\"container\""), "should contain attr val");
        assert!(output.contains("TEXT"), "should contain TEXT");
        assert!(output.contains("\"Hello\""), "should contain text content");
        assert!(output.contains("CLOSE_TAG"), "should contain CLOSE_TAG");
    }

    // -- Test 2: dump_with_dyn_text -----------------------------------------

    #[test]
    fn dump_with_dyn_text() {
        // DYN_TEXT slot=0 marker=t0
        // strings: 0="greeting" (slot name)
        // slot decl: slot_id=0, name_str_idx=0, type=Text(0x01)
        let opcodes = encode_dyn_text(0, 0);

        let data = build_minimal_ir(&["greeting"], &[(0, 0, 0x01, 0x00, &[])], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        let output = dump_ir(&module);

        assert!(output.contains("DYN_TEXT"), "should contain DYN_TEXT");
        assert!(output.contains("slot=0"), "should contain slot=0");
        assert!(output.contains("marker=t0"), "should contain marker=t0");
    }

    // -- Test 3: dump_header_line -------------------------------------------

    #[test]
    fn dump_header_line() {
        let opcodes = encode_text(0);
        let output = dump_static(&["Hello"], &opcodes);

        let first_line = output.lines().next().unwrap();
        assert!(
            first_line.starts_with("FMIR v2"),
            "first line should start with FMIR v2, got: {}",
            first_line
        );
        assert!(
            first_line.contains("source_hash="),
            "first line should contain source_hash="
        );
        assert!(
            first_line.contains("strings="),
            "first line should contain strings="
        );
        assert!(
            first_line.contains("slots="),
            "first line should contain slots="
        );
        assert!(
            first_line.contains("islands="),
            "first line should contain islands="
        );
    }

    // -- Test 4: dump_deterministic -----------------------------------------

    #[test]
    fn dump_deterministic() {
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[(1, 2)]));
        opcodes.extend_from_slice(&encode_text(3));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let data = build_minimal_ir(&["div", "class", "container", "Hello"], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();

        let dump1 = dump_ir(&module);
        let dump2 = dump_ir(&module);

        assert_eq!(dump1, dump2, "same IR dumped twice must produce identical output");
    }

    // -- Test 5: dump_void_tag ----------------------------------------------

    #[test]
    fn dump_void_tag() {
        // <input type="email">
        // strings: 0="input", 1="type", 2="email"
        let opcodes = encode_void_tag(0, &[(1, 2)]);
        let output = dump_static(&["input", "type", "email"], &opcodes);

        assert!(output.contains("VOID_TAG"), "should contain VOID_TAG");
        assert!(output.contains("\"input\""), "should contain tag name");
        assert!(output.contains("\"type\""), "should contain attr key");
        assert!(output.contains("\"email\""), "should contain attr val");
    }
}
