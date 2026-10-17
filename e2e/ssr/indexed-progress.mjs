import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';

// At most 13 calibration rows, 101 paired rows, 101 no-op rows and five
// phase records. This bound is evidence transport, not a performance limit.
export function createIndexedProgressWriter(path) {
  const prefix = '[forma:indexed-progress] ';
  let records = 0, bytes = 0;
  writeFileSync(path, '', { flag: 'wx' });
  return text => {
    if (!text.startsWith(prefix)) return;
    const line = text.slice(prefix.length) + '\n';
    const size = Buffer.byteLength(line);
    assert(records < 256 && bytes + size <= 128 * 1024, 'indexed progress evidence limit exceeded');
    appendFileSync(path, line); // Keep the original record before validation.
    records++; bytes += size;
    const row = JSON.parse(line);
    assert(row && typeof row === 'object' && typeof row.phase === 'string', 'invalid indexed progress record');
  };
}
