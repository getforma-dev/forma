# FMIR v3: the binary module format for Forma 3.0.0

This is the maintained wire contract for the Rust reader in `crates/forma-ir` and the
TypeScript writer in `packages/compiler`. FORMA-185 implements this contract on the merged
repository. The development set is `3.0.0-dev`; both languages encode and compare base version
`3.0.0` exactly. This staging version does not constitute a release. FORMA-112 owns the later
compatibility window and release contract.

The independently reviewed specification and its example were recovered from the interrupted
FORMA-114 author task. The 24-byte header, CRC exclusion range, exact version comparison and
load-time string-reference checks incorporate the lead's final B1–B3/S1–S10 decisions.
The byte grammar below is normative. Consumer features assigned to later tickets are identified
explicitly; applications do not migrate as part of this format change.

## 1. Summary

FMIR v3 keeps v2's bytecode, string table, slot table and the walker's HTML contract, and replaces
everything around them:

| | FMIR v2 (built) | FMIR v3 (this spec) |
|---|---|---|
| Signature | `FMIR` + u16 version `2` + u16 flags `0` + u64 `source_hash` written `0`, never checked (16 bytes) | PNG-style 8-byte signature, writer's version as three u16, body length, CRC-32 of every byte except its own four-byte field (24 bytes) |
| Sections | Exactly four, fixed order, fixed-offset descriptors (offset, size), data from byte 48 | A table: count, then (id, flags, offset, length) per section; known ids, a required flag, unknown optional sections skipped, unknown required refused |
| Integrity | None; structure checks only | Declared length must match; CRC-32 (IEEE) over the file excluding its own field checked before any section is parsed |
| Required content | bytecode, strings, slots, islands | bytecode, strings, slots, islands (with schema reference and digest), props schema; key paths where rows are keyed |
| Optional content | none possible | source positions; reserved ids for 114b's build identity and deployment |
| Opcodes | 18 defined (`0x01`-`0x12`), 12 emitted | 12; `0x09`, `0x0D`-`0x11` reserved for good |
| Versioning | exact match on `2` | exact base major/minor/patch match in FORMA-185; FORMA-112 adds the major/minor window; both versions named on refusal |
| Readers | forma-ir 0.2.x, the WASM walker | forma-ir 3.x only; no v2 reader (L-18) |

---

## 2. Historical v2 contract

The complete superseded contract is preserved in
[`archive/2026-10-15-FMIR-FORMAT-v2.md`](archive/2026-10-15-FMIR-FORMAT-v2.md).
Its four-section, 16-byte container had no integrity check, used a numeric format version,
and included six opcodes that the compiler did not emit. The old promise of retaining `FMIR`
at byte zero is superseded by the v3 signature below. A v2 prefix is recognized only to produce
a rebuild diagnosis; there is no v2 decoder path.

The browser core does not consume FMIR directly. The deprecated WASM exports and lenient loader
are separate retirement work; their presence does not permit either container to read v2 bytes.
The existing HTML corpus remains the render contract through this upgrade.

---

## 3. Header (24 bytes)

```
offset  size  field
0       8     signature: 89 46 4D 49 0D 0A 1A 0A
8       6     writer version: major u16, minor u16, patch u16
14      4     body_len u32: number of bytes after the 24-byte header (file length - 24)
18      4     crc u32: CRC-32 of bytes [0, 18), then [22, 24 + body_len)
22      2     reserved: must be 00 00
```

**Signature.** PNG's shape (design 1, `output/designs/1-compiled-contract.md` L62): a high-bit
byte so a 7-bit channel breaks it, three letters `FMI`, CR LF so a line-ending conversion breaks it,
Ctrl-Z so `type` stops, LF so a CR LF to CR conversion breaks it. A pre-v3 module begins
`46 4D 49 52` (`FMIR`), so the first byte distinguishes the formats. The lead accepted these eight
bytes at Q1.

**Writer version.** The set's version (DR-26; one version for seven packages, FORMA-112) as three
little-endian u16: `03 00 00 00 00 00` for 3.0.0. A prerelease build writes its base version:
`3.0.0-dev` and `3.0.0-alpha.1` both write `3,0,0`. In FORMA-185 the reader accepts only three
u16 values equal to its own `CARGO_PKG_VERSION` base major, minor and patch; prerelease suffixes
and build metadata are not encoded or compared. A different patch is a mismatch too. Reject
with `LOAD-108`, naming both versions. FORMA-112 adds design 1's compatibility window (same
major, writer minor no greater than reader minor, patch ignored); the encoding does not change.

**Body length.** Must equal the file's length minus 24 exactly. A module has no trailing bytes
(v2 allowed them silently). A mismatch is `LOAD-104`; use checked arithmetic for `24 + body_len`.

**CRC-32.** Compute one streaming CRC over every byte of the file except the four CRC bytes:
bytes `[0,18)` followed by `[22,end)`. Do not CRC four zero bytes in place of the skipped field.
This covers the signature, writer version, body length, reserved header bytes, table and all
section bytes, including unknown optional sections. It protects header corruption as well as
body corruption; the earlier signature, version and length checks may diagnose a header change
first, according to the order below. Parameters: CRC-32 / ISO-HDLC (the IEEE CRC used by PNG,
zlib and gzip), polynomial `0x04C11DB7`, reflected polynomial `0xEDB88320`, initial register
`0xFFFFFFFF`, reflected input/output, final XOR `0xFFFFFFFF`. Check value: ASCII `123456789`
produces `0xCBF43926`. Store little-endian. Both languages carry this vector in their tests.
Rust uses a 256-entry table and loop, without a dependency or change to `rust-version = "1.71"`.
TypeScript uses the same table by default; `node:zlib.crc32` on Node 22.2 or later may be a test
oracle, without raising the package's declared Node requirement.

**The check procedure**, in this order:

0. `len > 16 MiB`: `LOAD-107` (module size), before the CRC pass or any count-driven allocation.
1. `len < 24`: `LOAD-103` (`BufferTooShort`).
2. Signature mismatch: `LOAD-102`. If bytes `[0,4)` are `FMIR`, read `N` as u16 LE at `[4,6)`:
   "an FMIR module before v3 (header version N): rebuild with a 3.x compiler". Do not label a
   legacy header whose N is 7 as version 2. Otherwise report "bad signature".
3. Writer triple differs from the reader triple: `LOAD-108`, naming both.
4. `24 + body_len != len`: `LOAD-104`, naming declared and actual body lengths.
5. `crc32(bytes[0..18] ++ bytes[22..]) != crc`: `LOAD-104`, naming stored and computed CRCs.
   No section is parsed and no allocation based on its counts occurs before this succeeds;
   the streaming CRC itself allocates nothing from input counts.
6. Header reserved bytes `[22,24)` nonzero: `LOAD-103` (`ReservedBits`). They are CRC-covered,
   but a correctly restamped nonzero reserved field still has to fail its own rule.
7. Validate the section table (4), then parse and cross-check sections in the order specified
   in section 5, including structural bytecode validation before key paths and source positions.

The CRC detects a bad copy (truncation, a flipped storage or transfer byte, text-mode conversion).
It is not an authentication signature: a producer that can replace the file can restamp its CRC.
Trusted binary provenance and the browser's SR27 `integrity` attributes supply authentication
(design 2 L91-L93; v2 8.1). The corpus and parity suite detect a well-formed wrong writer (9).

---

## 4. Section table

Immediately after the header, at offset 24:

```
offset  size   field
24      2      section_count u16
26      2      reserved u16, must be zero
28      12*n   entries, each:
                 id u16        the section's kind (section 5)
                 flags u16     bit 0: required; bits 1-15 reserved, must be 0
                 offset u32    from the start of the file
                 length u32    in bytes
```

Rules a reader enforces, each a refusal:

- `section_count <= 64` (`LOAD-107`) and `4 + 12 * section_count <= body_len` (`LOAD-103`),
  checked before the table is allocated.
- Table reserved u16 at offset 26 is zero (`LOAD-103`, `ReservedBits`).
- Ids are unique and ascending (`LOAD-103`: duplicate or unordered section).
- The first section's `offset` is `28 + 12 * section_count`; each section's `offset + length`
  (checked with `checked_add`) is the next section's `offset`; the last ends at `24 + body_len`.
  Sections tile the body with no gap and no overlap (`LOAD-103`). A section may have `length 0`.
- Reserved flag bits set: `LOAD-103` (fail closed, as v2's header flags did; `format.rs`
  L342-L348).
- For an id the reader knows, the reader's own table in section 5 says whether it is required; the
  file's flag is not consulted. For an id the reader does not know: `required` set is `LOAD-106`,
  naming the id, the writer's version and the reader's; `required` clear is skipped, the bytes
  never read.
- Every section the reader's table marks required for this writer version must be present:
  `LOAD-105`, naming the section.

Why a required flag that readers of known ids ignore: it is for the reader that does not know the
id. For an otherwise accepted writer version, an unknown optional diagnostics section can be
skipped; a section the reader must understand is flagged required, and the reader refuses by
name rather than silently dropping meaning (DR-28; design 1 L85, PNG's critical and ancillary
chunks). The version check runs first: a 3.0.0 reader in this ticket never reaches the table of a
3.1.0 writer. FORMA-112 defines the later compatibility window.

---

## 5. Sections

Ids `0x0001`-`0x7FFF` are Forma's; `0x8000`-`0xFFFF` are never assigned by Forma (a private
producer may use them as optional sections). An id, once assigned, keeps its meaning for every
later version, as opcode bytes do.

| Id | Section | In 3.0.0 | Defined by |
|---|---|---|---|
| `0x0001` | bytecode | required | 5.1 (unchanged from v2) |
| `0x0002` | strings | required | 5.2 (unchanged from v2) |
| `0x0003` | slots | required | 5.3 (unchanged from v2) |
| `0x0004` | islands | required | 5.4 (v3 entry) |
| `0x0005` | props schema | required | 5.5 (FORMA-102) |
| `0x0006` | key paths | required when present (L-7) | 5.6 (FORMA-106) |
| `0x0007` | source positions | optional | 5.7 (L-7) |
| `0x0008` | build identity | optional; reserved until 114b | 5.8 |
| `0x0009` | deployment | optional; reserved until 114b | 5.8 |

The writer sets required bit 0 on emitted ids `0x0001` through `0x0006`, and clears it on
`0x0007`; the canonical dump includes flags. Known-id readers still apply their own required set.
Every known section is consumed exactly; bytes after its last entry are `LOAD-103`
(`TrailingBytes { section }`). Bytes inside a length-prefixed island entry that follow known
fields are the explicit exception: 5.4 says to skip them before the next entry.

Parse strings, slots, islands and props schema first, then perform the bytecode structural pass
(which uses those tables and records opcode starts), cross-check island offsets and schema
references, then parse key paths and source positions. An acyclic-schema check is part of schema
validation. Apart from these dependencies, their on-disk order remains ascending section id.

Check each count before allocating: its ceiling in section 8 (`LOAD-107`), then
`count * minimum_entry_size <= remaining bytes` (`LOAD-103`), using checked arithmetic. Minimum
entry sizes are strings 2, slots 10, islands 19 (2-byte length + 15 fixed bytes + 2-byte slot count),
schema objects 2, fields 17 (16-byte position/name prefix plus one type byte), enum variants 4,
key paths 9, source positions 20. The old review's island minimum of 17 omitted the mandatory
slot-count field; 19 is the smallest valid complete record.
For key paths and positions, first check their bytes bound, then their ceiling against the
recorded LIST/opcode counts (`LOAD-107`), both before allocating or reading entries. Thus those
ceilings are available and do not depend on a later pass. Counts are not allocation permissions
until both bounds pass.

### 5.1 Bytecode (`0x0001`)

Unchanged from v2: a flat stream of the twelve opcodes of section 6 with the operand encodings of
`format.rs` L443-L492. The structural rules of `parser.rs` L509-L641 stay: regions tile exactly;
every slot id named is declared; every `ISLAND_START` names an island in the table; a `SHOW_IF`'s
`SHOW_ELSE` byte lies inside its region; depth at most 64. A byte from the reserved set (`0x09`,
`0x0D`-`0x11`) or outside `0x01`-`0x12` is `IrError::InvalidOpcode` (`LOAD-103`).
A zero-length bytecode section is valid (an empty page); the other required tables must still
contain their count fields, and props schema must contain empty object 0.

Every bytecode `str_idx` is checked against the string table in that structural pass beside
slot-id checks (`LOAD-103`, `StringIndexOutOfBounds`): OPEN_TAG/VOID_TAG names and all attribute
keys and values, CLOSE_TAG names, TEXT, DYN_ATTR's name and PROP's property name. The loader
must refuse these before the server binds, instead of deferring them to `RENDER-102`.

### 5.2 Strings (`0x0002`)

Unchanged from v2 (`parser.rs` L25-L85; `ir-emit.ts` L280-L318): `count u32`, then per entry
`len u16` and `len` bytes of UTF-8, no BOM, no terminator. Each must be valid UTF-8 (`LOAD-103`).
Entries need not be unique (the writer deduplicates, `ir-emit.ts` L87-L94). The u16 length keeps
the writer's `BUILD-604` ceiling of 65,535 bytes per literal (`ir-emit.ts` L292-L296); at 3.0.0 that
fails the build instead of writing the placeholder module (v2 6.3, DR-1; FORMA-101).

### 5.3 Slots (`0x0003`)

Unchanged from v2 (`parser.rs` L131-L180; `ir-emit.ts` L321-L353): `count u16`, then per entry
`slot_id u16`, `name_str_idx u32`, `type_hint u8` (1-5), `source u8` (0, 1), `default_len u16`,
default bytes as UTF-8 text per type (`slot.rs` L392-L437). Duplicate ids are refused (`parser.rs`
L444). FORMA-102 decides how slots relate to the props schema (declared props seed signals; slots
stop being named after variables); until it does, the bytecode's operands are slot ids and this
table stays required (Q6 settled). Every `name_str_idx` indexes strings. Every nonempty default
must be valid UTF-8 and parse for its slot type at load (`LOAD-103`), rather than becoming Null
on the first render. Empty bytes mean "no default" for every type. Text accepts any UTF-8;
Bool accepts exactly `true` or `false`; Number accepts finite decimal text with optional sign,
fraction and exponent; Array accepts `[]` (the existing reader's supported array default); Object
has no nonempty default in this ticket. The frozen corpus must confirm default compatibility; this makes the
old silent fallback an explicit refusal. The number grammar is
`[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?`, without whitespace; overflow is refused.

### 5.4 Islands (`0x0004`)

v3 entry, length-prefixed so FORMA-103 and FORMA-105 can add trailing fields in a minor without a
format bump (design 1 L82: a "trailing field in a length-prefixed record" is a minor):

```
count u16
per island:
  entry_len u16        bytes that follow this field, within this entry
  id u16
  trigger u8           1 Load, 2 Visible, 3 Interaction, 4 Idle (as v2)
  reserved u8          must be 0 (was props_mode in v2; see below)
  name_str_idx u32     the component's registered name
  byte_offset u32      offset of this island's ISLAND_START in the bytecode
  schema_object u16    index into the props schema's object table; 0xFFFF: none
  digest_len u8        0 until FORMA-105; then 8 (SHA-256 truncated to 8 bytes)
  digest[digest_len]
  slot_count u16
  slot_ids u16[slot_count]
```

A reader reads the fields it knows and skips to `entry_len`; `entry_len` shorter than the fixed
fields (`2+1+1+4+4+2+1 = 15` bytes) is `LOAD-103`. `byte_offset` must point at an `ISLAND_START`
carrying `id` (`parser.rs` L472-L481); `schema_object`, unless `0xFFFF`, must index the object
table; every `slot_id` must be declared; `id`s are unique; `name_str_idx` indexes strings;
trigger is 1-4 and reserved is zero. All known fields must fit the entry:
`15 + digest_len + 2 + 2 * slot_count <= entry_len`, else `LOAD-103`.
The u16 `entry_len` therefore admits at most 32,759 slot ids when digest is empty; a writer
checks this and fails with a `BUILD-6xx` diagnostic instead of truncating its length.
Digest bytes remain opaque to FORMA-185's reader; FORMA-105 enforces its digest rule.

What changed and why: `props_mode` is gone. Its only emitted value was `Inline` (the historical v2 contract), `Deferred`
was never implemented, and DR-4 moves island props into one JSON state block in the head (v2 8.3),
so the mode has no meaning at 3.0.0. `slot_ids` stay for 114a as the bridge the walker reads today
(`walker.rs` L917-L925 builds the island's props from them); FORMA-103 and FORMA-105 replace or
supplement them with the schema reference and the digest, which is why both have a place now.
`digest` content is FORMA-105's (DR-6; design 3's `h`, `output/designs/3-server-to-page-data.md`
L80-L82): SHA-256 over the binding table and props schema as emitted, first 8 bytes
(`digest_len = 8`), represented as 16 hex digits where it appears in HTML. Emit no digest bytes
until FORMA-105 lands; that ticket fixes its byte concatenation and validation. The schema's
canonical display text is not the chosen hash input. Q4, Q7 and Q8 are settled.

### 5.5 Props schema (`0x0005`)

Required in every module from 3.0.0 (DR-3, FORMA-102). A table of object types; object 0 is the
page's props type, with zero fields for a page that declares none (the placeholder module too).
Islands and nested object fields refer to objects by index.

```
object_count u16
per object:
  field_count u16
  per field:
    name_str_idx u32   the name as written in TypeScript (never positional, design 3 L64-L65)
    file_str_idx u32   the declaring file, as the compiler saw it, relative to the project root
    line u32           1-based
    column u32         1-based, in UTF-16 code units as TypeScript reports them
    type               one tagged type (below)
type:
  0x01 boolean                                  Rust: bool
  0x02 string                                   String
  0x03 number                                   f64, or an integer to 64 bits; past ±(2^53 − 1) refused at render
  0x04 date                                     SystemTime, sent as epoch milliseconds
  0x05 enum: variant_count u16, variant_str_idx u32[variant_count]    a unit enum (string-literal union)
  0x06 array: element type follows             Vec<T>
  0x07 optional: inner type follows            Option<T>; both `x?: T` and `T | null` (L-43)
  0x08 object: object_index u16                 a struct deriving PageProps
```

That is L-43's closed set and nothing else; the Rust forms are the derive's business
(`forma-ir-derive`, L-4), not the module's: TypeScript `number` is one tag, and the Rust side's
choice of `f64` or an integer is checked at bind and render. Rules a reader enforces: field names
unique within an object (`LOAD-103`); an `optional` whose inner type is `optional` is refused
(`LOAD-103`); nesting of `array`/`optional` tags at most 16 deep and object references acyclic
(`LOAD-103` for a cycle, `LOAD-107` past the type nesting depth); use an iterative graph pass,
or one bounded by `object_count` (1,024), since object-reference depth is not the 16-tag bound.
`object_count >= 1` (object 0 is always page props); every `object_index` in range;
every field name, file and enum `variant_str_idx` indexes strings (`LOAD-103`); positions use
line >= 1 and column >= 1 in UTF-16 units (`LOAD-103` for zero); `object_count`, `field_count` and `variant_count` within section 8's ceilings. Tagged
unions, index signatures, `Map`, `Set`, tuples, functions and classes have no tag: the compiler
refuses them at build (v2 9, FORMA-102), and a reader meeting an unknown tag refuses the module
(`LOAD-103`).

Positions are design 3's "each field's file and line" (L49-L51); `bind`'s mismatch message names
both sides' positions (FORMA-102's acceptance test "both positions"). FORMA-105 uses the emitted
binding and schema bytes for its digest, as described in 5.4.

### 5.6 Key paths (`0x0006`)

L-7: "Key paths are a required section in a module with keyed rows." Present, and flagged
required, when any list in the module is keyed; absent otherwise. A `LIST` without an entry is
unkeyed: the walker writes no `data-forma-key` and adoption applies A2's row-count check
(FORMA-123); FORMA-106 then makes an unkeyed list a build error on the compiler's side, which is
not a reader rule.

```
count u32
per entry:
  list_offset u32          byte offset of the LIST opcode (0x0A) in the bytecode
  segment_count u8         1 to 32
  segment_str_idx u32[segment_count]    the property path, `item.id` as ["id"], `item.a.b` as ["a","b"]
```

Rules: `list_offset` points at a `LIST` byte at an opcode boundary (checked in the structural pass,
which already visits every opcode start; `LOAD-103` otherwise); offsets unique and ascending;
`segment_count` is 1-32; every segment index names a string. At most one entry names each
LIST; a LIST without an entry is unkeyed. Count is u32 so the 65,535 limit does not silently
restrict a bytecode section that can hold more LISTs. All these structural failures are
`LOAD-103`; the 32-segment ceiling is `LOAD-107`. FORMA-181 consumes this decoded metadata: at render its walker reads the row's value at the path and writes it as the
row root's `data-forma-key` (DR-8; v2 6.5), replacing the never-emitted `LIST_ITEM_KEY` whose
static operand could not key rows (the historical v2 contract). Encoding the path beside the `LIST` instead of in its
operands keeps `LIST`'s encoding unchanged (the ticket's rule) and lets the section be absent in
modules with no lists.

### 5.7 Source positions (`0x0007`, optional)

L-7: the table `RenderError`'s component path reads; "a reader without it loses the path, nothing
else." A writer may omit it (a size-trimmed build); a reader that lacks it reports `RenderError`
with an empty component path.

```
count u32
per entry (20 bytes):
  opcode_offset u32        an OPEN_TAG, VOID_TAG, ISLAND_START, SHOW_IF or LIST byte offset
  file_str_idx u32
  line u32
  column u32
  component_str_idx u32    the component whose body contains the opcode, or the page's name
```

Entries strictly ascending and unique by `opcode_offset`, each at a boundary of one of the
five named opcode kinds; all file/component indices index strings. Lines and columns are
1-based (column in UTF-16 code units); zero is `LOAD-103`. `count` is at most the number of
opcodes (`LOAD-107`). A bad entry refuses the module (`LOAD-103`), optional or not: a section the
reader knows is validated whole.

### 5.8 Reserved for FORMA-186 (`0x0008`, `0x0009`)

These ids reserve build identity and deployment respectively. They have no payload definition
in FORMA-185; FORMA-186 (formerly 114b) decides whether a module or the manifest carries these
values. Writers do not emit them here. They are unknown to this reader: an optional entry is
skipped and a required entry is `LOAD-106`, following section 4. Neither the proposed identity
length field nor proposed route/mode payload from the first draft is a format commitment.

---

## 6. The opcode set after the drop

Twelve opcodes; the bytes and operand encodings of `format.rs` L443-L492 unchanged for each:

| Byte | Opcode | Operands | Marker written |
|---|---|---|---|
| `0x01` | `OPEN_TAG` | `str_idx u32`, `attr_count u16`, `(key u32, val u32)[attr_count]` | |
| `0x02` | `CLOSE_TAG` | `str_idx u32` | |
| `0x03` | `VOID_TAG` | as `OPEN_TAG` | |
| `0x04` | `TEXT` | `str_idx u32` | |
| `0x05` | `DYN_TEXT` | `slot_id u16`, `marker_id u16` | `<!--f:tN-->` |
| `0x06` | `DYN_ATTR` | `attr_str_idx u32`, `slot_id u16` | |
| `0x07` | `SHOW_IF` | `slot_id u16`, `then_len u32`, `else_len u32`, then-body, `SHOW_ELSE`, else-body | `<!--f:sN-->` |
| `0x08` | `SHOW_ELSE` | none; the separator inside `SHOW_IF` | |
| `0x0A` | `LIST` | `slot_id u16`, `item_slot_id u16`, `body_len u32`, body | `<!--f:lN-->`, row-key metadata in 5.6; render integration is FORMA-181 |
| `0x0B` | `ISLAND_START` | `island_id u16` | `<!--f:iN-->` |
| `0x0C` | `ISLAND_END` | `island_id u16` | |
| `0x12` | `PROP` | `src_slot_id u16`, `prop_str_idx u32`, `target_slot_id u16` | |

Reserved, never reassigned, refused as `InvalidOpcode` by every 3.x reader: `0x09` (`SWITCH`),
`0x0D` (`TRY_START`), `0x0E` (`FALLBACK`), `0x0F` (`PRELOAD`), `0x10` (`COMMENT`), `0x11`
(`LIST_ITEM_KEY`). The reader's arms for them go (`walker.rs` L1028-L1045, L1129-L1178,
L1295-L1353; `parser.rs` L529-L534, L556-L558, L585-L639), with their tests and the `fallback_stack`.
A compiler that one day emits one of these constructs assigns a new byte with a cross test (DR-28)
rather than reviving the old meaning: `SWITCH` had no hydration marker and no default case
(`ARCHITECTURE.md` L941), `PRELOAD` wrote no nonce (`walker.rs` L1337-L1343), and `LIST_ITEM_KEY`
could not key rows (the historical v2 contract). Bytes `0x13`-`0xFF` are unassigned; a 3.x minor may assign one (design 1
L82), and a 3.0 reader refuses a module carrying it, which the exact-version rule here, and FORMA-112's later window, also require.

Enum values keep their meaning (`FMIR-FORMAT.md` L143-L145): `SlotType` 1-5, `SlotSource` 0-1,
`IslandTrigger` 1-4. `PropsMode` is removed with its field (5.4).

---

## 7. Alignment, endianness, encoding

- Every multi-byte integer is little-endian, at any offset. Readers decode with `from_le_bytes`
  on byte slices, as `format.rs` L39-L50 and `walker.rs` L2113-L2131 do; no aligned load is ever
  required. The 24-byte header, 2-byte count, 2-byte reserved field and 12-byte entries put the
  table at 28 and the first section at `28 + 12n`, both 4-aligned for every n. Subsequent sections
  are packed with no padding and may be unaligned; no reader may rely on aligned accesses.
- Strings are UTF-8 without BOM or terminator, lengths in bytes (the `unicode-emoji` corpus case
  pins bytes against UTF-16 units; `js_emitter_contract.rs` L17).
- There are no floats in the format; numbers in defaults travel as text (5.3), positions as u32.
- A module is self-contained: no external reference, no compression, no relocation
  (`FMIR-FORMAT.md` L28, kept).
- The file is exactly `24 + body_len` bytes (3).

---

## 8. Limits and codes

Codes follow the server-start family already in use, `LOAD-1xx` (`ir_compat.rs` L13-L19), under
L-3's rule that numbering is assigned at implementation by family and v2 9's that a code once
published keeps its meaning (`render.rs` L135). The existing three keep their meaning; five are
added. Design 1's `IR-V01`/`IR-C01` names (L146-L148) are superseded by this family, which the code
chose at FORMA-121.

| Code | Meaning | Exists | `IrError` variant |
|---|---|---|---|
| `LOAD-101` | The manifest declares a module the binary does not embed | yes | (forma-server's) |
| `LOAD-102` | Not a module this reader accepts: bad signature, or a pre-v3 FMIR module | yes; retains its family meaning, flags/version subcases move | `BadSignature([u8; 8])`, `LegacyModule { version: u16 }` |
| `LOAD-103` | Corrupt or truncated structure: section table, tables, opcodes, names, references, reserved bits | yes | the existing structural variants, plus `DuplicateSection(u16)`, `SectionsDoNotTile { .. }`, `ReservedBits { .. }`, `InvalidSchema { .. }`, `InvalidKeyPath { .. }`, `TrailingBytes { section }` |
| `LOAD-104` | Integrity: declared length differs from the file's, or the CRC-32 does not match (both values named) | new | `LengthMismatch { declared, actual }`, `ChecksumMismatch { expected, computed }` |
| `LOAD-105` | A required section is missing (named) | new | `MissingSection(u16)` |
| `LOAD-106` | An unknown section is flagged required (id, writer's version, reader's version) | new | `UnknownRequiredSection { id, writer }` |
| `LOAD-107` | A count or size passes a ceiling before allocation (which, the ceiling, the value) | new | `LimitExceeded { limit: &'static str, max, actual }` |
| `LOAD-108` | The writer's version differs from this reader's triple (both named; window added by FORMA-112) | new | `UnsupportedWriter { writer: [u16; 3], reader: [u16; 3] }` |

`IrError::code()` lives in forma-ir and is the sole source of codes; forma-server re-exports it.
`IrError` is `#[non_exhaustive]` from 3.0.0. The v2 variants `BadMagic`, `UnsupportedVersion`
and `UnsupportedFlags` are removed; callers use `code()` rather than an exhaustive match.
`LOAD-102` keeps its published family meaning, "not a module this reader accepts"; only its
more precise version/flag subcases move to `LOAD-108`/`LOAD-103`. fAuth's own loader calls
`IrModule::parse` (DR-28 "Affects") and inherits the checks; there is no evidence that it reads
header bytes itself. Its A2 loader never sees v3: migration is FORMA-152, after 3.0.0 (L-54).

Ceilings a reader enforces before allocating, each `LOAD-107` with the limit's name, its ceiling
and the value met. The lead accepted these ceilings (Q9); each is tied to something:

| Limit | Ceiling | Why this number |
|---|---|---|
| Module size (whole file) | 16 MiB | Twice the walker's default output budget (`walker.rs` L57, 8 MiB); the largest corpus module is 765 bytes; design 1's 300 components estimate 0.45 MB |
| Sections | 64 | Nine ids are defined; room for a 3.x line |
| Strings | 1,048,576 entries, each at most 65,535 bytes (the u16) | A million empty literals use 2 MiB of lengths and roughly 24 MiB of `Vec<String>` metadata on 64-bit Rust; accepted Q9 cost; the u16 is the writer's `BUILD-604` |
| Slots | 65,535 | Inherent in the u16 count; no `LOAD-107` branch can arise for this count |
| Islands | 4,096 | Each island costs at least one state-block entry; the block is capped at 1 MiB (v2 8.3) |
| Attributes per tag | bounded by remaining bytes / 8 | As today (`walker.rs` L2155; `parser.rs` L526-L527) |
| Control-flow depth | 64 | Today's `MAX_VALIDATION_DEPTH` and `MAX_RECURSION_DEPTH` (`parser.rs` L685; `walker.rs` L585) |
| List nesting at walk | 4 | Today's `MAX_LIST_DEPTH` (`walker.rs` L581) |
| Schema objects; fields per object; enum variants | 1,024 each | A props type of a thousand fields is a design error, not a page |
| Schema type nesting (`array`/`optional` chain) | 16 | Deeper than any declared props type; bounds the recursive decoder |
| Key-path entries; segments per path | number of `LIST` opcodes; 32 | One path per list; `item.a.b…` past 32 is no property path |
| Source-position entries | number of opcodes | One per opcode at most |

The walker's render-time budgets (output bytes, list iterations, depth; `RENDER-301` to
`RENDER-303`, `render.rs` L130-L132) are unchanged and are not load-time limits.

---

## 9. Worked example

`<main><h1>{title}</h1></main>`, with one server Text slot `title`, props `{ title: string }`,
declared at page.tsx line 3, column 23; no island or list. The final reviewed layout is 183 bytes,
body length 159, CRC `0xFA39788C`. The old 179-byte draft and the review's intermediate 181-byte
example remain in `recovery-originals/`; the latter predates the final table reserved-u16 decision.
`example.py` emits this file and the following listing independently of the production emitter:

```
0000  89 46 4d 49 0d 0a 1a 0a               signature
0008  03 00 00 00 00 00                     writer 3.0.0 (three u16)
000e  9f 00 00 00                           body length 159
0012  8c 78 39 fa                           CRC-32 excluding bytes [18,22) 0xfa39788c
0016  00 00                                 header reserved zero
0018  05 00                                 section count 5
001a  00 00                                 table reserved zero
001c  01 00 01 00 58 00 00 00 1d 00 00 00   section 0x0001 bytecode: required=1 offset=88 length=29
0028  02 00 01 00 75 00 00 00 1f 00 00 00   section 0x0002 strings: required=1 offset=117 length=31
0034  03 00 01 00 94 00 00 00 0c 00 00 00   section 0x0003 slots: required=1 offset=148 length=12
0040  04 00 01 00 a0 00 00 00 02 00 00 00   section 0x0004 islands: required=1 offset=160 length=2
004c  05 00 01 00 a2 00 00 00 15 00 00 00   section 0x0005 props schema: required=1 offset=162 length=21
0058  01 00 00 00 00 00 00                  OPEN_TAG str 0 (main), 0 attrs
005f  01 01 00 00 00 00 00                  OPEN_TAG str 1 (h1), 0 attrs
0066  05 00 00 00 00                        DYN_TEXT slot 0, marker 0
006b  02 01 00 00 00                        CLOSE_TAG str 1
0070  02 00 00 00 00                        CLOSE_TAG str 0
0075  04 00 00 00                           strings: count 4
0079  04 00 6d 61 69 6e                     string "main" (len 4)
007f  02 00 68 31                           string "h1" (len 2)
0083  05 00 74 69 74 6c 65                  string "title" (len 5)
008a  08 00 70 61 67 65 2e 74 73 78         string "page.tsx" (len 8)
0094  01 00                                 slots: count 1
0096  00 00 02 00 00 00 01 00 00 00         slot 0: name str 2, Text, Server, default_len 0
00a0  00 00                                 islands: count 0
00a2  01 00                                 props schema: object_count 1
00a4  01 00                                 object 0: field_count 1
00a6  02 00 00 00 03 00 00 00 03 00 00 00   field: name str 2, file str 3, line 3, column 23
00b2  17 00 00 00
00b6  02                                    type 0x02 string
```

Flip byte `0x66` (bytecode offset 14), DYN_TEXT 0x05 to TEXT 0x04, without restamping:
`LOAD-104 checksum mismatch` precedes structural parsing. Restamp CRC and it passes: TEXT's
u32 operand is zero, naming `main`, and `<h1>` contains `main` instead of the dynamic title.
This is well-formed wrong output; only the unchanged HTML goldens and parity suite catch it.
A restamped reserved opcode such as 0x09 instead produces `LOAD-103`.

Drop the final byte: `LOAD-104 length mismatch`, declared body 159 versus actual 158. Set the
writer triple to 3.1.0 or 3.0.1 and restamp: both are `LOAD-108` against reader 3.0.0 in this
ticket (exact triples). Append optional section 0x0100 and rebuild table/length/CRC: PASS and
identical render; required flag set instead yields `LOAD-106`, naming writer and reader versions.

The production TypeScript encoder reproduces this 183-byte example exactly. The independent
Python encoder at `scripts/fmir-spec/example.py` and its `listing.txt` are a separate oracle;
`crates/forma-ir/tests/fixtures/fmir-v3/index.tsv` describes every frozen fault and expected code.

---

## 10. Compatibility rule

- **A 3.x reader refuses every v2 module** with `LOAD-102`, diagnosing it by name: bytes `0..4`
  equal to `FMIR` identifies a pre-v3 header; N at bytes 4-6 is reported with the rebuild instruction (3, step 2). A
  v2 module is never read partially.
- **There is no 2.x reader for v3** (L-18; DR-28 migration step 1: "no v2 reader kept, since a
  binary never mixes format versions"). forma-ir 0.2.x answers `BadMagic` to a v3 module
  (`format.rs` L332-L335); nothing is added to make it do more. The server module loader is `crates/forma-server/src/ir.rs`; it delegates parsing to the one v3 reader. FORMA-107 removes its deprecated lenient entry point. fAuth migrates after the final release in FORMA-152.
- **Within 3.x**: this ticket accepts its own base version triple exactly (3). FORMA-112 adds
  the window: same major, writer minor not above reader minor, patch ignored. Everything
  a 3.x minor adds is one of: a new opcode byte, a new enum value, a new section id, a trailing
  field in a length-prefixed entry (5.4), or a new schema type tag; a 3.0 reader meeting any of
  them refuses by the window or by `LOAD-103`/`LOAD-106`, never mis-reads. Changing an existing
  encoding's meaning is a major (design 1 L82-L85).
- **The bump itself**: every embedded module is rebuilt; the compiler, forma-ir and forma-server
  ship together at 3.0.0 (FORMA-112, DR-26); ksx Studio re-commits its four modules and its CI
  byte-diffs them (ticket "Migration"); the corpus is regenerated once and frozen (11.1). Door
  D2 stays two-way while modules are private to their build (DR-28 "Door"); the signature and
  version bytes become one-way the day a module outlives its build.
- **Rollback**: re-pin A2's packages and rebuild; the modules regenerate as v2 (DR-28 migration
  step 3).

---

## 11. Conformance corpus and fuzzing

### 11.1 One wire table, two implementations

`fmir-constants.json` is the production authority for section ids, opcode bytes and operand
shapes, enum values, schema tags, ceilings, diagnostic codes and the CRC check vector.
`node scripts/generate-fmir-constants.mjs` generates Rust's `fmir_constants.rs` and the
compiler's `fmir-constants.ts`; `--check` runs in the workspace gate. The independent Python
specification encoders deliberately retain their own constants as a frozen test oracle.

The compiler's real `generateRealIr` entry point emits fourteen `.ir` files and canonical
`.dump` files in `crates/forma-ir/tests/fixtures/js-emitter`:

```sh
npm run emit:corpus -w packages/compiler -- "$PWD/crates/forma-ir/tests/fixtures/js-emitter"
cargo test -p forma-ir --test js_emitter_contract
```

Every original `.html` golden stays byte-identical. The Rust test compares all four slot-data
regimes and island fragments, and compares every `.dump` with the TypeScript text. The root
check gate fails if emission changes the committed corpus. Later AST schema extraction,
island digest generation and keyed-row behavior belong to FORMA-102, FORMA-105 and FORMA-181;
this writer exposes their typed wire encoders and emits empty page schema object 0 where no
schema is yet supplied. Default AST emission remains unkeyed, preserving the frozen HTML.

The 67 independent fixtures in `tests/fixtures/fmir-v3` include six accepted modules and 61
refusals. `fmir_v3.rs` checks exact codes; the server's `strict_loader.rs` checks every refusal
through the real strict loader and proves the fixture server binds no port. Positive modules
in that batch remain accepted. Additional tests cover all string-operand shapes, exact limits,
10,000-level recursive inputs, and canonical reconstruction. The standard CRC vector and
183-byte example are pinned independently in both languages. Regenerate the specification
fixtures with `python3 -I scripts/fmir-spec/fixtures.py`; a fixture diff requires format review.

### 11.2 Canonical text and reconstruction

`forma_ir::dump::dump_ir` and compiler `dumpFmir` produce exactly this ASCII grammar:

```text
FMIR v3 writer=3.0.0 body_len=159 crc=fa39788c
SECTION id=0001 flags=0001 offset=88 length=29
HEX <lowercase contiguous payload hex>
```

One header line is followed by two lines per section in descriptor order. Decimal fields have
no leading zeros; id/flags are four lowercase hex digits; CRC has eight. Each line, including
the final line, ends with LF. An empty section has `HEX ` followed by LF. The example above
abbreviates the payload only for exposition; emitted dumps always include every byte.

The dump describes the original validated encoding. It retains duplicate strings, descriptor
flags, opaque island extensions and unknown optional section payloads. The signature and both
reserved fields are implicit constants; section count follows from the number of descriptors.
Together with the header and all descriptor values, the payload bytes reconstruct the complete
module exactly. Tests reconstruct every accepted review fixture and compare all fourteen
production emitter dumps across languages. FORMA-105 hashes emitted binding/schema bytes,
not this text. Applications that mutate public decoded fields must parse a new encoding before
using a dump as that new module's representation.

### 11.3 Decoder fuzzing

`cargo-fuzz` (libFuzzer) runs from `fuzz/`, excluded from
the workspace's publishable members, built with the nightly toolchain the job installs; targets
seeded from the frozen corpus and the fault fixtures, with the accumulated corpus cached between
runs (`actions/cache` keyed per target) so coverage grows nightly. Four targets:

| Target | Input | Oracle |
|---|---|---|
| `parse_raw` | arbitrary bytes | `IrModule::parse` returns `Ok` or `Err`; never panics, never exceeds the memory limit, never exceeds the time limit. Nearly every mutation dies at the signature or CRC, which is itself what this target proves: the pre-section path is total |
| `parse_body` | arbitrary body bytes, with a valid 24-byte header prepended and **correct length and CRC over `[0,18) ++ [22,end)`** | the section table, section parsers, structural validator and limits are reached; same oracle. Without this layer the CRC shadows everything behind it |
| `parse_mutated` | a corpus module, `n` byte flips from the input, CRC restamped | same oracle; near-valid structure reaches the deepest checks (control-flow tiling, schema cycles, key-path offsets) |
| `walk` | first u32 LE gives module length, then that many module bytes, then slot-data bytes; reject an out-of-bounds split; parse the module and walk only on success | `walk_to_html_with_limits` never panics; output never exceeds `max_output_bytes + MAX_ESCAPE_EXPANSION` ; list iterations never exceed the budget; `dump_ir` of the module is bounded |

The CRC restamp lives in the harness, not in a reader switch: the shipped parser has no path that
skips the check (as `__fault-injection` is never in a shipping build, `lib.rs` L37-L48).

**Schedule.** The `.github/workflows/fmir-fuzz.yml` scheduled job runs nightly, each target for 20 minutes
(`-max_total_time=1200`, `-timeout=10`, `-rss_limit_mb=2048`), under AddressSanitizer (cargo-fuzz's
default). Pin a dated toolchain in `fuzz/rust-toolchain.toml` (the tested dated nightly, bumped deliberately). On every pull request, a
stable `#[test]` in forma-ir replays `fuzz/regressions/**` through its target's input adapter and
replays frozen `.ir` modules through `IrModule::parse`; accepted modules also run through
`walk_to_html_with_limits`. Assert no panic and the render budgets. This is part of the ordinary
stable `test` job; PR replay does not invoke cargo-fuzz or install nightly.

The walk slot-data adapter must be shared by the fuzzer and stable replay: consume at most the
module's declared slot count; for each declared slot (in ascending slot id), consume a u16 LE
byte length followed by that many bytes. Truncated entries stop decoding; Text uses lossy UTF-8,
Bool uses first byte parity, Number uses a zero-padded little-endian i32, Array/Object become
empty collections, and missing values are Null. This bounded adapter deliberately exercises
arbitrary values without an unbounded recursive data parser.

**What counts as a finding.** A panic (an index out of bounds, an arithmetic overflow in debug, an
`unwrap` that slipped past the lint at `lib.rs` L22-L25), an abort, a sanitizer report, an input
over the time limit, an input over the memory limit, a `walk` whose output or iteration count
passes its budget, or a `parse` that accepts a module whose sections do not tile or whose
canonical dump re-encodes to different bytes. An `Err` is not a finding. Each finding is minimized
(`cargo fuzz tmin`), committed under `fuzz/regressions/<target>/` with a unit test that replays
it, and fixed before the next release: an open finding blocks the tag (design 1 §5; DR-30's gate).
Not in scope: the hostile-module corpus and the untrusted mode, deferred with M9 (DR-14, L-13);
the fuzzing is for the decoder's totality under SA4's trusted module, not for a module an
application did not build.
