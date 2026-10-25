import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { affinityFromStatus } from '../grand-prix/harness/resource-profile.mjs';

export const SOURCES = Object.freeze({
  A: 'f5be8647439e560c71c27b8c5f4bde26507b8bbb',
  B: '44835efa2f13d694ff32f0dc56f4e5f0aa413eb3',
});
export const SEQUENCE = Object.freeze(['A', 'B', 'B', 'A']);
export const HARNESS = 'packages/core/scripts/signals-bench/island.mjs';
export const HARNESS_SHA256 = '270545637abacebc678d61f9bdd07496eee945d0a6806f376be5ea6c270d01f1';
export const MEMORY_BYTES = 2 * 1024 ** 3;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const fileHash = file => sha256(readFileSync(file));
export function processStartTime(stat) {
  const value = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19];
  assert(/^\d+$/.test(value ?? ''), 'invalid process identity');
  return value;
}
export function processRemains(path, startTime, read = readFileSync) {
  try { return processStartTime(read(path, 'utf8')) === startTime; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function statistics(values) {
  assert(values.length >= 2 && values.every(x => Number.isFinite(x) && x >= 0), 'invalid samples');
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return { n: values.length, mean, median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    sampleSd: Math.sqrt(values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (values.length - 1)),
    min: sorted[0], max: sorted.at(-1) };
}
export function validateResult(result, { entry, browserVersion }) {
  assert.equal(result.entry, entry, 'wrong measured entry');
  assert.equal(result.browser, browserVersion, 'wrong launched browser version');
  assert.equal(result.rows, 1000); assert.equal(result.warm, 5); assert.equal(result.runs, 15);
  assert.equal(result.samples?.length, 15, 'missing measured samples');
  for (const sample of result.samples) {
    assert.deepEqual(Object.keys(sample).sort(), ['adoptionMs', 'updateMs', 'writes']);
    assert.equal(sample.writes, 0, 'initial adoption wrote DOM');
    for (const key of ['adoptionMs', 'updateMs']) assert(Number.isFinite(sample[key]) && sample[key] >= 0, 'invalid timing');
  }
  const out = {};
  for (const key of ['adoptionMs', 'updateMs']) {
    out[key] = statistics(result.samples.map(sample => sample[key]));
    assert.equal(result.mean[key], out[key].mean, 'reported mean differs');
    assert.equal(result.median[key], out[key].median, 'reported median differs');
  }
  return out;
}
export function validateLaunch(record, expected) {
  assert.deepEqual(record.options, { headless: true }, 'launch options changed');
  assert.equal(record.executable, expected.executable);
  assert.equal(record.executableSha256, expected.executableSha256, 'launched browser bytes differ');
  assert.equal(record.version, expected.version);
  assert.deepEqual(record.nodeAffinity, expected.affinity, 'Node affinity differs');
  assert.deepEqual(record.browserAffinity, expected.affinity, 'browser affinity differs');
  assert.equal(record.memoryMax, String(MEMORY_BYTES), 'memory limit differs');
  assert.equal(record.swapMax, '0', 'swap limit differs');
  assert.equal(record.browserCgroup, record.cgroup, 'browser escaped owned memory cgroup');
  assert(record.cgroup.endsWith('/' + expected.unit + '.service'), 'not in owned service');
  assert(Number.isSafeInteger(record.pid) && record.pid > 0);
  return record;
}
export function allocation(status, available, platform, githubActions) {
  const cpus = affinityFromStatus(status);
  assert.equal(platform, 'linux'); assert.equal(githubActions, 'true');
  assert.equal(available, 4, 'requires four available CPUs');
  assert.equal(cpus.length, 4, 'requires four allowed CPUs');
  return { host: cpus, measured: cpus.slice(1), memoryBytes: MEMORY_BYTES, swapBytes: 0 };
}
export function ownedUnit(unit, campaignId) {
  assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(campaignId));
  assert(new RegExp('^forma-adoption-' + campaignId + '-[0-3]$').test(unit), 'foreign service unit');
  return 'Forma adoption comparison ' + campaignId;
}
export function summarize(legs) {
  assert.equal(legs.length, 4);
  assert.deepEqual(legs.map(x => x.source), SEQUENCE, 'sequence differs');
  const pooled = {};
  for (const source of ['A', 'B']) {
    pooled[source] = {};
    for (const key of ['adoptionMs', 'updateMs']) pooled[source][key] = statistics(legs.filter(x => x.source === source).flatMap(x => x.result.samples.map(s => s[key])));
  }
  const delta = {};
  for (const key of ['adoptionMs', 'updateMs']) {
    const a = pooled.A[key].mean, b = pooled.B[key].mean;
    delta[key] = { meanDifferenceMs: b - a, meanDifferencePercent: a === 0 ? null : (b / a - 1) * 100 };
  }
  return { pooled, delta, interpretation: 'Descriptive same-VM ABBA comparison; pooled samples are not independent VM replications. No new threshold is invented; the original ticket no-adoption-regression criterion and user-authorized product tradeoff still require assessment.' };
}
