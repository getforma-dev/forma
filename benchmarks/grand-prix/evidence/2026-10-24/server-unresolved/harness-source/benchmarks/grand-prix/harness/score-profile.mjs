import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateProfile } from './resource-profile.mjs';
import { validateCampaign } from './campaign.mjs';

const serverEvents = new Set(['sprint', 'endurance', 'multicore', 'reaction', 'fuel', 'grid', 'weight', 'pitstop']);
const clientEvents = new Set(['dom', 'bundle', 'signals']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

// Bind a saved summary to every input used in scoring, independent of JSON key
// order. Underscore-prefixed metadata is not scored and is deliberately omitted.
export function measurementDigest(raw) {
  const measured = Object.fromEntries(Object.entries(raw)
    .filter(([event]) => serverEvents.has(event) || clientEvents.has(event) || event === 'smoke')
    .map(([event, cars]) => [event, Object.fromEntries(Object.entries(cars).filter(([car]) => !car.startsWith('_')))]));
  return createHash('sha256').update(JSON.stringify(canonical(measured))).digest('hex');
}

export function validateSummaryProfile(summary, raw) {
  const qualification = scoringProfile(raw);
  // An old summary cannot acquire qualified labels by being paired with new raw
  // files. Historical summaries remain readable only with historical raw input.
  if (qualification.resourceProfile) {
    for (const key of ['resourceProfile', 'diagnostic', 'campaigns', 'measurementsSha256']) {
      assert(Object.hasOwn(summary, key), `profiled summary requires ${key}; run score.mjs again`);
    }
  }
  for (const key of ['resourceProfile', 'diagnostic', 'campaigns', 'measurementsSha256']) {
    if (Object.hasOwn(summary, key)) assert.deepEqual(summary[key], qualification[key], `summary ${key} differs from raw evidence`);
  }
  return qualification;
}

// Historical input remains readable, but cannot acquire a qualified profile
// merely by being scored with a newer harness.
export function scoringProfile(raw) {
  const records = Object.entries(raw).filter(([event]) => serverEvents.has(event) || clientEvents.has(event))
    .flatMap(([event, cars]) => Object.entries(cars).filter(([car]) => !car.startsWith('_')).map(([car, record]) => ({ event, car, record })));
  const profileOf = record => record.config?.resourceProfile ?? record.resourceProfile ?? null;
  const explicit = records.filter(({ record }) => profileOf(record));
  const measurementsSha256 = measurementDigest(raw);
  const campaigns = {};
  if (!explicit.length) return { resourceProfile: null, diagnostic: true, campaigns, measurementsSha256, profileLabel: 'Legacy measurements; no qualified resource profile recorded' };
  assert.equal(explicit.length, records.length, 'cannot combine profiled measurements with legacy or missing profiles');
  const profile = validateProfile(profileOf(explicit[0].record));
  for (const { event, car, record } of records) {
    assert.deepEqual(profileOf(record), profile, 'cannot score mixed resource profiles');
    if (record.config?.resourceProfile && record.resourceProfile) assert.deepEqual(record.config.resourceProfile, record.resourceProfile);
    assert(!car.endsWith('.failed'), 'failed measurements cannot enter scoring');
    if (!profile.qualified) continue;
    const campaign = validateCampaign(record.campaign);
    if (profile.name === 'gha-4-v1') assert.equal(campaign.kind, 'github-actions');
    assert(campaign.machineIdSha256, 'qualified Linux measurements require a machine fingerprint');
    const group = serverEvents.has(event) ? 'server' : 'client';
    if (campaigns[group]) assert.deepEqual(campaign, campaigns[group], `cannot score ${group} measurements from different campaigns`);
    else campaigns[group] = campaign;
    if (serverEvents.has(event)) {
      assert.equal(raw.smoke?.[car]?.pass, true, `${car}: qualified scoring requires a passing smoke check`);
      assert.deepEqual(raw.smoke[car].campaign, campaign, `${car}: smoke belongs to a different campaign`);
      assert.equal(record.config?.forced, false, 'forced measurements cannot qualify');
      for (const [key, value] of Object.entries({ duration: 10, warmup: 5, runs: 3, starts: 5, buildRuns: 3, concurrency: 64 })) {
        assert.equal(record.config[key], value, `qualified scoring requires unchanged ${key}`);
      }
      assert.deepEqual(record.config.classA, profile.classA);
      assert.deepEqual(record.config.classB, profile.classB);
      assert.equal(record.config.loadgenCpus, profile.loadgen.cpus);
      assert.equal(record.config.loadgenCpuset, profile.loadgen.cpuset);
      assert.equal(record.config.buildCpus, profile.build.cpus);
      assert.equal(record.config.buildCpuset, profile.build.cpuset);
      if (['sprint', 'endurance', 'multicore', 'reaction'].includes(event)) {
        assert.equal(record.runs?.length, 3);
        assert.equal(record.durationS, 10); assert.equal(record.warmupS, 5);
        assert.equal(record.concurrency, event === 'reaction' ? 1 : 64);
        assert.deepEqual(record.container, event === 'multicore' ? profile.classB : profile.classA);
        for (const run of record.runs) {
          assert.equal(run.nonOk, 0); assert.equal(run.successRate, 1);
          assert(run.errorDistribution && typeof run.errorDistribution === 'object' && !Array.isArray(run.errorDistribution), 'transport evidence required');
          for (const [error, count] of Object.entries(run.errorDistribution)) {
            assert.equal(error, 'aborted due to deadline');
            assert(Number.isInteger(count) && count >= 0 && count <= record.concurrency);
          }
        }
      }
    } else if (event !== 'bundle') {
      assert.equal(record.runs, 5); assert.equal(record.warmups, 2);
      assert.equal(event === 'dom' ? record.verified : record.correct, true, 'client correctness must pass');
    }
  }
  return { resourceProfile: profile, diagnostic: profile.diagnostic, campaigns, measurementsSha256,
    profileLabel: `${profile.name}: ${profile.classB.cpus}-CPU multicore server, ${profile.loadgen.cpus}-CPU load generator${profile.diagnostic ? '; diagnostic' : '; separate CPU sets'}` };
}
