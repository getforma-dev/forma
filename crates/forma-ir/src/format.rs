//! FMIR binary format definition and parsers.
//!
//! Defines the on-disk layout for Forma Module IR files:
//! - 24-byte signature/version/length/CRC header
//! - Variable section table (count + reserved + 12-byte descriptors)
//! - Opcode, SlotType, IslandTrigger enums
//! - SlotEntry and IslandEntry structs
//!
//! All multi-byte integers are little-endian.

use std::fmt;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Shared FMIR constants, generated from the root fmir-constants.json.
include!("fmir_constants.rs");

/// Base version of this reader, taken from Cargo package metadata.
pub fn reader_version() -> [u16; 3] {
    // Cargo validates these components. Invalid/out-of-u16 metadata cannot accept a module.
    [
        env!("CARGO_PKG_VERSION_MAJOR").parse().unwrap_or(u16::MAX),
        env!("CARGO_PKG_VERSION_MINOR").parse().unwrap_or(u16::MAX),
        env!("CARGO_PKG_VERSION_PATCH").parse().unwrap_or(u16::MAX),
    ]
}

/// Whether a reader accepts a writer: the same major and no newer minor.
/// Patch versions and package prerelease suffixes do not narrow the wire window.
pub const fn accepts_writer(reader: [u16; 3], writer: [u16; 3]) -> bool {
    reader[0] == writer[0] && writer[1] <= reader[1]
}

/// CRC-32/ISO-HDLC of a sequence of byte slices, without adding bytes at their boundaries.
pub fn crc32(chunks: &[&[u8]]) -> u32 {
    const fn table() -> [u32; 256] {
        let mut out = [0; 256];
        let mut i = 0;
        while i < 256 {
            let mut c = i as u32;
            let mut bit = 0;
            while bit < 8 {
                c = (c >> 1) ^ if c & 1 != 0 { CRC_POLYNOMIAL } else { 0 };
                bit += 1;
            }
            out[i] = c;
            i += 1;
        }
        out
    }
    const TABLE: [u32; 256] = table();
    let mut c = 0xffffffff;
    for chunk in chunks {
        for &b in *chunk {
            c = TABLE[((c ^ u32::from(b)) & 255) as usize] ^ (c >> 8);
        }
    }
    c ^ 0xffffffff
}

/// Refuse an input-driven count before allocation when it exceeds its named ceiling.
pub(crate) fn limit(name: &'static str, actual: usize, max: usize) -> Result<(), IrError> {
    if actual > max {
        Err(IrError::LimitExceeded(Box::new(LimitViolation {
            limit: name,
            max,
            actual,
        })))
    } else {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Little-endian reads
// ---------------------------------------------------------------------------
//
// Each call site has already checked that its slice is in bounds and of the
// width read; these index rather than `try_into().unwrap()` so the crate
// carries no `unwrap` (DR-12). The indexing cannot fail where the slice could
// be taken.

/// A `u16` from the first 2 bytes of `b`.
pub(crate) fn le_u16(b: &[u8]) -> u16 {
    u16::from_le_bytes([b[0], b[1]])
}

/// A `u32` from the first 4 bytes of `b`.
pub(crate) fn le_u32(b: &[u8]) -> u32 {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]])
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/// Details of an input limit refusal, boxed to keep the common error enum small.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LimitViolation {
    /// Which named limit was exceeded.
    pub limit: &'static str,
    /// Maximum accepted value.
    pub max: usize,
    /// Actual input value.
    pub actual: usize,
}

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
    /// Signature is not the FMIR v3 signature.
    BadSignature([u8; 8]),
    /// A legacy FMIR header needs a rebuild.
    LegacyModule {
        /// Legacy header version.
        version: u16,
    },
    /// Writer base version differs from the reader's Cargo version.
    UnsupportedWriter {
        /// Writer major/minor/patch.
        writer: [u16; 3],
        /// Reader major/minor/patch.
        reader: [u16; 3],
    },
    /// Declared body length differs from the actual file.
    LengthMismatch {
        /// Declared body bytes.
        declared: usize,
        /// Actual body bytes.
        actual: usize,
    },
    /// CRC-32 does not match the file excluding its CRC field.
    ChecksumMismatch {
        /// Stored checksum.
        expected: u32,
        /// Computed checksum.
        computed: u32,
    },
    /// Reserved bits must be zero.
    ReservedBits {
        /// Field that carried the bits.
        field: &'static str,
    },
    /// Section ids must be strictly ascending and unique.
    DuplicateSection(u16),
    /// Section offsets must cover exactly the data after the table.
    SectionsDoNotTile,
    /// A required section was absent.
    MissingSection(u16),
    /// An unknown section was marked required.
    UnknownRequiredSection {
        /// Section identifier.
        id: u16,
        /// Writer base version.
        writer: [u16; 3],
    },
    /// An input-controlled size or count exceeds its ceiling.
    LimitExceeded(Box<LimitViolation>),
    /// Known sections must consume their complete payload.
    TrailingBytes {
        /// Section identifier.
        section: u16,
    },
    /// Invalid props schema type or reference.
    InvalidSchema(&'static str),
    /// Invalid key-path entry.
    InvalidKeyPath(&'static str),
    /// Invalid source-position entry.
    InvalidSourcePosition(&'static str),
    /// A slot default does not parse for its declared type.
    InvalidDefault(u16),
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
    /// The walk panicked, and [`crate::walker::walk_to_html_counted`] caught
    /// the unwind. This reports a defect in the walker, not in the module or
    /// the data. Under `panic = "abort"` there is nothing to catch and the
    /// process ends instead.
    Panicked {
        /// The panic's message, when it carried one.
        message: String,
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
            IrError::BadSignature(got) => write!(f, "bad signature: {got:02x?}"),
            IrError::LegacyModule { version } => write!(
                f,
                "an FMIR module before v3 (header version {version}): rebuild with a 3.x compiler"
            ),
            IrError::UnsupportedWriter { writer, reader } => write!(
                f,
                "writer {}.{}.{} is incompatible with reader {}.{}.{}",
                writer[0], writer[1], writer[2], reader[0], reader[1], reader[2]
            ),
            IrError::LengthMismatch { declared, actual } => write!(
                f,
                "length mismatch: declared body {declared}, actual {actual}"
            ),
            IrError::ChecksumMismatch { expected, computed } => write!(
                f,
                "checksum mismatch: expected {expected:08x}, computed {computed:08x}"
            ),
            IrError::ReservedBits { field } => write!(f, "reserved bits in {field}"),
            IrError::DuplicateSection(id) => write!(f, "duplicate or unordered section 0x{id:04x}"),
            IrError::SectionsDoNotTile => write!(f, "sections do not tile the file"),
            IrError::MissingSection(id) => write!(f, "missing required section 0x{id:04x}"),
            IrError::UnknownRequiredSection { id, writer } => {
                let reader = reader_version();
                write!(f, "unknown required section 0x{id:04x} written by {}.{}.{}; this reader is {}.{}.{}",writer[0],writer[1],writer[2],reader[0],reader[1],reader[2])
            }
            IrError::LimitExceeded(details) => {
                let LimitViolation { limit, max, actual } = details.as_ref();
                write!(f, "{limit} exceeds limit {max}: {actual}")
            }
            IrError::TrailingBytes { section } => {
                write!(f, "trailing bytes in section 0x{section:04x}")
            }
            IrError::InvalidSchema(reason) => write!(f, "invalid props schema: {reason}"),
            IrError::InvalidKeyPath(reason) => write!(f, "invalid key path: {reason}"),
            IrError::InvalidSourcePosition(reason) => {
                write!(f, "invalid source position: {reason}")
            }
            IrError::InvalidDefault(id) => {
                write!(f, "default for slot {id} does not parse for its type")
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
            IrError::Panicked { message } => write!(f, "the walk panicked: {message}"),
        }
    }
}

impl IrError {
    /// Stable loader diagnostic code, shared with forma-server.
    pub fn code(&self) -> &'static str {
        match self {
            Self::BadSignature(_) | Self::LegacyModule { .. } => LOAD_102,
            Self::LengthMismatch { .. } | Self::ChecksumMismatch { .. } => LOAD_104,
            Self::MissingSection(_) => LOAD_105,
            Self::UnknownRequiredSection { .. } => LOAD_106,
            Self::LimitExceeded(_) => LOAD_107,
            Self::UnsupportedWriter { .. } => LOAD_108,
            _ => LOAD_103,
        }
    }
}
impl std::error::Error for IrError {}

/// Validated FMIR v3 header (24 bytes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IrHeader {
    /// Writer's base semantic version.
    pub writer: [u16; 3],
    /// Bytes after the header.
    pub body_len: u32,
    /// CRC-32 of the file excluding bytes 18 through 21.
    pub crc: u32,
}

impl IrHeader {
    /// Validate a complete file's header, including exact length and CRC, before section parsing.
    pub fn parse(data: &[u8]) -> Result<Self, IrError> {
        Self::parse_for_reader(data, reader_version())
    }

    // Private: production readers always use their own Cargo package version.
    fn parse_for_reader(data: &[u8], reader: [u16; 3]) -> Result<Self, IrError> {
        limit("module bytes", data.len(), MAX_MODULE_SIZE)?;
        if data.len() < HEADER_SIZE {
            return Err(IrError::BufferTooShort {
                expected: HEADER_SIZE,
                actual: data.len(),
            });
        }
        if data[..8] != SIGNATURE {
            if data[..4] == *b"FMIR" {
                return Err(IrError::LegacyModule {
                    version: le_u16(&data[4..6]),
                });
            }
            let mut got = [0; 8];
            got.copy_from_slice(&data[..8]);
            return Err(IrError::BadSignature(got));
        }
        let writer = [
            le_u16(&data[8..10]),
            le_u16(&data[10..12]),
            le_u16(&data[12..14]),
        ];
        if !accepts_writer(reader, writer) {
            return Err(IrError::UnsupportedWriter { writer, reader });
        }
        let body_len = le_u32(&data[14..18]);
        let actual = data.len() - HEADER_SIZE;
        if body_len as usize != actual {
            return Err(IrError::LengthMismatch {
                declared: body_len as usize,
                actual,
            });
        }
        let crc = le_u32(&data[18..22]);
        let computed = crc32(&[&data[..18], &data[22..]]);
        if computed != crc {
            return Err(IrError::ChecksumMismatch {
                expected: crc,
                computed,
            });
        }
        if data[22..24] != [0, 0] {
            return Err(IrError::ReservedBits { field: "header" });
        }
        Ok(Self {
            writer,
            body_len,
            crc,
        })
    }
}

/// A 12-byte section descriptor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SectionDescriptor {
    /// Section kind, unique and ascending.
    pub id: u16,
    /// Bit 0: required; all other bits reserved.
    pub flags: u16,
    /// Absolute file offset.
    pub offset: u32,
    /// Payload length.
    pub size: u32,
}

/// Validated variable-length section table following the header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SectionTable {
    /// Descriptors in file order.
    pub sections: Vec<SectionDescriptor>,
}
impl SectionTable {
    /// Parse the body prefix; the caller has already checked header integrity.
    pub fn parse(data: &[u8]) -> Result<Self, IrError> {
        if data.len() < 2 {
            return Err(IrError::BufferTooShort {
                expected: 2,
                actual: data.len(),
            });
        }
        let count = le_u16(data) as usize;
        limit("sections", count, MAX_SECTIONS)?;
        let end = TABLE_PREFIX_SIZE + count * SECTION_ENTRY_SIZE;
        if end > data.len() {
            return Err(IrError::BufferTooShort {
                expected: end,
                actual: data.len(),
            });
        }
        if le_u16(&data[2..4]) != 0 {
            return Err(IrError::ReservedBits {
                field: "section table",
            });
        }
        let mut sections = Vec::with_capacity(count);
        let mut previous = None;
        for entry in data[TABLE_PREFIX_SIZE..end].chunks_exact(SECTION_ENTRY_SIZE) {
            let id = le_u16(entry);
            let flags = le_u16(&entry[2..]);
            if previous.is_some_and(|p| id <= p) {
                return Err(IrError::DuplicateSection(id));
            }
            if flags & !SECTION_REQUIRED != 0 {
                return Err(IrError::ReservedBits {
                    field: "section flags",
                });
            }
            sections.push(SectionDescriptor {
                id,
                flags,
                offset: le_u32(&entry[4..]),
                size: le_u32(&entry[8..]),
            });
            previous = Some(id);
        }
        Ok(Self { sections })
    }
    /// Require exact tiling, including unknown optional payloads.
    pub fn validate(&self, file_len: usize) -> Result<(), IrError> {
        let mut expected =
            HEADER_SIZE + TABLE_PREFIX_SIZE + self.sections.len() * SECTION_ENTRY_SIZE;
        for section in &self.sections {
            if section.offset as usize != expected {
                return Err(IrError::SectionsDoNotTile);
            }
            expected = expected
                .checked_add(section.size as usize)
                .ok_or(IrError::InvalidSection)?;
            if expected > file_len {
                return Err(IrError::SectionsDoNotTile);
            }
        }
        if expected != file_len {
            return Err(IrError::SectionsDoNotTile);
        }
        Ok(())
    }
    /// Find a descriptor by id.
    pub fn get(&self, id: u16) -> Option<&SectionDescriptor> {
        self.sections.iter().find(|s| s.id == id)
    }
}

// ---------------------------------------------------------------------------
// Opcode enum (12 active opcodes; six reserved v2 values)
//
// Six unused v2 values remain reserved forever: Switch, TryStart, Fallback,
// Preload, Comment and ListItemKey. From v3 they are refused at load and have
// no walker arms. Key paths use a separate typed section (FORMA-181).
// ---------------------------------------------------------------------------

/// Bytecode opcodes for the FMIR instruction stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Opcode {
    /// Open an element. `str_idx(u32) + attr_count(u16) + [(key u32, val u32)]`
    OpenTag = OP_OPEN_TAG,
    /// Close the named element. `str_idx(u32)`
    CloseTag = OP_CLOSE_TAG,
    /// A void element, which takes no CLOSE_TAG. Same operands as OPEN_TAG.
    VoidTag = OP_VOID_TAG,
    /// Static text from the string table. `str_idx(u32)`
    Text = OP_TEXT,
    /// Slot-bound text wrapped in `<!--f:tN-->` markers.
    /// `slot_id(u16) + marker_id(u16)`
    DynText = OP_DYN_TEXT,
    /// Slot-bound attribute on the tag currently being opened.
    /// `attr_str_idx(u32) + slot_id(u16)`
    DynAttr = OP_DYN_ATTR,
    /// Conditional region wrapped in `<!--f:sN-->` markers.
    /// `slot_id(u16) + then_len(u32) + else_len(u32)`, then the two bodies
    /// separated by a [`Opcode::ShowElse`] byte.
    ShowIf = OP_SHOW_IF,
    /// Separator byte between a SHOW_IF's then- and else-bodies.
    ShowElse = OP_SHOW_ELSE,
    /// Repeat a body once per element of an array slot, wrapped in
    /// `<!--f:lN-->` markers. `slot_id(u16) + item_slot_id(u16) + body_len(u32)`
    List = OP_LIST,
    /// Begin an island region. `island_id(u16)`
    IslandStart = OP_ISLAND_START,
    /// End an island region. `island_id(u16)`
    IslandEnd = OP_ISLAND_END,
    /// Extract a named property from an Object slot into a target slot.
    /// Format: src_slot_id(u16) + prop_str_idx(u32) + target_slot_id(u16)
    Prop = OP_PROP,
    /// Select fallback only when source is Null. `source u16 + fallback u16 + destination u16`.
    Coalesce = OP_COALESCE,
}

impl Opcode {
    /// Convert a raw byte to an `Opcode`.
    pub fn from_byte(b: u8) -> Result<Self, IrError> {
        match b {
            OP_OPEN_TAG => Ok(Opcode::OpenTag),
            OP_CLOSE_TAG => Ok(Opcode::CloseTag),
            OP_VOID_TAG => Ok(Opcode::VoidTag),
            OP_TEXT => Ok(Opcode::Text),
            OP_DYN_TEXT => Ok(Opcode::DynText),
            OP_DYN_ATTR => Ok(Opcode::DynAttr),
            OP_SHOW_IF => Ok(Opcode::ShowIf),
            OP_SHOW_ELSE => Ok(Opcode::ShowElse),
            OP_LIST => Ok(Opcode::List),
            OP_ISLAND_START => Ok(Opcode::IslandStart),
            OP_ISLAND_END => Ok(Opcode::IslandEnd),
            OP_PROP => Ok(Opcode::Prop),
            OP_COALESCE => Ok(Opcode::Coalesce),
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
    Text = SLOT_TYPE_TEXT,
    /// A boolean.
    Bool = SLOT_TYPE_BOOL,
    /// An IEEE-754 double, formatted the way ECMAScript formats it.
    Number = SLOT_TYPE_NUMBER,
    /// An array, the only type a LIST may iterate.
    Array = SLOT_TYPE_ARRAY,
    /// A key/value object, the only type PROP may read from.
    Object = SLOT_TYPE_OBJECT,
}

impl SlotType {
    /// Convert a raw byte to a `SlotType`.
    pub fn from_byte(b: u8) -> Result<Self, IrError> {
        match b {
            SLOT_TYPE_TEXT => Ok(SlotType::Text),
            SLOT_TYPE_BOOL => Ok(SlotType::Bool),
            SLOT_TYPE_NUMBER => Ok(SlotType::Number),
            SLOT_TYPE_ARRAY => Ok(SlotType::Array),
            SLOT_TYPE_OBJECT => Ok(SlotType::Object),
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
    Load = TRIGGER_LOAD,
    /// Hydrate when the island scrolls into view.
    Visible = TRIGGER_VISIBLE,
    /// Hydrate on the first user interaction with the island.
    Interaction = TRIGGER_INTERACTION,
    /// Hydrate when the main thread next goes idle.
    Idle = TRIGGER_IDLE,
}

impl IslandTrigger {
    /// Convert a raw byte to an `IslandTrigger`.
    pub fn from_byte(b: u8) -> Result<Self, IrError> {
        match b {
            TRIGGER_LOAD => Ok(IslandTrigger::Load),
            TRIGGER_VISIBLE => Ok(IslandTrigger::Visible),
            TRIGGER_INTERACTION => Ok(IslandTrigger::Interaction),
            TRIGGER_IDLE => Ok(IslandTrigger::Idle),
            _ => Err(IrError::InvalidIslandTrigger(b)),
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
    Server = SLOT_SOURCE_SERVER,
    /// Owned by the client runtime; the slot table's default is what SSR
    /// renders.
    Client = SLOT_SOURCE_CLIENT,
}

impl SlotSource {
    /// Convert a raw byte to a `SlotSource`.
    pub fn from_byte(b: u8) -> Result<Self, IrError> {
        match b {
            SLOT_SOURCE_SERVER => Ok(SlotSource::Server),
            SLOT_SOURCE_CLIENT => Ok(SlotSource::Client),
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
    /// Props-schema object index, or 0xffff until declared.
    pub schema_object: u16,
    /// Opaque digest bytes; FORMA-105 defines their use.
    pub digest: Vec<u8>,
    /// Unknown trailing entry fields retained for lossless dumps.
    pub extension: Vec<u8>,
    /// Index into the string table for the island name.
    pub name_str_idx: u32,
    /// Byte offset of the ISLAND_START opcode in the bytecode stream.
    pub byte_offset: u32,
    /// Which slots belong to this island.
    pub slot_ids: Vec<u16>,
}

#[cfg(test)]
mod compatibility_tests {
    use super::*;
    #[test]
    fn shared_version_pairs_pass_through_the_actual_header_reader() {
        let pairs: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/compatibility/version-pairs.json"
        ))
        .unwrap();
        let base = |s: &str| -> [u16; 3] {
            let parts: Vec<u16> = s
                .split('-')
                .next()
                .unwrap()
                .split('.')
                .map(|p| p.parse().unwrap())
                .collect();
            [parts[0], parts[1], parts[2]]
        };
        for pair in pairs.as_array().unwrap() {
            let reader = base(pair["reader"].as_str().unwrap());
            let writer = base(pair["writer"].as_str().unwrap());
            let mut bytes = crate::parser::test_helpers::build_minimal_ir(&[], &[], &[], &[]);
            for (i, value) in writer.iter().enumerate() {
                bytes[8 + i * 2..10 + i * 2].copy_from_slice(&value.to_le_bytes());
            }
            let crc = crc32(&[&bytes[..18], &bytes[22..]]);
            bytes[18..22].copy_from_slice(&crc.to_le_bytes());
            let result = IrHeader::parse_for_reader(&bytes, reader);
            assert_eq!(
                result.is_ok(),
                pair["accepted"].as_bool().unwrap(),
                "{pair}: {result:?}"
            );
            if let Err(error) = result {
                assert_eq!(error.code(), "LOAD-108");
                for version in [reader, writer] {
                    assert!(error
                        .to_string()
                        .contains(&format!("{}.{}.{}", version[0], version[1], version[2])));
                }
            }
        }
    }
}
