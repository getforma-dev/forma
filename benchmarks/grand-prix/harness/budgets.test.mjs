import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateBudgets } from './budgets.mjs';
import { profileConfiguration } from './resource-profile.mjs';

function sample() {
  const base = event => ({ car: 'forma', event, image: { id: 'sha256:' + 'a'.repeat(64) }, config: { forced: false } });
  return {
    sprint: { ...base('sprint'), concurrency: 64, runs: Array.from({ length: 3 }, () => ({ nonOk: 0, okRps: 1000, successRate: 1, errorDistribution: {} })) },
    fuel: { ...base('fuel'), metric: { unit: 'MiB' }, values: [5, 5, 5], runs: Array.from({ length: 3 }, () => ({ samples: 10 })) },
    grid: { ...base('grid'), metric: { unit: 'ms' }, runs: Array.from({ length: 5 }, () => ({ ms: 200, dockerRunReturnedMs: 175 })) },
    weight: { ...base('weight'), parts: { image: { metric: { unit: 'bytes' }, values: [140_000_000] } } },
  };
}

test('the reference control passes all unchanged budgets', () => assert(evaluateBudgets(sample()).passed));
test('oha deadline cancellation is retained but is not a server failure', () => {
  const r = sample(); r.sprint.runs[0].errorDistribution = { 'aborted due to deadline': 64 };
  assert(evaluateBudgets(r).passed);
});
for (const [metric, mutate] of [
  ['peakMiB', r => { r.fuel.values = [8.01, 8.01, 8.01]; }],
  ['appBootMs', r => { r.grid.runs.forEach(run => { run.ms = run.dockerRunReturnedMs + 50.01; }); }],
  ['imageBytes', r => { r.weight.parts.image.values = [150_000_001]; }],
]) test(`deliberate ${metric} regression fails its gate`, () => {
  const r = sample(); mutate(r); const result = evaluateBudgets(r);
  assert.equal(result.passed, false);
  assert.deepEqual(result.checks.filter(check => !check.passed).map(check => check.metric), [metric]);
});
for (const [label, mutate] of [
  ['missing memory', r => { r.fuel.values.pop(); }],
  ['no memory samples', r => { r.fuel.runs[0].samples = 0; }],
  ['null deadline cancellation count', r => { r.sprint.runs[0].errorDistribution = { 'aborted due to deadline': null }; }],
  ['excess deadline cancellations', r => { r.sprint.runs[0].errorDistribution = { 'aborted due to deadline': 65 }; }],
  ['request timeout', r => { r.sprint.runs[0].errorDistribution = { timeout: 1 }; }],
  ['transport failure', r => { r.sprint.runs[0].successRate = 0.9; }],
  ['missing transport evidence', r => { delete r.sprint.runs[0].errorDistribution; }],
  ['transport error counts', r => { r.sprint.runs[0].errorDistribution = { reset: 1 }; }],
  ['truncated image identity', r => { Object.values(r).forEach(event => { event.image.id = 'sha256:abc'; }); }],
  ['failed load', r => { r.sprint.runs[0].nonOk = 1; }],
  ['invalid time', r => { r.grid.runs[0].ms = NaN; }],
  ['wrong image', r => { r.grid.image.id = 'other'; }],
  ['forced run', r => { r.sprint.config.forced = true; }],
  ['wrong units', r => { r.weight.parts.image.metric.unit = 'MB'; }],
]) test(`${label} refuses budget evidence`, () => {
  const r = sample(); mutate(r); assert.throws(() => evaluateBudgets(r));
});

function profiledSample() {
  const records = sample();
  const profile = profileConfiguration({ name: 'gha-4-v1', githubActions: true, availableCpus: 4, affinity: [4, 5, 6, 7] });
  for (const record of Object.values(records)) record.config = { forced: false, duration: 10, warmup: 5, runs: 3, concurrency: 64, starts: 5, resourceProfile: structuredClone(profile),
    classA: structuredClone(profile.classA), classB: structuredClone(profile.classB),
    loadgenCpus: profile.loadgen.cpus, loadgenCpuset: profile.loadgen.cpuset };
  for (const record of Object.values(records)) record.campaign = { schema: 1, id: '01234567-89ab-4def-8123-456789abcdef', createdAt: '2026-10-24T12:00:00.000Z', kind: 'github-actions', hostSha256: 'a'.repeat(64), machineIdSha256: 'b'.repeat(64), runnerTrackingSha256: 'c'.repeat(64), github: { runId: '123', runAttempt: '1', job: 'comparison', repository: 'getforma-dev/forma' } };
  Object.assign(records.sprint, { durationS: 10, warmupS: 5, container: structuredClone(profile.classA) });
  return records;
}
test('budget values stay unchanged and retain the four-CPU profile identity', () => {
  const result = evaluateBudgets(profiledSample());
  assert(result.passed); assert.equal(result.resourceProfile.name, 'gha-4-v1'); assert.equal(result.diagnostic, false);
  assert.equal(evaluateBudgets(sample()).diagnostic, true, 'old records must not become qualified');
});
for (const [label, mutate] of [
  ['mixed campaign', r => { r.fuel.campaign.id = '11111111-89ab-4def-8123-456789abcdef'; }],
  ['missing campaign', r => { delete r.grid.campaign; }],
  ['mixed profile', r => { delete r.fuel.config.resourceProfile; }],
  ['overlapping allocation', r => { r.sprint.config.resourceProfile.loadgen.cpuset = '4,5'; }],
  ['wrong server affinity', r => { r.grid.config.classA.cpuset = '6'; }],
  ['wrong loadgen affinity', r => { r.weight.config.loadgenCpuset = '4,5'; }],
  ['shortened duration', r => { r.sprint.durationS = 1; }],
  ['shortened warmup', r => { r.fuel.config.warmup = 1; }],
  ['actual server limits', r => { r.sprint.container.cpus = '2'; }],
]) test(`budget refuses ${label}`, () => { const records = profiledSample(); mutate(records); assert.throws(() => evaluateBudgets(records)); });
