import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SEQUENCE, SOURCES, HARNESS_SHA256, MEMORY_BYTES, statistics, validateResult, validateLaunch, allocation, ownedUnit, summarize, processRemains } from './protocol.mjs';
import { cleanupUnit, cleanupOwned, command } from './run.mjs';

const id = '00ab00ab-00ab-4000-8000-000000000000';
const unit = `forma-adoption-${id}-0`;
const expected = { executable: '/owned/headless_shell', executableSha256: 'a'.repeat(64), version: '156.0.8078.4', affinity: [3, 5, 7], unit };
const launch = () => ({ options: { headless: true }, executable: expected.executable, executableSha256: expected.executableSha256,
  version: expected.version, nodeAffinity: [3, 5, 7], browserAffinity: [3, 5, 7], memoryMax: String(MEMORY_BYTES),
  swapMax: '0', cgroup: `/system.slice/${unit}.service`, browserCgroup: `/system.slice/${unit}.service`, pid: 123 });
function result(value = 1) {
  const samples = Array.from({ length: 15 }, () => ({ adoptionMs: value, updateMs: value / 2, writes: 0 }));
  return { entry: '/owned/core.js', browser: expected.version, rows: 1000, warm: 5, runs: 15, samples,
    mean: { adoptionMs: value, updateMs: value / 2 }, median: { adoptionMs: value, updateMs: value / 2 } };
}
const resultExpected = { entry: '/owned/core.js', browserVersion: expected.version };
test('protocol fixes public source commits, unchanged harness and ABBA', () => {
  assert.deepEqual(SEQUENCE, ['A', 'B', 'B', 'A']);
  assert.equal(SOURCES.A, 'f5be8647439e560c71c27b8c5f4bde26507b8bbb');
  assert.equal(SOURCES.B, '44835efa2f13d694ff32f0dc56f4e5f0aa413eb3');
  assert.equal(HARNESS_SHA256, '270545637abacebc678d61f9bdd07496eee945d0a6806f376be5ea6c270d01f1');
});
test('sample statistics use sample SD and mathematical median', () => {
  assert.deepEqual(statistics([1, 2, 3, 4]), { n: 4, mean: 2.5, median: 2.5, sampleSd: Math.sqrt(5 / 3), min: 1, max: 4 });
  assert.throws(() => statistics([NaN, 1])); assert.throws(() => statistics([-1, 2]));
});
test('original complete output qualifies only the unchanged workload', () => {
  assert.equal(validateResult(result(), resultExpected).adoptionMs.n, 15);
  for (const change of [r => r.samples.pop(), r => r.rows = 999, r => r.warm = 4, r => r.runs = 14,
    r => r.entry += 'other', r => r.browser = 'wrong', r => r.samples[0].writes = 1,
    r => r.samples[0].updateMs = null, r => r.mean.adoptionMs = 9, r => r.median.updateMs = 9]) {
    const r = result(); change(r); assert.throws(() => validateResult(r, resultExpected));
  }
});
test('launch binding refuses changed options, executable, version, resources and ownership', () => {
  validateLaunch(launch(), expected);
  for (const change of [r => r.options.args = ['--other'], r => r.executable = '/foreign',
    r => r.executableSha256 = 'b'.repeat(64), r => r.version = 'other', r => r.nodeAffinity = [0, 1, 2, 3],
    r => r.browserAffinity = [3], r => r.memoryMax = 'max', r => r.swapMax = 'max', r => r.cgroup = '/foreign', r => r.browserCgroup = '/foreign', r => r.pid = 0]) {
    const r = launch(); change(r); assert.throws(() => validateLaunch(r, expected));
  }
});
test('host allocation binds actual nonconsecutive allowed CPUs', () => {
  assert.deepEqual(allocation('Cpus_allowed_list:\t1,3,5,7\n', 4, 'linux', 'true').measured, [3, 5, 7]);
  for (const args of [['Cpus_allowed_list: 0-7', 8, 'linux', 'true'], ['Cpus_allowed_list: 0-3', 4, 'darwin', 'true'], ['Cpus_allowed_list: 0-3', 4, 'linux', 'false']]) assert.throws(() => allocation(...args));
});
test('ABBA summary retains worsening and zero baseline without inventing pass threshold', () => {
  const legs = SEQUENCE.map(source => ({ source, result: result(source === 'A' ? 0 : 2) }));
  const s = summarize(legs); assert.equal(s.pooled.A.adoptionMs.n, 30); assert.equal(s.delta.adoptionMs.meanDifferenceMs, 2);
  assert.equal(s.delta.adoptionMs.meanDifferencePercent, null); assert.equal('passed' in s, false);
  assert.throws(() => summarize(legs.slice(1))); assert.throws(() => summarize([...legs].reverse().map((x, i) => i ? x : { ...x, source: 'B' })));
});
test('cleanup refuses foreign unit names and foreign descriptions before stop', () => {
  assert.throws(() => ownedUnit('unrelated.service', id));
  const calls = [];
  assert.throws(() => cleanupUnit(unit, id, (cmd, args) => { calls.push(args); return args.includes('list-units') ? `${unit}.service loaded active running` : 'foreign owner'; }));
  assert(!calls.some(args => args.includes('stop')));
  assert.deepEqual(cleanupUnit(unit, id, () => ''), { unit, absent: true });
});
test('cleanup removes only marked run-owned temporary tree and retains it on service failure', () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'adoption-control-')));
  try {
    const work = mkdtempSync(join(parent, 'forma-adoption-')); writeFileSync(join(work, '.owner'), id);
    const state = { work, runnerTemp: parent, campaignId: id, units: SEQUENCE.map((_, i) => `forma-adoption-${id}-${i}`) };
    const failed = cleanupOwned(state, () => { throw new Error('service unavailable'); }, parent);
    assert.equal(failed.errors.length, 4); assert(existsSync(work));
    writeFileSync(join(work, '.owner'), 'foreign'); assert.throws(() => cleanupOwned(state, () => '', parent));
    writeFileSync(join(work, '.owner'), id);
    assert.throws(() => cleanupOwned({ ...state, runnerTemp: '/foreign' }, () => '', parent));
    assert.throws(() => cleanupOwned({ ...state, units: [] }, () => '', parent));
    assert.equal(cleanupOwned(state, () => '', parent).temporaryTreeRemoved, true);
    assert.throws(() => cleanupOwned({ ...state, work: parent }, () => '', parent));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('command plumbing retains failure/timeout records and refuses output overwrite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'adoption-command-'));
  try {
    await assert.rejects(command(process.execPath, ['-e', 'process.exit(7)'], dir, join(dir, 'failed')), /command failed/);
    const { readFileSync } = await import('node:fs');
    assert.equal(JSON.parse(readFileSync(join(dir, 'failed.command.json'))).code, 7);
    await assert.rejects(command(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], dir, join(dir, 'timeout'), process.env, 100), /timed out/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'timeout.command.json'))).timedOut, true);
    await assert.rejects(command(process.execPath, ['-e', ''], dir, join(dir, 'failed')), /EEXIST/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('browser close treats only ENOENT as absent, preserving other failures and PID identity', () => {
  assert.equal(processRemains('/proc/gone/stat', '5', () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); }), false);
  assert.throws(() => processRemains('/proc/denied/stat', '5', () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }));
  const stat = '123 (name with ) bracket) ' + [...Array(19).fill('0'), '5'].join(' ');
  assert.equal(processRemains('/proc/123/stat', '5', () => stat), true);
  assert.equal(processRemains('/proc/123/stat', '6', () => stat), false);
  assert.throws(() => processRemains('/proc/123/stat', '5', () => 'malformed'));
});
