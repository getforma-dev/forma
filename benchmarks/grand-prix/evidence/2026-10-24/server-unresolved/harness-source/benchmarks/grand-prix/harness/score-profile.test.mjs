import assert from 'node:assert/strict';
import test from 'node:test';
import { profileConfiguration } from './resource-profile.mjs';
import { scoringProfile, measurementDigest, validateSummaryProfile } from './score-profile.mjs';

const profile = profileConfiguration({ name: 'gha-4-v1', githubActions: true, availableCpus: 4, affinity: [0, 1, 2, 3] });
const campaign = { schema: 1, id: 'b6ee6a58-a306-4b43-b3f3-d42d6ae279a1', createdAt: '2026-10-24T17:00:00.000Z',
  kind: 'github-actions', hostSha256: 'a'.repeat(64), machineIdSha256: 'b'.repeat(64), runnerTrackingSha256: 'c'.repeat(64),
  github: { runId: '123', runAttempt: '1', job: 'client', repository: 'getforma-dev/forma' } };
const input = () => ({ dom: { forma: { resourceProfile: structuredClone(profile), campaign: structuredClone(campaign), runs: 5, warmups: 2, verified: true } },
  bundle: { forma: { resourceProfile: structuredClone(profile), campaign: structuredClone(campaign), brotli: 8490 } } });
test('legacy measurements never inherit qualification from the scoring host', () => {
  assert.equal(scoringProfile({ sprint: { forma: { values: [10] } } }).diagnostic, true);
  assert.equal(scoringProfile({}).resourceProfile, null);
});
test('one explicit profile is retained and two-CPU scaling is labelled', () => {
  const result = scoringProfile(input()); assert.equal(result.diagnostic, false);
  assert.deepEqual(result.resourceProfile, profile); assert.match(result.profileLabel, /2-CPU multicore/);
});
test('missing, mixed, relabelled and failed evidence cannot qualify', () => {
  for (const edit of [r => delete r.bundle.forma.resourceProfile,
    r => { r.bundle.forma.resourceProfile = profileConfiguration({ availableCpus: 8, affinity: [0,1,2,3,4,5,6,7] }); },
    r => { r.dom.forma.resourceProfile.name = 'native-8-v1'; },
    r => { r.dom.forma.runs = 1; }, r => { r.dom.forma.verified = false; },
    r => { r.dom['forma.failed'] = r.dom.forma; }]) {
    const raw = input(); edit(raw); assert.throws(() => scoringProfile(raw));
  }
});
test('all diagnostic profile records remain diagnostic even with complete samples', () => {
  const raw = input(); for (const event of Object.values(raw)) for (const record of Object.values(event)) {
    record.resourceProfile = profileConfiguration({ name: 'gha-4-v1', githubActions: true, diagnostic: true, availableCpus: 4, affinity: [0,1,2,3] });
  }
  assert.equal(scoringProfile(raw).diagnostic, true);
});
test('qualified HTTP evidence requires full samples, limits and recorded transport outcomes', () => {
  const source = { smoke: { forma: { pass: true, campaign } }, sprint: { forma: { campaign,
    config: { resourceProfile: profile, forced: false, duration: 10, warmup: 5, runs: 3, starts: 5, buildRuns: 3, concurrency: 64,
      classA: profile.classA, classB: profile.classB, loadgenCpus: profile.loadgen.cpus, loadgenCpuset: profile.loadgen.cpuset,
      buildCpus: profile.build.cpus, buildCpuset: profile.build.cpuset },
    durationS: 10, warmupS: 5, concurrency: 64, container: profile.classA,
    runs: Array.from({ length: 3 }, () => ({ nonOk: 0, successRate: 1, errorDistribution: { 'aborted due to deadline': 64 } })),
  } } };
  assert.equal(scoringProfile(source).diagnostic, false);
  for (const edit of [r => delete r.sprint.forma.runs[0].errorDistribution,
    r => { r.sprint.forma.runs[0].errorDistribution = null; },
    r => { r.sprint.forma.runs[0].errorDistribution = { timeout: 1 }; },
    r => { r.sprint.forma.runs[0].errorDistribution = { 'aborted due to deadline': 65 }; },
    r => { r.sprint.forma.config.duration = 1; }, r => { r.sprint.forma.config.forced = true; },
    r => { r.sprint.forma.runs.pop(); }, r => { r.smoke.forma.pass = false; }]) {
    const raw = structuredClone(source); edit(raw); assert.throws(() => scoringProfile(raw));
  }
});
test('one championship group cannot mix hosts or campaigns with identical profiles', () => {
  for (const edit of [r => delete r.dom.forma.campaign,
    r => { r.dom.forma.campaign.id = 'b6ee6a58-a306-4b43-b3f3-d42d6ae279a2'; },
    r => { r.dom.forma.campaign.machineIdSha256 = 'd'.repeat(64); },
    r => { r.dom.forma.campaign.github.runId = '124'; }]) {
    const raw = input(); edit(raw); assert.throws(() => scoringProfile(raw));
  }
});
test('saved summaries require qualification fields and the exact measured inputs', () => {
  const raw = input(), summary = scoringProfile(raw);
  assert.deepEqual(validateSummaryProfile(summary, raw), summary);
  for (const key of ['resourceProfile', 'diagnostic', 'campaigns', 'measurementsSha256']) {
    const partial = structuredClone(summary); delete partial[key];
    assert.throws(() => validateSummaryProfile(partial, raw), /profiled summary requires/);
  }
  const changed = structuredClone(raw); changed.bundle.forma.brotli++;
  assert.throws(() => validateSummaryProfile(summary, changed), /measurementsSha256/);
  assert.throws(() => validateSummaryProfile({}, raw), /profiled summary requires/);
  assert.equal(validateSummaryProfile({}, { sprint: { forma: { values: [10] } } }).diagnostic, true);
});
test('measurement binding ignores key order and unscored metadata but binds smoke outcomes', () => {
  const raw = input(), shuffled = { bundle: raw.bundle, dom: raw.dom };
  assert.equal(measurementDigest(raw), measurementDigest(shuffled));
  shuffled.dom._metadata = { date: 'ignored' };
  assert.equal(measurementDigest(raw), measurementDigest(shuffled));
  assert.notEqual(measurementDigest(raw), measurementDigest({ ...raw, smoke: { forma: { pass: false } } }));
});
