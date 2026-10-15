/** FMIR v3 container encoding and lossless diagnostics. Structural payload validation
 * belongs to the emitter and the Rust loader; this reader validates the container. */
import compilerPackage from '../package.json';
import * as C from './fmir-constants.js';

export type WriterVersion = readonly [number, number, number];
export function baseWriterVersion(version: string): WriterVersion {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) throw new Error(`Invalid compiler package version: ${version}`);
  const parts = match.slice(1, 4).map(Number);
  if (parts.some(n => n > 0xffff)) throw new Error(`Compiler package version exceeds FMIR u16 components: ${version}`);
  return parts as unknown as WriterVersion;
}
// Bundlers embed package metadata with this module, including when a build tool
// bundles the compiler into its own runner outside the package directory.
export const COMPILER_WRITER_VERSION = baseWriterVersion(compilerPackage.version);

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ ((c & 1) ? C.CRC_POLYNOMIAL : 0);
  return c >>> 0;
});
/** CRC-32/ISO-HDLC, streaming chunks without inserting boundary or skipped bytes. */
export function crc32(...chunks: readonly Uint8Array[]): number {
  let value = 0xffffffff;
  for (const chunk of chunks) for (const byte of chunk) value = CRC_TABLE[(value ^ byte) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export interface FmirSection { id: number; flags: number; bytes: Uint8Array }
export interface FmirDescriptor extends FmirSection { offset: number; length: number }
export interface FmirContainer { writer: WriterVersion; bodyLength: number; checksum: number; sections: FmirDescriptor[] }
export class FmirContainerError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'FmirContainerError'; }
}
function requireRule(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new FmirContainerError(code, message);
}

/** Pack sections in canonical ascending order; flags and unknown payloads are preserved. */
export function encodeFmirSections(sections: readonly FmirSection[], writer: WriterVersion = COMPILER_WRITER_VERSION): Uint8Array {
  requireRule(sections.length <= C.MAX_SECTIONS, C.LOAD_107, 'section count exceeds 64');
  requireRule(writer.every(n => Number.isInteger(n) && n >= 0 && n <= 0xffff), C.LOAD_108, 'writer components must be u16');
  let previous = -1;
  let total = C.HEADER_SIZE + C.TABLE_PREFIX_SIZE + sections.length * C.SECTION_ENTRY_SIZE;
  for (const section of sections) {
    requireRule(Number.isInteger(section.id) && section.id >= 0 && section.id <= 0xffff && section.id > previous, C.LOAD_103, 'section ids must be u16, unique and ascending');
    requireRule(section.flags === 0 || section.flags === C.SECTION_REQUIRED, C.LOAD_103, 'reserved section flags');
    previous = section.id; total += section.bytes.length;
  }
  requireRule(total <= C.MAX_MODULE_SIZE, C.LOAD_107, 'module exceeds 16 MiB');
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  bytes.set(C.SIGNATURE);
  writer.forEach((part, i) => view.setUint16(8 + i * 2, part, true));
  view.setUint32(14, total - C.HEADER_SIZE, true);
  view.setUint16(C.HEADER_SIZE, sections.length, true);
  let offset = C.HEADER_SIZE + C.TABLE_PREFIX_SIZE + sections.length * C.SECTION_ENTRY_SIZE;
  sections.forEach((section, i) => {
    const p = C.HEADER_SIZE + C.TABLE_PREFIX_SIZE + i * C.SECTION_ENTRY_SIZE;
    view.setUint16(p, section.id, true); view.setUint16(p + 2, section.flags, true);
    view.setUint32(p + 4, offset, true); view.setUint32(p + 8, section.bytes.length, true);
    bytes.set(section.bytes, offset); offset += section.bytes.length;
  });
  view.setUint32(18, crc32(bytes.subarray(0, 18), bytes.subarray(22)), true);
  return bytes;
}

/** Header/table reader used by diagnostics and compiler conformance tests. */
export function readFmirContainer(bytes: Uint8Array, reader: WriterVersion = COMPILER_WRITER_VERSION): FmirContainer {
  requireRule(bytes.length <= C.MAX_MODULE_SIZE, C.LOAD_107, 'module exceeds 16 MiB');
  requireRule(bytes.length >= C.HEADER_SIZE, C.LOAD_103, 'header truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!C.SIGNATURE.every((b, i) => bytes[i] === b)) {
    const legacy = bytes[0] === 0x46 && bytes[1] === 0x4d && bytes[2] === 0x49 && bytes[3] === 0x52;
    throw new FmirContainerError(C.LOAD_102, legacy ? `an FMIR module before v3 (header version ${view.getUint16(4, true)}): rebuild with a 3.x compiler` : 'bad signature');
  }
  const writer: WriterVersion = [view.getUint16(8, true), view.getUint16(10, true), view.getUint16(12, true)];
  requireRule(writer.every((v, i) => v === reader[i]), C.LOAD_108, `writer ${writer.join('.')}; reader ${reader.join('.')}`);
  const bodyLength = view.getUint32(14, true), checksum = view.getUint32(18, true);
  requireRule(bodyLength === bytes.length - C.HEADER_SIZE, C.LOAD_104, `declared body ${bodyLength}; actual ${bytes.length - C.HEADER_SIZE}`);
  const computed = crc32(bytes.subarray(0, 18), bytes.subarray(22));
  requireRule(checksum === computed, C.LOAD_104, `stored CRC ${checksum.toString(16)}; computed ${computed.toString(16)}`);
  requireRule(view.getUint16(22, true) === 0, C.LOAD_103, 'reserved header bits');
  requireRule(bytes.length >= 26, C.LOAD_103, 'section count truncated');
  const count = view.getUint16(24, true);
  requireRule(count <= C.MAX_SECTIONS, C.LOAD_107, 'section count exceeds 64');
  requireRule(C.TABLE_PREFIX_SIZE + C.SECTION_ENTRY_SIZE * count <= bodyLength, C.LOAD_103, 'section table does not fit body');
  requireRule(view.getUint16(26, true) === 0, C.LOAD_103, 'reserved table bits');
  const sections: FmirDescriptor[] = [];
  let lastId = -1, end = 28 + C.SECTION_ENTRY_SIZE * count;
  for (let i = 0; i < count; i++) {
    const p = 28 + i * C.SECTION_ENTRY_SIZE;
    const id = view.getUint16(p, true), flags = view.getUint16(p + 2, true);
    const offset = view.getUint32(p + 4, true), length = view.getUint32(p + 8, true);
    requireRule(id > lastId, C.LOAD_103, 'section ids duplicate or unordered');
    requireRule((flags & ~C.SECTION_REQUIRED) === 0, C.LOAD_103, 'reserved section flags');
    requireRule(offset === end && offset + length <= bytes.length, C.LOAD_103, 'sections do not tile');
    requireRule((id >= C.SECTION_BYTECODE && id <= C.SECTION_SOURCE_POSITIONS) || flags === 0, C.LOAD_106, `unknown required section ${id}; writer ${writer.join('.')}; reader ${reader.join('.')}`);
    sections.push({ id, flags, offset, length, bytes: bytes.subarray(offset, offset + length) });
    lastId = id; end = offset + length;
  }
  requireRule(end === bytes.length, C.LOAD_103, 'sections do not reach file end');
  for (let id = C.SECTION_BYTECODE; id <= C.SECTION_PROPS_SCHEMA; id++) requireRule(sections.some(s => s.id === id), C.LOAD_105, `missing required section ${id}`);
  return { writer, bodyLength, checksum, sections };
}

/** Stable lossless representation shared with forma-ir::dump_ir. */
export function dumpFmir(bytes: Uint8Array): string {
  const module = readFmirContainer(bytes);
  let out = `FMIR v3 writer=${module.writer.join('.')} body_len=${module.bodyLength} crc=${module.checksum.toString(16).padStart(8, '0')}\n`;
  for (const section of module.sections) {
    out += `SECTION id=${section.id.toString(16).padStart(4, '0')} flags=${section.flags.toString(16).padStart(4, '0')} offset=${section.offset} length=${section.length}\n`;
    out += `HEX ${Buffer.from(section.bytes).toString('hex')}\n`;
  }
  return out;
}
