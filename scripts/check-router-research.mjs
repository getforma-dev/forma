// Authenticate the frozen research inputs and complete question-to-test mapping.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../docs/design/router/', import.meta.url));
const snapshot = JSON.parse(readFileSync(join(root, 'research-manifest.json'), 'utf8'));
const map = JSON.parse(readFileSync(join(root, 'research-map.json'), 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(join(root, 'research', path))).digest('hex');
assert.equal(snapshot.files.length, 49, 'frozen input inventory changed');
for (const file of snapshot.files) {
  assert.equal(hash(file.path), file.sha256, `${file.path}: frozen research bytes changed`);
  assert.equal(readFileSync(join(root, 'research', file.path)).length, file.bytes, `${file.path}: byte length`);
}
for (const [path, digest] of Object.entries(map.research_file_sha256)) assert.equal(hash(path), digest, `${path}: traceability digest`);
assert.equal(map.questions.length, 105);
assert.equal(new Set(map.questions.map(q => q.id)).size, 105);
assert.equal(map.tests.length, 57);
const ids = new Set(map.tests.map(t => t.id));
assert.equal(ids.size, 57);
for (const [study, count] of Object.entries(map.counts)) {
  const selected = map.questions.filter(q => q.study === study);
  assert.equal(selected.length, count, `${study}: complete question inventory`);
  assert.deepEqual(selected.map(q => q.number).sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i + 1));
}
for (const q of map.questions) {
  assert(['Adopt', 'Adapt', 'Defer', 'Reject'].includes(q.disposition), q.id);
  assert(q.decisions.length && q.decisions.every(id => map.decisions[id]), `${q.id}: decision`);
  assert(q.tests.length && q.tests.every(id => ids.has(id)), `${q.id}: acceptance`);
  assert(existsSync(join(root, 'research', q.source)), `${q.id}: source`);
}
console.log('Router research:49 exact input hashes,105 complete questions,57 acceptance IDs verified. Execution qualification is separate.');
