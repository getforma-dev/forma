//! Parsers for FMIR data tables: string table, slot table, and island table.
//!
//! Each parser consumes a byte slice containing exactly one section's data
//! and returns a typed, indexed collection.

use crate::format::{
    le_u16, le_u32, limit, IrError, IrHeader, IslandEntry, IslandTrigger, Opcode, SectionTable,
    SlotEntry, SlotSource, SlotType, HEADER_SIZE, MAX_ISLANDS, MAX_STRINGS, SECTION_BYTECODE,
    SECTION_ISLANDS, SECTION_ISLAND_CONTRACTS, SECTION_KEY_PATHS, SECTION_PROPS_SCHEMA,
    SECTION_REQUIRED, SECTION_SLOTS, SECTION_SOURCE_POSITIONS, SECTION_STRINGS,
};
use crate::schema::{self, Cursor, KeyPath, PropsSchema, SourcePosition};

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

        let count = le_u32(&data[0..4]) as usize;
        limit("strings", count, MAX_STRINGS)?;
        // Guard against a declared count that the section cannot possibly
        // hold. The old `count > data.len()` guard compared entries against
        // *bytes*: a string costs 2 bytes on disk (an empty string's u16
        // length prefix) but 24 bytes of `String` header in the reservation,
        // so it permitted a 12x memory blow-up before decoding a single
        // string — and `Vec::with_capacity` OOM aborts the process rather
        // than returning an error. `data.len() >= 4` is guaranteed above.
        //
        // FMIR v3 also caps the string count above and total module bytes in
        // IrHeader::parse; this check independently rejects impossible counts.
        let max_entries = (data.len() - 4) / 2;
        if count > max_entries {
            return Err(IrError::BufferTooShort {
                // Saturating: `count` is u32-wide and `usize` is 32 bits on
                // 32-bit targets.
                expected: 4usize.saturating_add(count.saturating_mul(2)),
                actual: data.len(),
            });
        }
        let mut offset = 4;
        // Exact reservation is the cheaper choice once `count` is validated:
        // measured, amortised push growth peaks *higher* (realloc holds both
        // buffers) and runs slower.
        let mut strings = Vec::with_capacity(count);

        for _ in 0..count {
            // Need at least 2 bytes for the length prefix.
            if offset + 2 > data.len() {
                return Err(IrError::BufferTooShort {
                    expected: offset + 2,
                    actual: data.len(),
                });
            }

            let str_len = le_u16(&data[offset..offset + 2]) as usize;
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

        if offset != data.len() {
            return Err(IrError::TrailingBytes {
                section: SECTION_STRINGS,
            });
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
/// Binary format (unchanged from v2): `count(u16)`, then `count` variable-length entries of
/// `[slot_id(u16), name_str_idx(u32), type_hint(u8), source(u8), default_len(u16), default_bytes([u8; default_len])]`.
/// Minimum entry size: 10 bytes (when default_len = 0).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlotTable {
    slots: Vec<SlotEntry>,
}

/// Minimum size of a single slot entry in bytes (without default data).
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

        let count = le_u16(&data[0..2]) as usize;
        // Same reasoning as StringTable::parse: a SlotEntry is 10 bytes on
        // disk but ~32 bytes in memory, so an unchecked count reserves far
        // more than the section could ever contain. `data.len() >= 2` above.
        let max_entries = (data.len() - 2) / SLOT_ENTRY_MIN_SIZE;
        if count > max_entries {
            return Err(IrError::BufferTooShort {
                expected: 2usize.saturating_add(count.saturating_mul(SLOT_ENTRY_MIN_SIZE)),
                actual: data.len(),
            });
        }
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

            let slot_id = le_u16(&data[offset..offset + 2]);
            let name_str_idx = le_u32(&data[offset + 2..offset + 6]);
            let type_hint = SlotType::from_byte(data[offset + 6])?;
            let source = SlotSource::from_byte(data[offset + 7])?;
            let default_len = le_u16(&data[offset + 8..offset + 10]) as usize;
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
            validate_default(slot_id, type_hint, &default_bytes)?;

            slots.push(SlotEntry {
                slot_id,
                name_str_idx,
                type_hint,
                source,
                default_bytes,
            });
        }

        if offset != data.len() {
            return Err(IrError::TrailingBytes {
                section: SECTION_SLOTS,
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

/// Validate only defaults supported by the frozen walker semantics.
fn validate_default(id: u16, kind: SlotType, bytes: &[u8]) -> Result<(), IrError> {
    if bytes.is_empty() {
        return Ok(());
    }
    let text = std::str::from_utf8(bytes).map_err(|e| IrError::InvalidUtf8(e.to_string()))?;
    let valid = match kind {
        SlotType::Text => true,
        SlotType::Bool => matches!(text, "true" | "false"),
        SlotType::Number => decimal(text) && text.parse::<f64>().is_ok_and(|n| n.is_finite()),
        SlotType::Array => text == "[]",
        SlotType::Object => false,
    };
    if valid {
        Ok(())
    } else {
        Err(IrError::InvalidDefault(id))
    }
}
fn decimal(text: &str) -> bool {
    let b = text.as_bytes();
    let mut p = 0;
    if matches!(b.get(p), Some(b'+' | b'-')) {
        p += 1;
    }
    let mut digits = 0;
    while b.get(p).is_some_and(u8::is_ascii_digit) {
        p += 1;
        digits += 1;
    }
    if b.get(p) == Some(&b'.') {
        p += 1;
        while b.get(p).is_some_and(u8::is_ascii_digit) {
            p += 1;
            digits += 1;
        }
    }
    if digits == 0 {
        return false;
    }
    if matches!(b.get(p), Some(b'e' | b'E')) {
        p += 1;
        if matches!(b.get(p), Some(b'+' | b'-')) {
            p += 1;
        }
        let start = p;
        while b.get(p).is_some_and(u8::is_ascii_digit) {
            p += 1;
        }
        if p == start {
            return false;
        }
    }
    p == b.len()
}

// ---------------------------------------------------------------------------
// IslandTableParsed
// ---------------------------------------------------------------------------

/// Parsed FMIR v3 island table, including opaque digest and trailing extension bytes.
///
/// Each entry has a u16 byte length, id/trigger/reserved/name/bytecode-offset,
/// schema-object reference, a length-prefixed digest and a counted slot-id list.
/// `docs/FMIR-FORMAT.md` specifies the exact bounded record layout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IslandTableParsed {
    islands: Vec<IslandEntry>,
}

impl IslandTableParsed {
    /// Parse bounded v3 island records, retaining unknown trailing entry bytes.
    pub fn parse(data: &[u8]) -> Result<Self, IrError> {
        let mut r = Cursor::new(data);
        let count = r.u16()? as usize;
        limit("islands", count, MAX_ISLANDS)?;
        r.bound(count, 19)?;
        let mut islands = Vec::with_capacity(count);
        for _ in 0..count {
            let entry_len = r.u16()? as usize;
            let mut e = Cursor::new(r.take(entry_len)?);
            let id = e.u16()?;
            let trigger = IslandTrigger::from_byte(e.u8()?)?;
            if e.u8()? != 0 {
                return Err(IrError::ReservedBits { field: "island" });
            }
            let name_str_idx = e.u32()?;
            let byte_offset = e.u32()?;
            let schema_object = e.u16()?;
            let digest_len = e.u8()? as usize;
            let digest = e.take(digest_len)?.to_vec();
            let slot_count = e.u16()? as usize;
            e.bound(slot_count, 2)?;
            let mut slot_ids = Vec::with_capacity(slot_count);
            for _ in 0..slot_count {
                slot_ids.push(e.u16()?);
            }
            let extension = e.take(e.remaining())?.to_vec();
            islands.push(IslandEntry {
                id,
                trigger,
                name_str_idx,
                byte_offset,
                schema_object,
                digest,
                slot_ids,
                extension,
            });
        }
        r.finish(SECTION_ISLANDS)?;
        Ok(Self { islands })
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

/// Sentinel meaning "no entry" in the dense id → table-index maps.
const NO_INDEX: u32 = u32::MAX;

/// A fully parsed and validated IR module, ready for walking.
///
/// Marked `#[non_exhaustive]`: the module carries derived lookup indices that
/// must stay in sync with the tables, so it can only be built by `parse`.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct IrModule {
    /// Parsed and integrity-checked v3 header.
    pub header: IrHeader,
    /// The module's string table — every name, literal and attribute value.
    pub strings: StringTable,
    /// The module's slot declarations, including their defaults.
    pub slots: SlotTable,
    /// Raw opcode stream; the walker interprets it on the fly.
    pub opcodes: Vec<u8>,
    /// The module's island declarations.
    pub islands: IslandTableParsed,
    /// Section descriptors, including unknown optional sections.
    pub sections: SectionTable,
    /// Declared props schema; object zero is the page's props.
    pub schema: PropsSchema,
    /// List key paths, in bytecode order.
    pub key_paths: Vec<KeyPath>,
    /// Optional component source positions.
    pub source_positions: Vec<SourcePosition>,
    /// Complete original encoding retained for canonical dumps and lossless roundtrips.
    raw: Vec<u8>,
    pub(crate) contracts: Option<crate::contracts::Contracts>,
    /// Dense `slot_id` → index into `slots.entries()`, `NO_INDEX` if absent.
    /// Replaces a linear scan per DYN_TEXT/DYN_ATTR/SHOW_IF/LIST opcode.
    slot_index: Vec<u32>,
    /// Dense island `id` → index into `islands.entries()`, `NO_INDEX` if
    /// absent. This one is not behind any feature gate, so it used to cost a
    /// full table scan in every build configuration.
    island_index: Vec<u32>,
}

impl IrModule {
    /// Parse a complete FMIR binary into a validated `IrModule`.
    pub fn parse(data: &[u8]) -> Result<Self, IrError> {
        let header = IrHeader::parse(data)?;
        let section_table = SectionTable::parse(&data[HEADER_SIZE..])?;
        section_table.validate(data.len())?;
        for section in &section_table.sections {
            if !(SECTION_BYTECODE..=SECTION_SOURCE_POSITIONS).contains(&section.id)
                && section.id != SECTION_ISLAND_CONTRACTS
                && section.flags & SECTION_REQUIRED != 0
            {
                return Err(IrError::UnknownRequiredSection {
                    id: section.id,
                    writer: header.writer,
                });
            }
        }
        for id in SECTION_BYTECODE..=SECTION_PROPS_SCHEMA {
            if section_table.get(id).is_none() {
                return Err(IrError::MissingSection(id));
            }
        }
        let payload = |id| -> Result<&[u8], IrError> {
            let section = section_table.get(id).ok_or(IrError::MissingSection(id))?;
            let start = section.offset as usize;
            data.get(start..start + section.size as usize)
                .ok_or(IrError::InvalidSection)
        };
        if let Some(section) = section_table.get(SECTION_ISLAND_CONTRACTS) {
            if section.flags != SECTION_REQUIRED {
                return Err(IrError::InvalidSchema("island contracts must be required"));
            }
        }
        let contracts = if section_table.get(SECTION_ISLAND_CONTRACTS).is_some() {
            Some(crate::contracts::Contracts::parse(payload(
                SECTION_ISLAND_CONTRACTS,
            )?)?)
        } else {
            None
        };
        let strings = StringTable::parse(payload(SECTION_STRINGS)?)?;
        let slots = SlotTable::parse(payload(SECTION_SLOTS)?)?;
        let islands = IslandTableParsed::parse(payload(SECTION_ISLANDS)?)?;
        let schema = PropsSchema::parse(payload(SECTION_PROPS_SCHEMA)?, &strings)?;
        let opcodes = payload(SECTION_BYTECODE)?.to_vec();
        let slot_index = build_id_index(slots.entries().iter().map(|e| e.slot_id));
        let island_index = build_id_index(islands.entries().iter().map(|e| e.id));
        let mut module = Self {
            header,
            strings,
            slots,
            islands,
            schema,
            opcodes,
            slot_index,
            island_index,
            sections: section_table.clone(),
            key_paths: Vec::new(),
            source_positions: Vec::new(),
            raw: data.to_vec(),
            contracts,
        };
        let starts = module.validation_starts()?;
        if section_table.get(SECTION_KEY_PATHS).is_some() {
            module.key_paths =
                schema::key_paths(payload(SECTION_KEY_PATHS)?, &module.strings, &starts)?;
        }
        if section_table.get(SECTION_SOURCE_POSITIONS).is_some() {
            module.source_positions = schema::source_positions(
                payload(SECTION_SOURCE_POSITIONS)?,
                &module.strings,
                &starts,
            )?;
        }
        Ok(module)
    }

    /// Validated canonical binding/schema bytes for one static island, for diagnostics.
    /// These bytes are identity metadata, not executable instructions or a binding bypass.
    pub fn island_contract_bytes(&self, id: u16) -> Option<(&[u8], &[u8])> {
        let contract = self.contracts.as_ref()?.islands.get(&id)?;
        Some((&contract.binding_bytes, &contract.schema_bytes))
    }

    /// Original bytes, including unknown optional sections and island extensions.
    pub fn raw_bytes(&self) -> &[u8] {
        &self.raw
    }

    /// Look up a slot table entry by `slot_id` in O(1).
    pub fn slot_entry(&self, slot_id: u16) -> Option<&SlotEntry> {
        match self.slot_index.get(slot_id as usize) {
            Some(&idx) if idx != NO_INDEX => self.slots.entries().get(idx as usize),
            _ => None,
        }
    }

    /// Look up an island table entry by island id in O(1).
    pub fn island_entry(&self, island_id: u16) -> Option<&IslandEntry> {
        match self.island_index.get(island_id as usize) {
            Some(&idx) if idx != NO_INDEX => self.islands.entries().get(idx as usize),
            _ => None,
        }
    }

    /// Validate cross-table references and opcode-stream structure.
    ///
    /// Runs once at parse time (O(n) in the bytecode length) so the walker can
    /// stay cheap and so malformed IR fails at load rather than rendering
    /// mystery HTML on some later request.
    pub fn validate(&self) -> Result<(), IrError> {
        self.validation_starts().map(|_| ())
    }

    fn validation_starts(&self) -> Result<Vec<(u32, Opcode)>, IrError> {
        let str_count = self.strings.len();

        // Validate all slot name_str_idx values are within string table bounds,
        // and that slot ids are unique (a duplicate makes "which slot does this
        // id mean" ambiguous, and the answer would differ between lookups).
        let mut seen_slot = vec![false; self.slot_index.len()];
        for slot in self.slots.entries() {
            if slot.name_str_idx as usize >= str_count {
                return Err(IrError::StringIndexOutOfBounds {
                    index: slot.name_str_idx,
                    len: str_count,
                });
            }
            let idx = slot.slot_id as usize;
            if seen_slot[idx] {
                return Err(IrError::DuplicateSlotId(slot.slot_id));
            }
            seen_slot[idx] = true;
        }

        // Validate all island name_str_idx values are within string table
        // bounds, ids are unique, every referenced slot exists, and the
        // byte_offset really points at this island's own ISLAND_START.
        let mut seen_island = vec![false; self.island_index.len()];
        for island in self.islands.entries() {
            if island.name_str_idx as usize >= str_count {
                return Err(IrError::StringIndexOutOfBounds {
                    index: island.name_str_idx,
                    len: str_count,
                });
            }
            let idx = island.id as usize;
            if seen_island[idx] {
                return Err(IrError::DuplicateIslandId(island.id));
            }
            seen_island[idx] = true;

            for &slot_id in &island.slot_ids {
                if self.slot_entry(slot_id).is_none() {
                    return Err(IrError::UnknownSlotId(slot_id));
                }
            }

            // A bounds check alone is not enough: an in-range offset landing
            // mid-operand on a stray 0x0B byte would pass it. Require the
            // opcode *and* its island id to match.
            let off = island.byte_offset as usize;
            let id_matches = self.opcodes.get(off) == Some(&(Opcode::IslandStart as u8))
                && crate::walker::read_u16(&self.opcodes, off + 1) == Ok(island.id);
            if !id_matches {
                return Err(IrError::IslandOffsetMismatch {
                    island_id: island.id,
                    byte_offset: island.byte_offset,
                });
            }
        }

        let mut starts = Vec::new();
        self.scan_region(0, self.opcodes.len(), 0, &mut starts)?;
        for island in self.islands.entries() {
            if starts
                .binary_search_by_key(&island.byte_offset, |(o, _)| *o)
                .is_err()
            {
                return Err(IrError::IslandOffsetMismatch {
                    island_id: island.id,
                    byte_offset: island.byte_offset,
                });
            }
            if island.schema_object != 0xffff
                && island.schema_object as usize >= self.schema.objects.len()
            {
                return Err(IrError::InvalidSchema("island object index out of range"));
            }
        }
        if let Some(contracts) = &self.contracts {
            contracts.validate(self, &starts)?;
        } else if !self.islands.is_empty() || starts.iter().any(|(_, op)| *op == Opcode::Coalesce) {
            return Err(IrError::MissingSection(SECTION_ISLAND_CONTRACTS));
        }
        Ok(starts)
    }

    /// Linearly decode `opcodes[start..end]`, requiring that it tiles exactly
    /// and that every slot id it names is declared.
    ///
    /// "Tiles exactly" means each control-flow region's declared length lines
    /// up with the opcodes inside it: decoding a SHOW_IF then-body must land
    /// precisely on `then_end`, the next byte must be SHOW_ELSE, and so on.
    /// The walker's own `<= end` checks cannot catch an over-long length at
    /// the top level (where `end == opcodes.len()` already), which is why this
    /// pass exists.
    ///
    /// RESIDUAL: an *under*-long length whose orphaned bytes still decode as a
    /// legal sibling sequence (`else_len = 0`, `body_len = 0`) is structurally
    /// indistinguishable from a legitimate module, so no length check can
    /// reject it. Closing that class needs module integrity — the FMIR header
    /// protects accidental corruption with a CRC. A writer can restamp a wrong
    /// module, so corpus/parity tests remain necessary for compiler defects.
    fn scan_region(
        &self,
        start: usize,
        end: usize,
        depth: usize,
        starts: &mut Vec<(u32, Opcode)>,
    ) -> Result<(), IrError> {
        limit("control-flow depth", depth, MAX_VALIDATION_DEPTH)?;
        let ops = &self.opcodes;
        let mut pos = start;
        while pos < end {
            let op_start = pos;
            let op = Opcode::from_byte(ops[pos])?;
            starts.push((pos as u32, op));
            pos += 1;
            match op {
                Opcode::OpenTag | Opcode::VoidTag => {
                    self.strings.get(read_u32_at(ops, pos, end)?)?;
                    let n = read_u16_at(ops, pos + 4, end)? as usize;
                    let next = bounded(pos, 6 + n * 8, end, op_start)?;
                    for i in 0..n {
                        self.strings.get(read_u32_at(ops, pos + 6 + i * 8, end)?)?;
                        self.strings.get(read_u32_at(ops, pos + 10 + i * 8, end)?)?;
                    }
                    pos = next;
                }
                Opcode::CloseTag | Opcode::Text => {
                    self.strings.get(read_u32_at(ops, pos, end)?)?;
                    pos = bounded(pos, 4, end, op_start)?;
                }
                Opcode::DynText => {
                    self.check_slot(read_u16_at(ops, pos, end)?)?;
                    pos = bounded(pos, 4, end, op_start)?;
                }
                Opcode::DynAttr => {
                    self.strings.get(read_u32_at(ops, pos, end)?)?;
                    self.check_slot(read_u16_at(ops, pos + 4, end)?)?;
                    pos = bounded(pos, 6, end, op_start)?;
                }
                Opcode::IslandStart => {
                    let id = read_u16_at(ops, pos, end)?;
                    if self.island_entry(id).is_none() {
                        return Err(IrError::UnknownIslandId(id));
                    }
                    pos = bounded(pos, 2, end, op_start)?;
                }
                Opcode::IslandEnd => {
                    pos = bounded(pos, 2, end, op_start)?;
                }
                Opcode::ShowElse => {} // Historical stray separator is a no-op.
                Opcode::Coalesce => {
                    self.check_slot(read_u16_at(ops, pos, end)?)?;
                    self.check_slot(read_u16_at(ops, pos + 2, end)?)?;
                    self.check_slot(read_u16_at(ops, pos + 4, end)?)?;
                    pos = bounded(pos, 6, end, op_start)?;
                }
                Opcode::Prop => {
                    self.check_slot(read_u16_at(ops, pos, end)?)?;
                    self.strings.get(read_u32_at(ops, pos + 2, end)?)?;
                    self.check_slot(read_u16_at(ops, pos + 6, end)?)?;
                    pos = bounded(pos, 8, end, op_start)?;
                }
                Opcode::ShowIf => {
                    self.check_slot(read_u16_at(ops, pos, end)?)?;
                    let tl = read_u32_at(ops, pos + 2, end)? as usize;
                    let el = read_u32_at(ops, pos + 6, end)? as usize;
                    let ts = bounded(pos, 10, end, op_start)?;
                    let te = bounded(ts, tl, end, op_start)?;
                    if te >= end || ops[te] != Opcode::ShowElse as u8 {
                        return Err(IrError::MalformedControlFlow { pos: te });
                    }
                    let es = te + 1;
                    let ee = bounded(es, el, end, op_start)?;
                    self.scan_region(ts, te, depth + 1, starts)?;
                    starts.push((te as u32, Opcode::ShowElse));
                    self.scan_region(es, ee, depth + 1, starts)?;
                    pos = ee;
                }
                Opcode::List => {
                    self.check_slot(read_u16_at(ops, pos, end)?)?;
                    self.check_slot(read_u16_at(ops, pos + 2, end)?)?;
                    let len = read_u32_at(ops, pos + 4, end)? as usize;
                    let bs = bounded(pos, 8, end, op_start)?;
                    let be = bounded(bs, len, end, op_start)?;
                    self.scan_region(bs, be, depth + 1, starts)?;
                    pos = be;
                }
            }
        }
        Ok(())
    }

    /// Reject an opcode operand naming a slot the module never declared.
    ///
    /// Without this a LIST whose `item_slot_id` is undeclared silently renders
    /// every row identically, and a PROP writes into nowhere.
    fn check_slot(&self, slot_id: u16) -> Result<(), IrError> {
        if self.slot_entry(slot_id).is_none() {
            return Err(IrError::UnknownSlotId(slot_id));
        }
        Ok(())
    }

    /// Look up a slot ID by its name. Returns `None` if no slot with that name exists.
    ///
    /// DUPLICATE-NAME RULE: slot *names* are not required to be unique — the
    /// compiler derives some of them per-element (`text:<index>`, `attr:class`)
    /// rather than per-module — so a name can address more than one slot. The
    /// whole crate resolves that collision the same way: **the first entry in
    /// slot-table order wins**, here, in [`crate::slot::SlotData::from_json`], and in the
    /// walker's island-props builder. They used to disagree three ways (first,
    /// last, and last-by-ascending-slot-id), so setting a value by name filled
    /// one slot and left its twin blank while the island's props reported a
    /// third answer.
    ///
    /// Verified by: crates/forma-ir/src/parser.rs > "duplicate_slot_names_resolve_first_wins_everywhere"
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

/// Maximum control-flow nesting depth accepted by the structural validator.
/// Matches the walker's `MAX_RECURSION_DEPTH`.
const MAX_VALIDATION_DEPTH: usize = crate::format::MAX_CONTROL_DEPTH;

/// Build a dense id → index map, keeping the FIRST entry for any duplicate id
/// so the map agrees with the linear `find` it replaces.
fn build_id_index(ids: impl Iterator<Item = u16> + Clone) -> Vec<u32> {
    let max_id = ids.clone().max();
    let Some(max_id) = max_id else {
        return Vec::new();
    };
    // Sized to max_id + 1 (not a flat 65,536) with a u32 sentinel rather than
    // Option<u32>: real pages have tens of slots, so this is a few hundred
    // bytes, paid once at parse.
    let mut index = vec![NO_INDEX; max_id as usize + 1];
    for (i, id) in ids.enumerate() {
        let entry = &mut index[id as usize];
        if *entry == NO_INDEX {
            *entry = i as u32;
        }
    }
    index
}

/// `base + len`, rejected if it overflows or leaves the enclosing region.
///
/// Plain `+` on `usize` can overflow on a 32-bit target.
fn bounded(base: usize, len: usize, end: usize, op_start: usize) -> Result<usize, IrError> {
    base.checked_add(len)
        .filter(|e| *e <= end)
        .ok_or(IrError::MalformedControlFlow { pos: op_start })
}

/// Read a u16 that must lie fully inside the region being scanned.
fn read_u16_at(ops: &[u8], pos: usize, end: usize) -> Result<u16, IrError> {
    if pos.checked_add(2).map(|e| e > end).unwrap_or(true) {
        return Err(IrError::MalformedControlFlow { pos });
    }
    crate::walker::read_u16(ops, pos)
}

/// Read a u32 that must lie fully inside the region being scanned.
fn read_u32_at(ops: &[u8], pos: usize, end: usize) -> Result<u32, IrError> {
    if pos.checked_add(4).map(|e| e > end).unwrap_or(true) {
        return Err(IrError::MalformedControlFlow { pos });
    }
    crate::walker::read_u32(ops, pos)
}

// ---------------------------------------------------------------------------
// Test helpers — always compiled so external crates can use them in tests.
// ---------------------------------------------------------------------------

/// Binary encoding helpers for building FMIR test data.
///
/// Behind the `test-helpers` feature, not `#[cfg(test)]`: other crates
/// (`forma-server`, and anyone writing a fixture) need them from their own
/// test targets, which `#[cfg(test)]` cannot reach. The feature keeps them out
/// of consumers' *release* builds, where a byte-exact FMIR encoder is
/// unwanted API surface.
///
/// This crate's own tests get it from a self dev-dependency in Cargo.toml.
#[cfg(any(test, feature = "test-helpers"))]
// Fixture encoders: a fixture that cannot be encoded is a broken test, and
// panicking says so at the line that built it. Never in a consumer's build.
#[allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
pub mod test_helpers {
    use crate::format::{
        crc32, reader_version, HEADER_SIZE, SECTION_ENTRY_SIZE, SIGNATURE, TABLE_PREFIX_SIZE,
    };

    /// Narrow to `u16`, panicking rather than silently truncating.
    ///
    /// These encoders write the on-disk widths, so a plain `as` cast turns a
    /// module with more than 65,535 strings/attrs/slots into a corrupt file
    /// with no error at all — the exact failure the parser exists to catch,
    /// manufactured by the test fixture that was supposed to prove it.
    fn to_u16(n: usize) -> [u8; 2] {
        u16::try_from(n)
            .unwrap_or_else(|_| panic!("{n} does not fit the u16 field this encoder writes"))
            .to_le_bytes()
    }

    /// Narrow to `u32`, panicking rather than silently truncating.
    fn to_u32(n: usize) -> [u8; 4] {
        u32::try_from(n)
            .unwrap_or_else(|_| panic!("{n} does not fit the u32 field this encoder writes"))
            .to_le_bytes()
    }

    /// Build valid string table binary data from a slice of strings.
    pub fn build_string_table(strings: &[&str]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&to_u32(strings.len()));
        for s in strings {
            let bytes = s.as_bytes();
            buf.extend_from_slice(&to_u16(bytes.len()));
            buf.extend_from_slice(bytes);
        }
        buf
    }

    /// Build valid v2 slot table binary data from a slice of
    /// (slot_id, name_str_idx, type_hint_byte, source_byte, default_bytes).
    pub fn build_slot_table(entries: &[(u16, u32, u8, u8, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&to_u16(entries.len()));
        for &(slot_id, name_str_idx, type_hint, source, default_bytes) in entries {
            buf.extend_from_slice(&slot_id.to_le_bytes());
            buf.extend_from_slice(&name_str_idx.to_le_bytes());
            buf.push(type_hint);
            buf.push(source);
            buf.extend_from_slice(&to_u16(default_bytes.len()));
            buf.extend_from_slice(default_bytes);
        }
        buf
    }

    /// Build valid island table binary data with slot_ids support.
    ///
    /// Tuple: `(id, trigger, obsolete_mode, name_str_idx, byte_offset, slot_ids)`
    pub fn build_island_table(entries: &[(u16, u8, u8, u32, u32, &[u16])]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&to_u16(entries.len()));
        for &(id, trigger, _obsolete_mode, name_str_idx, byte_offset, slot_ids) in entries {
            buf.extend_from_slice(&to_u16(17 + 2 * slot_ids.len()));
            buf.extend_from_slice(&id.to_le_bytes());
            buf.push(trigger);
            buf.push(0);
            buf.extend_from_slice(&name_str_idx.to_le_bytes());
            buf.extend_from_slice(&byte_offset.to_le_bytes());
            buf.extend_from_slice(&0xffffu16.to_le_bytes());
            buf.push(0); // no digest until FORMA-105
            buf.extend_from_slice(&to_u16(slot_ids.len()));
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
        buf.extend_from_slice(&to_u16(attrs.len()));
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
        buf.extend_from_slice(&to_u16(attrs.len()));
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
        buf.extend_from_slice(&to_u32(then_ops.len()));
        buf.extend_from_slice(&to_u32(else_ops.len()));
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
        buf.extend_from_slice(&to_u32(body_ops.len()));
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
        buf.extend_from_slice(&to_u16(cases.len()));
        // Case headers
        for (val_str_idx, body) in cases {
            buf.extend_from_slice(&val_str_idx.to_le_bytes());
            buf.extend_from_slice(&to_u32(body.len()));
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
        buf.extend_from_slice(&to_u32(fallback_ops.len()));
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

    /// Build a minimal valid FMIR v3 binary file for testing.
    ///
    /// * `strings` -- list of string table entries
    /// * `slots` -- list of `(slot_id, name_str_idx, type_hint_byte, source_byte, default_bytes)` tuples
    /// * `opcodes` -- raw opcode bytes (already assembled)
    /// * `islands` -- list of `(id, trigger_byte, obsolete_mode_byte, name_str_idx, byte_offset, slot_ids)` tuples
    pub fn build_minimal_ir(
        strings: &[&str],
        slots: &[(u16, u32, u8, u8, &[u8])],
        opcodes: &[u8],
        islands: &[(u16, u8, u8, u32, u32, &[u16])],
    ) -> Vec<u8> {
        let string_section = build_string_table(strings);
        let slot_section = build_slot_table(slots);
        let island_section = build_island_table(islands);

        build_ir_sections(&[
            (1, 1, opcodes),
            (2, 1, &string_section),
            (3, 1, &slot_section),
            (4, 1, &island_section),
            (5, 1, &[1, 0, 0, 0]),
        ])
    }

    /// Build a v3 module from arbitrary sections, for fault injection and protocol tests.
    pub fn build_ir_sections(sections: &[(u16, u16, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&SIGNATURE);
        for v in reader_version() {
            buf.extend_from_slice(&v.to_le_bytes());
        }
        buf.extend_from_slice(&[0; 10]); // body length, CRC, reserved
        buf.extend_from_slice(&to_u16(sections.len()));
        buf.extend_from_slice(&[0; 2]);
        let mut offset = HEADER_SIZE + TABLE_PREFIX_SIZE + SECTION_ENTRY_SIZE * sections.len();
        for &(id, flags, bytes) in sections {
            buf.extend_from_slice(&id.to_le_bytes());
            buf.extend_from_slice(&flags.to_le_bytes());
            buf.extend_from_slice(&to_u32(offset));
            buf.extend_from_slice(&to_u32(bytes.len()));
            offset += bytes.len();
        }
        for &(_, _, bytes) in sections {
            buf.extend_from_slice(bytes);
        }
        restamp(&mut buf);
        buf
    }

    /// Restamp length and checksum after a deliberate structural mutation.
    pub fn restamp(buf: &mut [u8]) {
        let body_len = to_u32(buf.len() - HEADER_SIZE);
        buf[14..18].copy_from_slice(&body_len);
        let checksum = crc32(&[&buf[..18], &buf[22..]]);
        buf[18..22].copy_from_slice(&checksum.to_le_bytes());
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::test_helpers::*;
    use super::*;
    use crate::format::{IrError, IslandTrigger, SlotSource, SlotType};

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
            (2, 1, 0x03, 0x01, b"7"), // slot_id=2, name_str_idx=1, type=Number, source=Client, 1-byte default
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
        assert_eq!(entries[1].default_bytes, b"7");
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
        assert_eq!(entry.schema_object, 0xffff);
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
        assert_eq!(entry.schema_object, 0xffff);
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

        assert_eq!(module.header.writer, crate::format::reader_version());
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
        // byte_offset must point at this island's own ISLAND_START opcode —
        // validate() rejects an island table that names an offset with no
        // matching ISLAND_START(id) there.
        let mut opcodes = vec![0x0B]; // ISLAND_START
        opcodes.extend_from_slice(&1u16.to_le_bytes());
        opcodes.extend_from_slice(&encode_text(1));
        opcodes.push(0x0C); // ISLAND_END
        opcodes.extend_from_slice(&1u16.to_le_bytes());
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
        assert_eq!(entry.schema_object, 0xffff);
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
                expected: 24,
                actual: 6,
            } => {}
            other => panic!("expected BufferTooShort(24, 6), got {other:?}"),
        }
    }

    #[test]
    fn parse_ir_rejects_bad_section_bounds() {
        let mut data = build_minimal_ir(&["x"], &[], &encode_text(0), &[]);
        // Fourth descriptor's length, at entry offset 28+3*12+8.
        data[72..76].copy_from_slice(&99999u32.to_le_bytes());
        restamp(&mut data);
        assert_eq!(
            IrModule::parse(&data).unwrap_err(),
            IrError::SectionsDoNotTile
        );
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
        let mut island_opcodes = vec![0x0B];
        island_opcodes.extend_from_slice(&1u16.to_le_bytes());
        island_opcodes.extend_from_slice(&opcodes);
        island_opcodes.push(0x0C);
        island_opcodes.extend_from_slice(&1u16.to_le_bytes());
        let data = build_minimal_ir(
            &["a", "b", "c"],
            &[],
            &island_opcodes,
            &[(1, 0x01, 0x01, 99, 0, &[])],
        );
        let err = IrModule::parse(&data).unwrap_err();
        assert_eq!(err, IrError::StringIndexOutOfBounds { index: 99, len: 3 });
    }

    #[test]
    fn duplicate_slot_names_resolve_first_wins_everywhere() {
        // The compiler derives some slot names per-element, so a name can name
        // two slots. `slot_id_by_name` returned the first while
        // `SlotData::from_json` (a HashMap insert) took the last — so setting
        // "dup" by name filled slot 1 while every lookup resolved slot 0.
        let opcodes = encode_text(0);
        let data = build_minimal_ir(
            &["dup"],
            &[(0, 0, 0x01, 0x00, &[]), (1, 0, 0x01, 0x00, &[])],
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&data).unwrap();

        assert_eq!(module.slot_id_by_name("dup"), Some(0));

        let slots = crate::slot::SlotData::from_json(r#"{"dup":"x"}"#, &module).unwrap();
        assert_eq!(slots.get(0).to_text(), "x", "the first slot must be filled");
        assert_eq!(slots.get(1).to_text(), "", "the second must stay untouched");
    }

    #[test]
    fn validate_rejects_list_item_slot_not_in_table() {
        // A LIST whose item_slot_id is not declared used to bind every row's
        // item into nowhere, so every row rendered identically with no error.
        // The slot table declares only slot 0; the LIST binds items to slot 7.
        let body = {
            let mut b = vec![0x05]; // DYN_TEXT
            b.extend_from_slice(&7u16.to_le_bytes());
            b.extend_from_slice(&0u16.to_le_bytes());
            b
        };
        let opcodes = encode_list(0, 7, &body);
        let data = build_minimal_ir(&["items"], &[(0, 0, 0x04, 0x00, &[])], &opcodes, &[]);
        assert_eq!(
            IrModule::parse(&data).unwrap_err(),
            IrError::UnknownSlotId(7)
        );
    }

    #[test]
    fn validate_rejects_island_start_missing_from_table() {
        // An ISLAND_START with no island-table entry renders its markers but
        // no data-forma-* attributes, so the client silently never hydrates
        // it. Rejected at load instead.
        let mut opcodes = vec![0x0B]; // ISLAND_START
        opcodes.extend_from_slice(&3u16.to_le_bytes());
        opcodes.extend_from_slice(&encode_text(0));
        opcodes.push(0x0C); // ISLAND_END
        opcodes.extend_from_slice(&3u16.to_le_bytes());

        let data = build_minimal_ir(&["hi"], &[], &opcodes, &[]);
        assert_eq!(
            IrModule::parse(&data).unwrap_err(),
            IrError::UnknownIslandId(3)
        );
    }

    // -- Allocation guards (F-03 / F-13) ------------------------------------

    #[test]
    fn string_table_rejects_count_the_section_cannot_hold() {
        // A string entry costs at least 2 bytes on disk but 24 bytes of
        // `String` header in the reservation, so the old `count > data.len()`
        // guard permitted a 12x blow-up — and `Vec::with_capacity` OOM aborts
        // the process rather than returning an error.
        let mut data = Vec::new();
        data.extend_from_slice(&1_000_000u32.to_le_bytes()); // count
        data.extend_from_slice(&[0u8; 16]); // only 16 bytes of payload
        let err = StringTable::parse(&data).unwrap_err();
        assert!(matches!(err, IrError::BufferTooShort { .. }));
    }

    #[test]
    fn slot_table_rejects_count_the_section_cannot_hold() {
        // 2-byte section declaring 65,535 entries used to reserve ~2 MB.
        let data = 65535u16.to_le_bytes().to_vec();
        let err = SlotTable::parse(&data).unwrap_err();
        assert!(matches!(err, IrError::BufferTooShort { .. }));
    }

    #[test]
    fn island_table_rejects_count_the_section_cannot_hold() {
        let count = 4096u16.to_le_bytes();
        assert!(matches!(
            IslandTableParsed::parse(&count),
            Err(IrError::BufferTooShort { .. })
        ));
        assert_eq!(
            IslandTableParsed::parse(&4097u16.to_le_bytes())
                .unwrap_err()
                .code(),
            "LOAD-107"
        );
    }

    // -- Cross-table validation (F-12 / F-16) -------------------------------

    #[test]
    fn validate_rejects_duplicate_slot_ids() {
        let opcodes = encode_text(0);
        let data = build_minimal_ir(
            &["a", "b"],
            &[(0, 0, 0x01, 0x00, &[]), (0, 1, 0x01, 0x00, &[])],
            &opcodes,
            &[],
        );
        assert_eq!(
            IrModule::parse(&data).unwrap_err(),
            IrError::DuplicateSlotId(0)
        );
    }

    #[test]
    fn validate_rejects_duplicate_island_ids() {
        let mut opcodes = vec![0x0B];
        opcodes.extend_from_slice(&0u16.to_le_bytes());
        opcodes.push(0x0C);
        opcodes.extend_from_slice(&0u16.to_le_bytes());
        let data = build_minimal_ir(
            &["Comp"],
            &[],
            &opcodes,
            &[(0, 0x01, 0x01, 0, 0, &[]), (0, 0x01, 0x01, 0, 0, &[])],
        );
        assert_eq!(
            IrModule::parse(&data).unwrap_err(),
            IrError::DuplicateIslandId(0)
        );
    }

    #[test]
    fn validate_rejects_island_slot_id_absent_from_slot_table() {
        // The seam the compiler change that populates island slot_ids sits on:
        // a stale id used to be silently dropped from the props object, so the
        // island's SSR props disagreed with what the client expected, with
        // zero diagnostics.
        let mut opcodes = vec![0x0B];
        opcodes.extend_from_slice(&0u16.to_le_bytes());
        opcodes.push(0x0C);
        opcodes.extend_from_slice(&0u16.to_le_bytes());
        let data = build_minimal_ir(&["Comp"], &[], &opcodes, &[(0, 0x01, 0x01, 0, 0, &[7])]);
        assert_eq!(
            IrModule::parse(&data).unwrap_err(),
            IrError::UnknownSlotId(7)
        );
    }

    #[test]
    fn validate_rejects_island_offset_landing_mid_operand() {
        // An in-bounds offset that happens to sit on a stray 0x0B byte passes
        // a bare bounds check — hence the structural check reads the opcode
        // AND the island id that follows it. Here byte_offset=4 lands inside a
        // TEXT operand whose bytes decode as ISLAND_START(0), while the entry
        // claims island 1.
        let mut opcodes = vec![0x0B];
        opcodes.extend_from_slice(&1u16.to_le_bytes());
        // TEXT with str_idx bytes containing 0x0B
        opcodes.push(0x04);
        opcodes.extend_from_slice(&0x0Bu32.to_le_bytes());
        opcodes.push(0x0C);
        opcodes.extend_from_slice(&1u16.to_le_bytes());

        let data = build_minimal_ir(&["Comp"], &[], &opcodes, &[(1, 0x01, 0x01, 0, 4, &[])]);
        assert_eq!(
            IrModule::parse(&data).unwrap_err(),
            IrError::IslandOffsetMismatch {
                island_id: 1,
                byte_offset: 4
            }
        );
    }

    #[test]
    fn validate_rejects_opcode_slot_id_absent_from_slot_table() {
        // DYN_TEXT naming slot 9 with an empty slot table.
        let mut opcodes = vec![0x05];
        opcodes.extend_from_slice(&9u16.to_le_bytes());
        opcodes.extend_from_slice(&0u16.to_le_bytes());
        let data = build_minimal_ir(&["a"], &[], &opcodes, &[]);
        assert_eq!(
            IrModule::parse(&data).unwrap_err(),
            IrError::UnknownSlotId(9)
        );
    }

    #[test]
    fn slot_and_island_lookups_are_indexed() {
        let mut opcodes = vec![0x0B];
        opcodes.extend_from_slice(&3u16.to_le_bytes());
        opcodes.push(0x0C);
        opcodes.extend_from_slice(&3u16.to_le_bytes());
        let data = build_minimal_ir(
            &["Comp", "title"],
            &[(4, 1, 0x01, 0x00, &[])],
            &opcodes,
            &[(3, 0x01, 0x01, 0, 0, &[4])],
        );
        let module = IrModule::parse(&data).unwrap();

        assert_eq!(module.slot_entry(4).unwrap().slot_id, 4);
        assert!(module.slot_entry(0).is_none());
        assert_eq!(module.island_entry(3).unwrap().id, 3);
        assert!(module.island_entry(0).is_none());
        // Out-of-range ids must not panic on the dense index.
        assert!(module.slot_entry(u16::MAX).is_none());
        assert!(module.island_entry(u16::MAX).is_none());
    }
}
