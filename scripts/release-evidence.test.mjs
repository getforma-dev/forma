import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { openSync, closeSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVIDENCE_MANIFEST, EVIDENCE_METADATA_LIMITS, recordEvidence, verifyEvidence } from './release-evidence.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'forma-p17-tree-')), directory = join(parent, 'p17');
  t.after(() => rm(parent, { recursive: true, force: true }));
  await mkdir(join(directory, 'security'), { recursive: true });
  await mkdir(join(directory, 'performance-attempt-abc123/nested'), { recursive: true });
  for (const [path, bytes] of [
    ['p17.json', '{"passed":true}\n'], ['security/hostile-widgets.json', '{"passed":true,"cases":1686}\n'],
    ['performance-attempt-abc123/manifest.jsonl', '{"sequence":1}\n'],
    ['performance-attempt-abc123/native-n1-300.json', Buffer.from([0, 255, 13, 10, 195, 169])],
    ['performance-attempt-abc123/nested/control.json', '{}\n'],
  ]) await writeFile(join(directory, path), bytes);
  return { parent, directory };
}

test('nested P17 bytes survive recording and an artifact-copy verification while flat DS11 still refuses', async t => {
  const { parent, directory } = await fixture(t);
  const original = await readFile(join(directory, 'performance-attempt-abc123/native-n1-300.json'));
  const flat = spawnSync('bash', [join(root, 'scripts/release-artifacts.sh'), 'record', directory], { encoding: 'utf8' });
  assert.equal(flat.status, 1); assert.match(flat.stderr, /is not a regular file/);
  const hash = await recordEvidence(directory);
  assert.equal(hash, sha(await readFile(join(directory, EVIDENCE_MANIFEST))));
  assert.deepEqual(await readFile(join(directory, 'performance-attempt-abc123/native-n1-300.json')), original);
  const downloaded = join(parent, 'downloaded'); await cp(directory, downloaded, { recursive: true });
  assert.deepEqual(await verifyEvidence(downloaded, hash), { files: 5, entries: 8, sha256: hash });
  await assert.rejects(recordEvidence(directory), /manifest already exists/);
});

for (const [name, mutate] of [
  ['same-length changed bytes', d => writeFile(join(d, 'p17.json'), '{"passed":truE}\n')],
  ['missing file', d => rm(join(d, 'security/hostile-widgets.json'))],
  ['unlisted file', d => writeFile(join(d, 'security/unlisted.json'), 'extra')],
  ['added empty directory', d => mkdir(join(d, 'extra'))],
  ['removed nested directory', d => rm(join(d, 'performance-attempt-abc123/nested'), { recursive: true })],
]) test(`authenticated evidence refuses ${name}`, async t => {
  const { directory } = await fixture(t), hash = await recordEvidence(directory);
  await mutate(directory);
  await assert.rejects(verifyEvidence(directory, hash), /tree differs|empty directory/);
});

test('untrusted manifest bytes fail authentication before JSON parsing or path use', async t => {
  const { directory } = await fixture(t), hash = await recordEvidence(directory);
  await writeFile(join(directory, EVIDENCE_MANIFEST), '{"entries":[{"path":"../../outside"}');
  await assert.rejects(verifyEvidence(directory, hash), /manifest differs/);
  await assert.rejects(verifyEvidence(directory, 'bad'), /trusted manifest SHA-256 required/);
});

const malformed = [
  ['traversal', m => { m.entries[0].path = '../outside'; }],
  ['absolute', m => { m.entries[0].path = '/outside'; }],
  ['backslash', m => { m.entries[0].path = 'security\\outside'; }],
  ['hidden name', m => { m.entries[0].path = '.secret'; }],
  ['newline name', m => { m.entries[0].path = 'safe\n'; }],
  ['carriage-return name', m => { m.entries[0].path = 'safe\r'; }],
  ['case-fold collision', m => { m.entries.splice(1, 0, { ...m.entries[0], path: m.entries[0].path.toUpperCase() }); m.entries.sort((a, b) => a.path < b.path ? -1 : 1); }],
  ['duplicate', m => { m.entries.splice(1, 0, m.entries[0]); }],
  ['unsorted', m => { m.entries.reverse(); }],
  ['missing parent', m => { m.entries = m.entries.filter(e => e.path !== 'security'); }],
  ['unknown fields', m => { m.entries[0].ignored = true; }],
  ['wrong schema', m => { m.schema = 2; }],
  ['invalid length', m => { m.entries.find(e => e.type === 'file').bytes = -1; }],
  ['invalid hash', m => { m.entries.find(e => e.type === 'file').sha256 = 'x'; }],
  ['reserved path', m => { m.entries[0].path = EVIDENCE_MANIFEST; }],
  ['excess entries', m => { m.entries = Array(EVIDENCE_METADATA_LIMITS.entries + 1).fill(m.entries[0]); }],
];
for (const [name, mutate] of malformed) test(`even authenticated metadata refuses ${name}`, async t => {
  const { directory } = await fixture(t); await recordEvidence(directory);
  const manifest = join(directory, EVIDENCE_MANIFEST), content = JSON.parse(await readFile(manifest, 'utf8'));
  mutate(content); const bytes = Buffer.from(JSON.stringify(content)); await writeFile(manifest, bytes);
  await assert.rejects(verifyEvidence(directory, sha(bytes)), /P17 evidence:/);
});

test('actual unsafe names are rejected rather than silently omitted', async t => {
  for (const name of ['.hidden', '-option', 'space name', 'safe\n', 'safe\r', 'safe\r\n']) {
    const { directory } = await fixture(t);
    if (process.platform === 'win32' && /[\r\n]/.test(name)) {
      // Windows refuses these names at creation; authenticated-manifest tests
      // above still exercise the same helper's lexical refusal on every host.
      await assert.rejects(writeFile(join(directory, name), 'secret'));
      continue;
    }
    await writeFile(join(directory, name), 'secret');
    await assert.rejects(recordEvidence(directory), /unsafe path/);
  }
});

test('recording refuses empty directories and portable case collisions before writing a manifest', async t => {
  const { directory } = await fixture(t);
  await mkdir(join(directory, 'empty'));
  await assert.rejects(recordEvidence(directory), /empty directory/);
  await rm(join(directory, 'empty'), { recursive: true });
  await writeFile(join(directory, 'evidence-sha256.json'), 'not the reserved manifest');
  await assert.rejects(recordEvidence(directory), /case-fold path collision|manifest already exists/);
});

test('links at the root, in a directory or at a file never authorize reading outside evidence', async t => {
  const { parent, directory } = await fixture(t);
  const outside = join(parent, 'outside'); await mkdir(outside); await writeFile(join(outside, 'secret'), 'secret');
  const rootLink = join(parent, 'root-link'); await symlink(directory, rootLink, 'junction');
  await assert.rejects(recordEvidence(rootLink), /not a real directory/);
  await symlink(outside, join(directory, 'escaped'), 'junction');
  await assert.rejects(recordEvidence(directory), /symbolic link/);
  await rm(join(directory, 'escaped'));
  await symlink(join(outside, 'secret'), join(directory, 'escaped'), 'file');
  await assert.rejects(recordEvidence(directory), /symbolic link/);
});

test('a special file is refused without opening or blocking on it', { skip: process.platform === 'win32' ? 'POSIX FIFO control; Windows uses the same regular-file predicate' : false }, async t => {
  const { directory } = await fixture(t);
  const result = spawnSync('mkfifo', [join(directory, 'pipe')], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  await assert.rejects(recordEvidence(directory), /special file/);
});

test('manifest size is bounded before reading its body', async t => {
  const { directory } = await fixture(t);
  await writeFile(join(directory, EVIDENCE_MANIFEST), Buffer.alloc(EVIDENCE_METADATA_LIMITS.bytes + 1));
  await assert.rejects(verifyEvidence(directory, 'a'.repeat(64)), /manifest too large/);
});

test('a real file changing during streamed hashing refuses completion', async t => {
  const { directory } = await fixture(t), file = join(directory, 'changing.bin');
  await writeFile(file, Buffer.alloc(16 * 1024 * 1024));
  let value = 0;
  const writer = setInterval(() => {
    // Windows guarantees last-write metadata after the writing handle closes.
    const fd = openSync(file, 'r+');
    try { writeSync(fd, Buffer.from([++value % 256]), 0, 1, 0); }
    finally { closeSync(fd); }
  }, 1);
  try { await assert.rejects(recordEvidence(directory), /file changed/); }
  finally { clearInterval(writer); }
  assert(value > 0, 'the mutation actually executed');
});
