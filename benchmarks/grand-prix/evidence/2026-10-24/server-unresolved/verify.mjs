// Independent offline audit of one completed, authenticated server artifact.
// No measurements from another run enter the checks or reproduced scores.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { scoringProfile, validateSummaryProfile } from './harness-source/benchmarks/grand-prix/harness/score-profile.mjs';
import { evaluateBudgets } from './harness-source/benchmarks/grand-prix/harness/budgets.mjs';
import { validateCampaign } from './harness-source/benchmarks/grand-prix/harness/campaign.mjs';
import { validateProfile, validateEngineProfile, parseCpuList } from './harness-source/benchmarks/grand-prix/harness/resource-profile.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const runRoot = path.resolve(process.argv[2] ?? path.join(root, 'artifact'));
const rawRoot = path.join(runRoot, 'raw');
const harness = '03d0b87a3eed1fa4625d37f6a9add3b77a626d3b';
const id = 'ci-40116667052-1';
const cars = ['forma', 'vanilla-node', 'react-node', 'preact-node', 'solid-node', 'svelte-node', 'vue-node',
  'react-bun', 'vanilla-bun', 'react-deno', 'vanilla-deno', 'next', 'react-router', 'astro'];
const events = ['sprint', 'endurance', 'multicore', 'reaction', 'fuel', 'grid', 'weight', 'pitstop'];
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const positive = (x, name) => assert(Number.isFinite(x) && x > 0, name);
const date = x => { const n = Date.parse(x); assert(Number.isFinite(n), 'timestamp'); return n; };
const near = (a, b, label) => assert(Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-10, label);
const report = json(path.join(runRoot, id + '-linux.json'));
assert.equal(report.sourceCommit, harness);
assert.equal(report.id, id); assert.equal(report.passed, true); assert(!report.error && !report.cleanupError);
assert.equal(report.diagnostic, false); assert.equal(report.compression, false);
assert.equal(report.platform, 'linux'); assert.equal(report.arch, 'x64'); assert.equal(report.cpus, 4);
assert.equal(report.formaRef, 'published 3.0.0');
assert.equal(report.carSource, '3d9de62d0709e8158cadd62be387ff1481ca9e66');
assert.deepEqual(report.cars, cars); assert.equal(report.events, '1-8');
const profile = validateProfile(report.resourceProfile);
assert.equal(profile.name, 'gha-4-v1'); assert.equal(profile.qualified, true); assert.equal(profile.diagnostic, false);
validateEngineProfile(profile, report.dockerEngine);
const campaign = validateCampaign(report.campaign);
assert.deepEqual(campaign.github, { runId: '40116667052', runAttempt: '1', job: 'budgets', repository: 'getforma-dev/forma' });
assert.deepEqual(json(path.join(runRoot, id + '-campaign.json')), campaign);
assert.equal(report.steps.length, cars.length);
let previousFinish = date(report.before);
const intervals = {};
for (const [i, step] of report.steps.entries()) {
  assert.equal(step.car, cars[i]);
  const start = date(step.at), finish = date(step.finished);
  assert(start >= previousFinish && finish > start, 'sequential car intervals');
  assert(step.load[0] < 2, 'driver quiet-start threshold');
  intervals[step.car] = { start, finish }; previousFinish = finish;
}
assert(date(report.finished) >= previousFinish);
const resources = (actual, expected) => {
  assert(actual, 'retained Docker inspection required');
  assert.equal(actual.nanoCpus, Number(expected.cpus) * 1e9);
  assert.deepEqual(parseCpuList(actual.cpuset), parseCpuList(expected.cpuset));
  if (expected.memory) assert.equal(actual.memoryBytes, Number(expected.memory.slice(0, -1)) * 1024 ** 3);
};
assert(profile.classB.cpuset.split(',').every(x => !profile.loadgen.cpuset.split(',').includes(x)));
const raw = {};
for (const event of [...events, 'smoke']) {
  const directory = path.join(rawRoot, event);
  const names = fs.readdirSync(directory).filter(name => name.endsWith('.json') && !name.startsWith('_'));
  assert.deepEqual(names.sort(), cars.map(car => car + '.json').sort(), event + ': exact 14 cars');
  raw[event] = Object.fromEntries(cars.map(car => [car, json(path.join(directory, car + '.json'))]));
}
let loadSamples = 0, memorySamples = 0, bootSamples = 0, buildSamples = 0, inspections = 0;
const bodyEqualityFindings = [];
const details = {};
for (const car of cars) {
  const smoke = raw.smoke[car];
  assert.equal(smoke.pass, true); assert.deepEqual(smoke.campaign, campaign);
  assert.deepEqual(smoke.checks.map(check => check.name), ['health', 'ssr100', 'ssr1000']);
  assert(smoke.checks.every(check => check.ok));
  const imageId = smoke.image.id;
  assert(/^sha256:[a-f0-9]{64}$/.test(imageId));
  const eventIntervals = [];
  for (const event of events) {
    const r = raw[event][car];
    assert.equal(r.car, car); assert.equal(r.event, event); assert.equal(r.runId, id);
    assert.deepEqual(r.campaign, campaign); assert.deepEqual(r.config.resourceProfile, profile);
    assert.equal(r.image.id, imageId); assert.equal(r.image.arch, 'amd64');
    assert.equal(r.machine.before.hostCpus, 4); assert.equal(r.machine.after.hostCpus, 4);
    assert.equal(r.machine.before.availableCpus, 4); assert.equal(r.machine.after.availableCpus, 4);
    const start = date(r.machine.before.at), finish = date(r.machine.after.at);
    assert(start >= intervals[car].start && finish > start && finish <= intervals[car].finish);
    if (event !== 'fuel') eventIntervals.push({ event, start, finish });
    if (['sprint', 'endurance', 'multicore', 'reaction', 'fuel', 'weight'].includes(event)) {
      resources(r.resources.server, event === 'multicore' ? profile.classB : profile.classA); inspections++;
      if (event === 'weight') assert.equal(r.resources.loadgen, null);
      else { resources(r.resources.loadgen, profile.loadgen); inspections++; }
    }
    if (['sprint', 'endurance', 'multicore', 'reaction'].includes(event)) {
      assert.equal(r.rows, event === 'endurance' ? 1000 : 100);
      assert.equal(r.runs.length, 3); assert.equal(r.values.length, 3);
      for (const [i, run] of r.runs.entries()) {
        assert.equal(run.run, i + 1); positive(run.seconds, 'load duration');
        assert(run.seconds >= 9.9, 'no shortened ten-second samples');
        assert.equal(run.nonOk, 0); assert.equal(run.successRate, 1);
        assert.deepEqual(run.statusCodes, { '200': run.ok }); assert.equal(run.requests, run.ok);
        positive(run.ok, 'successful requests'); near(run.okRps, run.ok / run.seconds, 'throughput denominator');
        for (const [key, n] of Object.entries(run.errorDistribution)) {
          assert.equal(key, 'aborted due to deadline'); assert(Number.isInteger(n) && n >= 0 && n <= r.concurrency);
        }
        assert.deepEqual(r.values[i], event === 'reaction' ? run.latencyMs.p99 : run.okRps);
        for (const n of Object.values(run.latencyMs)) positive(n, 'latency');
        const bodyBytes = smoke.checks.find(check => check.name === 'ssr' + r.rows).bytes;
        // Retain every failure and finish the independent audit; no exception
        // turns a byte mismatch into a passing equality check.
        if (run.bytesPerRequest !== bodyBytes) bodyEqualityFindings.push({ event, car, run: run.run,
          rows: r.rows, expectedBytes: bodyBytes, actualBytesPerRequest: run.bytesPerRequest,
          deltaBytes: run.bytesPerRequest - bodyBytes, concurrency: r.concurrency,
          seconds: run.seconds, requests: run.requests, ok: run.ok, nonOk: run.nonOk,
          successRate: run.successRate, statusCodes: run.statusCodes, errorDistribution: run.errorDistribution,
          totalDataRetained: false,
          inferredSuccessfulBodyByteRange: { minimum: run.bytesPerRequest * run.ok, maximum: (run.bytesPerRequest + 1) * run.ok - 1 } });
        loadSamples++;
      }
    }
  }
  eventIntervals.sort((a, b) => a.start - b.start);
  for (let i = 1; i < eventIntervals.length; i++) assert(eventIntervals[i].start >= eventIntervals[i - 1].finish, 'no overlap between car events');
  const sprint = raw.sprint[car], fuel = raw.fuel[car], grid = raw.grid[car], weight = raw.weight[car], pitstop = raw.pitstop[car];
  assert.deepEqual(fuel.values, sprint.runs.map(r => r.peakMiB));
  assert.equal(fuel.runs.length, 3); assert.equal(fuel.values.length, 3);
  fuel.values.forEach(n => positive(n, 'memory peak'));
  for (const sample of fuel.samples) {
    positive(sample.mib, 'memory sample');
    assert(Number.isInteger(sample.t) && sample.t >= date(fuel.machine.before.at) && sample.t <= date(fuel.machine.after.at));
  }
  let offset = 0;
  for (const [i, run] of fuel.runs.entries()) {
    assert.equal(run.samples, sprint.runs[i].memSamples); positive(run.samples, 'memory sample count');
    const samples = fuel.samples.slice(offset, offset + run.samples); offset += run.samples;
    assert.equal(run.peakMiB, Math.max(...samples.map(s => s.mib))); memorySamples += samples.length;
  }
  assert.equal(offset, fuel.samples.length);
  assert.equal(grid.runs.length, 5); assert.deepEqual(grid.values, grid.runs.map(r => r.ms));
  for (const run of grid.runs) { positive(run.ms - run.dockerRunReturnedMs, 'boot remainder'); resources(run.resources, profile.classA); bootSamples++; inspections++; }
  assert.deepEqual(weight.parts.image.values, [weight.image.sizeBytes]);
  positive(weight.image.sizeBytes, 'image size');
  assert.equal(weight.parts.gzip.values.length, 1); positive(weight.parts.gzip.values[0], 'gzip bytes');
  assert.equal(weight.parts.gzip.rawBytes, smoke.checks[1].bytes);
  assert.equal(pitstop.runs.length, 3); assert.deepEqual(pitstop.values, pitstop.runs.map(r => r.buildMs));
  assert.equal(pitstop.cpus, profile.build.cpus); assert.equal(pitstop.cpuset, profile.build.cpuset);
  pitstop.runs.forEach(run => { positive(run.buildMs, 'build time'); buildSamples++; });
  if (car === 'forma') for (const run of pitstop.runs) assert.equal(run.buildMs, run.fmirMs + run.appCompileMs);
  details[car] = { image: imageId, sprint: sprint.values, endurance: raw.endurance[car].values, multicore: raw.multicore[car].values,
    reaction: raw.reaction[car].values, memory: fuel.values, boot: grid.values, bootRemainders: grid.runs.map(r => r.ms - r.dockerRunReturnedMs),
    imageBytes: weight.parts.image.values[0], rawBytes: weight.parts.gzip.rawBytes, gzipBytes: weight.parts.gzip.values[0], build: pitstop.values };
}
const qualification = scoringProfile(raw);
assert.equal(qualification.diagnostic, false); assert.deepEqual(qualification.campaigns, { server: campaign });
const scorePath = path.join(root, 'reproduced-summary.json');
execFileSync(process.execPath, [path.join(root, 'harness-source/benchmarks/grand-prix/harness/score.mjs'), '--raw', rawRoot, '--out', scorePath], { stdio: 'pipe' });
const summary = json(scorePath); validateSummaryProfile(summary, raw);
const budgets = evaluateBudgets(Object.fromEntries(['sprint', 'fuel', 'grid', 'weight'].map(event => [event, raw[event].forma])));
assert.deepEqual(json(path.join(rawRoot, 'forma-budgets.json')), budgets);
const cleanup = json(path.join(runRoot, id + '-cleanup.json')), ownership = json(path.join(runRoot, id + '-ownership.json'));
assert.equal(cleanup.id, id); assert.equal(cleanup.dry, false); assert.deepEqual(cleanup.actions, []);
assert.equal(ownership.id, id); assert.equal(ownership.builder, 'gp264-' + id); assert.equal(ownership.builderCreated, false);
const archive = json(path.join(root, 'artifact-verification.json'));
assert.equal(archive.passed, true); assert.equal(sha(path.join(root, 'artifact.zip')), archive.sha256);
const output = { complete: true, passed: bodyEqualityFindings.length === 0, sourceHarnessQualified: true,
  bodyEquality: { passed: bodyEqualityFindings.length === 0, matchingSamples: loadSamples - bodyEqualityFindings.length,
    totalSamples: loadSamples, findings: bodyEqualityFindings },
  harness, run: '40116667052', artifact: archive, campaign, resourceProfile: profile,
  source: { carSource: report.carSource, formaRef: report.formaRef }, qualification,
  coverage: { cars: cars.length, scoredRecords: cars.length * events.length, smokeRecords: cars.length, loadSamples, memorySamples, bootSamples, buildSamples, retainedResourceEntriesVerified: inspections },
  intervals: report.steps, sequentialIntervalsVerified: true, nonOverlappingCpuSetsVerified: true,
  cleanup: { passed: true, finalActions: cleanup.actions, ownership }, budgets, details,
  scoring: { file: 'reproduced-summary.json', sha256: sha(scorePath), measurementsSha256: summary.measurementsSha256 },
  limitations: ['Timed response bodies and oha totalData were not retained. A failed byte-equality check remains unresolved and is not silently waived by successful protocol scoring.',
    'Build CPU affinity is bound by the exact driver command and recorded profile; short-lived --rm build containers have no retained Docker inspect record.',
    'No comparison with the earlier diagnostic run or another campaign is made. This is a frozen published-3.0.0 baseline, not an integrated-candidate race.'] };
fs.writeFileSync(path.join(root, 'independent-verification.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ passed: output.passed, coverage: output.coverage, budgets: budgets.measured, budgetPassed: budgets.passed, measurementsSha256: summary.measurementsSha256 }, null, 2));
if (!output.passed) process.exitCode = 1;
