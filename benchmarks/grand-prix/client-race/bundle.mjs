// Event 10: Brotli and gzip size of all JavaScript the built index.html loads (static import graph).
// Usage: node bundle.mjs [--cars vanilla,react] [--out ../results/raw/bundle]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import path from 'node:path';
import { appsDir, rawDir, parseArgs, builtCars } from './lib.mjs';
import { validateProfile } from '../harness/resource-profile.mjs';

const args = parseArgs(process.argv.slice(2), { out: path.join(rawDir, 'bundle') });
const resourceProfile = args['resource-profile'] ? validateProfile(JSON.parse(await readFile(args['resource-profile'], 'utf8'))) : null;
const { have, missing } = builtCars(args.cars);
if (missing.length || !have.length) throw new Error('requested bundle cars missing built output: ' + missing.join(', '));

const br = (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;

async function collect(dist) {
  const html = await readFile(path.join(dist, 'index.html'), 'utf8');
  const files = new Set();
  let inline = 0;
  const queue = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = /\bsrc=["']([^"']+)["']/.exec(m[1]);
    if (src) queue.push(src[1]);
    else if (!/type=["']application\/(ld\+)?json/.test(m[1]) && m[2].trim()) inline += Buffer.byteLength(m[2]);
  }
  for (const m of html.matchAll(/<link\b[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/gi)) queue.push(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']modulepreload["']/gi)) queue.push(m[1]);
  const inlineSources = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\bsrc=/.test(m[1]) && m[2].trim() && !/json/.test(m[1])).map((m) => m[2]);
  const base = (from, spec) => path.normalize(path.join(path.dirname(from), spec));
  const seen = new Set();
  const walk = async (rel, from) => {
    if (/^https?:/.test(rel)) throw new Error('unmeasured remote JavaScript: ' + rel);
    const file = from === null ? path.join(dist, rel.replace(/^\//, '')) : base(from, rel);
    if (seen.has(file)) return;
    seen.add(file);
    let text;
    text = await readFile(file, 'utf8');
    files.add(file);
    for (const m of text.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+\.m?js)["']/g)) await walk(m[1], file);
  };
  for (const s of queue) await walk(s, null);
  return { files: [...files], inlineSources };
}

await mkdir(args.out, { recursive: true });
for (const car of have) {
  const dist = path.join(appsDir, car, 'dist');
  const { files, inlineSources } = await collect(dist);
  const parts = [];
  for (const f of files) {
    const b = await readFile(f);
    parts.push({ file: path.relative(dist, f), bytes: b.length, gzip: gzipSync(b, { level: 9 }).length, brotli: br(b) });
  }
  for (const s of inlineSources) { const b = Buffer.from(s); parts.push({ file: '(inline)', bytes: b.length, gzip: gzipSync(b, { level: 9 }).length, brotli: br(b) }); }
  if (!parts.length) throw new Error(`${car}: no measured JavaScript files`);
  const sum = (k) => parts.reduce((a, p) => a + p[k], 0);
  const result = { event: 10, car, measuredAt: new Date().toISOString(), resourceProfile, files: parts, bytes: sum('bytes'), gzip: sum('gzip'), brotli: sum('brotli') };
  await writeFile(path.join(args.out, `${car}.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(`${car.padEnd(8)} raw ${result.bytes}  gzip ${result.gzip}  brotli ${result.brotli}  (${parts.length} file${parts.length === 1 ? '' : 's'})`);
}
