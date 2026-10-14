//! Human-readable text dump of an IR module for debugging and diffing.
//!
//! Produces a deterministic, line-oriented representation of the opcode
//! stream that can be compared across builds or used to diagnose hydration
//! mismatches.

use crate::format::Opcode;
use crate::parser::IrModule;
use crate::walker::{read_tag_with_attrs, read_u16, read_u32};
use std::fmt::Write;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Produce a deterministic text dump of an IR module for debugging and diffing.
///
/// Prints the header, the full slot and island tables, then the opcode stream.
/// The tables are there because the drift this tool exists to diagnose lives in
/// them: which slot a name resolves to, and which `slot_ids` an island claims
/// as its props. Printing only counts (which is all it used to do) meant
/// diagnosing a props mismatch required writing a throwaway Rust program.
///
/// Dev-only diagnostic: names are printed raw and the per-byte "UNKNOWN 0x.."
/// fallback is a large text amplifier, so do not point this at hostile input.
///
/// Verified by: crates/forma-ir/src/dump.rs > "dump_shows_slot_and_island_tables"
pub fn dump_ir(module: &IrModule) -> String {
    // Cap the pre-reservation. `saturating_mul` matters only on wasm32 (where
    // `usize` is 32 bits and the multiply can overflow); the `.min` is the
    // part that actually bounds the allocation on 64-bit. 1 MiB keeps the
    // exact estimate for any bytecode section under 128 KiB — every real page.
    let mut out = String::with_capacity(module.opcodes.len().saturating_mul(8).min(1 << 20));
    // `fmt::Write` for `String` never fails, so there is no error to report;
    // the `?`s in `write_dump` keep `unwrap` out of the crate (DR-12).
    let _ = write_dump(module, &mut out);
    out
}

/// The body of [`dump_ir`], writing into `out`.
fn write_dump(module: &IrModule, out: &mut String) -> std::fmt::Result {
    // Header line
    writeln!(
        out,
        "FMIR v{}  source_hash={:016x}  strings={}  slots={}  islands={}",
        module.header.version,
        module.header.source_hash,
        module.strings.len(),
        module.slots.len(),
        module.islands.len(),
    )?;

    // Slot table: id, name, type, source, default.
    for entry in module.slots.entries() {
        let name = module
            .strings
            .get(entry.name_str_idx)
            .unwrap_or("<bad-idx>");
        let default = std::str::from_utf8(&entry.default_bytes).unwrap_or("<non-utf8>");
        writeln!(
            out,
            "SLOT  {:>5}  {:<28}  {:?}/{:?}  default={:?}",
            entry.slot_id, name, entry.type_hint, entry.source, default,
        )?;
    }

    // Island table: id, name, trigger, props mode, byte offset, prop slots.
    for entry in module.islands.entries() {
        let name = module
            .strings
            .get(entry.name_str_idx)
            .unwrap_or("<bad-idx>");
        writeln!(
            out,
            "ISLE  {:>5}  {:<28}  {:?}/{:?}  at=0x{:04x}  slot_ids={:?}",
            entry.id, name, entry.trigger, entry.props_mode, entry.byte_offset, entry.slot_ids,
        )?;
    }

    // Walk opcodes — this is a SECOND decoder of the same operand widths, and
    // it must advance `pos` by exactly the amounts walker.rs does. The two are
    // cross-checked by `dump_agrees_with_the_walker_on_operand_widths`, which
    // asserts that a stream the walker renders successfully leaves no UNKNOWN
    // line here: an operand-width disagreement desynchronises this loop and
    // makes it decode an operand byte as an opcode.
    let ops = &module.opcodes;
    let strings = &module.strings;
    let len = ops.len();
    let mut pos: usize = 0;

    while pos < len {
        let offset = pos;
        let opcode = match Opcode::from_byte(ops[pos]) {
            Ok(op) => op,
            Err(_) => {
                writeln!(out, "{:04x}: UNKNOWN       0x{:02x}", offset, ops[pos])?;
                pos += 1;
                continue;
            }
        };
        pos += 1; // advance past opcode byte

        match opcode {
            Opcode::OpenTag => {
                let (tag_str_idx, attrs, new_pos) = match read_tag_with_attrs(ops, pos, strings) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: OPEN_TAG      <error: {}>", offset, e)?;
                        break;
                    }
                };
                let tag = strings.get(tag_str_idx).unwrap_or("?");
                write!(
                    out,
                    "{:04x}: OPEN_TAG      \"{}\" attrs={}",
                    offset,
                    tag,
                    attrs.len()
                )?;
                if !attrs.is_empty() {
                    write!(out, " [")?;
                    for (i, (key, val)) in attrs.iter().enumerate() {
                        if i > 0 {
                            write!(out, ", ")?;
                        }
                        write!(out, "(\"{}\",\"{}\")", key, val)?;
                    }
                    write!(out, "]")?;
                }
                writeln!(out)?;
                pos = new_pos;
            }

            Opcode::CloseTag => {
                let str_idx = match read_u32(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: CLOSE_TAG     <error: {}>", offset, e)?;
                        break;
                    }
                };
                pos += 4;
                let tag = strings.get(str_idx).unwrap_or("?");
                writeln!(out, "{:04x}: CLOSE_TAG     \"{}\"", offset, tag)?;
            }

            Opcode::VoidTag => {
                let (tag_str_idx, attrs, new_pos) = match read_tag_with_attrs(ops, pos, strings) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: VOID_TAG      <error: {}>", offset, e)?;
                        break;
                    }
                };
                let tag = strings.get(tag_str_idx).unwrap_or("?");
                write!(
                    out,
                    "{:04x}: VOID_TAG      \"{}\" attrs={}",
                    offset,
                    tag,
                    attrs.len()
                )?;
                if !attrs.is_empty() {
                    write!(out, " [")?;
                    for (i, (key, val)) in attrs.iter().enumerate() {
                        if i > 0 {
                            write!(out, ", ")?;
                        }
                        write!(out, "(\"{}\",\"{}\")", key, val)?;
                    }
                    write!(out, "]")?;
                }
                writeln!(out)?;
                pos = new_pos;
            }

            Opcode::Text => {
                let str_idx = match read_u32(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: TEXT          <error: {}>", offset, e)?;
                        break;
                    }
                };
                pos += 4;
                let text = strings.get(str_idx).unwrap_or("?");
                writeln!(out, "{:04x}: TEXT          \"{}\"", offset, text)?;
            }

            Opcode::DynText => {
                // slot_id(u16) + marker_id(u16)
                let slot_id = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: DYN_TEXT      <error: {}>", offset, e)?;
                        break;
                    }
                };
                let marker_id = match read_u16(ops, pos + 2) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: DYN_TEXT      <error: {}>", offset, e)?;
                        break;
                    }
                };
                pos += 4;
                writeln!(
                    out,
                    "{:04x}: DYN_TEXT      slot={} marker=t{}",
                    offset, slot_id, marker_id
                )?;
            }

            Opcode::DynAttr => {
                // attr_str_idx(u32) + slot_id(u16) = 6 bytes
                let attr_str_idx = match read_u32(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: DYN_ATTR      <error: {}>", offset, e)?;
                        break;
                    }
                };
                let slot_id = match read_u16(ops, pos + 4) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: DYN_ATTR      <error: {}>", offset, e)?;
                        break;
                    }
                };
                pos += 6;
                let attr_name = strings.get(attr_str_idx).unwrap_or("?");
                writeln!(
                    out,
                    "{:04x}: DYN_ATTR      \"{}\" slot={}",
                    offset, attr_name, slot_id
                )?;
            }

            Opcode::ShowIf => {
                // slot_id(2) + then_len(4) + else_len(4) = 10 bytes
                let slot_id = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: SHOW_IF       <error: {}>", offset, e)?;
                        break;
                    }
                };
                let then_len = match read_u32(ops, pos + 2) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: SHOW_IF       <error: {}>", offset, e)?;
                        break;
                    }
                };
                let else_len = match read_u32(ops, pos + 6) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: SHOW_IF       <error: {}>", offset, e)?;
                        break;
                    }
                };
                pos += 10;
                writeln!(
                    out,
                    "{:04x}: SHOW_IF       slot={} then_len={} else_len={}",
                    offset, slot_id, then_len, else_len
                )?;
            }

            Opcode::ShowElse => {
                // No operands
                writeln!(out, "{:04x}: SHOW_ELSE", offset)?;
            }

            Opcode::Switch => {
                // slot_id(2) + case_count(2) = 4 bytes header
                let slot_id = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: SWITCH        <error: {}>", offset, e)?;
                        break;
                    }
                };
                let case_count = match read_u16(ops, pos + 2) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: SWITCH        <error: {}>", offset, e)?;
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
                )?;
            }

            Opcode::List => {
                // slot_id(2) + item_slot_id(2) + body_len(4) = 8 bytes
                let slot_id = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: LIST          <error: {}>", offset, e)?;
                        break;
                    }
                };
                let item_slot_id = match read_u16(ops, pos + 2) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: LIST          <error: {}>", offset, e)?;
                        break;
                    }
                };
                let body_len = match read_u32(ops, pos + 4) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: LIST          <error: {}>", offset, e)?;
                        break;
                    }
                };
                pos += 8;
                writeln!(
                    out,
                    "{:04x}: LIST          slot={} item_slot={} body_len={}",
                    offset, slot_id, item_slot_id, body_len
                )?;
            }

            Opcode::IslandStart => {
                // island_id(u16)
                let island_id = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: ISLAND_START  <error: {}>", offset, e)?;
                        break;
                    }
                };
                pos += 2;
                writeln!(out, "{:04x}: ISLAND_START  id={}", offset, island_id)?;
            }

            Opcode::IslandEnd => {
                // island_id(u16)
                let island_id = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: ISLAND_END    <error: {}>", offset, e)?;
                        break;
                    }
                };
                pos += 2;
                writeln!(out, "{:04x}: ISLAND_END    id={}", offset, island_id)?;
            }

            Opcode::TryStart => {
                // fallback_len(4) = 4 bytes
                let fallback_len = match read_u32(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: TRY_START     <error: {}>", offset, e)?;
                        break;
                    }
                };
                pos += 4;
                writeln!(
                    out,
                    "{:04x}: TRY_START     fallback_len={}",
                    offset, fallback_len
                )?;
            }

            Opcode::Fallback => {
                // No operands
                writeln!(out, "{:04x}: FALLBACK", offset)?;
            }

            Opcode::Preload => {
                // resource_type(1) + url_str_idx(4) = 5 bytes
                if pos >= ops.len() {
                    writeln!(
                        out,
                        "{:04x}: PRELOAD       <error: buffer too short>",
                        offset
                    )?;
                    break;
                }
                let resource_type = ops[pos];
                let url_str_idx = match read_u32(ops, pos + 1) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: PRELOAD       <error: {}>", offset, e)?;
                        break;
                    }
                };
                pos += 5;
                let url = strings.get(url_str_idx).unwrap_or("?");
                writeln!(
                    out,
                    "{:04x}: PRELOAD       type={} url=\"{}\"",
                    offset, resource_type, url
                )?;
            }

            Opcode::Comment => {
                // str_idx(u32)
                let str_idx = match read_u32(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: COMMENT       <error: {}>", offset, e)?;
                        break;
                    }
                };
                pos += 4;
                let text = strings.get(str_idx).unwrap_or("?");
                writeln!(out, "{:04x}: COMMENT       \"{}\"", offset, text)?;
            }

            Opcode::ListItemKey => {
                // key_str_idx(u32)
                let str_idx = match read_u32(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: LIST_ITEM_KEY <error: {}>", offset, e)?;
                        break;
                    }
                };
                pos += 4;
                let key = strings.get(str_idx).unwrap_or("?");
                writeln!(out, "{:04x}: LIST_ITEM_KEY \"{}\"", offset, key)?;
            }

            Opcode::Prop => {
                // src_slot_id(u16) + prop_str_idx(u32) + target_slot_id(u16) = 8 bytes
                let src = match read_u16(ops, pos) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: PROP <error: {}>", offset, e)?;
                        break;
                    }
                };
                let prop_idx = match read_u32(ops, pos + 2) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: PROP <error: {}>", offset, e)?;
                        break;
                    }
                };
                let target = match read_u16(ops, pos + 6) {
                    Ok(v) => v,
                    Err(e) => {
                        writeln!(out, "{:04x}: PROP <error: {}>", offset, e)?;
                        break;
                    }
                };
                pos += 8;
                let prop_name = strings.get(prop_idx).unwrap_or("?");
                writeln!(
                    out,
                    "{:04x}: PROP slot[{}].\"{}\" -> slot[{}]",
                    offset, src, prop_name, target
                )?;
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::test_helpers::{
        build_minimal_ir, encode_close_tag, encode_list, encode_open_tag, encode_preload,
        encode_show_if, encode_switch, encode_text, encode_try, encode_void_tag,
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

        assert_eq!(
            dump1, dump2,
            "same IR dumped twice must produce identical output"
        );
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

    // -- Test 6: slot and island tables --------------------------------------

    #[test]
    fn dump_shows_slot_and_island_tables() {
        // The drift this tool exists to diagnose — which slot a name resolves
        // to, and which slots an island claims as props — used to be invisible
        // here: the dump printed `slots=2 islands=1` and nothing else.
        let mut opcodes = encode_island_start(0);
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let data = build_minimal_ir(
            &["div", "Counter", "list:items:array", "text:0"],
            &[(7, 2, 0x04, 0x00, b"[]"), (9, 3, 0x01, 0x01, b"hello")],
            &opcodes,
            &[(0, 0x02, 0x01, 1, 0, &[7, 9])],
        );
        let module = IrModule::parse(&data).unwrap();
        let output = dump_ir(&module);

        assert!(
            output.contains(
                r#"SLOT      7  list:items:array              Array/Server  default="[]""#
            ),
            "slot table missing or mis-rendered:\n{output}"
        );
        assert!(
            output.contains(
                r#"SLOT      9  text:0                        Text/Client  default="hello""#
            ),
            "client slot with default missing:\n{output}"
        );
        assert!(
            output.contains("ISLE      0  Counter                       Visible/Inline  at=0x0000  slot_ids=[7, 9]"),
            "island table missing its trigger/props_mode/slot_ids:\n{output}"
        );
    }

    // -- Test 7: cross-check against the walker's decoder ---------------------

    #[test]
    fn dump_agrees_with_the_walker_on_operand_widths() {
        // dump.rs re-implements the whole operand-width table independently of
        // walker.rs. Nothing used to check that they agree, so a new opcode or
        // a changed operand could desynchronise this loop into decoding an
        // operand byte as an opcode — and the tool you reach for when the IR
        // looks wrong would itself be lying.
        //
        // A stream the walker renders end to end is by construction correctly
        // tiled, so an UNKNOWN line here can only mean the two decoders differ.
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[(1, 2)]));
        opcodes.extend_from_slice(&encode_text(3));
        opcodes.extend_from_slice(&encode_dyn_text(0, 0));
        opcodes.extend_from_slice(&encode_dyn_attr(1, 1));
        opcodes.extend_from_slice(&encode_comment(3));
        opcodes.extend_from_slice(&encode_show_if(1, &encode_text(3), &encode_text(0)));
        opcodes.extend_from_slice(&encode_switch(0, &[(3, &encode_text(3))]));
        opcodes.extend_from_slice(&encode_list_item_key(3));
        opcodes.extend_from_slice(&encode_prop(2, 3, 0));
        opcodes.extend_from_slice(&encode_list(2, 0, &encode_dyn_text(0, 1)));
        opcodes.extend_from_slice(&encode_try(&encode_text(3), &encode_text(0)));
        opcodes.extend_from_slice(&encode_preload(1, 3));
        opcodes.extend_from_slice(&encode_void_tag(0, &[]));
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let island_offset = (opcodes.len()
            - encode_island_start(0).len()
            - encode_open_tag(0, &[]).len()
            - encode_close_tag(0).len()
            - encode_island_end(0).len()
            - encode_close_tag(0).len()) as u32;

        let data = build_minimal_ir(
            &["div", "class", "container", "Hello"],
            &[
                (0, 3, 0x01, 0x00, b""),
                (1, 3, 0x02, 0x00, b"true"),
                (2, 3, 0x04, 0x00, b"[]"),
            ],
            &opcodes,
            &[(0, 0x01, 0x01, 0, island_offset, &[0])],
        );
        let module = IrModule::parse(&data).unwrap();

        // The walker accepts it...
        let slots = crate::slot::SlotData::new_from_defaults(&module.slots);
        crate::walker::walk_to_html(&module, &slots).expect("walker must render this stream");

        // ...so the dump must decode every byte of it.
        let output = dump_ir(&module);
        assert!(
            !output.contains("UNKNOWN"),
            "dump.rs and walker.rs disagree on an operand width:\n{output}"
        );
        assert!(
            !output.contains("<error:"),
            "dump.rs failed to decode a stream the walker rendered:\n{output}"
        );
    }

    fn encode_comment(str_idx: u32) -> Vec<u8> {
        let mut b = vec![0x10];
        b.extend_from_slice(&str_idx.to_le_bytes());
        b
    }

    fn encode_dyn_attr(attr_str_idx: u32, slot_id: u16) -> Vec<u8> {
        let mut b = vec![0x06];
        b.extend_from_slice(&attr_str_idx.to_le_bytes());
        b.extend_from_slice(&slot_id.to_le_bytes());
        b
    }

    fn encode_list_item_key(key_str_idx: u32) -> Vec<u8> {
        let mut b = vec![0x11];
        b.extend_from_slice(&key_str_idx.to_le_bytes());
        b
    }

    fn encode_prop(src: u16, prop_str_idx: u32, target: u16) -> Vec<u8> {
        let mut b = vec![0x12];
        b.extend_from_slice(&src.to_le_bytes());
        b.extend_from_slice(&prop_str_idx.to_le_bytes());
        b.extend_from_slice(&target.to_le_bytes());
        b
    }

    fn encode_island_start(island_id: u16) -> Vec<u8> {
        let mut b = vec![0x0B];
        b.extend_from_slice(&island_id.to_le_bytes());
        b
    }

    fn encode_island_end(island_id: u16) -> Vec<u8> {
        let mut b = vec![0x0C];
        b.extend_from_slice(&island_id.to_le_bytes());
        b
    }
}
