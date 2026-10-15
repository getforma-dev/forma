"""Build the FMIR v3 worked example and print it as annotated bytes.
Page: <main><h1>{title}</h1></main> with props { title: string }.
Usage: python3 -I example.py
"""
import struct, zlib
from pathlib import Path

here = Path(__file__).resolve().parent

def u8(v): return bytes([v])
def u16(v): return struct.pack("<H", v)
def u32(v): return struct.pack("<I", v)

strings = ["main", "h1", "title", "page.tsx"]
def s(name): return strings.index(name)

# --- bytecode (section 1) ---
bc = b""
bc += u8(0x01) + u32(s("main")) + u16(0)          # OPEN_TAG main, 0 attrs
bc += u8(0x01) + u32(s("h1")) + u16(0)            # OPEN_TAG h1
bc += u8(0x05) + u16(0) + u16(0)                  # DYN_TEXT slot 0, marker 0
bc += u8(0x02) + u32(s("h1"))                     # CLOSE_TAG h1
bc += u8(0x02) + u32(s("main"))                   # CLOSE_TAG main

# --- strings (section 2) ---
st = u32(len(strings))
for x in strings:
    e = x.encode(); st += u16(len(e)) + e

# --- slots (section 3): one slot, id 0, name "title", Text, Server, no default ---
sl = u16(1) + u16(0) + u32(s("title")) + u8(0x01) + u8(0x00) + u16(0)

# --- islands (section 4): none ---
isl = u16(0)

# --- props schema (section 5): object table, object 0 = page props, 1 field ---
ps = u16(1)                      # object_count
ps += u16(1)                     # object 0: field_count
ps += u32(s("title")) + u32(s("page.tsx")) + u32(3) + u32(23)   # name, file, line, column
ps += u8(0x02)                   # type: string

sections = [(0x0001, 1, bc), (0x0002, 1, st), (0x0003, 1, sl), (0x0004, 1, isl), (0x0005, 1, ps)]

HEADER_LEN = 24
table_len = 4 + 12 * len(sections)
offset = HEADER_LEN + table_len
table = u16(len(sections)) + u16(0)
data = b""
rows = []
for sid, req, payload in sections:
    table += u16(sid) + u16(req) + u32(offset) + u32(len(payload))
    rows.append((sid, req, offset, len(payload)))
    offset += len(payload); data += payload

body = table + data
assert zlib.crc32(b"123456789") == 0xCBF43926
sig = bytes([0x89, 0x46, 0x4D, 0x49, 0x0D, 0x0A, 0x1A, 0x0A])
header = sig + u16(3) + u16(0) + u16(0) + u32(len(body)) + u32(0) + u16(0)
module = header + body
crc = zlib.crc32(module[:18] + module[22:]) & 0xFFFFFFFF
header = header[:18] + u32(crc) + header[22:]
module = header + body
assert len(header) == 24
print("total bytes", len(module), "body", len(body), "crc %08x" % crc)
print("sections", rows)

def hexrow(off, b):
    return f"{off:04x}  {' '.join(f'{x:02x}' for x in b):<36}"

lines = []
lines.append(hexrow(0, sig) + "  signature")
lines.append(hexrow(8, header[8:14]) + "  writer 3.0.0 (three u16)")
lines.append(hexrow(14, header[14:18]) + f"  body length {len(body)}")
lines.append(hexrow(18, header[18:22]) + f"  CRC-32 excluding bytes [18,22) 0x{crc:08x}")
lines.append(hexrow(22, header[22:24]) + "  header reserved zero")
lines.append(hexrow(24, table[0:2]) + f"  section count {len(sections)}")
lines.append(hexrow(26, table[2:4]) + "  table reserved zero")
p = 28
names = {1:"bytecode",2:"strings",3:"slots",4:"islands",5:"props schema"}
for sid, req, off, ln in rows:
    lines.append(hexrow(p, table[p-24:p-24+12]) + f"  section 0x{sid:04x} {names[sid]}: required={req} offset={off} length={ln}")
    p += 12
# data
off = HEADER_LEN + table_len
def chunk(label, b):
    global off
    for i in range(0, len(b), 12):
        part = b[i:i+12]
        lines.append(hexrow(off + i, part) + ("  " + label if i == 0 else ""))
    off += len(b)
# bytecode broken per opcode
ops = [(bc[0:7], "OPEN_TAG str 0 (main), 0 attrs"), (bc[7:14], "OPEN_TAG str 1 (h1), 0 attrs"),
       (bc[14:19], "DYN_TEXT slot 0, marker 0"), (bc[19:24], "CLOSE_TAG str 1"), (bc[24:29], "CLOSE_TAG str 0")]
for b, label in ops: chunk(label, b)
chunk("strings: count 4", st[0:4])
pp = 4
for x in strings:
    e = x.encode(); chunk(f'string "{x}" (len {len(e)})', st[pp:pp+2+len(e)]); pp += 2 + len(e)
chunk("slots: count 1", sl[0:2]); chunk("slot 0: name str 2, Text, Server, default_len 0", sl[2:])
chunk("islands: count 0", isl)
chunk("props schema: object_count 1", ps[0:2]); chunk("object 0: field_count 1", ps[2:4])
chunk("field: name str 2, file str 3, line 3, column 23", ps[4:20]); chunk("type 0x02 string", ps[20:21])
lines = [line.rstrip() for line in lines]
print("\n".join(lines))
assert off == len(module)
(here / "example.ir").write_bytes(module)
(here / "listing.txt").write_text("\n".join(lines) + "\n")
