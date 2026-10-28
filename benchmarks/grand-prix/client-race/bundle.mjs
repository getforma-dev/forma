import { readCampaign } from '../harness/campaign.mjs';
// Event 10: Brotli and gzip size of all JavaScript the built index.html loads (static import graph).
// Usage: node bundle.mjs [--cars vanilla,react] [--out ../results/raw/bundle]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import path from 'node:path';
import { appsDir, rawDir, parseArgs, builtCars } from './lib.mjs';
import { validateProfile } from '../harness/resource-profile.mjs';
import { collectBundle } from './bundle-graph.mjs';

const args = parseArgs(process.argv.slice(2), { out: path.join(rawDir, 'bundle') });
const resourceProfile = args['resource-profile'] ? validateProfile(JSON.parse(await readFile(args['resource-profile'], 'utf8'))) : null;
const campaign = args.campaign ? readCampaign(args.campaign) : process.env.GP_CAMPAIGN_FILE ? readCampaign() : null;
if (resourceProfile?.qualified && !campaign) throw new Error('qualified run requires a campaign identity');
const { have, missing } = builtCars(args.cars);
const cars = [...have, ...missing];
for (const car of cars) if (existsSync(path.join(args.out, `${car}.json`))) throw new Error('Refusing to overwrite retained bundle result: ' + car);

const br = (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;

await mkdir(args.out, { recursive: true });
let failed = 0;
for (const car of cars) {
  const result = { event: 10, car, measuredAt: new Date().toISOString(), resourceProfile, campaign,
    measurementScope: 'initial static JavaScript graph (dynamic imports excluded)',
    graphMethod: 'node-vm-static-imports-v1', status: 'failed', verified: false };
  try {
    const dist = path.join(appsDir, car, 'dist');
    const { files, inlineSources } = await collectBundle(dist);
    const parts = files.map(({ file, bytes }) => ({ file, bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, brotli: br(bytes) }));
    for (const source of inlineSources) {
      const bytes = Buffer.from(source);
      parts.push({ file: '(inline)', bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, brotli: br(bytes) });
    }
    const sum = key => parts.reduce((total, part) => total + part[key], 0);
    Object.assign(result, { files: parts, bytes: sum('bytes'), gzip: sum('gzip'), brotli: sum('brotli'), status: 'passed', verified: true });
    console.log(`${car.padEnd(8)} raw ${result.bytes}  gzip ${result.gzip}  brotli ${result.brotli}  (${parts.length} file${parts.length === 1 ? '' : 's'})`);
  } catch (error) { result.error = error.message; failed++; console.error(`${car}: FAILED: ${error.message}`); }
  await writeFile(path.join(args.out, `${car}.json`), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
}
process.exitCode = failed ? 1 : 0;
