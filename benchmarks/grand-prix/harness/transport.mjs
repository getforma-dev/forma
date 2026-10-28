// One explicit HTTP representation for probes and the pinned load generator.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { assertSSRPage } from './ssr-contract.mjs';

export const OHA_VERSION = '1.16.0';
export function requestHeaders(encoding = 'identity') {
  assert(['identity', 'br', 'gzip'].includes(encoding), 'unsupported request encoding');
  return { 'user-agent': `oha/${OHA_VERSION}`, accept: '*/*', 'accept-encoding': encoding };
}
export const ohaHeaderArgs = headers => Object.entries(headers).flatMap(([name, value]) => ['-H', `${name}: ${value}`]);
export const ohaArguments = (url, { c, z }, headers) => ['oha', '-z', z + 's', '-c', String(c), '--no-tui', '--disable-compression', ...ohaHeaderArgs(headers), '--output-format', 'json', url];
const sha256 = body => createHash('sha256').update(body).digest('hex');
const natural = (value, name) => assert(Number.isSafeInteger(value) && value >= 0, `invalid ${name}`);

export function captureResponse(rows, response, headers) {
  const body = response.body ?? Buffer.alloc(0);
  return { semanticValidation: 'laboratory-1-rows-v1', rows, status: response.status, requestHeaders: { ...headers }, headers: response.headers ?? {},
    rawHeaders: response.rawHeaders ?? [], bytes: body.length, sha256: sha256(body), bodyBase64: body.toString('base64'),
    ...(response.error ? { error: response.error } : {}) };
}

// Verify the retained encoded bytes, then check the decoded server-rendered data.
// No normalizing, stripping or framework-specific allowance is applied to bytes.
export function validateResponse(record, headers = requestHeaders()) {
  assert.deepEqual(record?.requestHeaders, headers, 'probe/load request headers differ');
  assert.equal(record.status, 200, 'probe must return 200');
  assert(typeof record.bodyBase64 === 'string', 'retained response body required');
  const body = Buffer.from(record.bodyBase64, 'base64');
  assert.equal(body.toString('base64'), record.bodyBase64, 'noncanonical retained body');
  assert.equal(body.length, record.bytes, 'retained response length differs');
  assert.equal(sha256(body), record.sha256, 'retained response hash differs');
  assert(Array.isArray(record.rawHeaders) && record.rawHeaders.length % 2 === 0, 'raw response headers required');
  // Node's header map may join or discard duplicate fields; preserve and check
  // the wire pairs too, especially Content-Length and Content-Encoding.
  for (const name of ['content-length', 'content-encoding']) {
    const values = record.rawHeaders.flatMap((item, index) => index % 2 === 0 && item.toLowerCase() === name ? [record.rawHeaders[index + 1]] : []);
    assert(values.every(value => value === values[0]), `conflicting ${name} headers`);
    if (values.length) assert.equal(record.headers[name], values[0], `${name} header map differs`);
  }
  const encoding = record.headers['content-encoding'] ?? 'identity';
  assert.equal(encoding, headers['accept-encoding'], 'unexpected response encoding');
  if (record.headers['content-length'] !== undefined) {
    assert(/^\d+$/.test(record.headers['content-length']), 'invalid content length');
    assert.equal(Number(record.headers['content-length']), body.length, 'encoded content length differs');
  }
  const decoded = encoding === 'br' ? brotliDecompressSync(body) : encoding === 'gzip' ? gunzipSync(body) : body;
  assertSSRPage(record.rows, decoded.toString('utf8'));
  return body;
}

export function wireMeasurement(run, response) {
  return { kind: run.requestHeaders['accept-encoding'] === 'identity' ? 'exact-identity-length' : 'aggregate-encoded-length',
    meanBytes: run.totalData / run.requests, flooredMeanBytes: run.bytesPerRequest, completedResponses: run.requests,
    totalBytes: run.totalData, preflightBytes: response.bytes };
}

export function assertSampleRepresentation(run, response, headers = requestHeaders()) {
  validateResponse(response, headers);
  assert.deepEqual(run.requestHeaders, headers, 'load request headers differ');
  assert(run.requested && Number.isInteger(run.requested.c) && run.requested.c > 0 && Number.isFinite(run.requested.z) && run.requested.z > 0);
  assert(typeof run.target === 'string' && /^http:\/\//.test(run.target));
  const target = new URL(run.target);
  assert.equal(target.pathname, '/ssr');
  assert.deepEqual([...target.searchParams.entries()], [['rows', String(response.rows)]], 'load target differs from verified rows');
  assert.deepEqual(run.response, response, 'sample response differs from event preflight');
  assert.deepEqual(run.arguments, ohaArguments(run.target, run.requested, headers), 'load arguments differ');
  const raw = run.rawOha;
  assert(raw?.summary && raw.statusCodeDistribution, 'complete oha output required');
  for (const key of ['totalData', 'sizePerRequest']) natural(raw.summary[key], `oha ${key}`);
  const statuses = Object.values(raw.statusCodeDistribution);
  statuses.forEach(n => natural(n, 'status count'));
  const completed = statuses.reduce((sum, n) => sum + n, 0);
  assert(completed > 0, 'no completed requests');
  assert.equal(completed, run.requests); assert.equal(raw.statusCodeDistribution['200'], completed, 'non-200 load response');
  assert.equal(run.ok, completed); assert.equal(run.nonOk, 0);
  assert.deepEqual(run.statusCodes, raw.statusCodeDistribution);
  assert.deepEqual(run.errorDistribution, raw.errorDistribution);
  assert.equal(run.successRate, raw.summary.successRate);
  assert.equal(run.successRate, 1, 'failed load transport');
  assert(raw.errorDistribution && typeof raw.errorDistribution === 'object' && !Array.isArray(raw.errorDistribution), 'missing load errors');
  for (const [error, count] of Object.entries(raw.errorDistribution)) {
    assert.equal(error, 'aborted due to deadline', 'unexpected load error');
    natural(count, 'deadline cancellations');
    assert(count <= run.requested.c, 'excess deadline cancellations');
  }
  assert(Number.isFinite(raw.summary.total) && raw.summary.total > 0, 'invalid oha duration');
  assert.equal(run.seconds, raw.summary.total);
  assert.equal(run.okRps, completed / run.seconds);
  assert.equal(run.totalData, raw.summary.totalData); assert.equal(run.bytesPerRequest, raw.summary.sizePerRequest);
  // oha1.16.0 sums successful response-body bytes and divides by the number of
  // successful records; deadline cancellations are excluded from both terms.
  // https://github.com/hatoo/oha/blob/v1.16.0/src/result_data.rs#L144-L154
  assert.equal(run.bytesPerRequest, Math.floor(run.totalData / completed), 'oha byte arithmetic differs');
  assert(run.totalData > 0 && run.bytesPerRequest > 0, 'empty load response bodies');
  assert.deepEqual(run.wireBytes, wireMeasurement(run, response), 'wire-byte interpretation differs');
  if (headers['accept-encoding'] === 'identity') {
    assert.equal(run.bytesPerRequest, response.bytes, 'load/probe response sizes differ');
    assert(Number.isSafeInteger(response.bytes * completed), 'byte total exceeds exact integer range');
    assert.equal(run.totalData, response.bytes * completed, 'load total bytes differ from verified response');
  }
  // A fresh nonce can change compression ratio without changing decoded data.
  // The compressed total is therefore an aggregate, never a claim that every
  // timed body equals the separately retained, semantically verified probe.
}
