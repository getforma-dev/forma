// Report consistency is not authentication of a hosted CI run.
import assert from 'node:assert/strict';
import { rcLine } from './release-line.mjs';
export const CONTRACT = 'forma-rc-burn-in-v1';
export const MIN_ACTIVE_NS = 3_600_000_000_000n;
export const FUZZ_TARGETS = ['parse_raw', 'parse_body', 'parse_mutated', 'walk'];
export const ENGINES = ['chromium', 'firefox', 'webkit'];
export { SKEW_DRILL_CHECKS as SKEW_CHECKS } from '../e2e/skew/run-drill.mjs';
import { SKEW_DRILL_CHECKS as SKEW_CHECKS } from '../e2e/skew/run-drill.mjs';
const PACKAGE_IDS = ['crates:forma-ir', 'crates:forma-ir-derive', 'crates:forma-server', 'npm:@getforma/build', 'npm:@getforma/compiler', 'npm:@getforma/core', 'npm:@getforma/create-app'];
const TASKS = [...FUZZ_TARGETS.map(t => `fuzz:${t}`), 'hostile', ...ENGINES.map(e => `skew:${e}`), 'fixtures'];
const hash = (s, label) => assert.match(s ?? '', /^[a-f0-9]{64}$/, `${label}: invalid SHA-256`);
const ns = (s, label) => { assert.equal(typeof s, 'string', `${label}: nanoseconds must be an integer string`); assert.match(s, /^(?:0|[1-9][0-9]{0,18})$/, `${label}: invalid monotonic value`); return BigInt(s); };
const nonemptyUnique = (values, label) => { assert(Array.isArray(values) && values.length > 0 && values.length <= 65_536, `${label}: empty or oversized`); assert(values.every(v => typeof v === 'string' && v.length > 0 && v.length <= 1024), `${label}: invalid identity`); assert.equal(new Set(values).size, values.length, `${label}: duplicate identity`); return values; };
const identicalIds = (actual, expected, label) => assert.deepEqual(nonemptyUnique(actual, label).slice().sort(), nonemptyUnique(expected, `${label} expectation`).slice().sort(), `${label}: incomplete or unexpected identities`);
const packages = (rows, version) => {
  assert(Array.isArray(rows)); assert.deepEqual(rows.map(p => `${p.registry}:${p.name}`).sort(), PACKAGE_IDS, 'exact seven archives required');
  for (const p of rows) { assert.equal(p.version, version); hash(p.sha256, p.name); assert(Number.isSafeInteger(p.bytes) && p.bytes > 0, `${p.name}: archive length`); assert.equal(typeof p.file, 'string'); assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p.file), `${p.name}: archive filename`); }
  assert.equal(new Set(rows.map(p => p.file)).size, 7, 'duplicate archive filename');
  return rows.slice().sort((a, b) => `${a.registry}:${a.name}`.localeCompare(`${b.registry}:${b.name}`));
};

/** expected must come from independently authenticated RC inputs, never report fields.
 * Raw report-file hashes and GitHub run attestation are separate required integration seams.
 */
export function validateBurnInReport(report, expected) {
  assert.equal(report.contract, CONTRACT, 'unsupported burn-in contract');
  rcLine(expected.rcTag);
  assert.match(expected.sourceCommit ?? '', /^[a-f0-9]{40}$/, 'expected exact RC source');
  assert.equal(report.rcTag, expected.rcTag); assert.equal(report.sourceCommit, expected.sourceCommit);
  assert.equal(report.harnessCommit, expected.sourceCommit, 'harness differs from RC source');
  for (const key of ['ds12Sha256', 'p17EvidenceSha256', 'd14EvidenceSha256', 'harnessSha256']) { hash(expected[key], key); assert.equal(report[key], expected[key], `${key}: mismatched prerequisite`); }
  assert.deepEqual(packages(report.packages, expected.rcTag.slice(1)), packages(expected.packages, expected.rcTag.slice(1)), 'archive identity differs from authenticated RC');
  nonemptyUnique(expected.hostileCaseIds, 'expected hostile cases');
  nonemptyUnique(expected.fixtureCheckIds, 'expected fixture checks');
  assert.equal(report.complete, true, 'incomplete campaign'); assert.equal(report.zeroFaults, true, 'campaign fault flag'); assert.deepEqual(report.faults, [], 'campaign faults');
  assert.deepEqual(report.cleanup, {complete: true, remainingOwnedPids: [], failures: []}, 'incomplete owned cleanup');
  assert(Array.isArray(report.rounds) && report.rounds.length > 0 && report.rounds.length <= 256, 'missing or oversized rounds');
  let active = 0n, previousRoundEnd = null, first = null, last = null, taskCount = 0;
  const seeds = new Set();
  for (const [index, round] of report.rounds.entries()) {
    assert.equal(round.index, index + 1, 'rounds must be contiguous and ordered'); assert.equal(round.complete, true, 'incomplete round');
    assert.deepEqual(round.tasks?.map(t => t.id), TASKS, 'missing, duplicated or reordered task');
    const roundStart = ns(round.startedNs, 'round start'), roundEnd = ns(round.finishedNs, 'round end');
    assert(roundEnd > roundStart); if (previousRoundEnd !== null) assert(roundStart >= previousRoundEnd, 'overlapping or reversed rounds');
    let previousTaskEnd = null;
    for (const task of round.tasks) {
      const start = ns(task.startedNs, 'task start'), end = ns(task.finishedNs, 'task end');
      assert(end > start && start >= roundStart && end <= roundEnd, 'invalid task interval');
      if (previousTaskEnd !== null) assert(start >= previousTaskEnd, 'overlapping or reversed tasks');
      assert.equal(task.exitCode, 0, 'workload failed'); assert.equal(task.complete, true, 'incomplete workload'); assert.deepEqual(task.faults, [], 'workload faults'); hash(task.reportSha256, 'workload report');
      if (task.id.startsWith('fuzz:')) {
        assert(Number.isSafeInteger(task.executions) && task.executions > 0, 'empty fuzz workload');
        assert(Number.isInteger(task.seed) && task.seed >= 0 && task.seed <= 0xffffffff, 'invalid fuzz seed');
        assert(!seeds.has(task.seed), 'fuzz seeds must distinguish each round/target'); seeds.add(task.seed);
        assert.equal(task.findings, 0, 'fuzz finding');
        // Credit only whole seconds in libFuzzer's successful Done summary,
        // bounded by the observed process interval. Setup and other tasks earn no credit.
        assert(Number.isSafeInteger(task.fuzzSeconds) && task.fuzzSeconds > 0 && task.fuzzSeconds <= 120, 'invalid completed fuzz interval');
        const credit = BigInt(task.fuzzSeconds) * 1_000_000_000n;
        assert(credit <= end - start, 'fuzz time exceeds actual child interval');
        assert.equal(ns(task.activeNanoseconds, 'fuzz credit'), credit);
        active += credit;
      } else if (task.id === 'hostile') {
        assert.equal(task.completeMatrix, true, 'partial hostile matrix');
        identicalIds(task.caseIds, expected.hostileCaseIds, 'hostile cases');
      } else if (task.id.startsWith('skew:')) {
        assert.deepEqual(task.checks, SKEW_CHECKS, 'incomplete or reordered skew checks');
      } else identicalIds(task.checkIds, expected.fixtureCheckIds, 'fixture checks');
      if (!task.id.startsWith('fuzz:')) assert.equal(task.activeNanoseconds, '0', 'non-fuzz work cannot pad the active hour');
      previousTaskEnd = end; taskCount++;
    }
    assert.equal(ns(round.tasks[0].startedNs), roundStart, 'round starts outside first workload');
    assert.equal(ns(round.tasks.at(-1).finishedNs), roundEnd, 'round ends outside last workload');
    first ??= roundStart; last = roundEnd; previousRoundEnd = roundEnd;
  }
  assert.equal(ns(report.startedNs, 'campaign start'), first); assert.equal(ns(report.finishedNs, 'campaign end'), last);
  assert.equal(ns(report.activeNanoseconds, 'claimed active duration'), active, 'active duration disagrees with workloads');
  const elapsed = last - first; assert(active >= MIN_ACTIVE_NS, 'less than 3600 seconds of actual workload'); assert(elapsed >= active);
  assert.equal(ns(report.orchestrationNanoseconds, 'claimed orchestration duration'), elapsed - active, 'orchestration duration disagrees');
  // No five-second handoff threshold: normal startup/cleanup is recorded separately.
  return {contract: CONTRACT, contentValid: true, hostedAttestationVerified: false, releaseAccepted: false, rcTag: report.rcTag, sourceCommit: report.sourceCommit, rounds: report.rounds.length, tasks: taskCount, activeNanoseconds: String(active), elapsedNanoseconds: String(elapsed), orchestrationNanoseconds: String(elapsed - active)};
}

/** A completed libFuzzer run, not elapsed wall time or a progress line. */
export function readFuzzCompletion(log, observedNanoseconds) {
  const done = [...log.matchAll(/^Done ([1-9][0-9]*) runs in ([1-9][0-9]*) second\(s\)$/gm)];
  assert.equal(done.length, 1, 'missing or ambiguous completed libFuzzer summary');
  const executions = Number(done[0][1]), fuzzSeconds = Number(done[0][2]);
  assert(Number.isSafeInteger(executions) && executions > 0);
  assert(Number.isSafeInteger(fuzzSeconds) && fuzzSeconds > 0 && fuzzSeconds <= 120);
  const activeNanoseconds = String(BigInt(fuzzSeconds) * 1_000_000_000n);
  assert(BigInt(activeNanoseconds) <= ns(observedNanoseconds, 'observed fuzz child'), 'fuzzer summary exceeds observed interval');
  return { executions, fuzzSeconds, activeNanoseconds, findings: 0 };
}
