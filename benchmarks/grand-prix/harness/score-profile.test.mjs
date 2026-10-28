import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { profileConfiguration } from './resource-profile.mjs';
import { renderPage } from '../contestants/vanilla-node/src/page.vanilla.mjs';
import { requestHeaders, captureResponse, ohaArguments, wireMeasurement } from './transport.mjs';
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
  const headers = requestHeaders();
  const responses = Object.fromEntries([10, 100, 1000].map(rows => {
    const body = Buffer.from(renderPage(rows));
    return [rows, captureResponse(rows, { status: 200, headers: {}, rawHeaders: [], body }, headers)];
  }));
  const load = z => {
    const requested = { c: 64, z }, target = 'http://car:3000/ssr?rows=100', bytes = responses[100].bytes;
    const run = { requested, target, response: responses[100], requestHeaders: headers, arguments: ohaArguments(target, requested, headers),
      nonOk: 0, successRate: 1, errorDistribution: {}, statusCodes: { 200: 100 }, requests: 100, ok: 100, seconds: z, okRps: 100 / z,
      bytesPerRequest: bytes, totalData: bytes * 100,
      rawOha: { summary: { total: z, successRate: 1, totalData: bytes * 100, sizePerRequest: bytes }, statusCodeDistribution: { 200: 100 }, errorDistribution: {} } };
    run.wireBytes = wireMeasurement(run, responses[100]); return run;
  };
  const source = { smoke: { forma: { pass: true, campaign, requestHeaders: headers, responses } }, sprint: { forma: { campaign, response: responses[100], warmup: load(5),
    config: { resourceProfile: profile, requestHeaders: headers, forced: false, duration: 10, warmup: 5, runs: 3, starts: 5, buildRuns: 3, concurrency: 64,
      classA: profile.classA, classB: profile.classB, loadgenCpus: profile.loadgen.cpus, loadgenCpuset: profile.loadgen.cpuset,
      buildCpus: profile.build.cpus, buildCpuset: profile.build.cpuset },
    durationS: 10, warmupS: 5, concurrency: 64, container: profile.classA,
    runs: Array.from({ length: 3 }, () => load(10)),
  } } };
  assert.equal(scoringProfile(source).diagnostic, false);
  // A compressed preflight and the smoke probe can have different wire sizes
  // while both retain the exact decoded row/summary contract.
  for (const encoding of ['gzip', 'br']) {
    const raw = structuredClone(source), requestedHeaders = requestHeaders(encoding);
    const encode = (original, nonce) => {
      const body = Buffer.concat([Buffer.from(original.bodyBase64, 'base64'), Buffer.from(`<script nonce="${nonce}"></script>`)]);
      const encoded = encoding === 'gzip' ? gzipSync(body) : brotliCompressSync(body);
      return captureResponse(original.rows, { status: 200, body: encoded,
        headers: { 'content-encoding': encoding, 'content-length': String(encoded.length) },
        rawHeaders: ['Content-Encoding', encoding, 'Content-Length', String(encoded.length)] }, requestedHeaders);
    };
    raw.smoke.forma.requestHeaders = requestedHeaders;
    for (const rows of [10, 100, 1000]) raw.smoke.forma.responses[rows] = encode(responses[rows], 'AAAAAAAAAAAAAAAAAAAAAA==');
    const record = raw.sprint.forma;
    record.config.requestHeaders = requestedHeaders; record.config.acceptEncoding = encoding;
    record.response = encode(responses[100], 'mY5yPWZxVhhP9k1n2Q3Xgw==');
    assert.notEqual(record.response.bytes, raw.smoke.forma.responses[100].bytes);
    for (const run of [record.warmup, ...record.runs]) {
      run.response = record.response; run.requestHeaders = requestedHeaders;
      run.arguments = ohaArguments(run.target, run.requested, requestedHeaders);
      run.totalData = record.response.bytes * run.requests + 1; run.bytesPerRequest = Math.floor(run.totalData / run.requests);
      run.rawOha.summary.totalData = run.totalData; run.rawOha.summary.sizePerRequest = run.bytesPerRequest;
      run.wireBytes = wireMeasurement(run, record.response);
    }
    assert.equal(scoringProfile(raw).diagnostic, false);
  }
  for (const edit of [r => delete r.sprint.forma.runs[0].errorDistribution,
    r => { r.sprint.forma.runs[0].errorDistribution = null; },
    r => { r.sprint.forma.runs[0].errorDistribution = { timeout: 1 }; },
    r => { r.sprint.forma.runs[0].errorDistribution = { 'aborted due to deadline': 65 }; },
    r => { r.sprint.forma.config.duration = 1; }, r => { r.sprint.forma.config.forced = true; },
    r => { r.sprint.forma.runs.pop(); }, r => { r.smoke.forma.pass = false; },
    r => { delete r.smoke.forma.responses[100].bodyBase64; }, r => { r.sprint.forma.runs[1].bytesPerRequest -= 660; },
    r => { delete r.sprint.forma.warmup; }, r => { delete r.sprint.forma.config.requestHeaders; }]) {
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
test('unscored engine-reference telemetry binds the saved summary and client campaign', () => {
  const raw = input();
  raw['signals-version-check'] = { 'alien-signals-3.1.2': { resourceProfile: structuredClone(profile),
    campaign: structuredClone(campaign), runs: 5, warmups: 2, correct: true, values: [1, 2, 3, 4, 5] } };
  const summary = scoringProfile(raw);
  assert.deepEqual(validateSummaryProfile(summary, raw), summary);
  raw['signals-version-check']['alien-signals-3.1.2'].values[0]++;
  assert.throws(() => validateSummaryProfile(summary, raw), /measurementsSha256/);
  raw['signals-version-check']['alien-signals-3.1.2'].campaign.github.runId = '456';
  assert.throws(() => scoringProfile(raw), /different campaigns/);
});
