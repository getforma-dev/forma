import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateBudgets } from './budgets.mjs';

function sample() {
  const base = event => ({ car: 'forma', event, image: { id: 'sha256:control' }, config: { forced: false } });
  return {
    sprint: { ...base('sprint'), runs: Array.from({ length: 3 }, () => ({ nonOk: 0, okRps: 1000 })) },
    fuel: { ...base('fuel'), metric: { unit: 'MiB' }, values: [5, 5, 5], runs: Array.from({ length: 3 }, () => ({ samples: 10 })) },
    grid: { ...base('grid'), metric: { unit: 'ms' }, runs: Array.from({ length: 5 }, () => ({ ms: 200, dockerRunReturnedMs: 175 })) },
    weight: { ...base('weight'), parts: { image: { metric: { unit: 'bytes' }, values: [140_000_000] } } },
  };
}

test('the reference control passes all unchanged budgets', () => assert(evaluateBudgets(sample()).passed));
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
  ['failed load', r => { r.sprint.runs[0].nonOk = 1; }],
  ['invalid time', r => { r.grid.runs[0].ms = NaN; }],
  ['wrong image', r => { r.grid.image.id = 'other'; }],
  ['forced run', r => { r.sprint.config.forced = true; }],
  ['wrong units', r => { r.weight.parts.image.metric.unit = 'MB'; }],
]) test(`${label} refuses budget evidence`, () => {
  const r = sample(); mutate(r); assert.throws(() => evaluateBudgets(r));
});
