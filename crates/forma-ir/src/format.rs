//! FMIR binary format definition and parsers.
//!
//! Defines the on-disk layout for Forma Module IR files:
//! - 16-byte header (magic, version, flags, source hash)
//! - 32-byte section table (4 sections x 8 bytes each)
//! - Opcode, SlotType, IslandTrigger, PropsMode enums
//! - SlotEntry and IslandEntry structs
//!
//! All multi-byte integers are little-endian.

use std::fmt;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Magic bytes identifying an FMIR file.
pub const MAGIC: &[u8; 4] = b"FMIR";

/// Size of the file header in bytes.
pub const HEADER_SIZE: usize = 16;

/// Size of the section table in bytes (4 sections x 8 bytes).
pub const SECTION_TABLE_SIZE: usize = 32;

/// Current IR format version.
pub const IR_VERSION: u16 = 2;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/// Errors that can occur when parsing FMIR binary data.
///
/// Marked `#[non_exhaustive]`: new failure modes are added as the parser is
/// hardened, and downstream crates must not break when that happens. Match
/// with a `_ =>` arm (or just use `Display`).
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum IrError {
    /// Input buffer is too short to contain the expected structure.
    BufferTooShort {
        /// Bytes the structure needed.
        expected: usize,
        /// Bytes actually available.
        actual: usize,
    },
    /// Magic bytes do not match "FMIR".
    BadMagic([u8; 4]),
    /// IR version is not supported.
    UnsupportedVersion(u16),
    /// A section extends beyond the file boundary.
    SectionOutOfBounds {
        /// Index of the offending section in the section table.
        section: usize,
        /// The section's declared byte offset.
        offset: u32,
        /// The section's declared byte length.
        size: u32,
        /// Length of the file the offsets were read from.
        file_len: usize,
    },
    /// An opcode byte does not map to a known opcode.
    InvalidOpcode(u8),
    /// A slot-type byte does not map to a known slot type.
    InvalidSlotType(u8),
    /// An island-trigger byte does not map to a known trigger.
    InvalidIslandTrigger(u8),
    /// A props-mode byte does not map to a known mode.
    InvalidPropsMode(u8),
    /// A slot-source byte does not map to a known source.
    InvalidSlotSource(u8),
    /// A string index is out of bounds.
    StringIndexOutOfBounds {
        /// The index that was asked for.
        index: u32,
        /// Number of entries the string table actually holds.
        len: usize,
    },
    /// A byte sequence is not valid UTF-8.
    InvalidUtf8(String),
    /// Nested LIST depth exceeded the maximum allowed.
    ListDepthExceeded {
        /// The nesting limit that was exceeded.
        max: u8,
    },
    /// An island with the given id was not found in the island table.
    IslandNotFound(u16),
    /// Failed to parse JSON input.
    JsonParseError(String),
    /// A section descriptor has invalid values (e.g. integer overflow).
    ///
    /// Also returned for opcode-stream offsets that overflow or point outside
    /// the region they were read from (branch/body lengths in SHOW_IF, SWITCH,
    /// LIST and TRY_START/FALLBACK).
    InvalidSection,
    /// Recursive opcode nesting (SHOW_IF, LIST, SWITCH, etc.) exceeded the
    /// maximum allowed depth.
    RecursionLimitExceeded,
    /// The rendered HTML exceeded the walker's configured output budget.
    OutputLimitExceeded {
        /// The byte budget that was exceeded.
        limit: usize,
    },
    /// Total LIST item iterations exceeded the walker's per-render budget.
    /// Distinct from [`IrError::ListDepthExceeded`], which bounds *nesting*.
    ListBudgetExceeded {
        /// The total-iteration budget that was exceeded.
        max: usize,
    },
    /// The header's reserved `flags` field carried an unknown non-zero bit.
    UnsupportedFlags(u16),
    /// A tag or attribute name from the string table is not a legal HTML name.
    InvalidName(String),
    /// The slot table declares the same `slot_id` more than once.
    DuplicateSlotId(u16),
    /// The island table declares the same island `id` more than once.
    DuplicateIslandId(u16),
    /// An island's `byte_offset` does not point at an ISLAND_START opcode
    /// carrying that island's own id.
    IslandOffsetMismatch {
        /// The island whose table entry is wrong.
        island_id: u16,
        /// The byte offset that entry declared.
        byte_offset: u32,
    },
    /// A slot id referenced by an island entry or an opcode is not declared
    /// in the slot table.
    UnknownSlotId(u16),
    /// The opcode stream's control-flow regions do not tile exactly: a
    /// branch/body length does not line up with the opcodes it contains.
    MalformedControlFlow {
        /// Byte offset in the opcode stream where the mismatch was detected.
        pos: usize,
    },
    /// An ISLAND_START opcode names an island id the island table does not
    /// declare. Such an island emits its `<!--f:iN-->` markers but no
    /// `data-forma-*` attributes, so the client can never hydrate it.
    UnknownIslandId(u16),
    /// Two ISLAND_START opcodes are pending on the same element: the outer
    /// island's body opens no tag of its own before the inner island starts,
    /// so only one of them can carry the `data-forma-island` attribute set and
    /// the other would silently never hydrate.
    NestedIslandRoot {
        /// The island still waiting for a root element.
        outer: u16,
        /// The island that started before it got one.
        inner: u16,
    },
}

impl fmt::Display for IrError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            IrError::BufferTooShort { expected, actual } => {
                write!(
                    f,
                    "buffer too short: expected at least {expected} bytes, got {actual}"
                )
            }
            IrError::BadMagic(got) => {
                write!(f, "bad magic: expected FMIR, got {:?}", got)
            }
            IrError::UnsupportedVersion(v) => {
                write!(f, "unsupported IR version: {v} (expected {IR_VERSION})")
            }
            IrError::SectionOutOfBounds {
                section,
                offset,
                size,
                file_len,
            } => {
                write!(
                    f,
                    "section {section} out of bounds: offset={offset}, size={size}, file_len={file_len}"
                )
            }
            IrError::InvalidOpcode(b) => write!(f, "invalid opcode: 0x{b:02x}"),
            IrError::InvalidSlotType(b) => write!(f, "invalid slot type: 0x{b:02x}"),
            IrError::InvalidIslandTrigger(b) => {
                write!(f, "invalid island trigger: 0x{b:02x}")
            }
            IrError::InvalidPropsMode(b) => write!(f, "invalid props mode: 0x{b:02x}"),
            IrError::InvalidSlotSource(b) => write!(f, "invalid slot source: 0x{b:02x}"),
            IrError::StringIndexOutOfBounds { index, len } => {
                write!(
                    f,
                    "string index {index} out of bounds (table has {len} entries)"
                )
            }
            IrError::InvalidUtf8(msg) => write!(f, "invalid UTF-8: {msg}"),
            IrError::ListDepthExceeded { max } => {
                write!(f, "nested LIST depth exceeded maximum of {max}")
            }
            IrError::IslandNotFound(id) => {
                write!(f, "island with id {id} not found in island table")
            }
            IrError::JsonParseError(msg) => {
                write!(f, "JSON parse error: {msg}")
            }
            IrError::InvalidSection => {
                write!(f, "invalid section or opcode offset (out of range)")
            }
            IrError::RecursionLimitExceeded => {
                write!(f, "recursion limit exceeded (maximum depth: 64)")
            }
            IrError::OutputLimitExceeded { limit } => {
                write!(f, "rendered output exceeded the limit of {limit} bytes")
            }
            IrError::ListBudgetExceeded { max } => {
                write!(f, "total LIST iterations exceeded the budget of {max}")
            }
            IrError::UnsupportedFlags(flags) => {
                write!(f, "unsupported header flags: 0x{flags:04x} (must be 0)")
            }
            IrError::InvalidName(name) => {
                write!(f, "invalid tag or attribute name: {name:?}")
            }
            IrError::DuplicateSlotId(id) => {
                write!(f, "duplicate slot id {id} in slot table")
            }
            IrError::DuplicateIslandId(id) => {
                write!(f, "duplicate island id {id} in island table")
            }
            IrError::IslandOffsetMismatch {
                island_id,
                byte_offset,
            } => {
                write!(
                    f,
                    "island {island_id} byte_offset {byte_offset} does not point at its ISLAND_START opcode"
                )
            }
            IrError::UnknownSlotId(id) => {
                write!(f, "slot id {id} is not declared in the slot table")
            }
            IrError::MalformedControlFlow { pos } => {
                write!(
                    f,
                    "malformed control flow: region lengths do not tile at byte {pos}"
                )
            }
            IrError::UnknownIslandId(id) => {
                write!(f, "island id {id} is not declared in the island table")
            }
            IrError::NestedIslandRoot { outer, inner } => {
                write!(
                    f,
                    "island {inner} starts before island {outer} has opened its root element — \
                     one of them could never carry its data-forma-* attributes"
                )
            }
        }
    }
}

impl std::error::Error for IrError {}

// ---------------------------------------------------------------------------
// Header (16 bytes)
// ---------------------------------------------------------------------------

/// FMIR file header — the first 16 bytes of every `.fmir` file.
///
/// Layout (little-endian):
/// ```text
/// [0..4)   magic        – b"FMIR"
/// [4..6)   version      – u16
/// [6..8)   flags        – u16 (reserved; MUST be 0 — any non-zero bit is a
///                        hard parse error, so unknown future extensions fail
///                        closed instead of being silently mis-parsed. A new
///                        flag bit therefore requires a coordinated forma-ir
///                        release before the compiler may emit it.)
/// [8..16)  source_hash  – u64 (hash of original source; currently written as
///                        0 by the JS compiler and not verified here)
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IrHeader {
    /// FMIR format version. Always [`IR_VERSION`] for a header that parsed.
    pub version: u16,
    /// Reserved bit field, validated to be zero (see the layout above).
    pub flags: u16,
    /// Hash of the original source module. Written as 0 by the JS compiler
    /// today and not verified here.
    pub source_hash: u64,
}

impl IrHeader {
    /// Parse an `IrHeader` from the first 16 bytes of `data`.
    pub fn parse(data: &[u8]) -> Result<Self, IrError> {
        if data.len() < HEADER_SIZE {
            return Err(IrError::BufferTooShort {
                expected: HEADER_SIZE,
                actual: data.len(),
            });
        }

        let magic: [u8; 4] = data[0..4].try_into().unwrap();
        if &magic != MAGIC {
            return Err(IrError::BadMagic(magic));
        }

        let version = u16::from_le_bytes(data[4..6].try_into().unwrap());
        if version != IR_VERSION {
            return Err(IrError::UnsupportedVersion(version));
        }

        // `flags` is reserved. Reject any non-zero bit so that a future
        // extension (compression, extended section table, ...) fails closed on
        // an old reader instead of being silently ignored and mis-parsed.
        let flags = u16::from_le_bytes(data[6..8].try_into().unwrap());
        if flags != 0 {
            return Err(IrError::UnsupportedFlags(flags));
        }

        let source_hash = u64::from_le_bytes(data[8..16].try_into().unwrap());

        Ok(IrHeader {
            version,
            flags,
            source_hash,
        })
    }
}

// ---------------------------------------------------------------------------
// Section table (32 bytes)
// ---------------------------------------------------------------------------

/// A single section descriptor: offset + size (both u32, little-endian).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SectionDescriptor {
    /// Byte offset of the section from the start of the file.
    pub offset: u32,
    /// Length of the section in bytes.
    pub size: u32,
}

/// Section table — four section descriptors immediately following the header.
///
/// Sections (in order):
/// 0. Bytecode
/// 1. String table
/// 2. Slot table
/// 3. Island table
///
/// Layout: 4 x (offset u32 + size u32) = 32 bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SectionTable {
    /// Bytecode, string table, slot table, island table — in that order.
    pub sections: [SectionDescriptor; 4],
}

impl SectionTable {
    /// Parse a `SectionTable` from `data` (must be at least 32 bytes).
    pub fn parse(data: &[u8]) -> Result<Self, IrError> {
        if data.len() < SECTION_TABLE_SIZE {
            return Err(IrError::BufferTooShort {
                expected: SECTION_TABLE_SIZE,
                actual: data.len(),
            });
        }

        let mut sections = [SectionDescriptor { offset: 0, size: 0 }; 4];
        for (i, section) in sections.iter_mut().enumerate() {
            let base = i * 8;
            let offset = u32::from_le_bytes(data[base..base + 4].try_into().unwrap());
            let size = u32::from_le_bytes(data[base + 4..base + 8].try_into().unwrap());
            *section = SectionDescriptor { offset, size };
        }

        Ok(SectionTable { sections })
    }

    /// Validate that every section falls within `file_len` bytes.
    pub fn validate(&self, file_len: usize) -> Result<(), IrError> {
        for (i, sec) in self.sections.iter().enumerate() {
            let end = (sec.offset as usize)
                .checked_add(sec.size as usize)
                .ok_or(IrError::InvalidSection)?;
            if end > file_len {
                return Err(IrError::SectionOutOfBounds {
                    section: i,
                    offset: sec.offset,
                    size: sec.size,
                    file_len,
                });
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Opcode enum (18 opcodes, 0x01–0x12)
//
// Six are decoded and walked but never emitted by @getforma/compiler today:
// Switch, TryStart, Fallback, Preload, Comment, ListItemKey. They are reserved
// wire space, not dead code — see docs/ARCHITECTURE.md §B1. ListItemKey in
// particular cannot be emitted usefully as specified: its operand is a static
// string index, so every row would carry the same key. Per-item keys need an
// FMIR version bump.
// ---------------------------------------------------------------------------

/// Bytecode opcodes for the FMIR instruction stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Opcode {
    /// Open an element. `str_idx(u32) + attr_count(u16) + [(key u32, val u32)]`
    OpenTag = 0x01,
    /// Close the named element. `str_idx(u32)`
    CloseTag = 0x02,
    /// A void element, which takes no CLOSE_TAG. Same operands as OPEN_TAG.
    VoidTag = 0x03,
    /// Static text from the string table. `str_idx(u32)`
    Text = 0x04,
    /// Slot-bound text wrapped in `<!--f:tN-->` markers.
    /// `slot_id(u16) + marker_id(u16)`
    DynText = 0x05,
    /// Slot-bound attribute on the tag currently being opened.
    /// `attr_str_idx(u32) + slot_id(u16)`
    DynAttr = 0x06,
    /// Conditional region wrapped in `<!--f:sN-->` markers.
    /// `slot_id(u16) + then_len(u32) + else_len(u32)`, then the two bodies
    /// separated by a [`Opcode::ShowElse`] byte.
    ShowIf = 0x07,
    /// Separator byte between a SHOW_IF's then- and else-bodies.
    ShowElse = 0x08,
    /// First-match-wins multi-way branch on a slot's text.
    /// `slot_id(u16) + case_count(u16)`, then one
    /// `(val_str_idx u32, body_len u32)` header per case, then the bodies.
    Switch = 0x09,
    /// Repeat a body once per element of an array slot, wrapped in
    /// `<!--f:lN-->` markers. `slot_id(u16) + item_slot_id(u16) + body_len(u32)`
    List = 0x0A,
    /// Begin an island region. `island_id(u16)`
    IslandStart = 0x0B,
    /// End an island region. `island_id(u16)`
    IslandEnd = 0x0C,
    /// Begin a try block. `fallback_len(u32)`
    TryStart = 0x0D,
    /// Separator between a try block's main and fallback bodies.
    Fallback = 0x0E,
    /// Emit a `<link rel="preload">`. `resource_type(u8) + url_str_idx(u32)`
    Preload = 0x0F,
    /// An HTML comment. `str_idx(u32)`
    Comment = 0x10,
    /// Set `data-forma-key` on the next element opened in a LIST body.
    /// `key_str_idx(u32)`
    ///
    /// LIMITATION: the operand is a *static* string-table index, so every item
    /// in a list gets the same key. Per-item keys would need a slot-bound
    /// operand, which is a v-bump to this opcode's layout and a coordinated
    /// compiler change — not something the walker can work around.
    ListItemKey = 0x11,
    /// Extract a named property from an Object slot into a target slot.
    /// Format: src_slot_id(u16) + prop_str_idx(u32) + target_slot_id(u16)
    Prop = 0x12,
}

impl Opcode {
    /// Convert a raw byte to an `Opcode`.
    pub fn from_byte(b: u8) -> Result<Self, IrError> {
        match b {
            0x01 => Ok(Opcode::OpenTag),
            0x02 => Ok(Opcode::CloseTag),
            0x03 => Ok(Opcode::VoidTag),
            0x04 => Ok(Opcode::Text),
            0x05 => Ok(Opcode::DynText),
            0x06 => Ok(Opcode::DynAttr),
            0x07 => Ok(Opcode::ShowIf),
            0x08 => Ok(Opcode::ShowElse),
            0x09 => Ok(Opcode::Switch),
            0x0A => Ok(Opcode::List),
            0x0B => Ok(Opcode::IslandStart),
            0x0C => Ok(Opcode::IslandEnd),
            0x0D => Ok(Opcode::TryStart),
            0x0E => Ok(Opcode::Fallback),
            0x0F => Ok(Opcode::Preload),
            0x10 => Ok(Opcode::Comment),
            0x11 => Ok(Opcode::ListItemKey),
            0x12 => Ok(Opcode::Prop),
            _ => Err(IrError::InvalidOpcode(b)),
        }
    }
}

// ---------------------------------------------------------------------------
// SlotType enum (5 types)
// ---------------------------------------------------------------------------

/// Data type hint for a slot entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SlotType {
    /// A string.
    Text = 0x01,
    /// A boolean.
    Bool = 0x02,
    /// An IEEE-754 double, formatted the way ECMAScript formats it.
    Number = 0x03,
    /// An array, the only type a LIST may iterate.
    Array = 0x04,
    /// A key/value object, the only type PROP may read from.
    Object = 0x05,
}

impl SlotType {
    /// Convert a raw byte to a `SlotType`.
    pub fn from_byte(b: u8) -> Result<Self, IrError> {
        match b {
            0x01 => Ok(SlotType::Text),
            0x02 => Ok(SlotType::Bool),
            0x03 => Ok(SlotType::Number),
            0x04 => Ok(SlotType::Array),
            0x05 => Ok(SlotType::Object),
            _ => Err(IrError::InvalidSlotType(b)),
        }
    }
}

// ---------------------------------------------------------------------------
// IslandTrigger enum (4 triggers)
// ---------------------------------------------------------------------------

/// When an island should be hydrated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum IslandTrigger {
    /// Hydrate as soon as the page's JS runs.
    Load = 0x01,
    /// Hydrate when the island scrolls into view.
    Visible = 0x02,
    /// Hydrate on the first user interaction with the island.
    Interaction = 0x03,
    /// Hydrate when the main thread next goes idle.
    Idle = 0x04,
}

impl IslandTrigger {
    /// Convert a raw byte to an `IslandTrigger`.
    pub fn from_byte(b: u8) -> Result<Self, IrError> {
        match b {
            0x01 => Ok(IslandTrigger::Load),
            0x02 => Ok(IslandTrigger::Visible),
            0x03 => Ok(IslandTrigger::Interaction),
            0x04 => Ok(IslandTrigger::Idle),
            _ => Err(IrError::InvalidIslandTrigger(b)),
        }
    }
}

// ---------------------------------------------------------------------------
// PropsMode enum (3 modes)
// ---------------------------------------------------------------------------

/// How island props are delivered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PropsMode {
    /// Props serialized into a `data-forma-props` attribute on the island root.
    Inline = 0x01,
    /// Props accumulated into a shared `<script id="__forma_islands">` JSON
    /// block at the end of the page.
    ///
    /// NOT YET EMITTED BY THE COMPILER — `@getforma/compiler` hardcodes
    /// `Inline` at every `addIsland` call site, so nothing in the toolchain
    /// produces this value today. The walker supports it because `forma-ir`
    /// accepts FMIR from any producer, but treat it as a dormant branch rather
    /// than a shipping feature until the compiler opts into it (the intended
    /// trigger being props too large for an attribute).
    ScriptTag = 0x02,
    /// Reserved. NOT IMPLEMENTED on either side of the stack.
    ///
    /// The name promises props fetched by the client after hydration, but
    /// there is no mechanism behind it: the walker emits no props and no fetch
    /// hint (no `data-forma-props-src`, nothing), and `@getforma/core`'s
    /// `loadIslandProps` knows only the inline attribute and the shared block.
    /// An island declared `Deferred` is therefore indistinguishable from an
    /// island with no props at all. Treat it as reserved wire space, not as a
    /// feature — the compiler never emits it.
    Deferred = 0x03,
}

impl PropsMode {
    /// Convert a raw byte to a `PropsMode`.
    pub fn from_byte(b: u8) -> Result<Self, IrError> {
        match b {
            0x01 => Ok(PropsMode::Inline),
            0x02 => Ok(PropsMode::ScriptTag),
            0x03 => Ok(PropsMode::Deferred),
            _ => Err(IrError::InvalidPropsMode(b)),
        }
    }
}

// ---------------------------------------------------------------------------
// SlotSource enum (2 sources)
// ---------------------------------------------------------------------------

/// Where the slot value originates at runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SlotSource {
    /// Filled by the page handler before the walk. Still `Null` at render
    /// time means the handler probably has a bug, and the walker warns.
    Server = 0x00,
    /// Owned by the client runtime; the slot table's default is what SSR
    /// renders.
    Client = 0x01,
}

impl SlotSource {
    /// Convert a raw byte to a `SlotSource`.
    pub fn from_byte(b: u8) -> Result<Self, IrError> {
        match b {
            0x00 => Ok(SlotSource::Server),
            0x01 => Ok(SlotSource::Client),
            _ => Err(IrError::InvalidSlotSource(b)),
        }
    }
}

// ---------------------------------------------------------------------------
// SlotEntry
// ---------------------------------------------------------------------------

/// A slot declaration in the slot table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlotEntry {
    /// Unique slot identifier within the module.
    pub slot_id: u16,
    /// Index into the string table for the slot name.
    pub name_str_idx: u32,
    /// Expected data type for this slot.
    pub type_hint: SlotType,
    /// Where the slot value originates at runtime.
    pub source: SlotSource,
    /// Default value bytes (empty if no default).
    pub default_bytes: Vec<u8>,
}

// ---------------------------------------------------------------------------
// IslandEntry
// ---------------------------------------------------------------------------

/// An island declaration in the island table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IslandEntry {
    /// Unique island identifier within the module.
    pub id: u16,
    /// When this island should hydrate.
    pub trigger: IslandTrigger,
    /// How props are delivered to the island.
    pub props_mode: PropsMode,
    /// Index into the string table for the island name.
    pub name_str_idx: u32,
    /// Byte offset of the ISLAND_START opcode in the bytecode stream.
    pub byte_offset: u32,
    /// Which slots belong to this island.
    pub slot_ids: Vec<u16>,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a valid 16-byte FMIR header.
    fn make_header(version: u16, flags: u16, source_hash: u64) -> Vec<u8> {
        let mut buf = Vec::with_capacity(HEADER_SIZE);
        buf.extend_from_slice(MAGIC);
        buf.extend_from_slice(&version.to_le_bytes());
        buf.extend_from_slice(&flags.to_le_bytes());
        buf.extend_from_slice(&source_hash.to_le_bytes());
        buf
    }

    #[test]
    fn parse_valid_header() {
        let data = make_header(2, 0, 0xDEAD_BEEF_CAFE_BABE);
        let hdr = IrHeader::parse(&data).unwrap();
        assert_eq!(hdr.version, 2);
        assert_eq!(hdr.flags, 0);
        assert_eq!(hdr.source_hash, 0xDEAD_BEEF_CAFE_BABE);
    }

    #[test]
    fn reject_bad_magic() {
        let mut data = make_header(2, 0, 0);
        data[0..4].copy_from_slice(b"NOPE");
        let err = IrHeader::parse(&data).unwrap_err();
        assert_eq!(err, IrError::BadMagic(*b"NOPE"));
    }

    #[test]
    fn reject_unsupported_version() {
        let data = make_header(99, 0, 0);
        let err = IrHeader::parse(&data).unwrap_err();
        assert_eq!(err, IrError::UnsupportedVersion(99));
    }

    #[test]
    fn reject_nonzero_flags() {
        // `flags` is reserved and must be 0 — a future extension bit must fail
        // closed on this reader rather than being silently ignored.
        let data = make_header(2, 1, 0);
        let err = IrHeader::parse(&data).unwrap_err();
        assert_eq!(err, IrError::UnsupportedFlags(1));

        let data = make_header(2, 0x8000, 0);
        let err = IrHeader::parse(&data).unwrap_err();
        assert_eq!(err, IrError::UnsupportedFlags(0x8000));
    }

    /// Build a 32-byte section table from four (offset, size) pairs.
    fn make_section_table(sections: [(u32, u32); 4]) -> Vec<u8> {
        let mut buf = Vec::with_capacity(SECTION_TABLE_SIZE);
        for (offset, size) in &sections {
            buf.extend_from_slice(&offset.to_le_bytes());
            buf.extend_from_slice(&size.to_le_bytes());
        }
        buf
    }

    #[test]
    fn parse_section_table() {
        let data = make_section_table([
            (48, 100),  // bytecode
            (148, 200), // string table
            (348, 50),  // slot table
            (398, 30),  // island table
        ]);
        let st = SectionTable::parse(&data).unwrap();
        assert_eq!(
            st.sections[0],
            SectionDescriptor {
                offset: 48,
                size: 100
            }
        );
        assert_eq!(
            st.sections[1],
            SectionDescriptor {
                offset: 148,
                size: 200
            }
        );
        assert_eq!(
            st.sections[2],
            SectionDescriptor {
                offset: 348,
                size: 50
            }
        );
        assert_eq!(
            st.sections[3],
            SectionDescriptor {
                offset: 398,
                size: 30
            }
        );
    }

    #[test]
    fn validate_section_bounds() {
        let data = make_section_table([
            (48, 100),
            (148, 200),
            (348, 50),
            (398, 9999), // way past end
        ]);
        let st = SectionTable::parse(&data).unwrap();
        let err = st.validate(500).unwrap_err();
        assert_eq!(
            err,
            IrError::SectionOutOfBounds {
                section: 3,
                offset: 398,
                size: 9999,
                file_len: 500,
            }
        );
    }

    #[test]
    fn opcode_from_byte_all_valid() {
        let expected = [
            (0x01, Opcode::OpenTag),
            (0x02, Opcode::CloseTag),
            (0x03, Opcode::VoidTag),
            (0x04, Opcode::Text),
            (0x05, Opcode::DynText),
            (0x06, Opcode::DynAttr),
            (0x07, Opcode::ShowIf),
            (0x08, Opcode::ShowElse),
            (0x09, Opcode::Switch),
            (0x0A, Opcode::List),
            (0x0B, Opcode::IslandStart),
            (0x0C, Opcode::IslandEnd),
            (0x0D, Opcode::TryStart),
            (0x0E, Opcode::Fallback),
            (0x0F, Opcode::Preload),
            (0x10, Opcode::Comment),
            (0x11, Opcode::ListItemKey),
            (0x12, Opcode::Prop),
        ];
        for (byte, op) in &expected {
            assert_eq!(Opcode::from_byte(*byte).unwrap(), *op, "byte 0x{byte:02x}");
        }
    }

    #[test]
    fn opcode_from_byte_invalid() {
        assert_eq!(
            Opcode::from_byte(0x00).unwrap_err(),
            IrError::InvalidOpcode(0x00)
        );
        assert_eq!(
            Opcode::from_byte(0x13).unwrap_err(),
            IrError::InvalidOpcode(0x13)
        );
        assert_eq!(
            Opcode::from_byte(0xFF).unwrap_err(),
            IrError::InvalidOpcode(0xFF)
        );
    }

    #[test]
    fn slot_type_from_byte() {
        let expected = [
            (0x01, SlotType::Text),
            (0x02, SlotType::Bool),
            (0x03, SlotType::Number),
            (0x04, SlotType::Array),
            (0x05, SlotType::Object),
        ];
        for (byte, st) in &expected {
            assert_eq!(
                SlotType::from_byte(*byte).unwrap(),
                *st,
                "byte 0x{byte:02x}"
            );
        }
        assert_eq!(
            SlotType::from_byte(0x00).unwrap_err(),
            IrError::InvalidSlotType(0x00)
        );
        assert_eq!(
            SlotType::from_byte(0x06).unwrap_err(),
            IrError::InvalidSlotType(0x06)
        );
    }

    #[test]
    fn island_trigger_from_byte() {
        let expected = [
            (0x01, IslandTrigger::Load),
            (0x02, IslandTrigger::Visible),
            (0x03, IslandTrigger::Interaction),
            (0x04, IslandTrigger::Idle),
        ];
        for (byte, trigger) in &expected {
            assert_eq!(
                IslandTrigger::from_byte(*byte).unwrap(),
                *trigger,
                "byte 0x{byte:02x}"
            );
        }
        assert_eq!(
            IslandTrigger::from_byte(0x00).unwrap_err(),
            IrError::InvalidIslandTrigger(0x00)
        );
        assert_eq!(
            IslandTrigger::from_byte(0x05).unwrap_err(),
            IrError::InvalidIslandTrigger(0x05)
        );
    }

    #[test]
    fn props_mode_from_byte() {
        let expected = [
            (0x01, PropsMode::Inline),
            (0x02, PropsMode::ScriptTag),
            (0x03, PropsMode::Deferred),
        ];
        for (byte, mode) in &expected {
            assert_eq!(
                PropsMode::from_byte(*byte).unwrap(),
                *mode,
                "byte 0x{byte:02x}"
            );
        }
        assert_eq!(
            PropsMode::from_byte(0x00).unwrap_err(),
            IrError::InvalidPropsMode(0x00)
        );
        assert_eq!(
            PropsMode::from_byte(0x04).unwrap_err(),
            IrError::InvalidPropsMode(0x04)
        );
    }

    #[test]
    fn slot_source_from_byte() {
        assert_eq!(SlotSource::from_byte(0x00).unwrap(), SlotSource::Server);
        assert_eq!(SlotSource::from_byte(0x01).unwrap(), SlotSource::Client);
        assert_eq!(
            SlotSource::from_byte(0x02).unwrap_err(),
            IrError::InvalidSlotSource(0x02)
        );
        assert_eq!(
            SlotSource::from_byte(0xFF).unwrap_err(),
            IrError::InvalidSlotSource(0xFF)
        );
    }
}
