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
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IrError {
    /// Input buffer is too short to contain the expected structure.
    BufferTooShort { expected: usize, actual: usize },
    /// Magic bytes do not match "FMIR".
    BadMagic([u8; 4]),
    /// IR version is not supported.
    UnsupportedVersion(u16),
    /// A section extends beyond the file boundary.
    SectionOutOfBounds {
        section: usize,
        offset: u32,
        size: u32,
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
    StringIndexOutOfBounds { index: u32, len: usize },
    /// A byte sequence is not valid UTF-8.
    InvalidUtf8(String),
    /// Nested LIST depth exceeded the maximum allowed.
    ListDepthExceeded { max: u8 },
    /// An island with the given id was not found in the island table.
    IslandNotFound(u16),
    /// Failed to parse JSON input.
    JsonParseError(String),
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
                write!(f, "string index {index} out of bounds (table has {len} entries)")
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
/// [6..8)   flags        – u16 (reserved, must be 0)
/// [8..16)  source_hash  – u64 (hash of original source)
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IrHeader {
    pub version: u16,
    pub flags: u16,
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

        let flags = u16::from_le_bytes(data[6..8].try_into().unwrap());
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
    pub offset: u32,
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
        for i in 0..4 {
            let base = i * 8;
            let offset = u32::from_le_bytes(data[base..base + 4].try_into().unwrap());
            let size = u32::from_le_bytes(data[base + 4..base + 8].try_into().unwrap());
            sections[i] = SectionDescriptor { offset, size };
        }

        Ok(SectionTable { sections })
    }

    /// Validate that every section falls within `file_len` bytes.
    pub fn validate(&self, file_len: usize) -> Result<(), IrError> {
        for (i, sec) in self.sections.iter().enumerate() {
            let end = sec.offset as usize + sec.size as usize;
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
// Opcode enum (16 opcodes, 0x01–0x10)
// ---------------------------------------------------------------------------

/// Bytecode opcodes for the FMIR instruction stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Opcode {
    OpenTag = 0x01,
    CloseTag = 0x02,
    VoidTag = 0x03,
    Text = 0x04,
    DynText = 0x05,
    DynAttr = 0x06,
    ShowIf = 0x07,
    ShowElse = 0x08,
    Switch = 0x09,
    List = 0x0A,
    IslandStart = 0x0B,
    IslandEnd = 0x0C,
    TryStart = 0x0D,
    Fallback = 0x0E,
    Preload = 0x0F,
    Comment = 0x10,
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
    Text = 0x01,
    Bool = 0x02,
    Number = 0x03,
    Array = 0x04,
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
    Load = 0x01,
    Visible = 0x02,
    Interaction = 0x03,
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
    Inline = 0x01,
    ScriptTag = 0x02,
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
    Server = 0x00,
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
        assert_eq!(st.sections[0], SectionDescriptor { offset: 48, size: 100 });
        assert_eq!(st.sections[1], SectionDescriptor { offset: 148, size: 200 });
        assert_eq!(st.sections[2], SectionDescriptor { offset: 348, size: 50 });
        assert_eq!(st.sections[3], SectionDescriptor { offset: 398, size: 30 });
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
        assert_eq!(Opcode::from_byte(0x00).unwrap_err(), IrError::InvalidOpcode(0x00));
        assert_eq!(Opcode::from_byte(0x13).unwrap_err(), IrError::InvalidOpcode(0x13));
        assert_eq!(Opcode::from_byte(0xFF).unwrap_err(), IrError::InvalidOpcode(0xFF));
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
            assert_eq!(SlotType::from_byte(*byte).unwrap(), *st, "byte 0x{byte:02x}");
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
