// Recompute the archived static bytes. Run with Node24.22.0, matching the build.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

for (const label of ['main', 'candidate']) {
  const record = JSON.parse(readFileSync(new URL(`${label}.json`, import.meta.url)));
  const root = new URL(`${label}-dist/`, import.meta.url);
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const entry = [...html.matchAll(/<script\b[^>]*src="\.\/([^"]+)"/g)].map(m => m[1]);
  const allJs = readdirSync(root, { recursive: true }).filter(p => /\.m?js$/.test(p)).sort();
  assert.deepEqual(entry, record.files.map(file => file.file));
  assert.deepEqual(allJs, entry.slice().sort());
  const totals = { bytes: 0, gzip: 0, brotli: 0 };
  for (const file of record.files) {
    const bytes = readFileSync(new URL(file.file, root));
    const measured = {
      bytes: bytes.length,
      gzip: gzipSync(bytes, { level: 9 }).length,
      brotli: brotliCompressSync(bytes, { params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
      } }).length,
    };
    for (const [key, value] of Object.entries(measured)) {
      assert.equal(value, file[key], `${label}: ${file.file}: ${key}`);
      totals[key] += value;
    }
  }
  for (const [key, value] of Object.entries(totals)) assert.equal(value, record[key]);
  console.log(`${label}: ${JSON.stringify(totals)}`);
}
