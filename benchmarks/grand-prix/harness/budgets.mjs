import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BUDGETS = Object.freeze({ peakMiB: 8, appBootMs: 50, imageBytes: 150_000_000 });
const positive = (n, label) => assert(Number.isFinite(n) && n > 0, `missing/invalid ${label}`);
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;

export function evaluateBudgets({ sprint, fuel, grid, weight }) {
  for (const [event, record] of Object.entries({ sprint, fuel, grid, weight })) {
    assert.equal(record?.car, 'forma', `${event}: expected Forma`);
    assert.equal(record?.event, event, `${event}: unexpected event`);
    assert(/^sha256:[a-f0-9]{64}$/.test(record.image?.id ?? ''), `${event}: missing/full image identity required`);
    assert.equal(record.image.id, sprint.image.id, 'mixed image identities');
    assert.equal(record.config?.forced, false, `${event}: loaded-machine override is not budget evidence`);
  }
  assert.equal(sprint.runs?.length, 3, 'three Sprint samples required');
  for (const run of sprint.runs) {
    assert.equal(run.nonOk, 0, 'failed Sprint requests');
    assert.equal(run.successRate, 1, 'failed Sprint transports');
    assert(run.errorDistribution && typeof run.errorDistribution === 'object' && !Array.isArray(run.errorDistribution), 'missing Sprint transport evidence');
    assert(Object.values(run.errorDistribution).every(count => count === 0), 'Sprint transport errors');
    positive(run.okRps, 'Sprint throughput');
  }
  assert.equal(fuel.metric?.unit, 'MiB');
  assert.equal(fuel.values?.length, 3, 'three memory peaks required');
  fuel.values.forEach(n => positive(n, 'peak memory'));
  assert.equal(fuel.runs?.length, 3);
  fuel.runs.forEach(run => positive(run.samples, 'memory sample count'));
  assert.equal(grid.metric?.unit, 'ms');
  assert.equal(grid.runs?.length, 5, 'five boot samples required');
  const boots = grid.runs.map(run => {
    positive(run.ms, 'first 200 time');
    positive(run.dockerRunReturnedMs, 'Docker start time');
    const value = run.ms - run.dockerRunReturnedMs;
    positive(value, 'application boot remainder');
    return value;
  });
  assert.equal(weight.parts?.image?.metric?.unit, 'bytes');
  assert.equal(weight.parts.image.values?.length, 1);
  const imageBytes = weight.parts.image.values[0];
  positive(imageBytes, 'image bytes');
  // The published telemetry uses the mean of per-run peaks, not a pooled max.
  const measured = { peakMiB: mean(fuel.values), appBootMs: mean(boots), imageBytes };
  const checks = Object.entries(BUDGETS).map(([metric, limit]) => ({
    metric, limit, measured: measured[metric], passed: measured[metric] <= limit,
  }));
  return { schema: 1, image: sprint.image.id, measured, limits: BUDGETS,
    samples: { memoryPeaks: fuel.values, bootRemainders: boots },
    checks, passed: checks.every(check => check.passed) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dir = resolve(process.argv[2] ?? 'results/raw');
  const records = Object.fromEntries(['sprint', 'fuel', 'grid', 'weight'].map(event =>
    [event, JSON.parse(readFileSync(resolve(dir, event, 'forma.json'), 'utf8'))]));
  const result = evaluateBudgets(records);
  writeFileSync(resolve(dir, 'forma-budgets.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
