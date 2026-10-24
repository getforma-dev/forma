// Test-harness comparison, independent of the compiler codec. FMIR-v3's frozen
// corpus keeps its original writer; only the current package version and its
// covering CRC may differ. Never regenerate an expected payload from the emitter.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const SIGNATURE = Buffer.from([0x89, 0x46, 0x4d, 0x49, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEADER_SIZE = 24;

// Bitwise CRC-32/ISO-HDLC reference; deliberately does not import the codec's
// table or encoder. The standard check vector is pinned in fmir-corpus.test.mjs.
export function referenceCrc32(...chunks) {
  let crc = 0xffffffff;
  for (const chunk of chunks) for (const byte of chunk) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function header(bytes) {
  assert(bytes.length >= HEADER_SIZE + 4 && bytes.length <= 16 * 1024 * 1024, 'invalid FMIR corpus length');
  assert.deepEqual(bytes.subarray(0, 8), SIGNATURE, 'invalid FMIR corpus signature');
  const writer = [8, 10, 12].map(offset => bytes.readUInt16LE(offset));
  const bodyLength = bytes.readUInt32LE(14), checksum = bytes.readUInt32LE(18);
  assert.equal(bodyLength, bytes.length - HEADER_SIZE, 'invalid FMIR corpus body length');
  assert.equal(bytes.readUInt16LE(22), 0, 'invalid FMIR corpus reserved header');
  assert.equal(checksum, referenceCrc32(bytes.subarray(0, 18), bytes.subarray(22)), 'invalid FMIR corpus CRC');
  return { writer, bodyLength, checksum };
}
const firstLine = ({ writer, bodyLength, checksum }) => `FMIR v3 writer=${writer.join('.')} body_len=${bodyLength} crc=${checksum.toString(16).padStart(8, '0')}\n`;

export function assertCurrentCorpus({ name, bytes, dump, frozenBytes, frozenDump, expectedVersion }) {
  assert(Array.isArray(expectedVersion) && expectedVersion.length === 3 && expectedVersion.every(n => Number.isInteger(n) && n >= 0 && n <= 0xffff), 'expected writer must have three u16 components');
  const frozen = Buffer.from(frozenBytes), current = Buffer.from(bytes);
  const old = header(frozen), actual = header(current);
  assert.equal(expectedVersion[0], 3, 'this comparison requires FMIR v3');
  assert(old.writer[0] === expectedVersion[0] && old.writer[1] <= expectedVersion[1], `${name}: frozen writer is outside the current reader window`);
  assert.deepEqual(actual.writer, expectedVersion, `${name}: writer does not match the current package version`);
  assert(frozenDump.startsWith(firstLine(old)), `${name}: frozen dump header disagrees with frozen bytes`);
  const expected = Buffer.from(frozen);
  expectedVersion.forEach((part, index) => expected.writeUInt16LE(part, 8 + 2 * index));
  expected.writeUInt32LE(referenceCrc32(expected.subarray(0, 18), expected.subarray(22)), 18);
  assert.deepEqual(current, expected, `${name}: emitted bytes differ from the frozen corpus beyond the version header`);
  const expectedDump = firstLine(header(expected)) + frozenDump.slice(firstLine(old).length);
  assert.equal(dump, expectedDump, `${name}: canonical dump differs from the frozen corpus beyond the version header`);
}

// Native tests read real compiler bytes with unchanged HTML goldens. Preserve
// the historical corpus even when the child refuses or a write fails partway.
export function withStagedCorpus(files, verify) {
  assert.equal(new Set(files.map(file => file.path)).size, files.length, 'duplicate corpus path');
  const original = files.map(file => ({ path: file.path, bytes: readFileSync(file.path) }));
  try {
    for (const file of files) writeFileSync(file.path, file.bytes);
    return verify();
  } finally {
    for (const file of original) writeFileSync(file.path, file.bytes);
    for (const file of original) assert.deepEqual(readFileSync(file.path), file.bytes, `failed to restore ${file.path}`);
  }
}
