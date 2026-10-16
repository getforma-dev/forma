// DS12 transport bound, including forty complete compressed mobile traces.
// This is neither a product budget nor a bound for other release metadata.
import assert from 'node:assert/strict';
export const RELEASE_RECORD_MAX_BYTES = 128 * 1024 * 1024;

/** Bound the received bytes, not just the advertised length. Cancelling the
 * reader on any failure prevents an oversized response continuing to stream. */
export async function readBoundedBody(response, maxBytes) {
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= RELEASE_RECORD_MAX_BYTES);
  assert(response.ok, `GitHub response unreadable (${response.status})`);
  const reader = response.body?.getReader();
  assert(reader, 'GitHub response body absent');
  let complete = false;
  try {
    const length = response.headers.get('content-length');
    if (length !== null) assert(/^\d+$/.test(length) && Number.isSafeInteger(Number(length)) && Number(length) <= maxBytes, 'GitHub response exceeds byte limit');
    let size = 0; const chunks = [];
    for (;;) {
      const {done, value} = await reader.read();
      if (done) { complete = true; return Buffer.concat(chunks, size); }
      assert(value instanceof Uint8Array, 'GitHub response contains non-byte chunk');
      size += value.byteLength;
      assert(size <= maxBytes, 'GitHub response exceeds byte limit');
      chunks.push(Buffer.from(value));
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
