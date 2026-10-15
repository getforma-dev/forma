import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { build } from '../src/build';
import { generateManifest } from '../src/manifest';
import { serviceWorkerSource } from '../src/service-worker';
import type { AssetManifest } from '../src/types';
import { watching } from './helpers/watch';

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

it('keeps development network-only while failed watch cycles preserve metadata and recovery hashes current bytes', async () => {
  const {entry, outputDir, config, root} = fixture();
  const lock = join(root, 'Cargo.lock');
  const renderer = (version: string) => writeFileSync(lock, `version=4\n[[package]]\nname="forma-server"\nversion="${version}"\n`);
  renderer('3.0.0');
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
    await change(() => renderer('3.1.0'));
    expect(readFileSync(join(outputDir, manifest().aliases['app.js']), 'utf8')).toContain('new entry');
    expect(readFileSync(join(outputDir, 'manifest.json'), 'utf8')).not.toBe(original);
    digests(manifest(), outputDir);
    expect(readFileSync(join(outputDir, 'sw.js'), 'utf8')).toBe(worker);
  }, root);
}, 30_000);
