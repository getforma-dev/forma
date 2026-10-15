# The FMIR binary format — layout and stability contract

FMIR is the compiled form of a Forma page: a binary module, written to disk as
a `.ir` file, that `@getforma/compiler` emits and that a Rust server
(`forma-ir`) or the WASM walker reads to produce HTML without running any
JavaScript.

This document is the **contract**. It exists because consumers already
byte-guard this layout — ksx Studio asserts `bytes[0..6] == b"FMIR\x02\x00"`
in its test suite — and until now nothing in the repo told them which of those
bytes they were allowed to depend on.

Current version: **2** (`forma_ir::IR_VERSION`).

---

## 1. What is frozen

These four properties are **frozen across all future FMIR versions**. A reader
may rely on them without first knowing the version, and they will not change
in a v3, v4, or any later revision:

| Offset | Size | Value | Guarantee |
|-------:|-----:|-------|-----------|
| `0` | 4 | `"FMIR"` (`46 4D 49 52`) | The magic is at offset 0 and is always these four ASCII bytes. |
| `4` | 2 | version, u16 **little-endian** | The version is always a u16 LE at offset 4. |
| — | — | — | Every multi-byte integer anywhere in the file is little-endian. |
| — | — | — | A file is self-contained: no external references, no compression, no relocations. |

So this sniff is valid forever, for any version:

```rust
fn fmir_version(bytes: &[u8]) -> Option<u16> {
    if bytes.len() < 6 || &bytes[0..4] != b"FMIR" {
        return None;
    }
    Some(u16::from_le_bytes([bytes[4], bytes[5]]))
}
```

`forma_ir::MAGIC` and `forma_ir::IR_VERSION` are public constants; prefer them
over literals.

Everything below offset 6 is **version-scoped**: true for v2, and a version
bump may change any of it.

---

## 2. v2 layout

```text
+---------------------------+ 0
| header            16 bytes|
+---------------------------+ 16
| section table     32 bytes|
+---------------------------+ 48
| section data              |
| (bytecode, strings,       |
|  slots, islands)          |
+---------------------------+ EOF
```

### 2.1 Header — bytes `[0, 16)`

| Range | Field | Type | Notes |
|-------|-------|------|-------|
| `[0, 4)` | magic | `[u8; 4]` | `"FMIR"`. Frozen (§1). |
| `[4, 6)` | version | u16 LE | `2`. Frozen position (§1). |
| `[6, 8)` | flags | u16 LE | Reserved. **MUST be 0.** |
| `[8, 16)` | source_hash | u64 LE | Hash of the source module. The JS compiler writes `0` today and the reader does not verify it. |

`flags` **fails closed**: any non-zero bit is a hard parse error
(`IrError::UnsupportedFlags`), so a reader that predates a future extension
refuses the file instead of mis-parsing it. Introducing a flag bit therefore
requires shipping the reader before the compiler may emit it.

### 2.2 Section table — bytes `[16, 48)`

Four descriptors, 8 bytes each, in this fixed order:

| Index | Section | Content |
|------:|---------|---------|
| 0 | bytecode | the opcode stream the walker executes |
| 1 | strings | every tag name, attribute name, literal and slot name |
| 2 | slots | slot declarations and their defaults |
| 3 | islands | island declarations |

Each descriptor is:

| Range (within the descriptor) | Field | Type |
|------|-------|------|
| `[0, 4)` | offset from the start of the file | u32 LE |
| `[4, 8)` | size in bytes | u32 LE |

Section data therefore begins at **offset 48**. The parser validates that
`offset + size` does not overflow and lies inside the file before slicing.

### 2.3 Section payloads (v2)

**String table** — `count: u32 LE`, then `count` entries of
`len: u16 LE` followed by `len` bytes of UTF-8.

**Slot table** — `count: u16 LE`, then `count` entries of:

| Field | Type |
|-------|------|
| `slot_id` | u16 LE |
| `name_str_idx` | u32 LE |
| `type_hint` | u8 — `1` Text, `2` Bool, `3` Number, `4` Array, `5` Object |
| `source` | u8 — `0` Server, `1` Client |
| `default_len` | u16 LE |
| `default_bytes` | `default_len` bytes |

**Island table** — `count: u16 LE`, then `count` entries of:

| Field | Type |
|-------|------|
| `id` | u16 LE |
| `trigger` | u8 — `1` Load, `2` Visible, `3` Interaction, `4` Idle |
| `props_mode` | u8 — `1` Inline, `2` ScriptTag, `3` Deferred |
| `name_str_idx` | u32 LE |
| `byte_offset` | u32 LE — offset of this island's `ISLAND_START` within the bytecode section |
| `slot_id_count` | u16 LE |
| `slot_ids` | `slot_id_count` x u16 LE |

**Bytecode** — a flat opcode stream. Opcode bytes and operand widths are
documented on `forma_ir::Opcode`; `cargo doc -p forma-ir` renders them, and
`forma_ir::dump::dump_ir` prints a decoded module including both tables.

---

## 3. What v2 guarantees

For as long as a file declares version 2:

1. **The layout above is exact and will not change.** No field is added,
   removed, reordered or re-widened within v2. A v2 file written today parses
   identically in every future `forma-ir` release that still accepts v2.
2. **Opcode bytes keep their meaning.** `0x01` is `OPEN_TAG` in every v2 file,
   forever. New opcodes may be assigned to *unused* bytes within v2 — a reader
   that does not know them returns `IrError::InvalidOpcode` rather than
   guessing — but an assigned byte is never reused for something else.
3. **Enum discriminants keep their meaning.** `SlotType`, `SlotSource`,
   `IslandTrigger` and `PropsMode` byte values are stable; new values may be
   added, and an unknown value is a parse error, never a default.
4. **The emitted HTML contract is stable.** The hydration markers
   (`<!--f:tN-->`, `<!--f:sN-->`, `<!--f:lN-->`, `<!--f:iN-->`), the
   `data-forma-*` attribute set and the `__forma_islands` JSON block are shared
   byte-for-byte with `@getforma/core`. They are part of this contract even
   though they are not in the binary. So is where markers are *not* written:
   inside `textarea`, `title`, `style` and `script`, whose content HTML reads as
   text (ARCHITECTURE.md 3.3, the context rule).
5. **Validation may get stricter.** A future patch release may *reject* a file
   that an earlier one accepted, when accepting it produced silently wrong
   output (an `ISLAND_START` with no island-table entry, control-flow lengths
   that do not tile). Well-formed compiler output is unaffected; this is
   deliberately not treated as a compatibility break, because the alternative
   is rendering a page that is quietly wrong.

## 4. What a version bump would mean

`IrHeader::parse` rejects any version other than `IR_VERSION` outright — there
is no forward or backward compatibility window inside the reader. So a bump to
3 means:

- every v2 file must be **recompiled**; a v2 file handed to a v3 reader fails
  with `IrError::UnsupportedVersion(2)`, and vice versa.
- the compiler, `forma-ir`, `forma-server`, the WASM walker and every embedded
  module in every consumer ship **together**. There is no mixed-version
  deployment.
- §1 still holds: magic at 0, u16 LE version at 4, little-endian throughout. A
  byte guard written against §1 keeps working; one written against §2 does not.

A bump is reserved for changes that cannot be made additively — re-widening a
field, changing the section count, changing an existing opcode's operands.
Adding an opcode, an enum value, or a new section *appended after* the existing
four are all additive and stay in v2.

## 5. Recommended consumer guard

Assert the two frozen bytes plus the version you compiled against, and let the
parser do the rest:

```rust
// Fails loudly at test time if a toolchain upgrade changes the module format
// out from under the embedded asset.
assert_eq!(&ir_bytes[0..4], forma_ir::MAGIC);
assert_eq!(
    u16::from_le_bytes([ir_bytes[4], ir_bytes[5]]),
    forma_ir::IR_VERSION,
);
let module = forma_ir::IrModule::parse(&ir_bytes)?; // validates everything else
```

Do not hand-slice past offset 6. `IrModule::parse` already validates every
bound, cross-table reference and control-flow region in one pass, and it is the
only thing that stays correct across a version bump.
