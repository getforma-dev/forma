import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { build } from '../src/build';
import { BUILD_WRITER_VERSION } from '../src/compatibility';
import { generateManifest } from '../src/manifest';
import { serviceWorkerSource } from '../src/service-worker';
import type { AssetManifest } from '../src/types';
import { watching } from './helpers/watch';

// Real esbuild cycles, with file barriers only in the overlap control. The first
// barrier retains an already-failed cycle across the recovery edit. The second
// proves that its completion marker cannot stand in for accepted publication.
vi.mock('./helpers/runner', async () => {
  const { build: bundle } = await import('esbuild');
  const { createRequire } = await import('node:module');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const { writeFileSync } = await import('node:fs');
  return { bundleBuildRunner: async (outfile: string) => {
    const actual = pathToFileURL(createRequire(import.meta.url).resolve('esbuild')).href;
    const wrapper = outfile + '.esbuild.mjs';
    writeFileSync(wrapper, `
      import * as actual from ${JSON.stringify(actual)};
      export * from ${JSON.stringify(actual)};
      import {existsSync,writeFileSync} from 'node:fs';
      import {join} from 'node:path';
      export async function context(options) {
        const root=join(options.outdir,'..');
        const barrier={name:'worker-recovery-order-control',setup(builder){
          builder.onEnd(async result=>{
            const phase=result.errors.length?'failed':'recovery';
            if(!existsSync(join(root,'hold-'+phase))||existsSync(join(root,'held-'+phase)))return;
            writeFileSync(join(root,'held-'+phase),'held');
            const deadline=Date.now()+10000;
            while(!existsSync(join(root,'release-'+phase))){
              if(Date.now()>deadline)throw new Error(phase+' publication barrier was not released');
              await new Promise(resolve=>setTimeout(resolve,10));
            }
          });
        }};
        return actual.context({...options,plugins:[barrier,...(options.plugins??[])]});
      }
    `);
    await bundle({entryPoints:[fileURLToPath(new URL('../src/build.ts',import.meta.url))],outfile,
      bundle:true,platform:'node',format:'esm',logLevel:'warning',
      banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"},
      plugins:[{name:'worker-recovery-runner',setup(builder){
        builder.onResolve({filter:/^esbuild$/},()=>({path:pathToFileURL(wrapper).href,external:true}));
        builder.onResolve({filter:/^@getforma\/compiler$/},()=>({path:fileURLToPath(new URL('../../compiler/src/index.ts',import.meta.url))}));
      }}],
    });
  }};
});

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, {recursive: true, force: true, maxRetries: 10, retryDelay: 50})));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-worker-contract-')); temporary.push(root);
  const entry = join(root, 'app.ts'), lazy = join(root, 'later.ts'), outputDir = join(root, 'dist');
  writeFileSync(entry, 'import "./style.css"; export const open = () => import("./later");');
  writeFileSync(lazy, 'export const value = "first";');
  writeFileSync(join(root, 'style.css'), 'main { color: red; }');
  const config = {app: 'ledger', entryPoints: [{entry, outfile: 'app.js'}], routes: {'/': {js: ['app'], css: []}}, outputDir, codeSplitting: true};
  return {root, entry, lazy, outputDir, config};
}
function digests(manifest: AssetManifest, outputDir: string) {
  for (const [file, metadata] of Object.entries(manifest.assets)) {
    expect(metadata.integrity).toBe('sha384-' + createHash('sha384').update(readFileSync(join(outputDir, file))).digest('base64'));
  }
}
function table(manifest: AssetManifest, outputDir: string) {
  digests(manifest, outputDir);
  const worker = readFileSync(join(outputDir, 'sw.js'), 'utf8');
  const actual = JSON.parse(worker.match(/const ASSET_INTEGRITY = new Map\((\[.*\])\);/)![1]);
  const expected = Object.entries(manifest.assets).filter(([file, metadata]) => metadata.immutable && /\.(js|css|wasm)$/.test(file))
    .map(([file, metadata]) => ['/_assets/' + file, metadata.integrity]).sort(([a], [b]) => a.localeCompare(b));
  expect(actual).toEqual(expected);
  expect(actual.some(([file]: string[]) => file.includes('/chunk.'))).toBe(true);
  expect(actual.some(([file]: string[]) => file.endsWith('.css'))).toBe(true);
  return worker;
}

it('publishes a coherent table after final JS/CSS/chunk bytes and preserves it through a failed build then recovery', async () => {
  const {lazy, outputDir, config} = fixture();
  const before = await build(config);
  const beforeWorker = table(before.manifest, outputDir);
  const beforeManifest = readFileSync(join(outputDir, 'manifest.json'), 'utf8');
  writeFileSync(lazy, 'export const value = ;');
  await expect(build(config)).rejects.toThrow();
  expect(readFileSync(join(outputDir, 'manifest.json'), 'utf8')).toBe(beforeManifest);
  expect(readFileSync(join(outputDir, 'sw.js'), 'utf8')).toBe(beforeWorker);
  table(before.manifest, outputDir);
  writeFileSync(lazy, 'export const value = "recovered final chunk";');
  const after = await build(config);
  expect(table(after.manifest, outputDir)).not.toBe(beforeWorker);
  expect(after.manifest.build).not.toBe(before.manifest.build);
});

it('uses real final WASM bytes when an immutable graph asset is supplied, without a legacy WASM build stage', () => {
  const {outputDir, config} = fixture(); mkdirSync(outputDir);
  const wasm = 'engine.01234567.wasm';
  writeFileSync(join(outputDir, wasm), Buffer.from([0,97,115,109,1,0,0,0]));
  const {manifest} = generateManifest({...config, entryPoints: [], routes: {}}, {'engine.wasm': wasm});
  digests(manifest, outputDir);
  expect(manifest.assets[wasm].immutable).toBe(true);
  const worker = serviceWorkerSource(manifest);
  expect(worker).toContain(JSON.stringify(['/_assets/' + wasm, manifest.assets[wasm].integrity]));
});

for (const overlap of [false, true]) it(`keeps development network-only while failed watch cycles preserve metadata and recovery hashes current bytes (pending failed cycle: ${overlap})`, async () => {
  const {entry, lazy, outputDir, config, root} = fixture();
  const lock = join(root, 'Cargo.lock');
  const renderer = (version: string) => writeFileSync(lock, `version=4\n[[package]]\nname="forma-server"\nversion="${version}"\n`);
  renderer(BUILD_WRITER_VERSION.join('.'));
  await watching(config, async ({ready, change, manifest}) => {
    await ready();
    const original = readFileSync(join(outputDir, 'manifest.json'), 'utf8');
    const worker = readFileSync(join(outputDir, 'sw.js'), 'utf8');
    expect(worker).toContain('network-only'); expect(worker).not.toContain('ASSET_INTEGRITY');
    digests(manifest(), outputDir);
    await change(() => renderer('4.0.0'));
    await change(() => writeFileSync(entry, 'import "./style.css"; export const changed = "new entry"; export const open = () => import("./later");'));
    expect(readFileSync(join(outputDir, 'manifest.json'), 'utf8')).toBe(original);
    expect(readFileSync(join(outputDir, 'sw.js'), 'utf8')).toBe(worker);
    if (overlap) {
      writeFileSync(join(root, 'hold-failed'), 'hold');
      writeFileSync(join(root, 'hold-recovery'), 'hold');
      writeFileSync(lazy, 'export const value = "changed during incompatible renderer";');
      await vi.waitFor(() => expect(existsSync(join(root, 'held-failed'))).toBe(true), {timeout:10_000});
    }
    await change(() => {
      renderer([BUILD_WRITER_VERSION[0], BUILD_WRITER_VERSION[1] + 1, 0].join('.'));
      if (overlap) writeFileSync(join(root, 'release-failed'), 'release');
    });
    if (overlap) expect(readFileSync(join(outputDir, 'manifest.json'), 'utf8')).toBe(original);
    let settled = false;
    const recovered = (async () => {
      // A completed marker may belong to an already-running failed cycle.
      // Require the recovery edit's accepted generation, not merely that marker.
      await vi.waitFor(() => {
        expect(readFileSync(join(outputDir, manifest().aliases['app.js']), 'utf8')).toContain('new entry');
        expect(readFileSync(join(outputDir, 'manifest.json'), 'utf8')).not.toBe(original);
        digests(manifest(), outputDir);
        expect(readFileSync(join(outputDir, 'sw.js'), 'utf8')).toBe(worker);
      }, {timeout:10_000});
    })();
    // Attach a rejection handler while the independent real build is held.
    const result = recovered.then(() => { settled = true; return {error:undefined}; }, error => { settled = true; return {error}; });
    if (overlap) {
      await vi.waitFor(() => expect(existsSync(join(root, 'held-recovery'))).toBe(true), {timeout:10_000});
      const settledBeforePublication = settled;
      writeFileSync(join(root, 'release-recovery'), 'release');
      expect(settledBeforePublication, 'a failed cycle completion is not a recovered publication').toBe(false);
    }
    const outcome = await result;
    if (outcome.error) throw outcome.error;
  }, root);
}, 30_000);
