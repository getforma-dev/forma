"""FMIR v3 reference encoder for the specification's example and fault fixtures.

Layout per FMIR-v3.md sections 3 to 7 (24-byte header; section count u16 + reserved u16 at 24;
12-byte entries from 28; CRC-32 over bytes [0,18) then [22, end)).

Used by example.py and fixtures.py. Not the implementation: the implementation regenerates
example.ir from its own encoder and must produce these bytes.
"""
import struct, zlib

SIGNATURE = bytes([0x89, 0x46, 0x4D, 0x49, 0x0D, 0x0A, 0x1A, 0x0A])
HEADER_LEN = 24
TABLE_HEAD = 4          # section_count u16 + reserved u16
ENTRY_LEN = 12

SEC_BYTECODE, SEC_STRINGS, SEC_SLOTS, SEC_ISLANDS, SEC_SCHEMA, SEC_KEYPATHS, SEC_POSITIONS = 1, 2, 3, 4, 5, 6, 7

def u8(v): return bytes([v])
def u16(v): return struct.pack("<H", v)
def u32(v): return struct.pack("<I", v)

def crc32(module: bytes) -> int:
    """The spec's CRC: every byte of the file except the four CRC bytes at [18, 22)."""
    return zlib.crc32(module[:18] + module[22:]) & 0xFFFFFFFF

def assemble(sections, writer=(3, 0, 0), pad=b"\x00\x00", table_reserved=b"\x00\x00",
             count=None, crc=None):
    """sections: list of (id, flags, payload) in table order. Returns the module bytes."""
    n = len(sections) if count is None else count
    table = u16(n) + table_reserved
    offset = HEADER_LEN + TABLE_HEAD + ENTRY_LEN * len(sections)
    data = b""
    for sid, flags, payload in sections:
        table += u16(sid) + u16(flags) + u32(offset) + u32(len(payload))
        offset += len(payload); data += payload
    body = table + data
    header = SIGNATURE + u16(writer[0]) + u16(writer[1]) + u16(writer[2]) + u32(len(body)) + u32(0) + pad
    module = header + body
    c = crc32(module) if crc is None else crc
    return module[:18] + u32(c) + module[22:]

def restamp(module: bytes) -> bytes:
    """Rewrite body_len and the CRC after a mutation that kept the 24-byte header shape."""
    module = module[:14] + u32(len(module) - HEADER_LEN) + module[18:]
    return module[:18] + u32(crc32(module)) + module[22:]

def strings_section(strings):
    out = u32(len(strings))
    for s in strings:
        e = s.encode(); out += u16(len(e)) + e
    return out

def slots_section(slots):
    """slots: list of (slot_id, name_str_idx, type_hint, source, default_bytes)."""
    out = u16(len(slots))
    for sid, name, th, src, d in slots:
        out += u16(sid) + u32(name) + u8(th) + u8(src) + u16(len(d)) + d
    return out

def island_entry(island_id, trigger, name_str_idx, byte_offset, schema_object=0xFFFF,
                 digest=b"", slot_ids=(), reserved=0, entry_len=None):
    body = (u16(island_id) + u8(trigger) + u8(reserved) + u32(name_str_idx) + u32(byte_offset)
            + u16(schema_object) + u8(len(digest)) + digest + u16(len(slot_ids)))
    for s in slot_ids: body += u16(s)
    return u16(len(body) if entry_len is None else entry_len) + body

def islands_section(entries):
    return u16(len(entries)) + b"".join(entries)

# schema type tags
T_BOOLEAN, T_STRING, T_NUMBER, T_DATE, T_ENUM, T_ARRAY, T_OPTIONAL, T_OBJECT = range(1, 9)

def field(name_str_idx, file_str_idx, line, column, type_bytes):
    return u32(name_str_idx) + u32(file_str_idx) + u32(line) + u32(column) + type_bytes

def schema_section(objects):
    """objects: list of lists of field bytes."""
    out = u16(len(objects))
    for fields in objects:
        out += u16(len(fields)) + b"".join(fields)
    return out

def keypaths_section(entries):
    """entries: list of (list_offset, [segment_str_idx...])."""
    out = u32(len(entries))
    for off, segs in entries:
        out += u32(off) + u8(len(segs)) + b"".join(u32(s) for s in segs)
    return out

def positions_section(entries):
    """entries: list of (opcode_offset, file_str_idx, line, column, component_str_idx)."""
    out = u32(len(entries))
    for e in entries: out += b"".join(u32(x) for x in e)
    return out

# opcodes
OPEN_TAG, CLOSE_TAG, VOID_TAG, TEXT, DYN_TEXT, DYN_ATTR, SHOW_IF, SHOW_ELSE = 1, 2, 3, 4, 5, 6, 7, 8
LIST, ISLAND_START, ISLAND_END, PROP = 0x0A, 0x0B, 0x0C, 0x12

def op_open(str_idx, attrs=()):
    return u8(OPEN_TAG) + u32(str_idx) + u16(len(attrs)) + b"".join(u32(k) + u32(v) for k, v in attrs)
def op_close(str_idx): return u8(CLOSE_TAG) + u32(str_idx)
def op_text(str_idx): return u8(TEXT) + u32(str_idx)
def op_dyn_text(slot, marker): return u8(DYN_TEXT) + u16(slot) + u16(marker)
def op_list(slot, item_slot, body): return u8(LIST) + u16(slot) + u16(item_slot) + u32(len(body)) + body
def op_island_start(i): return u8(ISLAND_START) + u16(i)
def op_island_end(i): return u8(ISLAND_END) + u16(i)
def op_prop(src, name_str_idx, target): return u8(PROP) + u16(src) + u32(name_str_idx) + u16(target)
