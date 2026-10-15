//! Lossless, deterministic FMIR v3 text representation shared with the compiler.

use crate::parser::IrModule;
use std::fmt::Write;

/// Dump the header and every section, including unknown optional bytes.
///
/// Payload hex is lowercase and contiguous. Every line has a final newline. This
/// representation preserves duplicate strings, flags and island extension bytes,
/// so re-encoding can reproduce the original module exactly.
pub fn dump_ir(module: &IrModule) -> String {
    let mut out = String::new();
    let h = module.header;
    let _ = writeln!(
        out,
        "FMIR v3 writer={}.{}.{} body_len={} crc={:08x}",
        h.writer[0], h.writer[1], h.writer[2], h.body_len, h.crc
    );
    for section in &module.sections.sections {
        let _ = writeln!(
            out,
            "SECTION id={:04x} flags={:04x} offset={} length={}",
            section.id, section.flags, section.offset, section.size
        );
        out.push_str("HEX ");
        let start = section.offset as usize;
        // `IrModule::parse` checked exact tiling; the original byte slice is immutable.
        for b in &module.raw_bytes()[start..start + section.size as usize] {
            let _ = write!(out, "{b:02x}");
        }
        out.push('\n');
    }
    out
}
