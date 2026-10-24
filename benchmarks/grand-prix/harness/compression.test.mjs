import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { checkCandidateLock } from './candidate-lock.mjs';
import { decodeExperimentResponse } from './compression-response.mjs';
import { summarizeCompression } from './compression-report.mjs';

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
function sample() {
  return Object.fromEntries(['identity', 'br', 'gzip'].map(encoding => {
    const base = event => ({ event, car: 'forma', image: { id: 'sha256:' + 'a'.repeat(64) }, config: {
      acceptEncoding: encoding, forced: false, duration: 10, warmup: 5, runs: 3, concurrency: 64, loadgenCpus: '4',
      classA: { cpus: '1', memory: '1g', workers: 1 }, classB: { cpus: '4', memory: '2g', workers: 4 } } });
    const load = event => ({ ...base(event), rows: 100, durationS: 10, warmupS: 5, concurrency: event === 'reaction' ? 1 : 64,
      container: event === 'multicore' ? { cpus: '4', memory: '2g', workers: 4 } : { cpus: '1', memory: '1g', workers: 1 },
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
