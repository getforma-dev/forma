"""Generate the FMIR v3 fault fixtures of FMIR-v3.md section 11.1 step 4, one per reader rule.

Every fixture is derived from a good module by one mutation, then (unless the case is about the
length or the CRC) `restamp`ed so the length and CRC are correct and the mutated rule is what the
reader meets. Writes fixtures/<expected>-<name>.ir and fixtures/index.tsv (name, expected code or
PASS, what was mutated). Usage: python3 -I fixtures.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fmir3 import *

here = os.path.dirname(os.path.abspath(__file__))
out_dir = os.path.abspath(os.path.join(here, "../../crates/forma-ir/tests/fixtures/fmir-v3"))
os.makedirs(out_dir, exist_ok=True)

# --- good module A: the worked example (no island, no list) ----------------------------------
strings = ["main", "h1", "title", "page.tsx"]
s = strings.index
bc = op_open(s("main")) + op_open(s("h1")) + op_dyn_text(0, 0) + op_close(s("h1")) + op_close(s("main"))
st = strings_section(strings)
sl = slots_section([(0, s("title"), 0x01, 0x00, b"")])
isl = islands_section([])
ps = schema_section([[field(s("title"), s("page.tsx"), 3, 23, u8(T_STRING))]])
SEC_A = [(SEC_BYTECODE, 1, bc), (SEC_STRINGS, 1, st), (SEC_SLOTS, 1, sl), (SEC_ISLANDS, 1, isl), (SEC_SCHEMA, 1, ps)]
good_a = assemble(SEC_A)
BC_OFF = HEADER_LEN + TABLE_HEAD + ENTRY_LEN * 5          # 88: first bytecode byte
ST_OFF = BC_OFF + len(bc)                                 # 117: strings section
SL_OFF = ST_OFF + len(st)
IS_OFF = SL_OFF + len(sl)
PS_OFF = IS_OFF + len(isl)

def with_sections(sections, **kw): return assemble(sections, **kw)
def replace(sections, sid, payload, flags=None):
    return [(i, (f if flags is None or i != sid else flags), (payload if i == sid else p)) for i, f, p in sections]

# --- good module B: one island, one keyed list, source positions -----------------------------
strings_b = ["main", "ul", "li", "Counter", "rows", "row", "id", "label", "page.tsx", "Counter.tsx", "count"]
sb = strings_b.index
# slots: 0 rows (Array, Server), 1 row (Object, Client scratch), 2 row.label (Text), 3 count (Number, Server, default "7")
slots_b = [(0, sb("rows"), 0x04, 0x00, b""), (1, sb("row"), 0x05, 0x01, b""), (2, sb("label"), 0x01, 0x01, b""),
           (3, sb("count"), 0x03, 0x00, b"7")]
list_body = op_prop(1, sb("label"), 2) + op_open(sb("li")) + op_dyn_text(2, 0) + op_close(sb("li"))
island_body = op_open(sb("Counter")) + op_dyn_text(3, 1) + op_close(sb("Counter"))
pre = op_open(sb("main")) + op_open(sb("ul"))
list_off = len(pre)
bc_b = pre + op_list(0, 1, list_body) + op_close(sb("ul"))
island_off = len(bc_b)
bc_b += op_island_start(0) + island_body + op_island_end(0) + op_close(sb("main"))
isl_b = islands_section([island_entry(0, 1, sb("Counter"), island_off, schema_object=1, slot_ids=(3,))])
ps_b = schema_section([
    [field(sb("rows"), sb("page.tsx"), 2, 3, u8(T_ARRAY) + u8(T_OBJECT) + u16(2)), field(sb("count"), sb("page.tsx"), 3, 3, u8(T_NUMBER))],
    [field(sb("count"), sb("Counter.tsx"), 1, 30, u8(T_NUMBER))],
    [field(sb("id"), sb("page.tsx"), 5, 3, u8(T_NUMBER)), field(sb("label"), sb("page.tsx"), 6, 3, u8(T_STRING))],
])
kp_b = keypaths_section([(list_off, [sb("id")])])
pos_b = positions_section([(0, sb("page.tsx"), 8, 5, sb("main")), (island_off, sb("page.tsx"), 12, 7, sb("Counter"))])
SEC_B = [(SEC_BYTECODE, 1, bc_b), (SEC_STRINGS, 1, strings_section(strings_b)), (SEC_SLOTS, 1, slots_section(slots_b)),
         (SEC_ISLANDS, 1, isl_b), (SEC_SCHEMA, 1, ps_b), (SEC_KEYPATHS, 1, kp_b), (SEC_POSITIONS, 0, pos_b)]
good_b = assemble(SEC_B)

def flip(m, at, mask=0xFF): m = bytearray(m); m[at] ^= mask; return bytes(m)
def put(m, at, b): m = bytearray(m); m[at:at + len(b)] = b; return bytes(m)

cases = []   # (name, expected, bytes, note)
def case(name, expected, data, note): cases.append((name, expected, data, note))

case("good-a", "PASS", good_a, "the worked example")
case("good-b", "PASS", good_b, "one island, one keyed list, source positions")
# LOAD-102
case("bad-signature", "LOAD-102", flip(good_a, 0, 0x80), "first signature byte 0x89 -> 0x09; nothing else read")
case("v2-module", "LOAD-102", b"FMIR" + u16(2) + u16(0) + bytes(8) + bytes(32), "FMIR header version 2: 'an FMIR module before v3 (header version 2), rebuild it'")
case("pre-v3-version-7", "LOAD-102", b"FMIR" + u16(7) + u16(0) + bytes(8) + bytes(32), "FMIR header version 7 (as FORMA-121's flipped/version.ir): the same message with N = 7")
# LOAD-108
case("writer-3.1.0", "LOAD-108", restamp(put(good_a, 8, u16(3) + u16(1) + u16(0))), "writer 3.1.0 against reader 3.0.0 (exact comparison in FORMA-185)")
case("writer-3.0.1", "LOAD-108", restamp(put(good_a, 8, u16(3) + u16(0) + u16(1))), "writer 3.0.1 against reader 3.0.0: patch counts in FORMA-185")
case("writer-2.9.0", "LOAD-108", restamp(put(good_a, 8, u16(2) + u16(9) + u16(0))), "writer 2.9.0")
# LOAD-104
case("short-by-one", "LOAD-104", good_a[:-1], "last byte dropped: declared body_len 159, actual 158")
case("long-by-one", "LOAD-104", good_a + b"\x00", "one trailing byte: declared 159, actual 160")
case("crc-flipped-bytecode", "LOAD-104", flip(good_a, BC_OFF + 14, 0x01), "DYN_TEXT 0x05 -> TEXT 0x04 at the first bytecode offset 14, CRC not restamped: checksum mismatch before structure")
case("crc-flipped-strings", "LOAD-104", flip(good_a, ST_OFF + 6, 0x20), "'main' -> 'mAin' in the string table, CRC not restamped")
case("crc-flipped-table", "LOAD-104", flip(good_a, 28 + 4, 0x01), "first section offset 88 -> 89 in the table, CRC not restamped")
case("crc-field-flipped", "LOAD-104", flip(good_a, 18, 0x01), "one bit of the CRC field itself")
# LOAD-103, header and table
case("header-pad-nonzero", "LOAD-103", restamp(put(good_a, 22, b"\x01\x00")), "reserved header bytes 22..24 not zero (covered by the CRC, so restamped: its own refusal)")
case("table-reserved-nonzero", "LOAD-103", restamp(put(good_a, 26, b"\x00\x01")), "reserved u16 after section_count not zero")
case("reserved-flag-bit", "LOAD-103", restamp(put(good_a, 28 + 2, u16(0x0003))), "flags bit 1 set on the bytecode entry")
case("duplicate-section-id", "LOAD-103", restamp(put(good_a, 28 + 12 * 4, u16(SEC_ISLANDS))), "schema entry's id changed to 4: duplicate")
case("unordered-table", "LOAD-103", restamp(with_sections([SEC_A[1], SEC_A[0]] + SEC_A[2:])), "strings before bytecode: ids not ascending")
case("offset-in-header", "LOAD-103", restamp(put(good_a, 28 + 4, u32(10))), "first section offset 10: not 28 + 12n")
case("gap-between-sections", "LOAD-103", restamp(put(good_a, 28 + 12 + 4, u32(ST_OFF + 1))), "strings offset one past the bytecode's end: sections do not tile")
case("table-does-not-fit", "LOAD-103", restamp(put(good_a, 24, u16(60))), "section_count 60 within the 64 ceiling but 4 + 12*60 > body_len")
case("zero-length-required-section", "LOAD-103", restamp(with_sections(replace(SEC_A, SEC_STRINGS, b""))), "strings section of length 0: its count does not fit")
# LOAD-103, strings and slots
case("string-not-utf8", "LOAD-103", restamp(put(good_a, ST_OFF + 6, b"\xff")), "'main' with a 0xFF byte, CRC restamped")
case("string-past-section", "LOAD-103", restamp(put(good_a, ST_OFF + 4, u16(200))), "first string length 200: past the section")
case("section-trailing-bytes", "LOAD-103", restamp(with_sections(replace(SEC_A, SEC_STRINGS, st + b"\x00"))), "one byte after the last string entry inside the strings section")
case("slot-name-past-table", "LOAD-103", restamp(put(good_a, SL_OFF + 4, u32(9))), "slot 0 name_str_idx 9 of 4")
case("slot-type-unknown", "LOAD-103", restamp(put(good_a, SL_OFF + 8, b"\x07")), "slot type 7")
case("slot-default-not-parsable", "LOAD-103", restamp(with_sections(replace(SEC_B, SEC_SLOTS, slots_section(slots_b[:3] + [(3, sb("count"), 0x03, 0x00, b"seven")])))), "a Number slot whose default is 'seven'")
# LOAD-103, bytecode
case("reserved-opcode-0x09", "LOAD-103", restamp(put(good_a, BC_OFF + 14, b"\x09")), "SWITCH byte where DYN_TEXT was, CRC restamped")
case("unassigned-opcode-0x13", "LOAD-103", restamp(put(good_a, BC_OFF + 14, b"\x13")), "an unassigned opcode byte")
case("str-idx-past-table", "LOAD-103", restamp(put(good_a, BC_OFF + 1, u32(99))), "OPEN_TAG names string 99 of 4 (B3: checked in the structural pass)")
case("slot-id-undeclared", "LOAD-103", restamp(put(good_a, BC_OFF + 15, u16(5))), "DYN_TEXT names slot 5, undeclared")
case("region-does-not-tile", "LOAD-103", restamp(with_sections(replace(SEC_A, SEC_BYTECODE, bc[:-1]))), "last CLOSE_TAG missing its final operand byte")
case("pass-flipped-dyn-text", "PASS", restamp(flip(good_a, BC_OFF + 14, 0x01)), "DYN_TEXT -> TEXT with the CRC restamped: well-formed and wrong, renders <h1>main</h1> (12.2)")
# LOAD-103, islands
case("island-entry-len-short", "LOAD-103", restamp(with_sections(replace(SEC_B, SEC_ISLANDS, islands_section([island_entry(0, 1, sb("Counter"), island_off, schema_object=1, slot_ids=(3,), entry_len=10)])))), "entry_len 10 < 15")
case("island-fields-exceed-entry-len", "LOAD-103", restamp(with_sections(replace(SEC_B, SEC_ISLANDS, islands_section([island_entry(0, 1, sb("Counter"), island_off, schema_object=1, slot_ids=(3, 2), entry_len=17)])))), "15 + 0 + 2 + 2*2 = 21 > entry_len 17")
case("island-reserved-nonzero", "LOAD-103", restamp(with_sections(replace(SEC_B, SEC_ISLANDS, islands_section([island_entry(0, 1, sb("Counter"), island_off, schema_object=1, slot_ids=(3,), reserved=1)])))), "the former props_mode byte is 1")
case("island-trigger-unknown", "LOAD-103", restamp(with_sections(replace(SEC_B, SEC_ISLANDS, islands_section([island_entry(0, 5, sb("Counter"), island_off, schema_object=1, slot_ids=(3,))])))), "trigger 5")
case("island-offset-not-start", "LOAD-103", restamp(with_sections(replace(SEC_B, SEC_ISLANDS, islands_section([island_entry(0, 1, sb("Counter"), island_off + 1, schema_object=1, slot_ids=(3,))])))), "byte_offset one past ISLAND_START")
case("island-schema-object-out-of-range", "LOAD-103", restamp(with_sections(replace(SEC_B, SEC_ISLANDS, islands_section([island_entry(0, 1, sb("Counter"), island_off, schema_object=7, slot_ids=(3,))])))), "schema_object 7 of 3")
case("island-start-unknown-id", "LOAD-103", restamp(put(good_b, HEADER_LEN + TABLE_HEAD + ENTRY_LEN * 7 + island_off + 1, u16(4))), "ISLAND_START names island 4, not in the table")
# LOAD-103, schema
case("schema-object-count-zero", "LOAD-103", restamp(with_sections(replace(SEC_A, SEC_SCHEMA, u16(0)))), "object_count 0: object 0 must exist")
case("schema-unknown-type-tag", "LOAD-103", restamp(put(good_a, PS_OFF + 20, b"\x09")), "type tag 9")
case("schema-optional-of-optional", "LOAD-103", restamp(with_sections(replace(SEC_A, SEC_SCHEMA, schema_section([[field(s("title"), s("page.tsx"), 3, 23, u8(T_OPTIONAL) + u8(T_OPTIONAL) + u8(T_STRING))]])))), "optional<optional<string>>")
case("schema-object-cycle", "LOAD-103", restamp(with_sections(replace(SEC_A, SEC_SCHEMA, schema_section([[field(s("title"), s("page.tsx"), 3, 23, u8(T_OBJECT) + u16(0))]])))), "object 0's field is object 0")
case("schema-object-index-out-of-range", "LOAD-103", restamp(with_sections(replace(SEC_A, SEC_SCHEMA, schema_section([[field(s("title"), s("page.tsx"), 3, 23, u8(T_OBJECT) + u16(3))]])))), "object index 3 of 1")
case("schema-duplicate-field-name", "LOAD-103", restamp(with_sections(replace(SEC_A, SEC_SCHEMA, schema_section([[field(s("title"), s("page.tsx"), 3, 23, u8(T_STRING)), field(s("title"), s("page.tsx"), 4, 23, u8(T_NUMBER))]])))), "two fields named 'title' in object 0")
case("schema-name-past-table", "LOAD-103", restamp(put(good_a, PS_OFF + 4, u32(9))), "field name_str_idx 9 of 4")
case("schema-type-nesting-17", "LOAD-107", restamp(with_sections(replace(SEC_A, SEC_SCHEMA, schema_section([[field(s("title"), s("page.tsx"), 3, 23, u8(T_ARRAY) * 17 + u8(T_STRING))]])))), "17 nested arrays: past the nesting ceiling of 16")
# LOAD-103, key paths and positions
case("keypath-offset-not-list", "LOAD-103", restamp(with_sections(replace(SEC_B, SEC_KEYPATHS, keypaths_section([(0, [sb("id")])])))), "key path at offset 0, an OPEN_TAG")
case("keypath-zero-segments", "LOAD-103", restamp(with_sections(replace(SEC_B, SEC_KEYPATHS, keypaths_section([(list_off, [])]) + bytes(4)))), "segment_count 0, with four padding bytes so the minimum bytes bound passes and the segment-count rule is reached")
case("keypath-segment-past-table", "LOAD-103", restamp(with_sections(replace(SEC_B, SEC_KEYPATHS, keypaths_section([(list_off, [40])])))), "segment_str_idx 40 of 11")
case("keypath-duplicate-list", "LOAD-103", restamp(with_sections(replace(replace(SEC_B, SEC_BYTECODE, bc_b + op_list(0, 1, b"")), SEC_KEYPATHS, keypaths_section([(list_off, [sb("id")]), (list_off, [sb("label")])])))), "two entries for one LIST")
case("keypath-count-past-lists", "LOAD-107", restamp(with_sections(replace(SEC_B, SEC_KEYPATHS, keypaths_section([(list_off, [sb("id")]), (list_off + 100, [sb("id")])])))), "two entries, one LIST: the opcode-count ceiling after the structural pass")
case("position-offset-not-boundary", "LOAD-103", restamp(with_sections(replace(SEC_B, SEC_POSITIONS, positions_section([(1, sb("page.tsx"), 8, 5, sb("main"))])))), "opcode_offset 1 is inside OPEN_TAG's operands (an optional section is still validated whole)")
case("position-unordered", "LOAD-103", restamp(with_sections(replace(SEC_B, SEC_POSITIONS, positions_section([(island_off, sb("page.tsx"), 12, 7, sb("Counter")), (0, sb("page.tsx"), 8, 5, sb("main"))])))), "entries not ascending")
# LOAD-105 / LOAD-106 / unknown optional
case("missing-schema-section", "LOAD-105", restamp(with_sections([x for x in SEC_A if x[0] != SEC_SCHEMA])), "no 0x0005")
case("missing-strings-section", "LOAD-105", restamp(with_sections([x for x in SEC_A if x[0] != SEC_STRINGS])), "no 0x0002")
case("unknown-required-0x0100", "LOAD-106", restamp(with_sections(SEC_A + [(0x0100, 1, b"hello")])), "section 0x0100 flagged required: 'written by 3.0.0; this reader is 3.0.0'")
case("unknown-optional-0x0100", "PASS", restamp(with_sections(SEC_A + [(0x0100, 0, b"hello")])), "section 0x0100 optional: skipped, renders identically to good-a")
case("private-optional-0x8000", "PASS", restamp(with_sections(SEC_A + [(0x8000, 0, bytes(40))])), "a private-range optional section: skipped")
case("positions-absent", "PASS", restamp(with_sections([x for x in SEC_B if x[0] != SEC_POSITIONS])), "good-b without its optional source positions: renders identically, empty component path")
# LOAD-107
case("string-count-max", "LOAD-107", restamp(put(good_a, ST_OFF, u32(0xFFFFFFFF))), "string count 4,294,967,295: past the ceiling, refused before any allocation (ceiling before bytes bound)")
case("string-count-fits-ceiling-not-bytes", "LOAD-103", restamp(put(good_a, ST_OFF, u32(1000))), "string count 1,000: under the ceiling, 2*1000 > bytes left")
case("section-count-65", "LOAD-107", restamp(put(good_a, 24, u16(65))), "section_count 65: past the ceiling of 64, before the table is allocated")
case("island-count-4097", "LOAD-107", restamp(put(good_b, HEADER_LEN + TABLE_HEAD + ENTRY_LEN * 7 + len(bc_b) + len(strings_section(strings_b)) + len(slots_section(slots_b)), u16(4097))), "island count 4,097")
# module size: not written (16 MiB + 1 bytes); the reader's unit test builds it in memory.

index = ["name\texpected\tbytes\tnote"]
for name, expected, data, note in cases:
    fn = f"{expected}-{name}.ir"
    open(os.path.join(out_dir, fn), "wb").write(data)
    index.append(f"{fn}\t{expected}\t{len(data)}\t{note}")
open(os.path.join(out_dir, "index.tsv"), "w").write("\n".join(index) + "\n")
from collections import Counter
print(len(cases), "fixtures;", dict(Counter(c[1] for c in cases)))
print("good-a", len(good_a), "bytes; good-b", len(good_b), "bytes; list at", list_off, "island at", island_off)
