import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readLedger, validateLedger, renderChanges } from '../src/lineage.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = path.resolve(root, '../..');
const ledger = readLedger(undefined, { repositoryRoot });
const copy = () => structuredClone(ledger);

test('curated lineage has unique decisions, exact release ancestry and resolvable evidence', () => {
  assert(ledger.changes.length >= 12, 'preserve the twelve audited decisions when appending new history');
  assert.equal(ledger.releases['3.1.0'].commit, '9a570afece5eb5091824422f00134a875310e857');
  assert.equal(ledger.releases['3.2.0'].commit, 'fc76ea8531f0e3a85d0224087384e41f52040e3c');
  execFileSync('git', ['merge-base', '--is-ancestor', ledger.releases['3.1.0'].commit, ledger.releases['3.2.0'].commit], { cwd: repositoryRoot });
  assert(ledger.changes.some(change => change.status === 'rejected'));
  assert(ledger.changes.some(change => change.status === 'accepted-tradeoff'));
});
test('remaining numerical misses are preserved as misses, not shipped-release success', () => {
  const latest = ledger.changes.find(change => change.id === 'GP-H010');
  for (const name of ['Fan-out / pristine own engine', 'Effect create-dispose / pristine own engine', 'Create 1000 / matched vanilla'])
    assert.equal(latest.measurements.find(m => m.metric === name).target.met, false);
  assert.equal(ledger.changes.find(change => change.id === 'GP-H004').shippedReleases.length, 0);
  const release = ledger.changes.find(change => change.id === 'GP-H012');
  assert(release.measurements.every(m => m.baseline === null));
  assert.match(release.tradeoffs.join(' '), /not p95/);
  assert.match(release.tradeoffs.join(' '), /No fresh full Grand Prix/);
});
test('schema rejects duplicate identity, missing evidence and unsupported source/release claims', () => {
  for (const mutate of [
    l => l.changes[1].id = l.changes[0].id,
    l => l.changes[0].sourceCommits = ['0'.repeat(40)],
    l => l.changes[0].shippedReleases = ['99.0.0'],
    l => l.changes[3].shippedReleases = ['3.1.0'],
    l => l.changes[0].evidence[0].path = '/tmp/private',
    l => l.changes[0].evidence[0].path = '../../private',
    l => l.changes[0].evidence[0].path = 'missing-evidence.json',
    l => l.changes[0].repeatOnlyIf = [],
  ]) { const broken = copy(); mutate(broken); assert.throws(() => validateLedger(broken, { repositoryRoot })); }
});
test('schema prevents forged target outcomes and invented before values', () => {
  for (const mutate of [
    l => l.changes[0].measurements[0].target.met = false,
    l => l.changes[0].measurements[0].candidate.value = NaN,
    l => l.changes[0].measurements[0].candidate.source = 'unknown',
    l => l.changes[0].measurements[0].unit = '',
    l => l.changes.at(-1).measurements[0].baseline = { source: 'stable-3.1', value: 30 },
    l => l.changes[0].measurements[0].baseline = null,
  ]) { const broken = copy(); mutate(broken); assert.throws(() => validateLedger(broken)); }
});
test('human history is deterministic, complete and synchronized to machine ledger', () => {
  const output = renderChanges(ledger);
  assert.equal(output, readFileSync(path.join(root, 'docs/PERFORMANCE-HISTORY.md'), 'utf8'));
  for (const change of ledger.changes) {
    assert(output.includes(change.id));
    assert(output.includes(change.finding));
    assert(output.includes(change.repeatOnlyIf[0]));
  }
  assert.match(output, /waived task into completed work/);
});
