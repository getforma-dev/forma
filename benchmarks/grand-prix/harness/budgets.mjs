import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateProfile } from './resource-profile.mjs';
import { validateCampaign } from './campaign.mjs';

export const BUDGETS = Object.freeze({ peakMiB: 8, appBootMs: 50, imageBytes: 150_000_000 });
const positive = (n, label) => assert(Number.isFinite(n) && n > 0, `missing/invalid ${label}`);
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;

export function evaluateBudgets({ sprint, fuel, grid, weight }) {
  const campaign = sprint.campaign;
  if (campaign) validateCampaign(campaign);
  const resourceProfile = sprint.config?.resourceProfile;
  if (resourceProfile?.qualified) assert(campaign, 'qualified budgets require one host campaign');
  if (resourceProfile) validateProfile(resourceProfile);
  for (const [event, record] of Object.entries({ sprint, fuel, grid, weight })) {
    assert.deepEqual(record?.campaign, campaign, 'mixed host campaigns');
    assert.equal(record?.car, 'forma', `${event}: expected Forma`);
    assert.equal(record?.event, event, `${event}: unexpected event`);
    assert(/^sha256:[a-f0-9]{64}$/.test(record.image?.id ?? ''), `${event}: missing/full image identity required`);
    assert.equal(record.image.id, sprint.image.id, 'mixed image identities');
    assert.deepEqual(record.config?.resourceProfile, resourceProfile, 'mixed resource profiles');
    if (resourceProfile) {
      assert.deepEqual(record.config.classA, resourceProfile.classA);
      assert.deepEqual(record.config.classB, resourceProfile.classB);
      assert.equal(record.config.loadgenCpus, resourceProfile.loadgen.cpus);
      assert.equal(record.config.loadgenCpuset, resourceProfile.loadgen.cpuset);
      if (resourceProfile.qualified) for (const [key, value] of Object.entries({ duration: 10, warmup: 5, runs: 3, concurrency: 64, starts: 5 })) {
        assert.equal(record.config[key], value, 'qualified budget requires unchanged ' + key);
      }
    }
    assert.equal(record.config?.forced, false, `${event}: loaded-machine override is not budget evidence`);
  }
  if (resourceProfile?.qualified) {
    assert.equal(sprint.durationS, 10); assert.equal(sprint.warmupS, 5); assert.equal(sprint.concurrency, 64);
    assert.deepEqual(sprint.container, resourceProfile.classA);
  }
  assert.equal(sprint.runs?.length, 3, 'three Sprint samples required');
  for (const run of sprint.runs) {
    assert.equal(run.nonOk, 0, 'failed Sprint requests');
    assert.equal(run.successRate, 1, 'failed Sprint transports');
    assert(run.errorDistribution && typeof run.errorDistribution === 'object' && !Array.isArray(run.errorDistribution), 'missing Sprint transport evidence');
    // oha cancels at most one in-flight request per worker when -z expires.
    // Its success_rate explicitly excludes only this deadline cancellation:
    // https://github.com/hatoo/oha/blob/v1.16.0/src/result_data.rs#L77-L87
    const deadline = Object.hasOwn(run.errorDistribution, 'aborted due to deadline') ? run.errorDistribution['aborted due to deadline'] : 0;
    assert(Number.isInteger(sprint.concurrency) && sprint.concurrency > 0);
    assert(Number.isInteger(deadline) && deadline >= 0 && deadline <= sprint.concurrency, 'invalid deadline cancellations');
    assert(Object.entries(run.errorDistribution).every(([error, count]) => error === 'aborted due to deadline' || count === 0), 'Sprint transport errors');
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
  return { schema: 1, image: sprint.image.id, campaign: campaign ?? null, resourceProfile: resourceProfile ?? null, diagnostic: resourceProfile?.diagnostic ?? true, measured, limits: BUDGETS,
    samples: { memoryPeaks: fuel.values, bootRemainders: boots },
    checks, passed: checks.every(check => check.passed) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dir = resolve(process.argv[2] ?? (process.env.GP_RESULTS_DIR ? resolve(process.env.GP_RESULTS_DIR, 'raw') : 'results/raw'));
  const records = Object.fromEntries(['sprint', 'fuel', 'grid', 'weight'].map(event =>
    [event, JSON.parse(readFileSync(resolve(dir, event, 'forma.json'), 'utf8'))]));
  const result = evaluateBudgets(records);
  writeFileSync(resolve(dir, 'forma-budgets.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
