import assert from 'node:assert/strict';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

export function decodeExperimentResponse(response, encoding) {
  assert(['identity', 'br', 'gzip'].includes(encoding));
  assert.equal(response.status, 200, 'compression response failed');
  assert.equal(response.headers['content-encoding'] ?? 'identity', encoding, 'server did not return the requested encoding');
  assert.equal(response.headers['cache-control'], 'no-store', 'compression changed cache policy');
  assert.match(response.headers.vary ?? '', /(?:^|,\s*)accept-encoding(?:\s*,|$)/i, 'negotiation must vary on encoding');
  assert.equal(Number(response.headers['content-length']), response.body.length, 'incorrect encoded content length');
  return encoding === 'br' ? brotliDecompressSync(response.body) : encoding === 'gzip' ? gunzipSync(response.body) : response.body;
}
