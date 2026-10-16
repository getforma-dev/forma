#!/usr/bin/env node
// P17's nested evidence transfer. DS11 retains its separate flat artifact contract.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EVIDENCE_MANIFEST = 'EVIDENCE-SHA256.json';
export const EVIDENCE_METADATA_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, entries: 16_384, depth: 32, path: 4096 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
const stat = path => lstat(path, { bigint: true });
const unchanged = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);

function safePath(path) {
  assert(typeof path === 'string' && path.length > 0 && path.length <= EVIDENCE_METADATA_LIMITS.path, 'P17 evidence: invalid path length');
  const parts = path.split('/');
  assert(parts.length <= EVIDENCE_METADATA_LIMITS.depth && parts.every(part => /^[A-Za-z0-9_@+][A-Za-z0-9._@+-]*$/.test(part)), `P17 evidence: unsafe path ${JSON.stringify(path)}`);
  return parts;
}

// Fixed-size reads also cover large raw Lighthouse reports without copying them.
async function hashFile(path, { collect = false } = {}) {
  const before = await stat(path);
  assert(before.isFile() && !before.isSymbolicLink(), `P17 evidence: not a regular file: ${path}`);
  assert(before.size <= BigInt(Number.MAX_SAFE_INTEGER), `P17 evidence: invalid file length: ${path}`);
  if (collect) assert(before.size <= BigInt(EVIDENCE_METADATA_LIMITS.bytes), 'P17 evidence: manifest too large');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    assert(unchanged(before, await file.stat({ bigint: true })), `P17 evidence: file changed before hashing: ${path}`);
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024), chunks = [];
    let length = 0;
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      length += bytesRead;
      assert(BigInt(length) <= before.size, `P17 evidence: file changed while hashing: ${path}`);
      hash.update(buffer.subarray(0, bytesRead));
      if (collect) chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const after = await stat(path);
    assert(after.isFile() && !after.isSymbolicLink() && unchanged(before, after)
      && unchanged(before, await file.stat({ bigint: true })) && BigInt(length) === before.size,
    `P17 evidence: file changed while hashing: ${path}`);
    return { bytes: length, sha256: hash.digest('hex'), ...(collect ? { content: Buffer.concat(chunks) } : {}) };
  } finally { await file.close(); }
}

async function inventory(root, recorded) {
  const entries = [], portable = new Set([EVIDENCE_MANIFEST.toLowerCase()]);
  async function visit(directory, prefix) {
    const before = await stat(directory);
    assert(before.isDirectory() && !before.isSymbolicLink(), `P17 evidence: not a real directory: ${directory}`);
    const names = (await readdir(directory)).sort();
    // The pinned Actions uploader stores files only. Empty directories would
    // vanish on download, so refuse them instead of silently omitting evidence.
    assert(!prefix || names.length > 0, `P17 evidence: empty directory cannot survive artifact transfer: ${prefix}`);
    for (const name of names) {
      if (!prefix && name === EVIDENCE_MANIFEST) {
        assert(recorded, 'P17 evidence: manifest already exists');
        continue;
      }
      const path = prefix ? `${prefix}/${name}` : name;
      safePath(path);
      assert(!portable.has(path.toLowerCase()), `P17 evidence: case-fold path collision: ${path}`);
      portable.add(path.toLowerCase());
      assert(entries.length < EVIDENCE_METADATA_LIMITS.entries, 'P17 evidence: too many entries');
      const absolute = join(root, ...path.split('/')), metadata = await stat(absolute);
      assert(!metadata.isSymbolicLink(), `P17 evidence: symbolic link: ${path}`);
      if (metadata.isDirectory()) {
        entries.push({ path, type: 'directory' });
        await visit(absolute, path);
      } else {
        assert(metadata.isFile(), `P17 evidence: special file: ${path}`);
        entries.push({ path, type: 'file', ...await hashFile(absolute) });
      }
    }
    const after = await stat(directory);
    assert(after.isDirectory() && !after.isSymbolicLink() && unchanged(before, after), `P17 evidence: directory changed while hashing: ${directory}`);
  }
  await visit(root, '');
  assert(entries.some(entry => entry.type === 'file'), 'P17 evidence: no evidence files');
  return entries.sort(compare);
}

function validateManifest(manifest) {
  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'P17 evidence: malformed manifest');
  assert.deepEqual(Object.keys(manifest).sort(), ['entries', 'schema'], 'P17 evidence: unknown manifest fields');
  assert.equal(manifest.schema, 1, 'P17 evidence: unsupported schema');
  assert(Array.isArray(manifest.entries) && manifest.entries.length > 0
    && manifest.entries.length <= EVIDENCE_METADATA_LIMITS.entries, 'P17 evidence: invalid entry count');
  const seen = new Map(), portable = new Set([EVIDENCE_MANIFEST.toLowerCase()]);
  let previous = '';
  for (const entry of manifest.entries) {
    assert(entry && typeof entry === 'object' && !Array.isArray(entry), 'P17 evidence: malformed entry');
    const parts = safePath(entry.path);
    assert(entry.path !== EVIDENCE_MANIFEST && entry.path > previous, 'P17 evidence: duplicate, unsorted or reserved path');
    assert(!portable.has(entry.path.toLowerCase()), 'P17 evidence: case-fold path collision');
    portable.add(entry.path.toLowerCase());
    assert(['file', 'directory'].includes(entry.type), 'P17 evidence: invalid entry type');
    assert.deepEqual(Object.keys(entry).sort(), entry.type === 'file' ? ['bytes', 'path', 'sha256', 'type'] : ['path', 'type'], 'P17 evidence: unknown entry fields');
    if (entry.type === 'file') {
      assert(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0, 'P17 evidence: invalid byte length');
      assert(/^[a-f0-9]{64}$/.test(entry.sha256 ?? ''), 'P17 evidence: invalid file hash');
    }
    if (parts.length > 1) assert.equal(seen.get(parts.slice(0, -1).join('/')), 'directory', 'P17 evidence: missing directory or path collision');
    seen.set(entry.path, entry.type); previous = entry.path;
  }
  return manifest.entries;
}

export async function recordEvidence(directory) {
  const root = resolve(directory), entries = await inventory(root, false);
  const bytes = Buffer.from(JSON.stringify({ schema: 1, entries }, null, 2) + '\n');
  assert(bytes.length <= EVIDENCE_METADATA_LIMITS.bytes, 'P17 evidence: manifest too large');
  const file = await open(join(root, EVIDENCE_MANIFEST), 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  return sha(bytes);
}

export async function verifyEvidence(directory, expectedSha256) {
  assert(/^[a-f0-9]{64}$/.test(expectedSha256 ?? ''), 'P17 evidence: trusted manifest SHA-256 required');
  const root = resolve(directory), rootStat = await stat(root);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'P17 evidence: not a real root directory');
  const manifest = await hashFile(join(root, EVIDENCE_MANIFEST), { collect: true });
  assert.equal(manifest.sha256, expectedSha256, 'P17 evidence: manifest differs from the verifier job output');
  const expected = validateManifest(JSON.parse(manifest.content.toString('utf8')));
  const actual = await inventory(root, true);
  assert.deepEqual(actual, expected, 'P17 evidence: tree differs from authenticated manifest');
  assert.equal((await hashFile(join(root, EVIDENCE_MANIFEST))).sha256, expectedSha256, 'P17 evidence: manifest changed during verification');
  return { files: actual.filter(entry => entry.type === 'file').length, entries: actual.length, sha256: expectedSha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, directory, hash, ...extra] = process.argv.slice(2);
    assert(directory && extra.length === 0 && (command === 'record' ? hash === undefined : command === 'verify' && hash),
      'usage: release-evidence.mjs record DIRECTORY | verify DIRECTORY EXPECTED_SHA256');
    if (command === 'record') console.log(await recordEvidence(directory));
    else console.log(`verified P17 evidence ${JSON.stringify(await verifyEvidence(directory, hash))}`);
  } catch (error) { console.error(`P17 evidence: ${error.message}`); process.exitCode = 1; }
}
