//! Parsers for FMIR data tables: string table, slot table, and island table.
//!
//! Each parser consumes a byte slice containing exactly one section's data
//! and returns a typed, indexed collection.

use crate::format::{
    IrError, IrHeader, IslandEntry, IslandTrigger, PropsMode, SectionTable, SlotEntry, SlotSource,
    SlotType, HEADER_SIZE, SECTION_TABLE_SIZE,
};

// ---------------------------------------------------------------------------
// StringTable
// ---------------------------------------------------------------------------

/// Parsed string table — an indexed collection of UTF-8 strings.
///
/// Binary format: `count(u32)`, then `count` entries of `[len(u16), bytes([u8; len])]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StringTable {
    strings: Vec<String>,
}

impl StringTable {
    /// Parse a string table from its section data.
    pub fn parse(data: &[u8]) -> Result<Self, IrError> {
        if data.len() < 4 {
            return Err(IrError::BufferTooShort {
                expected: 4,
                actual: data.len(),
            });
        }

        let count = u32::from_le_bytes(data[0..4].try_into().unwrap()) as usize;
        if count > data.len() {
            return Err(IrError::BufferTooShort {
                expected: count,
                actual: data.len(),
            });
        }
        let mut offset = 4;
        let mut strings = Vec::with_capacity(count);

        for _ in 0..count {
            // Need at least 2 bytes for the length prefix.
            if offset + 2 > data.len() {
                return Err(IrError::BufferTooShort {
                    expected: offset + 2,
                    actual: data.len(),
                });
            }

            let str_len = u16::from_le_bytes(data[offset..offset + 2].try_into().unwrap()) as usize;
            offset += 2;

            if offset + str_len > data.len() {
                return Err(IrError::BufferTooShort {
                    expected: offset + str_len,
                    actual: data.len(),
                });
            }

            let s = std::str::from_utf8(&data[offset..offset + str_len])
                .map_err(|e| IrError::InvalidUtf8(e.to_string()))?;
            strings.push(s.to_owned());
            offset += str_len;
        }

        Ok(StringTable { strings })
    }

    /// O(1) indexed lookup into the string table.
    pub fn get(&self, idx: u32) -> Result<&str, IrError> {
        self.strings
            .get(idx as usize)
            .map(|s| s.as_str())
            .ok_or(IrError::StringIndexOutOfBounds {
                index: idx,
                len: self.strings.len(),
            })
    }

    /// Number of strings in the table.
    pub fn len(&self) -> usize {
        self.strings.len()
    }

    /// Returns true if the string table is empty.
    pub fn is_empty(&self) -> bool {
        self.strings.is_empty()
    }
}

// ---------------------------------------------------------------------------
// SlotTable
// ---------------------------------------------------------------------------

/// Parsed slot table — an indexed collection of slot entries.
///
/// Binary format (v2): `count(u16)`, then `count` variable-length entries of
/// `[slot_id(u16), name_str_idx(u32), type_hint(u8), source(u8), default_len(u16), default_bytes([u8; default_len])]`.
/// Minimum entry size: 10 bytes (when default_len = 0).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlotTable {
    slots: Vec<SlotEntry>,
}

/// Minimum size of a single v2 slot entry in bytes (without default data).
/// slot_id(2) + name_str_idx(4) + type_hint(1) + source(1) + default_len(2) = 10
const SLOT_ENTRY_MIN_SIZE: usize = 10;

impl SlotTable {
    /// Parse a slot table from its section data.
    pub fn parse(data: &[u8]) -> Result<Self, IrError> {
        if data.len() < 2 {
            return Err(IrError::BufferTooShort {
                expected: 2,
                actual: data.len(),
            });
        }

        let count = u16::from_le_bytes(data[0..2].try_into().unwrap()) as usize;
        let mut slots = Vec::with_capacity(count);
        let mut offset = 2;

        for _ in 0..count {
            // Check minimum entry size
            if offset + SLOT_ENTRY_MIN_SIZE > data.len() {
                return Err(IrError::BufferTooShort {
                    expected: offset + SLOT_ENTRY_MIN_SIZE,
                    actual: data.len(),
                });
            }

            let slot_id = u16::from_le_bytes(data[offset..offset + 2].try_into().unwrap());
            let name_str_idx = u32::from_le_bytes(data[offset + 2..offset + 6].try_into().unwrap());
            let type_hint = SlotType::from_byte(data[offset + 6])?;
            let source = SlotSource::from_byte(data[offset + 7])?;
            let default_len =
                u16::from_le_bytes(data[offset + 8..offset + 10].try_into().unwrap()) as usize;
            offset += SLOT_ENTRY_MIN_SIZE;

            // Read default bytes
            if offset + default_len > data.len() {
                return Err(IrError::BufferTooShort {
                    expected: offset + default_len,
                    actual: data.len(),
                });
            }
            let default_bytes = data[offset..offset + default_len].to_vec();
            offset += default_len;

            slots.push(SlotEntry {
                slot_id,
                name_str_idx,
                type_hint,
                source,
                default_bytes,
            });
        }

        Ok(SlotTable { slots })
    }

    /// Number of slots in the table.
    pub fn len(&self) -> usize {
        self.slots.len()
    }

    /// Returns true if the slot table is empty.
    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    /// Access the underlying slot entries.
    pub fn entries(&self) -> &[SlotEntry] {
        &self.slots
    }
}

// ---------------------------------------------------------------------------
// IslandTableParsed
// ---------------------------------------------------------------------------

/// Parsed island table — an indexed collection of island entries.
///
/// Binary format: `count(u16)`, then `count` variable-length entries of
/// `[id(u16), trigger(u8), props_mode(u8), name_str_idx(u32), byte_offset(u32), slot_count(u16), [slot_id(u16) x slot_count]]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IslandTableParsed {
    islands: Vec<IslandEntry>,
}

/// Minimum size of a single island entry in bytes (without slot_ids).
/// id(2) + trigger(1) + props_mode(1) + name_str_idx(4) + byte_offset(4) + slot_count(2) = 14
const ISLAND_ENTRY_MIN_SIZE: usize = 14;

impl IslandTableParsed {
    /// Parse an island table from its section data.
    pub fn parse(data: &[u8]) -> Result<Self, IrError> {
        if data.len() < 2 {
            return Err(IrError::BufferTooShort {
                expected: 2,
                actual: data.len(),
            });
        }

        let count = u16::from_le_bytes(data[0..2].try_into().unwrap()) as usize;
        let mut islands = Vec::with_capacity(count);
        let mut offset = 2;

        for _ in 0..count {
            // Minimum: id(2) + trigger(1) + props_mode(1) + name_str_idx(4) + byte_offset(4) + slot_count(2) = 14
            if offset + ISLAND_ENTRY_MIN_SIZE > data.len() {
                return Err(IrError::BufferTooShort {
                    expected: offset + ISLAND_ENTRY_MIN_SIZE,
                    actual: data.len(),
                });
            }

            let id = u16::from_le_bytes(data[offset..offset + 2].try_into().unwrap());
            let trigger = IslandTrigger::from_byte(data[offset + 2])?;
            let props_mode = PropsMode::from_byte(data[offset + 3])?;
            let name_str_idx = u32::from_le_bytes(data[offset + 4..offset + 8].try_into().unwrap());
            let byte_offset = u32::from_le_bytes(data[offset + 8..offset + 12].try_into().unwrap());
            let slot_count =
                u16::from_le_bytes(data[offset + 12..offset + 14].try_into().unwrap()) as usize;
            offset += ISLAND_ENTRY_MIN_SIZE;

            // Read slot_ids
            let needed = slot_count * 2;
            if offset + needed > data.len() {
                return Err(IrError::BufferTooShort {
                    expected: offset + needed,
                    actual: data.len(),
                });
            }
            let mut slot_ids = Vec::with_capacity(slot_count);
            for _ in 0..slot_count {
                slot_ids.push(u16::from_le_bytes(
                    data[offset..offset + 2].try_into().unwrap(),
                ));
                offset += 2;
            }

            islands.push(IslandEntry {
                id,
                trigger,
                props_mode,
                name_str_idx,
                byte_offset,
                slot_ids,
            });
        }

        Ok(IslandTableParsed { islands })
    }

    /// Number of islands in the table.
    pub fn len(&self) -> usize {
        self.islands.len()
    }

    /// Returns true if the island table is empty.
    pub fn is_empty(&self) -> bool {
        self.islands.is_empty()
    }

    /// Access the underlying island entries.
    pub fn entries(&self) -> &[IslandEntry] {
        &self.islands
    }
}

// ---------------------------------------------------------------------------
// IrModule — full-file parser
// ---------------------------------------------------------------------------

/// A fully parsed and validated IR module, ready for walking.
#[derive(Debug, Clone)]
pub struct IrModule {
    pub header: IrHeader,
    pub strings: StringTable,
    pub slots: SlotTable,
    /// Raw opcode stream; the walker interprets it on the fly.
    pub opcodes: Vec<u8>,
    pub islands: IslandTableParsed,
}

impl IrModule {
    /// Parse a complete FMIR binary into a validated `IrModule`.
    pub fn parse(data: &[u8]) -> Result<Self, IrError> {
        // 1. Parse header (first 16 bytes).
        let header = IrHeader::parse(data)?;

        // 2. Parse section table (next 32 bytes, starting at HEADER_SIZE).
        if data.len() < HEADER_SIZE + SECTION_TABLE_SIZE {
            return Err(IrError::BufferTooShort {
                expected: HEADER_SIZE + SECTION_TABLE_SIZE,
                actual: data.len(),
            });
        }
        let section_table = SectionTable::parse(&data[HEADER_SIZE..])?;

        // 3. Validate all section bounds against the file length.
        section_table.validate(data.len())?;

        // Section indices: 0=Bytecode, 1=Strings, 2=Slots, 3=Islands
        let sec_bytecode = &section_table.sections[0];
        let sec_strings = &section_table.sections[1];
        let sec_slots = &section_table.sections[2];
        let sec_islands = &section_table.sections[3];

        // 4. Parse string table.
        let string_data = &data[sec_strings.offset as usize
            ..(sec_strings.offset as usize + sec_strings.size as usize)];
        let strings = StringTable::parse(string_data)?;

        // 5. Parse slot table.
        let slot_data =
            &data[sec_slots.offset as usize..(sec_slots.offset as usize + sec_slots.size as usize)];
        let slots = SlotTable::parse(slot_data)?;

        // 6. Extract opcode stream (just clone into Vec<u8>).
        let opcodes = data[sec_bytecode.offset as usize
            ..(sec_bytecode.offset as usize + sec_bytecode.size as usize)]
            .to_vec();

        // 7. Parse island table.
        let island_data = &data[sec_islands.offset as usize
            ..(sec_islands.offset as usize + sec_islands.size as usize)];
        let islands = IslandTableParsed::parse(island_data)?;

        let module = IrModule {
            header,
            strings,
            slots,
            opcodes,
            islands,
        };

        // 8. Run cross-table validation.
        module.validate()?;

        Ok(module)
    }

    /// Validate cross-table references within the module.
    pub fn validate(&self) -> Result<(), IrError> {
        let str_count = self.strings.len();

        // Validate all slot name_str_idx values are within string table bounds.
        for slot in self.slots.entries() {
            if slot.name_str_idx as usize >= str_count {
                return Err(IrError::StringIndexOutOfBounds {
                    index: slot.name_str_idx,
                    len: str_count,
                });
            }
        }

        // Validate all island name_str_idx values are within string table bounds.
        for island in self.islands.entries() {
            if island.name_str_idx as usize >= str_count {
                return Err(IrError::StringIndexOutOfBounds {
                    index: island.name_str_idx,
                    len: str_count,
                });
            }
        }

        Ok(())
    }

    /// Look up a slot ID by its name. Returns `None` if no slot with that name exists.
    pub fn slot_id_by_name(&self, name: &str) -> Option<u16> {
        for slot in self.slots.entries() {
            if let Ok(slot_name) = self.strings.get(slot.name_str_idx) {
                if slot_name == name {
                    return Some(slot.slot_id);
                }
            }
        }
        None
    }
}

// ---------------------------------------------------------------------------
// Test helpers — always compiled so external crates can use them in tests.
// ---------------------------------------------------------------------------

/// Binary encoding helpers for building FMIR test data.
///
/// These are always compiled (not behind `#[cfg(test)]`) so that other crates
/// (e.g., `forma-server`) can use them in their own tests
/// via `forma_ir::parser::test_helpers::build_minimal_ir`.
pub mod test_helpers {
    use crate::format::{HEADER_SIZE, SECTION_TABLE_SIZE};

    /// Build valid string table binary data from a slice of strings.
    pub fn build_string_table(strings: &[&str]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&(strings.len() as u32).to_le_bytes());
        for s in strings {
            let bytes = s.as_bytes();
            buf.extend_from_slice(&(bytes.len() as u16).to_le_bytes());
            buf.extend_from_slice(bytes);
        }
        buf
    }

    /// Build valid v2 slot table binary data from a slice of
    /// (slot_id, name_str_idx, type_hint_byte, source_byte, default_bytes).
    pub fn build_slot_table(entries: &[(u16, u32, u8, u8, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        for &(slot_id, name_str_idx, type_hint, source, default_bytes) in entries {
            buf.extend_from_slice(&slot_id.to_le_bytes());
            buf.extend_from_slice(&name_str_idx.to_le_bytes());
            buf.push(type_hint);
            buf.push(source);
            buf.extend_from_slice(&(default_bytes.len() as u16).to_le_bytes());
            buf.extend_from_slice(default_bytes);
        }
        buf
    }

    /// Build valid island table binary data with slot_ids support.
    ///
    /// Tuple: `(id, trigger, props_mode, name_str_idx, byte_offset, slot_ids)`
    pub fn build_island_table(entries: &[(u16, u8, u8, u32, u32, &[u16])]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        for &(id, trigger, props_mode, name_str_idx, byte_offset, slot_ids) in entries {
            buf.extend_from_slice(&id.to_le_bytes());
            buf.push(trigger);
            buf.push(props_mode);
            buf.extend_from_slice(&name_str_idx.to_le_bytes());
            buf.extend_from_slice(&byte_offset.to_le_bytes());
            buf.extend_from_slice(&(slot_ids.len() as u16).to_le_bytes());
            for &slot_id in slot_ids.iter() {
                buf.extend_from_slice(&slot_id.to_le_bytes());
            }
        }
        buf
    }

    // -- Opcode encoding helpers --------------------------------------------

    /// Encode an OPEN_TAG opcode: opcode(1) + str_idx(4) + attr_count(2) + [(key(4), val(4))]
    pub fn encode_open_tag(str_idx: u32, attrs: &[(u32, u32)]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(0x01); // Opcode::OpenTag
        buf.extend_from_slice(&str_idx.to_le_bytes());
        buf.extend_from_slice(&(attrs.len() as u16).to_le_bytes());
        for &(key_idx, val_idx) in attrs {
            buf.extend_from_slice(&key_idx.to_le_bytes());
            buf.extend_from_slice(&val_idx.to_le_bytes());
        }
        buf
    }

    /// Encode a CLOSE_TAG opcode: opcode(1) + str_idx(4)
    pub fn encode_close_tag(str_idx: u32) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(0x02); // Opcode::CloseTag
        buf.extend_from_slice(&str_idx.to_le_bytes());
        buf
    }

    /// Encode a VOID_TAG opcode: opcode(1) + str_idx(4) + attr_count(2) + [(key(4), val(4))]
    pub fn encode_void_tag(str_idx: u32, attrs: &[(u32, u32)]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(0x03); // Opcode::VoidTag
        buf.extend_from_slice(&str_idx.to_le_bytes());
        buf.extend_from_slice(&(attrs.len() as u16).to_le_bytes());
        for &(key_idx, val_idx) in attrs {
            buf.extend_from_slice(&key_idx.to_le_bytes());
            buf.extend_from_slice(&val_idx.to_le_bytes());
        }
        buf
    }

    /// Encode a TEXT opcode: opcode(1) + str_idx(4)
    pub fn encode_text(str_idx: u32) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(0x04); // Opcode::Text
        buf.extend_from_slice(&str_idx.to_le_bytes());
        buf
    }

    /// Encode a SHOW_IF opcode with then/else branches.
    ///
    /// Binary layout:
    /// ```text
    /// [SHOW_IF(0x07)] [slot_id(u16)] [then_len(u32)] [else_len(u32)]
    /// [then_ops bytes...] [SHOW_ELSE(0x08)] [else_ops bytes...]
    /// ```
    pub fn encode_show_if(slot_id: u16, then_ops: &[u8], else_ops: &[u8]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(0x07); // Opcode::ShowIf
        buf.extend_from_slice(&slot_id.to_le_bytes());
        buf.extend_from_slice(&(then_ops.len() as u32).to_le_bytes());
        buf.extend_from_slice(&(else_ops.len() as u32).to_le_bytes());
        buf.extend_from_slice(then_ops); // then branch body
        buf.push(0x08); // SHOW_ELSE marker
        buf.extend_from_slice(else_ops); // else branch body
        buf
    }

    /// Encode a LIST opcode: opcode(1) + slot_id(2) + item_slot_id(2) + body_len(4) + body
    pub fn encode_list(slot_id: u16, item_slot_id: u16, body_ops: &[u8]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(0x0A); // Opcode::List
        buf.extend_from_slice(&slot_id.to_le_bytes());
        buf.extend_from_slice(&item_slot_id.to_le_bytes());
        buf.extend_from_slice(&(body_ops.len() as u32).to_le_bytes());
        buf.extend_from_slice(body_ops);
        buf
    }

    /// Encode a SWITCH opcode with case headers and bodies.
    ///
    /// Binary layout:
    /// ```text
    /// [SWITCH(0x09)] [slot_id(u16)] [case_count(u16)]
    /// [val_str_idx(u32) body_len(u32)] x case_count   -- case headers
    /// [...body opcodes for case 0...]
    /// [...body opcodes for case 1...]
    /// ...
    /// ```
    pub fn encode_switch(slot_id: u16, cases: &[(u32, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(0x09); // Opcode::Switch
        buf.extend_from_slice(&slot_id.to_le_bytes());
        buf.extend_from_slice(&(cases.len() as u16).to_le_bytes());
        // Case headers
        for (val_str_idx, body) in cases {
            buf.extend_from_slice(&val_str_idx.to_le_bytes());
            buf.extend_from_slice(&(body.len() as u32).to_le_bytes());
        }
        // Case bodies
        for (_, body) in cases {
            buf.extend_from_slice(body);
        }
        buf
    }

    /// Encode a TRY_START/FALLBACK block.
    ///
    /// Binary layout:
    /// ```text
    /// [TRY_START(0x0D)] [fallback_len(u32)]
    /// [...main_ops...]
    /// [FALLBACK(0x0E)]
    /// [...fallback_ops...]
    /// ```
    pub fn encode_try(main_ops: &[u8], fallback_ops: &[u8]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(0x0D); // Opcode::TryStart
        buf.extend_from_slice(&(fallback_ops.len() as u32).to_le_bytes());
        buf.extend_from_slice(main_ops);
        buf.push(0x0E); // Opcode::Fallback
        buf.extend_from_slice(fallback_ops);
        buf
    }

    /// Encode a PRELOAD opcode: opcode(1) + resource_type(1) + url_str_idx(4)
    pub fn encode_preload(resource_type: u8, url_str_idx: u32) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(0x0F); // Opcode::Preload
        buf.push(resource_type);
        buf.extend_from_slice(&url_str_idx.to_le_bytes());
        buf
    }

    // -- Full-file builder --------------------------------------------------

    /// Build a minimal valid FMIR v2 binary file for testing.
    ///
    /// * `strings` -- list of string table entries
    /// * `slots` -- list of `(slot_id, name_str_idx, type_hint_byte, source_byte, default_bytes)` tuples
    /// * `opcodes` -- raw opcode bytes (already assembled)
    /// * `islands` -- list of `(id, trigger_byte, props_mode_byte, name_str_idx, byte_offset, slot_ids)` tuples
    pub fn build_minimal_ir(
        strings: &[&str],
        slots: &[(u16, u32, u8, u8, &[u8])],
        opcodes: &[u8],
        islands: &[(u16, u8, u8, u32, u32, &[u16])],
    ) -> Vec<u8> {
        let string_section = build_string_table(strings);
        let slot_section = build_slot_table(slots);
        let island_section = build_island_table(islands);

        // Section layout: header(16) + section_table(32) = 48 bytes before first section.
        let data_start = HEADER_SIZE + SECTION_TABLE_SIZE;

        // Order of sections in the file: bytecode, strings, slots, islands
        let bytecode_offset = data_start;
        let bytecode_size = opcodes.len();

        let string_offset = bytecode_offset + bytecode_size;
        let string_size = string_section.len();

        let slot_offset = string_offset + string_size;
        let slot_size = slot_section.len();

        let island_offset = slot_offset + slot_size;
        let island_size = island_section.len();

        // Build header
        let mut buf = Vec::new();
        buf.extend_from_slice(b"FMIR");
        buf.extend_from_slice(&2u16.to_le_bytes()); // version
        buf.extend_from_slice(&0u16.to_le_bytes()); // flags
        buf.extend_from_slice(&0u64.to_le_bytes()); // source_hash

        // Build section table (4 sections: bytecode, strings, slots, islands)
        buf.extend_from_slice(&(bytecode_offset as u32).to_le_bytes());
        buf.extend_from_slice(&(bytecode_size as u32).to_le_bytes());
        buf.extend_from_slice(&(string_offset as u32).to_le_bytes());
        buf.extend_from_slice(&(string_size as u32).to_le_bytes());
        buf.extend_from_slice(&(slot_offset as u32).to_le_bytes());
        buf.extend_from_slice(&(slot_size as u32).to_le_bytes());
        buf.extend_from_slice(&(island_offset as u32).to_le_bytes());
        buf.extend_from_slice(&(island_size as u32).to_le_bytes());

        // Append section data
        buf.extend_from_slice(opcodes);
        buf.extend_from_slice(&string_section);
        buf.extend_from_slice(&slot_section);
        buf.extend_from_slice(&island_section);

        buf
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::test_helpers::*;
    use super::*;
    use crate::format::{IrError, IslandTrigger, PropsMode, SlotSource, SlotType};

    // -- StringTable tests --------------------------------------------------

    #[test]
    fn parse_string_table() {
        let data = build_string_table(&["div", "class", "container"]);
        let table = StringTable::parse(&data).unwrap();

        assert_eq!(table.len(), 3);
        assert_eq!(table.get(0).unwrap(), "div");
        assert_eq!(table.get(1).unwrap(), "class");
        assert_eq!(table.get(2).unwrap(), "container");

        // Out of bounds
        let err = table.get(3).unwrap_err();
        assert_eq!(err, IrError::StringIndexOutOfBounds { index: 3, len: 3 });
    }

    #[test]
    fn parse_string_table_empty() {
        let data = build_string_table(&[]);
        let table = StringTable::parse(&data).unwrap();
        assert_eq!(table.len(), 0);
    }

    #[test]
    fn parse_string_table_unicode() {
        let data = build_string_table(&["héllo"]);
        let table = StringTable::parse(&data).unwrap();

        assert_eq!(table.len(), 1);
        assert_eq!(table.get(0).unwrap(), "héllo");
    }

    #[test]
    fn parse_string_table_truncated() {
        // Count says 2 strings but data is truncated after the first string's length prefix.
        let mut data = Vec::new();
        data.extend_from_slice(&2u32.to_le_bytes()); // count = 2
        data.extend_from_slice(&3u16.to_le_bytes()); // first string len = 3
        data.extend_from_slice(b"div"); // first string bytes
                                        // Second string is missing entirely

        let err = StringTable::parse(&data).unwrap_err();
        match err {
            IrError::BufferTooShort { .. } => {} // expected
            other => panic!("expected BufferTooShort, got {other:?}"),
        }
    }

    // -- SlotTable tests ----------------------------------------------------

    #[test]
    fn parse_slot_table() {
        let data = build_slot_table(&[
            (1, 0, 0x01, 0x00, &[]), // slot_id=1, name_str_idx=0, type=Text, source=Server, no default
            (2, 1, 0x03, 0x01, &[0x42]), // slot_id=2, name_str_idx=1, type=Number, source=Client, 1-byte default
        ]);
        let table = SlotTable::parse(&data).unwrap();

        assert_eq!(table.len(), 2);

        let entries = table.entries();
        assert_eq!(entries[0].slot_id, 1);
        assert_eq!(entries[0].name_str_idx, 0);
        assert_eq!(entries[0].type_hint, SlotType::Text);
        assert_eq!(entries[0].source, SlotSource::Server);
        assert_eq!(entries[0].default_bytes, Vec::<u8>::new());

        assert_eq!(entries[1].slot_id, 2);
        assert_eq!(entries[1].name_str_idx, 1);
        assert_eq!(entries[1].type_hint, SlotType::Number);
        assert_eq!(entries[1].source, SlotSource::Client);
        assert_eq!(entries[1].default_bytes, vec![0x42]);
    }

    #[test]
    fn parse_slot_table_empty() {
        let data = build_slot_table(&[]);
        let table = SlotTable::parse(&data).unwrap();
        assert_eq!(table.len(), 0);
    }

    // -- IslandTableParsed tests --------------------------------------------

    #[test]
    fn parse_island_table() {
        let data = build_island_table(&[
            (1, 0x02, 0x01, 5, 0, &[]), // id=1, trigger=Visible, props=Inline, name_str_idx=5, byte_offset=0, no slots
        ]);
        let table = IslandTableParsed::parse(&data).unwrap();

        assert_eq!(table.len(), 1);

        let entry = &table.entries()[0];
        assert_eq!(entry.id, 1);
        assert_eq!(entry.trigger, IslandTrigger::Visible);
        assert_eq!(entry.props_mode, PropsMode::Inline);
        assert_eq!(entry.name_str_idx, 5);
        assert_eq!(entry.slot_ids, Vec::<u16>::new());
    }

    #[test]
    fn parse_island_table_with_slot_ids() {
        let data = build_island_table(&[
            (0, 0x01, 0x01, 0, 0, &[0, 1]), // id=0, Load, Inline, name=0, byte_offset=0, slots=[0, 1]
        ]);
        let table = IslandTableParsed::parse(&data).unwrap();
        assert_eq!(table.len(), 1);
        let entry = &table.entries()[0];
        assert_eq!(entry.id, 0);
        assert_eq!(entry.trigger, IslandTrigger::Load);
        assert_eq!(entry.props_mode, PropsMode::Inline);
        assert_eq!(entry.slot_ids, vec![0, 1]);
    }

    #[test]
    fn parse_island_table_empty() {
        let data = build_island_table(&[]);
        let table = IslandTableParsed::parse(&data).unwrap();
        assert_eq!(table.len(), 0);
    }

    // -- IrModule tests -----------------------------------------------------

    #[test]
    fn parse_minimal_ir_file() {
        // 1 string ("div"), empty slots/islands, opcodes = [OPEN_TAG "div", CLOSE_TAG "div"]
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let data = build_minimal_ir(&["div"], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();

        assert_eq!(module.header.version, 2);
        assert_eq!(module.strings.get(0).unwrap(), "div");
        assert_eq!(module.strings.len(), 1);
        assert_eq!(module.slots.len(), 0);
        assert_eq!(module.islands.len(), 0);
        assert_eq!(module.opcodes.len(), opcodes.len());
    }

    #[test]
    fn parse_ir_with_slots() {
        let opcodes = encode_text(0);
        let data = build_minimal_ir(
            &["greeting", "count", "Hello"],
            &[
                (1, 0, 0x01, 0x00, &[]), // slot_id=1, name="greeting", type=Text, source=Server
                (2, 1, 0x03, 0x00, &[]), // slot_id=2, name="count", type=Number, source=Server
            ],
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&data).unwrap();

        assert_eq!(module.slots.len(), 2);
        let entries = module.slots.entries();
        assert_eq!(entries[0].slot_id, 1);
        assert_eq!(entries[0].name_str_idx, 0);
        assert_eq!(entries[0].type_hint, SlotType::Text);
        assert_eq!(entries[1].slot_id, 2);
        assert_eq!(entries[1].name_str_idx, 1);
        assert_eq!(entries[1].type_hint, SlotType::Number);
    }

    #[test]
    fn parse_ir_with_islands() {
        let opcodes = encode_text(0);
        let data = build_minimal_ir(
            &["Counter", "Hello"],
            &[],
            &opcodes,
            &[
                (1, 0x01, 0x01, 0, 0, &[]), // id=1, trigger=Load, props=Inline, name="Counter", byte_offset=0, no slots
            ],
        );
        let module = IrModule::parse(&data).unwrap();

        assert_eq!(module.islands.len(), 1);
        let entry = &module.islands.entries()[0];
        assert_eq!(entry.id, 1);
        assert_eq!(entry.trigger, IslandTrigger::Load);
        assert_eq!(entry.props_mode, PropsMode::Inline);
        assert_eq!(entry.name_str_idx, 0);
        assert_eq!(module.strings.get(entry.name_str_idx).unwrap(), "Counter");
    }

    #[test]
    fn parse_ir_rejects_truncated() {
        // File shorter than HEADER_SIZE (16 bytes)
        let data = b"FMIR\x02\x00";
        let err = IrModule::parse(data).unwrap_err();
        match err {
            IrError::BufferTooShort {
                expected: 16,
                actual: 6,
            } => {}
            other => panic!("expected BufferTooShort(16, 6), got {other:?}"),
        }
    }

    #[test]
    fn parse_ir_rejects_bad_section_bounds() {
        // Build a valid file, then corrupt a section descriptor so it extends past EOF.
        let opcodes = encode_text(0);
        let mut data = build_minimal_ir(&["x"], &[], &opcodes, &[]);

        // Corrupt section 3 (island table) size to be huge.
        // Section table starts at offset 16. Section 3 is at 16 + 3*8 = 40.
        // Size field is at offset 44 (40 + 4).
        let big_size: u32 = 99999;
        data[44..48].copy_from_slice(&big_size.to_le_bytes());

        let err = IrModule::parse(&data).unwrap_err();
        match err {
            IrError::SectionOutOfBounds { section: 3, .. } => {}
            other => panic!("expected SectionOutOfBounds for section 3, got {other:?}"),
        }
    }

    #[test]
    fn validate_catches_bad_slot_str_idx() {
        // Slot references string index 99, but only 3 strings exist.
        let opcodes = encode_text(0);
        let data = build_minimal_ir(
            &["a", "b", "c"],
            &[(1, 99, 0x01, 0x00, &[])], // name_str_idx=99, out of bounds
            &opcodes,
            &[],
        );
        let err = IrModule::parse(&data).unwrap_err();
        assert_eq!(err, IrError::StringIndexOutOfBounds { index: 99, len: 3 });
    }

    #[test]
    fn validate_catches_bad_island_str_idx() {
        // Island references string index 99, but only 3 strings exist.
        let opcodes = encode_text(0);
        let data = build_minimal_ir(
            &["a", "b", "c"],
            &[],
            &opcodes,
            &[(1, 0x01, 0x01, 99, 0, &[])],
        );
        let err = IrModule::parse(&data).unwrap_err();
        assert_eq!(err, IrError::StringIndexOutOfBounds { index: 99, len: 3 });
    }
}
