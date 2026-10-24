import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateProfile } from './resource-profile.mjs';
import { validateCampaign } from './campaign.mjs';

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const positive = n => assert(Number.isFinite(n) && n > 0, 'invalid numeric measurement');
export function summarizeCompression(records, { diagnostic = false } = {}) {
  const variants = {};
  const campaign = records.identity?.sprint?.campaign;
  if (campaign) validateCampaign(campaign);
  if (!diagnostic) assert(campaign, 'qualified comparison requires one host campaign');
  const resourceProfile = records.identity?.sprint?.config?.resourceProfile;
  if (resourceProfile) validateProfile(resourceProfile);
  if (!diagnostic) assert(resourceProfile?.qualified, 'qualified comparison needs an explicit qualified resource profile');
  let image;
  for (const encoding of ['identity', 'br', 'gzip']) {
    const events = records[encoding];
    for (const event of ['sprint', 'multicore', 'reaction', 'fuel', 'weight']) {
      const record = events[event];
      assert.equal(record?.event, event);
      assert.equal(record.car, 'forma');
      assert.deepEqual(record.campaign, campaign, 'mixed host campaigns');
      assert.equal(record.config?.acceptEncoding, encoding);
      assert.deepEqual(record.config.resourceProfile, resourceProfile, 'mixed resource profiles');
      if (!diagnostic) {
        assert.equal(record.config.forced, false, 'loaded run cannot qualify');
        for (const [field, value] of Object.entries({ duration: 10, warmup: 5, runs: 3, concurrency: 64, loadgenCpus: resourceProfile.loadgen.cpus })) {
          assert.equal(record.config[field], value, `qualified profile requires original ${field}`);
        }
        assert.deepEqual(record.config.classA, resourceProfile.classA);
        assert.deepEqual(record.config.classB, resourceProfile.classB);
        assert.equal(record.config.loadgenCpuset, resourceProfile.loadgen.cpuset);
      }
      assert(/^sha256:[a-f0-9]{64}$/.test(record.image?.id ?? ''), 'missing image identity');
      image ??= record.image.id;
      assert.equal(record.image.id, image, 'encodings must use the same binary image');
    }
    for (const event of ['sprint', 'multicore', 'reaction']) {
      const record = events[event];
      assert.equal(record.rows, 100);
      assert.equal(record.concurrency, event === 'reaction' ? 1 : 64);
      if (!diagnostic) {
        assert.equal(record.durationS, 10); assert.equal(record.warmupS, 5);
        assert.deepEqual(record.container, event === 'multicore'
          ? resourceProfile.classB : resourceProfile.classA);
      }
      assert.equal(record.runs.length, 3, 'three samples required');
      for (const run of record.runs) {
        assert.equal(run.nonOk, 0); assert.equal(run.successRate, 1);
        assert(run.errorDistribution && typeof run.errorDistribution === 'object' && !Array.isArray(run.errorDistribution));
        for (const [error, count] of Object.entries(run.errorDistribution)) {
          assert(Number.isInteger(count) && count >= 0);
          assert(error === 'aborted due to deadline' ? count <= record.concurrency : count === 0, 'transport failure');
        }
        positive(run.okRps); positive(run.latencyMs.p95); positive(run.latencyMs.p99);
      }
    }
    assert.equal(events.fuel.values.length, 3);
    events.fuel.values.forEach(positive);
    const cpu = events.fuel.samples.map(sample => /^([\d.]+)%$/.exec(sample.cpu)?.[1]).filter(value => value !== undefined).map(Number);
    assert(cpu.length > 0 && cpu.every(value => Number.isFinite(value) && value >= 0), 'missing CPU samples');
    const representation = events.weight.representation;
    assert.equal(representation?.verified, true);
    assert.equal(representation.requestedEncoding, encoding);
    assert.equal(representation.contentEncoding, encoding);
    positive(representation.encodedBytes); positive(representation.decodedBytes);
    for (const event of ['sprint', 'multicore', 'reaction']) for (const run of events[event].runs) {
      assert.equal(run.bytesPerRequest, representation.encodedBytes, 'load generator did not transfer the verified encoded body');
    }
    if (encoding === 'identity') assert.equal(representation.encodedBytes, representation.decodedBytes);
    else assert.equal(representation.decodedBytes, variants.identity.decodedBytes);
    variants[encoding] = { encodedBytes: representation.encodedBytes, decodedBytes: representation.decodedBytes,
      sprintRps: mean(events.sprint.runs.map(run => run.okRps)),
      sprintP95Ms: mean(events.sprint.runs.map(run => run.latencyMs.p95)),
      sprintP99Ms: mean(events.sprint.runs.map(run => run.latencyMs.p99)),
      multicoreRps: mean(events.multicore.runs.map(run => run.okRps)),
      multicoreP99Ms: mean(events.multicore.runs.map(run => run.latencyMs.p99)),
      reactionP99Ms: mean(events.reaction.runs.map(run => run.latencyMs.p99)),
      peakMiB: mean(events.fuel.values), sampledCpuPercentMean: mean(cpu), sampledCpuPercentMax: Math.max(...cpu), cpuSamples: cpu.length };
  }
  for (const variant of Object.values(variants)) {
    variant.sprintRpsRatioToIdentity = variant.sprintRps / variants.identity.sprintRps;
    variant.sprintP99RatioToIdentity = variant.sprintP99Ms / variants.identity.sprintP99Ms;
  }
  return { schema: 1, image, diagnostic, campaign: campaign ?? null, resourceProfile: resourceProfile ?? null, variants, passed: true,
    protocol: { durationS: records.identity.sprint.durationS, warmupS: records.identity.sprint.warmupS,
      samples: records.identity.sprint.runs.length, concurrency: records.identity.sprint.concurrency,
      classA: records.identity.sprint.config.classA, classB: records.identity.sprint.config.classB },
    meaning: 'Same opt-in binary; identity includes negotiation. CPU percentages are sampled during one-CPU Sprint runs; timings are means of three samples.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(process.argv[2]);
  const records = Object.fromEntries(['identity', 'br', 'gzip'].map(encoding => [encoding,
    Object.fromEntries(['sprint', 'multicore', 'reaction', 'fuel', 'weight'].map(event => [event,
      JSON.parse(readFileSync(join(directory, encoding, event, 'forma.json'), 'utf8'))]))]));
  const report = summarizeCompression(records, { diagnostic: process.argv.includes('--diagnostic') });
  writeFileSync(join(directory, 'comparison.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
}
