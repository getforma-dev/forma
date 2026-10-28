import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateDashboard } from '../src/dashboard.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grandprix-dashboard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(root, file, value) {
  const output = path.join(root, file); fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, typeof value === 'string' ? value : JSON.stringify(value));
}

test('dashboard works without a ledger or runs and does not invent successful targets', t => {
  const root = fixture(t), result = generateDashboard(root), html = fs.readFileSync(result.path, 'utf8');
  assert.equal(result.changes, 0); assert.equal(result.runs, 0);
  assert(html.includes('No change ledger is available'));
  assert(html.includes('Fresh 3.2 Grand Prix performance remains unmeasured'));
  assert(html.includes('not proof that all goals were met'));
});

test('ledger values are escaped, targets preserved, and unsafe evidence URLs rejected', t => {
  const root = fixture(t);
  write(root, 'config/change-ledger.json', { updatedAt: '2026-10-28', changes: [{
    id: 'test', title: '<script>danger()</script>', status: 'accepted-tradeoff', change: 'Useful <change>',
    measurements: [{ metric: 'batch', pairing: 'same-campaign', baseline: { value: 100 }, candidate: { value: 80 }, direction: 'higher', unit: 'ops/s', campaignId: 'abc', target: { operator: '>=', value: 90, met: false } }],
    evidence: [{ path: 'javascript:alert(1)', label: 'bad' }], tradeoffs: ['<loss>'], remainingTargets: ['keep <all> samples'],
  }] });
  const result = generateDashboard(root), html = fs.readFileSync(result.path, 'utf8');
  assert.equal(result.targets, 1); assert(!html.includes('<script>danger()'));
  assert(html.includes('&lt;script&gt;danger()')); assert(!html.includes('href="javascript:'));
  assert(html.includes('-20%')); assert(html.includes('not met')); assert(html.includes('&lt;loss&gt;'));
});

test('history includes failures, resolves real report links, and is deterministic', t => {
  const root = fixture(t);
  write(root, 'runs/r-test/manifest.json', { id: 'r-test', status: 'failed', quality: 'unqualified', startedAt: '2026-10-28T00:00:00Z', config: { suite: 'server' } });
  write(root, 'runs/r-test/report.html', '<p>report</p>');
  write(root, 'runs/r-test/integrity.json', {});
  write(root, 'evidence/2026-10-24/index.html', '<p>evidence</p>');
  const first = generateDashboard(root), html = fs.readFileSync(first.path, 'utf8');
  assert.equal(first.runs, 1); assert(html.includes('failed')); assert(html.includes('unqualified'));
  assert(html.includes('href="../../runs/r-test/report.html"'));
  assert(html.includes('href="../../evidence/2026-10-24/index.html"'));
  generateDashboard(root); assert.equal(fs.readFileSync(first.path, 'utf8'), html);
});

test('dependency audit is labeled as a dated snapshot and shows both versions', t => {
  const root = fixture(t);
  write(root, 'docs/dependency-audit-2026-10-28.json', { checkedAt: '2026-10-28', packages: [{ name: '@getforma/core', latest: '3.2.0' }], dependencies: [{ name: '@getforma/core', resolved: '3.0.0' }] });
  const result = generateDashboard(root), html = fs.readFileSync(result.path, 'utf8');
  assert(html.includes('saved snapshot, not a live version claim')); assert(html.includes('3.0.0')); assert(html.includes('3.2.0'));
  assert(html.includes('Review update and requalify'));
});
