import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCurrentCorpus, assertCurrentFmirHash, packageWriter, referenceCrc32, withStagedCorpus } from './fmir-corpus.mjs';

const fixtures = fileURLToPath(new URL('../crates/forma-ir/tests/fixtures/js-emitter/', import.meta.url));
const cases = readdirSync(fixtures).filter(name => name.endsWith('.ir')).map(name => name.slice(0, -3));
function restamp(bytes) {
  // Python's standard-library implementation is independent of both the real
  // compiler and the comparison helper under test.
  const crc = Number(execFileSync('python3', ['-c', 'import sys,zlib; b=sys.stdin.buffer.read(); print(zlib.crc32(b[:18]+b[22:]) & 0xffffffff)'], { input: bytes, encoding: 'utf8' }));
  bytes.writeUInt32LE(crc, 18);
  return bytes;
}
function fixture(name = 'barrel-exports', expectedVersion = [3, 1, 0]) {
  const frozenBytes = readFileSync(join(fixtures, `${name}.ir`));
  const frozenDump = readFileSync(join(fixtures, `${name}.dump`), 'utf8');
  const bytes = Buffer.from(frozenBytes);
  expectedVersion.forEach((part, index) => bytes.writeUInt16LE(part, 8 + 2 * index));
  restamp(bytes);
  const dump = frozenDump.replace(/^FMIR[^\n]+\n/, `FMIR v3 writer=${expectedVersion.join('.')} body_len=${bytes.length - 24} crc=${bytes.readUInt32LE(18).toString(16).padStart(8, '0')}\n`);
  return { name, bytes, dump, frozenBytes, frozenDump, expectedVersion };
}

test('independent CRC matches ISO-HDLC check vector and split chunks', () => {
  assert.equal(referenceCrc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(referenceCrc32(Buffer.from('1234'), Buffer.from('56789')), 0xcbf43926);
  assert.equal(referenceCrc32(Buffer.alloc(0)), 0);
});
test('all 14 historical3.0 and current3.1 corpus bodies compare byte for byte', () => {
  assert.equal(cases.length, 14);
  for (const name of cases) for (const writer of [[3, 0, 0], [3, 1, 0]]) {
    const f = fixture(name, writer);
    assertCurrentCorpus(f);
    if (writer[1] === 0) assert.deepEqual(f.bytes, f.frozenBytes);
  }
});
test('the historical full-binary hash permits only the exact current writer and covering CRC', () => {
  for (const writer of [[3, 0, 0], [3, 1, 0]]) {
    const f = fixture('barrel-exports', writer);
    const proof = { ...f, frozenVersion: [3, 0, 0], frozenSha256: createHash('sha256').update(f.frozenBytes).digest('hex') };
    assertCurrentFmirHash(proof);
    for (const [offset, message] of [[0, /signature/], [14, /body length/], [22, /reserved header/], [f.bytes.length - 1, /emitted bytes differ/]]) {
      const bytes = Buffer.from(f.bytes); bytes[offset] ^= 1; restamp(bytes);
      assert.throws(() => assertCurrentFmirHash({ ...proof, bytes }), message);
    }
    const stale = Buffer.from(f.bytes); stale.writeUInt16LE(writer[1] + 1, 10); restamp(stale);
    assert.throws(() => assertCurrentFmirHash({ ...proof, bytes: stale }), /writer does not match/);
    assert.throws(() => assertCurrentFmirHash({ ...proof, frozenSha256: '0'.repeat(64) }), /emitted bytes differ/);
    const invalid = Buffer.from(f.bytes); invalid[18] ^= 1;
    assert.throws(() => assertCurrentFmirHash({ ...proof, bytes: invalid }), /CRC/);
  }
});
test('package versions bind the three exact u16 writer components', () => {
  assert.deepEqual(packageWriter('3.1.0-rc.1'), [3, 1, 0]);
  assert.deepEqual(packageWriter('3.0.9'), [3, 0, 9]);
  for (const value of [undefined, '3.1', '3.01.0', '3.1.65536', '3.1.0junk']) assert.throws(() => packageWriter(value));
});
test('a payload mutation with independently repaired CRC still fails', () => {
  for (const writer of [[3, 0, 0], [3, 1, 0]]) {
    const f = fixture('barrel-exports', writer);
    f.bytes[f.bytes.length - 1] ^= 1;
    restamp(f.bytes);
    assert.throws(() => assertCurrentCorpus(f), /emitted bytes differ/);
  }
});
test('non-version header fields remain protected even with a repaired CRC', () => {
  for (const [offset, message] of [[0, /signature/], [14, /body length/], [22, /reserved header/]]) {
    const f = fixture(); f.bytes[offset] ^= 1; restamp(f.bytes);
    assert.throws(() => assertCurrentCorpus(f), message);
  }
});
test('current writer must match and a future frozen writer is refused', () => {
  const wrong = fixture(); wrong.bytes.writeUInt16LE(0, 10); restamp(wrong.bytes);
  assert.throws(() => assertCurrentCorpus(wrong), /writer does not match/);
  const future = fixture(); future.frozenBytes.writeUInt16LE(2, 10); restamp(future.frozenBytes);
  assert.throws(() => assertCurrentCorpus(future), /outside the current reader window/);
});
test('corrupted original CRC and dump header cannot become valid expected data', () => {
  const badCrc = fixture(); badCrc.frozenBytes[18] ^= 1;
  assert.throws(() => assertCurrentCorpus(badCrc), /CRC/);
  const badDump = fixture(); badDump.frozenDump = badDump.frozenDump.replace('writer=3.0.0', 'writer=3.1.0');
  assert.throws(() => assertCurrentCorpus(badDump), /frozen dump header disagrees/);
});
test('every canonical dump character after the first line remains exact', () => {
  const f = fixture(); f.dump = f.dump.replace('SECTION id=', 'SECTION id=f');
  assert.throws(() => assertCurrentCorpus(f), /canonical dump differs/);
});
test('staging restores exact original binaries/dumps and preserves HTML on success and failed child', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-corpus-restore-'));
  try {
    const f = fixture(), ir = join(dir, 'case.ir'), dump = join(dir, 'case.dump'), html = join(dir, 'case.html');
    writeFileSync(ir, f.frozenBytes); writeFileSync(dump, f.frozenDump); writeFileSync(html, '<div>unchanged</div>');
    const files = [{ path: ir, bytes: f.bytes }, { path: dump, bytes: f.dump }];
    for (const fails of [false, true]) {
      const run = () => withStagedCorpus(files, () => {
        assert.deepEqual(readFileSync(ir), f.bytes); assert.equal(readFileSync(dump, 'utf8'), f.dump);
        if (fails) execFileSync(process.execPath, ['-e', 'process.exit(9)']);
      });
      if (fails) assert.throws(run, /Command failed/); else run();
      assert.deepEqual(readFileSync(ir), f.frozenBytes); assert.equal(readFileSync(dump, 'utf8'), f.frozenDump);
      assert.equal(readFileSync(html, 'utf8'), '<div>unchanged</div>');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
