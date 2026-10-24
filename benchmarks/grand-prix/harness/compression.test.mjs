import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { checkCandidateLock } from './candidate-lock.mjs';
import { decodeExperimentResponse } from './compression-response.mjs';
import { summarizeCompression } from './compression-report.mjs';
import { expected } from '../shared/dataset.mjs';
import { requestHeaders, captureResponse, ohaArguments, wireMeasurement } from './transport.mjs';
import { profileConfiguration } from './resource-profile.mjs';

const codecs = JSON.parse(readFileSync(new URL('./compression-codecs.json', import.meta.url))).packages;
const original = readFileSync(new URL('../contestants/forma/Cargo.lock', import.meta.url), 'utf8');
const blocks = records => records.map(record => '\n[[package]]\n' + Object.entries(record).map(([key, value]) => `${key} = "${value}"`).join('\n') + '\n').join('');
test('default lock guard permits no new dependencies; compression adds only the nine pinned codecs', () => {
  checkCandidateLock(original, original);
  assert.throws(() => checkCandidateLock(original, original + blocks(codecs)));
  checkCandidateLock(original, original + blocks(codecs), codecs);
});
for (const [name, mutate] of [
  ['unrelated addition', text => text + blocks([{ name: 'unreviewed', version: '1.0.0', source: 'registry+x', checksum: 'a'.repeat(64) }])],
  ['existing version drift', text => text.replace(/(name = "axum"\nversion = ")[^"]+/, '$199.0.0')],
  ['codec checksum drift', text => text.replace(codecs[0].checksum, '0'.repeat(64))],
  ['missing codec', text => text.replace(blocks([codecs[0]]), '')],
  ['duplicate codec', text => text + blocks([codecs[0]])],
]) test(`codec closure refuses ${name}`, () => assert.throws(() => checkCandidateLock(original, mutate(original + blocks(codecs)), codecs)));

test('all three representations decode exactly; false headers and corrupt bodies fail', () => {
  const body = Buffer.from('<table>' + 'row'.repeat(1000) + '</table>');
  for (const encoding of ['identity', 'br', 'gzip']) {
    const encoded = encoding === 'br' ? brotliCompressSync(body) : encoding === 'gzip' ? gzipSync(body) : body;
    const response = { status: 200, body: encoded, headers: { 'content-encoding': encoding,
      'cache-control': 'no-store', vary: 'Accept-Encoding', 'content-length': String(encoded.length) } };
    assert.deepEqual(decodeExperimentResponse(response, encoding), body);
    assert.throws(() => decodeExperimentResponse(response, encoding === 'br' ? 'gzip' : 'br'));
    assert.throws(() => decodeExperimentResponse({ ...response, headers: { ...response.headers, 'content-length': '1' } }, encoding));
    if (encoding !== 'identity') assert.throws(() => decodeExperimentResponse({ ...response, body: encoded.subarray(0, 1), headers: { ...response.headers, 'content-length': '1' } }, encoding));
  }
});
function sample(name = 'native-8-v1') {
  const resourceProfile = profileConfiguration({ name, githubActions: true, availableCpus: name === 'gha-4-v1' ? 4 : 8, affinity: name === 'gha-4-v1' ? [4, 5, 6, 7] : [0, 1, 2, 3, 4, 5, 6, 7] });
  return Object.fromEntries(['identity', 'br', 'gzip'].map(encoding => {
    const base = event => ({ event, car: 'forma', campaign: { schema: 1, id: '01234567-89ab-4def-8123-456789abcdef', createdAt: '2026-10-24T12:00:00.000Z', kind: 'github-actions', hostSha256: 'a'.repeat(64), machineIdSha256: 'b'.repeat(64), runnerTrackingSha256: 'c'.repeat(64), github: { runId: '123', runAttempt: '1', job: 'comparison', repository: 'getforma-dev/forma' } }, image: { id: 'sha256:' + 'a'.repeat(64) }, config: {
      acceptEncoding: encoding, forced: false, duration: 10, warmup: 5, runs: 3, concurrency: 64, resourceProfile: structuredClone(resourceProfile), loadgenCpus: resourceProfile.loadgen.cpus, loadgenCpuset: resourceProfile.loadgen.cpuset,
      classA: structuredClone(resourceProfile.classA), classB: structuredClone(resourceProfile.classB) } });
    const load = event => ({ ...base(event), rows: 100, durationS: 10, warmupS: 5, concurrency: event === 'reaction' ? 1 : 64,
      container: structuredClone(event === 'multicore' ? resourceProfile.classB : resourceProfile.classA),
      runs: Array.from({ length: 3 }, () => ({ nonOk: 0, successRate: 1, errorDistribution: {}, okRps: 1000,
        bytesPerRequest: encoding === 'identity' ? 33000 : 2500, latencyMs: { p95: 2, p99: 3 } })) });
    return [encoding, { sprint: load('sprint'), multicore: load('multicore'), reaction: load('reaction'),
      fuel: { ...base('fuel'), values: [5, 6, 7], samples: [{ cpu: '95.2%' }, { cpu: 'post' }] },
      weight: { ...base('weight'), representation: { requestedEncoding: encoding, contentEncoding: encoding, encodedBytes: encoding === 'identity' ? 33000 : 2500, decodedBytes: 33000, verified: true } } }];
  }));
}
test('comparison preserves identity and compression samples from one image', () => {
  const report = summarizeCompression(sample());
  assert.equal(report.variants.br.sprintRpsRatioToIdentity, 1);
  assert.equal(report.variants.gzip.sampledCpuPercentMean, 95.2);
});
for (const [name, mutate] of [
  ['mixed binary images', records => { records.br.sprint.image.id = 'sha256:' + 'b'.repeat(64); }],
  ['wrong request header', records => { records.br.sprint.config.acceptEncoding = 'identity'; }],
  ['missing runs', records => { records.gzip.reaction.runs.pop(); }],
  ['transport failure', records => { records.br.multicore.runs[0].errorDistribution = { timeout: 1 }; }],
  ['invalid deadline', records => { records.br.sprint.runs[0].errorDistribution = { 'aborted due to deadline': null }; }],
  ['changed decoded page', records => { records.br.weight.representation.decodedBytes = 30000; }],
  ['uncompressed load requests', records => { records.br.sprint.runs[0].bytesPerRequest = 33000; }],
  ['missing CPU evidence', records => { records.br.fuel.samples = []; }],
  ['loaded-machine override', records => { records.br.sprint.config.forced = true; }],
  ['shortened duration', records => { records.br.sprint.config.duration = 1; }],
  ['shortened warmup', records => { records.br.sprint.config.warmup = 1; }],
  ['lower concurrency', records => { records.br.sprint.concurrency = 1; }],
  ['more CPU quota', records => { records.br.sprint.container.cpus = '8'; }],
  ['more memory', records => { records.br.sprint.config.classA.memory = '8g'; }],
  ['different loadgen budget', records => { records.br.reaction.config.loadgenCpus = '8'; }],
]) test(`comparison rejects ${name}`, () => { const records = sample(); mutate(records); assert.throws(() => summarizeCompression(records)); });
test('shortened observations can be reported only as diagnostics with their actual profile retained', () => {
  const records = sample();
  for (const events of Object.values(records)) for (const record of Object.values(events)) {
    record.config.duration = 1; record.config.warmup = 1;
    if (record.durationS) { record.durationS = 1; record.warmupS = 1; }
  }
  assert.throws(() => summarizeCompression(records));
  const report = summarizeCompression(records, { diagnostic: true });
  assert.equal(report.diagnostic, true); assert.equal(report.protocol.durationS, 1); assert.equal(report.protocol.warmupS, 1);
});

test('GHA four-CPU compression is a distinct qualified profile with disjoint actual affinity', () => {
  const report = summarizeCompression(sample('gha-4-v1'));
  assert.equal(report.resourceProfile.name, 'gha-4-v1');
  assert.equal(report.protocol.classB.cpus, '2');
  assert.equal(report.resourceProfile.loadgen.cpuset, '6,7');
});
for (const [name, mutate] of [
  ['missing campaign', records => { delete records.br.sprint.campaign; }],
  ['different machine', records => { records.br.sprint.campaign.hostSha256 = 'd'.repeat(64); }],
  ['different job', records => { records.gzip.reaction.campaign.github.job = 'another'; }],
  ['missing profile', records => { for (const events of Object.values(records)) for (const record of Object.values(events)) delete record.config.resourceProfile; }],
  ['mixed profiles', records => { records.br.sprint.config.resourceProfile = sample('native-8-v1').br.sprint.config.resourceProfile; }],
  ['overlapping affinity', records => { records.identity.sprint.config.resourceProfile.loadgen.cpuset = '4,5'; }],
  ['unapplied affinity', records => { records.gzip.multicore.container.cpuset = '4,5,6,7'; }],
  ['diagnostic promoted', records => { for (const events of Object.values(records)) for (const record of Object.values(events)) record.config.resourceProfile.diagnostic = true; }],
]) test(`four-CPU comparison refuses ${name}`, () => {
  const records = sample('gha-4-v1'); mutate(records); assert.throws(() => summarizeCompression(records));
});

function explicitSample() {
  const records = sample('gha-4-v1');
  const page = nonce => Buffer.from(expected(100).mustContain.join(' ') + '<tr data-id="1"></tr>'.repeat(100) + `<script nonce="${nonce}"></script>`);
  const nonces = ['AAAAAAAAAAAAAAAAAAAAAA==', 'mY5yPWZxVhhP9k1n2Q3Xgw==', 'BBBBBBBBBBBBBBBBBBBBBB=='];
  for (const [encoding, events] of Object.entries(records)) {
    const headers = requestHeaders(encoding);
    const encoded = nonces.map(nonce => { const body = page(nonce); return encoding === 'gzip' ? gzipSync(body) : encoding === 'br' ? brotliCompressSync(body) : body; });
    const response = captureResponse(100, { status: 200, body: encoded[0], headers: { 'content-length': String(encoded[0].length), 'content-encoding': encoding },
      rawHeaders: ['Content-Length', String(encoded[0].length), 'Content-Encoding', encoding] }, headers);
    for (const record of Object.values(events)) record.config.requestHeaders = headers;
    for (const event of ['sprint', 'multicore', 'reaction']) {
      const record = events[event]; record.response = response;
      const load = (index, z) => {
        const requested = { c: record.concurrency, z }, target = 'http://car:3000/ssr?rows=100';
        const totalData = encoded[index].length * 100 + encoded[(index + 1) % 3].length;
        const run = { requested, target, response, requestHeaders: headers, arguments: ohaArguments(target, requested, headers),
          nonOk: 0, successRate: 1, errorDistribution: {}, statusCodes: { 200: 101 }, requests: 101, ok: 101, seconds: z, okRps: 101 / z,
          bytesPerRequest: Math.floor(totalData / 101), totalData, latencyMs: { p95: 2, p99: 3 },
          rawOha: { summary: { total: z, successRate: 1, totalData, sizePerRequest: Math.floor(totalData / 101) }, statusCodeDistribution: { 200: 101 }, errorDistribution: {} } };
        run.wireBytes = wireMeasurement(run, response); return run;
      };
      record.runs = [0, 1, 2].map(index => load(index, 10)); record.warmup = load(0, 5);
    }
    Object.assign(events.weight.representation, { encodedBytes: encoded[0].length, decodedBytes: page(nonces[0]).length });
  }
  return records;
}
test('current compression reports real aggregate wire means when fresh nonces vary encoded lengths', () => {
  const records = explicitSample(), report = summarizeCompression(records);
  for (const encoding of ['br', 'gzip']) {
    const variant = report.variants[encoding];
    assert.equal(variant.wireBytes.sprint.kind, 'aggregate-encoded-length');
    assert.notEqual(variant.wireBytes.sprint.meanBytes, variant.encodedBytes);
    assert.equal(variant.wireBytes.sprint.totalBytes, records[encoding].sprint.runs.reduce((n, run) => n + run.totalData, 0));
  }
  assert.equal(report.variants.identity.wireBytes.sprint.meanBytes, report.variants.identity.encodedBytes);
  assert.match(report.meaning, /not a per-response compressed length claim/);
});
for (const [name, edit] of [
  ['missing current headers', r => { delete r.br.sprint.config.requestHeaders; }],
  ['false aggregate bytes', r => { r.br.sprint.runs[1].totalData++; }],
  ['corrupt compressed probe', r => { r.gzip.sprint.response.bodyBase64 = 'AAAA'; }],
  ['wrong decoded row count', r => { r.br.sprint.response.rows = 10; }],
  ['identity660-byte drift', r => { const run = r.identity.sprint.runs[0]; run.bytesPerRequest -= 660; run.totalData -= 660 * run.requests; run.rawOha.summary.sizePerRequest = run.bytesPerRequest; run.rawOha.summary.totalData = run.totalData; run.wireBytes = wireMeasurement(run, run.response); }],
]) test(`current compression refuses ${name}`, () => { const records = explicitSample(); edit(records); assert.throws(() => summarizeCompression(records)); });
