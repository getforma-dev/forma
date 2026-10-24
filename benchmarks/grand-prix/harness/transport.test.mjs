import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { expected } from '../shared/dataset.mjs';
import { get } from './lib.mjs';
import { requestHeaders, ohaArguments, captureResponse, validateResponse, assertSampleRepresentation, wireMeasurement, OHA_VERSION } from './transport.mjs';
const page = rows => Buffer.from(expected(rows).mustContain.join(' ') + '<table>' + Array.from({ length: rows }, (_, i) => `<tr data-id="${i + 1}"></tr>`).join('') + '</table>');
const response = (rows = 100, encoding = 'identity') => {
  const body = encoding === 'gzip' ? gzipSync(page(rows)) : page(rows);
  return captureResponse(rows, { status: 200, body, headers: { 'content-length': String(body.length), ...(encoding === 'identity' ? {} : { 'content-encoding': encoding }) },
    rawHeaders: ['Content-Length', String(body.length), ...(encoding === 'identity' ? [] : ['Content-Encoding', encoding])] }, requestHeaders(encoding));
};
function sample(rep, count = 3) {
  const requested = { c: 64, z: 10 }, target = 'http://car:3000/ssr?rows=100', headers = rep.requestHeaders;
  const summary = { total: 10, successRate: 1, totalData: rep.bytes * count, sizePerRequest: rep.bytes };
  const run = { requested, target, response: rep, requestHeaders: headers, arguments: ohaArguments(target, requested, headers),
    rawOha: { summary, statusCodeDistribution: { 200: count }, errorDistribution: { 'aborted due to deadline': 64 } },
    totalData: summary.totalData, bytesPerRequest: summary.sizePerRequest, seconds: 10, okRps: count / 10,
    requests: count, ok: count, nonOk: 0, successRate: 1, statusCodes: { 200: count }, errorDistribution: { 'aborted due to deadline': 64 } };
  run.wireBytes = wireMeasurement(run, rep); return run;
}
test('probe and load generator share the Docker-pinned version and explicit headers', () => {
  assert(readFileSync(new URL('./loadgen/Dockerfile', import.meta.url), 'utf8').includes(`ARG OHA_VERSION=v${OHA_VERSION}`));
  assert.deepEqual(requestHeaders(), { 'user-agent': 'oha/1.16.0', accept: '*/*', 'accept-encoding': 'identity' });
  const args = ohaArguments('http://car:3000', { c: 1, z: 5 }, requestHeaders());
  for (const [key, value] of Object.entries(requestHeaders())) assert(args.includes(`${key}: ${value}`));
  assert(args.includes('--disable-compression'));
});
test('a user-agent-dependent native representation exposes the old probe mismatch and matched headers resolve it', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    const body = Buffer.concat([page(100), req.headers['user-agent'] === 'oha/1.16.0' ? Buffer.alloc(0) : Buffer.alloc(660, 32)]);
    res.setHeader('Content-Length', body.length); res.end(body);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const port = server.address().port;
    const oldBody = await new Promise((resolve, reject) => http.get({ hostname: '127.0.0.1', port }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    }).on('error', reject));
    const probe = await get(port, '/ssr?rows=100');
    const simulatedLoad = await get(port, '/ssr?rows=100', requestHeaders());
    assert.equal(oldBody.length - probe.body.length, 660);
    assert(probe.body.equals(simulatedLoad.body));
    for (const headers of seen.slice(1)) for (const [key, value] of Object.entries(requestHeaders())) assert.equal(headers[key], value);
    const rep = captureResponse(100, probe, requestHeaders());
    assertSampleRepresentation(sample(rep), rep);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('retained identity and gzip bodies are checked as encoded bytes and decoded SSR data', () => {
  for (const encoding of ['identity', 'gzip']) {
    const rep = response(100, encoding); validateResponse(rep, requestHeaders(encoding));
    assertSampleRepresentation(sample(rep), rep, requestHeaders(encoding));
  }
});
for (const [label, edit] of [
  ['different row target', run => { run.target = 'http://car:3000/ssr?rows=10'; run.arguments = ohaArguments(run.target, run.requested, run.requestHeaders); }],
  ['different response snapshot', run => { run.response = response(10); }],
  ['old missing user agent', (run, rep) => { delete rep.requestHeaders['user-agent']; }],
  ['wrong Accept-Encoding', run => { run.requestHeaders['accept-encoding'] = 'gzip'; }],
  ['altered actual invocation', run => { run.arguments.push('-H', 'User-Agent: another'); }],
  ['missing body', (run, rep) => { delete rep.bodyBase64; }],
  ['corrupted body', (run, rep) => { rep.bodyBase64 = Buffer.from('wrong').toString('base64'); }],
  ['conflicting raw length', (run, rep) => { rep.rawHeaders.push('Content-Length', '1'); }],
  ['660-byte mismatch', run => { run.bytesPerRequest -= 660; run.rawOha.summary.sizePerRequest -= 660; run.totalData -= 1980; run.rawOha.summary.totalData -= 1980; }],
  ['integer-average conceals variable body', run => { run.totalData++; run.rawOha.summary.totalData++; }],
  ['missing total data', run => { delete run.rawOha.summary.totalData; }],
  ['nonfinite total data', run => { run.rawOha.summary.totalData = Infinity; }],
  ['fractional total data', run => { run.rawOha.summary.totalData += .5; }],
  ['unsafe total data', run => { run.rawOha.summary.totalData = Number.MAX_SAFE_INTEGER + 1; }],
  ['different completed denominator', run => { run.rawOha.statusCodeDistribution['200']++; }],
  ['failure counted as success', run => { run.rawOha.statusCodeDistribution['500'] = 1; }],
]) test(`${label} refuses representation evidence`, () => {
  const rep = response(), run = sample(rep); edit(run, rep); run.wireBytes = wireMeasurement(run, rep); assert.throws(() => assertSampleRepresentation(run, rep));
});

for (const mode of ['success', 'mismatch', 'malformed', 'process-failure']) test(`oha ${mode} retains exact output before validation`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp264-transport-'));
  try {
    const rep = response(), run = sample(rep);
    Object.assign(run.rawOha.summary, { requestsPerSec: .3, average: .001, slowest: .002 });
    run.rawOha.latencyPercentiles = { p50: .001, p95: .002, p99: .002 };
    if (mode === 'mismatch') { run.rawOha.summary.sizePerRequest -= 660; run.rawOha.summary.totalData -= 1980; }
    const output = mode === 'malformed' ? '{broken-json' : JSON.stringify(run.rawOha);
    writeFileSync(join(dir, 'output'), output); writeFileSync(join(dir, 'response.json'), JSON.stringify(rep));
    writeFileSync(join(dir, 'docker'), `#!${process.execPath}\nprocess.stdout.write(require('node:fs').readFileSync(process.env.FIXTURE_OUTPUT)); process.exit(Number(process.env.FIXTURE_EXIT));\n`);
    chmodSync(join(dir, 'docker'), 0o755);
    const code = `import { oha } from ${JSON.stringify(new URL('./lib.mjs', import.meta.url).href)};
      import { readFileSync } from 'node:fs';
      let rejected = false;
      try { await oha({name:'fixture'}, 'http://car:3000/ssr?rows=100', { c:64,z:10,evidence:'fixture-warmup',response:JSON.parse(readFileSync(process.env.FIXTURE_RESPONSE)) }); }
      catch { rejected = true; }
      console.log(JSON.stringify({rejected}));`;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8',
      env: { ...process.env, PATH: dir + ':' + process.env.PATH, GP_RAW_DIR: join(dir, 'raw'), GP_RUN_ID: 'transport-control',
        FIXTURE_OUTPUT: join(dir, 'output'), FIXTURE_RESPONSE: join(dir, 'response.json'), FIXTURE_EXIT: mode === 'process-failure' ? '1' : '0' } }));
    assert.equal(result.rejected, mode !== 'success');
    const saved = JSON.parse(readFileSync(join(dir, 'raw/transport/fixture-warmup.json')));
    assert.deepEqual(saved.response, rep); assert.deepEqual(saved.arguments, ohaArguments(run.target, run.requested, requestHeaders()));
    if (mode === 'malformed') assert.equal(saved.stdout, output); else assert.deepEqual(saved.rawOha, run.rawOha);
    assert.equal(saved.exitCode, mode === 'process-failure' ? 1 : 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fresh equal-width nonces can vary gzip/br wire lengths without a tolerance or normalization', () => {
  // Fixed distinct nonce strings keep this deterministic while retaining every
  // original byte. Their compressibility differs even at the same decoded size.
  const nonces = ['AAAAAAAAAAAAAAAAAAAAAA==', 'mY5yPWZxVhhP9k1n2Q3Xgw==', 'mY5yPWZxVhhP9k1n2Q3Xgw=='];
  assert.equal(new Set(nonces.map(n => n.length)).size, 1);
  for (const encoding of ['gzip', 'br']) {
    const representations = nonces.map(nonce => {
      const decoded = Buffer.concat([page(100), Buffer.from(`<script nonce="${nonce}"></script>`)]);
      const body = encoding === 'gzip' ? gzipSync(decoded) : brotliCompressSync(decoded);
      const headers = { 'content-encoding': encoding, 'content-length': String(body.length) };
      return captureResponse(100, { status: 200, body, headers, rawHeaders: ['Content-Encoding', encoding, 'Content-Length', String(body.length)] }, requestHeaders(encoding));
    });
    assert(new Set(representations.map(rep => rep.bytes)).size > 1, 'control needs varying compressed lengths');
    representations.forEach(rep => validateResponse(rep, requestHeaders(encoding)));
    const run = sample(representations[0]);
    run.totalData = representations.reduce((n, rep) => n + rep.bytes, 0);
    run.bytesPerRequest = Math.floor(run.totalData / representations.length);
    run.rawOha.summary.totalData = run.totalData; run.rawOha.summary.sizePerRequest = run.bytesPerRequest;
    run.wireBytes = wireMeasurement(run, representations[0]);
    assert.notEqual(run.bytesPerRequest, representations[0].bytes);
    assertSampleRepresentation(run, representations[0], requestHeaders(encoding));
    assert.equal(run.wireBytes.kind, 'aggregate-encoded-length');
    assert.equal(run.wireBytes.meanBytes, run.totalData / 3);
    const invalid = structuredClone(run); invalid.totalData++;
    assert.throws(() => assertSampleRepresentation(invalid, representations[0], requestHeaders(encoding)), 'raw arithmetic is still enforced');
  }
});
