import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, compareMeans } from '../src/statistics.mjs';
import { collectReport, generateReport, compareRuns, validateIslandEvidence } from '../src/report.mjs';
import { profileConfiguration } from '../harness/resource-profile.mjs';

const campaign = {
  schema: 1, id: '11111111-1111-4111-8111-111111111111', createdAt: '2026-10-28T00:00:00.000Z',
  kind: 'native', hostSha256: 'a'.repeat(64), machineIdSha256: 'b'.repeat(64), runnerTrackingSha256: null, github: null,
};
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grandprix-report-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(dir, relative, data) {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}
function manifest(id = 'test') {
  return { id, status: 'completed', protocolVersion: 'lab-1', testHash: 'c'.repeat(64), config: { runs: 3 }, environment: { cpu: 'test', node: 'v22' } };
}
function dom(samples, changes = {}) {
  return { verified: true, runs: samples.length, warmups: 2, pageErrors: [], campaign,
    ops: { create1000: { runs: samples } }, machine: { cpu: 'test', cores: 4, node: 'v22', chrome: 'test' }, ...changes };
}

test('sample SD, median and CV retain every sample, including zero and outlier', () => {
  assert.deepEqual(describe([0, 1, 2]), { n: 3, mean: 1, median: 1, sd: 1, min: 0, max: 2, cv: 1 });
  assert.equal(describe([1, 2, 3, 100]).mean, 26.5);
  assert.equal(describe([3]).sd, null);
  assert.equal(describe([0, 0]).cv, null);
  for (const bad of [[1, null], [1, NaN], [1, Infinity], [1, -1], ['1']]) assert.throws(() => describe(bad));
  assert.equal(compareMeans({ mean: 10 }, { mean: 8 }, 'lower').improvementPercent, 20);
  assert.equal(compareMeans({ mean: 0 }, { mean: 8 }, 'lower'), null);
});

test('nested trials retain their own samples and only compare competitors in that trial', t => {
  const dir = fixture(t); write(dir, 'manifest.json', manifest());
  write(dir, 'artifacts/client/published/raw/dom/forma.json', dom([10, 12, 14]));
  write(dir, 'artifacts/client/published/raw/dom/react.json', dom([20, 24, 28]));
  write(dir, 'artifacts/client/candidate/raw/dom/forma.json', dom([9, 10, 11]));
  const report = collectReport(dir);
  assert.equal(report.measurements.length, 3);
  assert.equal(report.comparisons.length, 1);
  assert.equal(report.comparisons[0].ratio, 0.5);
  assert.equal(report.comparisons[0].trial, 'artifacts/client/published');
  assert.equal(report.measurements[0].campaignId, campaign.id);
  assert.equal(report.sourceComparisons.length, 1);
  assert.equal(report.sourceComparisons[0].ratio, 10 / 12);
  assert.equal(report.sourceComparisons[0].baselineTrial, 'artifacts/client/published');
});

test('failures, missing samples and selected missing competitors stay visible', t => {
  const dir = fixture(t);
  write(dir, 'manifest.json', { ...manifest(), expected: [{ event: 'dom', car: 'vue' }] });
  write(dir, 'raw/dom/forma.json', dom([10, null, 12]));
  write(dir, 'raw/dom/react.failed.json', dom([20, 24, 28], { verified: false, error: 'failure' }));
  write(dir, 'raw/dom/solid.json', dom([10], { runs: 5 }));
  const report = collectReport(dir);
  assert.equal(report.measurements.find(row => row.car === 'forma').status, 'invalid');
  assert.equal(report.measurements.find(row => row.car === 'react.failed').status, 'excluded');
  assert.equal(report.measurements.find(row => row.car === 'solid').status, 'invalid');
  assert.equal(report.measurements.find(row => row.car === 'vue').status, 'missing');
  assert(report.comparisons.every(comparison => comparison.status === 'not-comparable'));
});

test('different campaigns and unlike batching semantics never produce ratios', t => {
  const dir = fixture(t);
  write(dir, 'raw/signals/forma.json', { correct: true, runs: 3, campaign, benches: { batch: { runs: [10, 12, 14] } } });
  write(dir, 'raw/signals/vue.json', { correct: true, runs: 3, campaign, benches: { batch: { runs: [20, 24, 28], comparable: false } } });
  write(dir, 'raw/signals/solid.json', { correct: true, runs: 3, campaign: { ...campaign, id: '22222222-2222-4222-8222-222222222222' }, benches: { batch: { runs: [20, 24, 28] } } });
  const report = collectReport(dir);
  assert(report.comparisons.every(comparison => comparison.status === 'not-comparable'));
  assert(report.comparisons.find(row => row.competitor === 'vue').reasons.some(reason => reason.includes('semantics')));
  assert(report.comparisons.find(row => row.competitor === 'solid').reasons.some(reason => reason.includes('campaign')));
});

test('historical comparisons gate protocol, test, config, environment and campaign', t => {
  const dir = fixture(t), baseline = path.join(dir, 'a'), current = path.join(dir, 'b');
  write(baseline, 'manifest.json', manifest('a')); write(current, 'manifest.json', manifest('b'));
  write(baseline, 'raw/dom/forma.json', dom([10, 12, 14])); write(current, 'raw/dom/forma.json', dom([5, 6, 7]));
  assert.equal(compareRuns(baseline, current).changes[0].improvementPercent, 50);
  for (const key of ['protocolVersion', 'testHash', 'config', 'environment']) {
    write(current, 'manifest.json', { ...manifest('b'), [key]: 'different' });
    const result = compareRuns(baseline, current);
    assert.equal(result.comparable, false); assert(result.reasons.some(reason => reason.includes(key)));
    assert.equal(result.changes[0].ratio, undefined);
  }
  write(current, 'manifest.json', manifest('b'));
  write(current, 'raw/dom/forma.json', dom([5, 6, 7], { campaign: { ...campaign, id: '22222222-2222-4222-8222-222222222222' } }));
  assert.equal(compareRuns(baseline, current).comparable, false);
});

test('island contexts remain sample units and native activation is not compared across frameworks', t => {
  const dir = fixture(t);
  const raw = { protocol: 'forma-264-island-v1', verified: true, campaign, runs: 2, samples: [1, 2].map(n => ({ verified: true, errors: [], readinessMs: n * 10, activationMs: n, htmlBytes: 100, transferredJavaScriptBytes: 200, clickMs: [n, n + 1] })) };
  write(dir, 'artifacts/islands-test/forma.json', { ...raw, car: 'forma' }); write(dir, 'artifacts/islands-test/react-node.json', { ...raw, car: 'react-node' });
  const report = collectReport(dir);
  assert.equal(report.measurements.find(row => row.metric === 'click-1').statistics.n, 2);
  assert.equal(report.comparisons.find(row => row.metric === 'activationMs').status, 'not-comparable');
});

test('qualified island evidence requires the adjacent authenticated driver contract', t => {
  const dir = fixture(t);
  const profile = profileConfiguration({ name: 'gha-4-v1', diagnostic: false, platform: 'linux', githubActions: true, availableCpus: 4, affinity: [0, 1, 2, 3] });
  const identity = { ...campaign, kind: 'github-actions', runnerTrackingSha256: 'c'.repeat(64), github: { runId: '123', runAttempt: '1', job: 'islands', repository: 'getforma-dev/forma' } };
  const source = 'd'.repeat(40), image = `sha256:${'e'.repeat(64)}`, container = 'f'.repeat(64), browserHash = 'a'.repeat(64);
  const sample = { verified: true, errors: [], failedJavaScript: [], clickMs: [1, 2], readinessMs: 10, activationMs: null, htmlBytes: 100,
    transferredJavaScriptBytes: 200, javascript: [{ status: 200, fromDiskCache: false, fromServiceWorker: false, transferredBytes: 200 }] };
  const raw = { protocol: 'forma-264-island-v1', car: 'next', qualifiedProfile: true, verified: true, campaign: identity, resourceProfile: profile, sourceCommit: source,
    runs: 5, warmups: 2, samples: Array.from({ length: 5 }, () => structuredClone(sample)), warmupSamples: Array.from({ length: 2 }, () => structuredClone(sample)),
    machine: { platform: 'linux', arch: 'x64' }, browser: { sha256: browserHash, version: 'Chrome/1.2.3', processAffinity: [1, 2, 3] }, processAffinity: [1, 2, 3],
    container: { id: container, image, nanoCpus: 1e9, memoryBytes: 1073741824 } };
  const driver = { protocol: raw.protocol, passed: true, qualifiedProfile: true, diagnostic: false, failures: [], campaign: identity, resourceProfile: profile, sourceCommit: source,
    cars: ['next'], engine: { cpus: 4, os: 'Ubuntu 24.04' }, browser: { executableSha256: browserHash, arch: 'x64', version: '1.2.3' },
    steps: [{ car: 'next', passed: true, sourceCommit: source, image: { id: image }, container: { id: container, nanoCpus: 1e9, memoryBytes: 1073741824, cpuset: '0' } }] };
  assert.equal(validateIslandEvidence(raw, driver), true);
  write(dir, 'artifacts/islands-test/next.json', raw); write(dir, 'artifacts/islands-test/run.json', driver);
  const report = collectReport(dir);
  assert.equal(report.measurements.length, 6, 'driver run.json is metadata, not another competitor');
  assert(report.measurements.every(row => row.qualification === 'qualified'));
  assert.equal(report.measurements.find(row => row.metric === 'activationMs').status, 'unavailable');
  assert.equal(report.measurements.find(row => row.metric === 'activationMs').required, false);
  const controls = [
    (r, d) => { d.passed = false; }, (r, d) => { d.steps[0].container.cpuset = '1'; },
    (r, d) => { d.steps[0].image.id = `sha256:${'0'.repeat(64)}`; }, (r, d) => { d.browser.executableSha256 = '0'.repeat(64); },
    (r, d) => { r.processAffinity = [0]; }, (r, d) => { r.campaign.id = '22222222-2222-4222-8222-222222222222'; },
    (r, d) => { r.warmupSamples.pop(); }, (r, d) => { r.samples[0].errors.push('pageerror'); },
    (r, d) => { d.steps[0].container.memoryBytes = 100; }, (r, d) => { r.samples[0].javascript[0].transferredBytes = 201; },
  ];
  for (const mutate of controls) { const r = structuredClone(raw), d = structuredClone(driver); mutate(r, d); assert.throws(() => validateIslandEvidence(r, d)); }
  assert.throws(() => validateIslandEvidence(raw, null));
});

test('report generation is deterministic, escapes HTML and formula cells, preserves raw input', t => {
  const dir = fixture(t);
  write(dir, 'manifest.json', manifest('<test>'));
  write(dir, 'raw/dom/=SUM(1).json', dom([1, 2], { ops: { '<img src=x onerror=alert(1)>': { runs: [1, 2] } } }));
  const raw = fs.readFileSync(path.join(dir, 'raw/dom/=SUM(1).json'), 'utf8');
  generateReport(dir);
  const first = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert(!first.includes('<img src=x')); assert(first.includes('&lt;img src=x'));
  assert(fs.readFileSync(path.join(dir, 'measurements.csv'), 'utf8').includes("'=SUM(1)"));
  generateReport(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'report.html'), 'utf8'), first);
  assert.equal(fs.readFileSync(path.join(dir, 'raw/dom/=SUM(1).json'), 'utf8'), raw);
});

test('archives and unsupported raw events are visible, not invented as sample data', t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'artifact.zip'), 'placeholder');
  write(dir, 'raw/row-profile/forma.json', { diagnostic: true });
  const report = collectReport(dir);
  assert.equal(report.measurements.length, 0);
  assert.deepEqual(report.archives, ['artifact.zip']);
  assert.equal(report.evidence[0].supported, false);
  assert(report.warnings.some(warning => warning.includes('not expanded')));
});
