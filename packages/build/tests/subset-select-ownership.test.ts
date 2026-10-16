/** Actual build/watch publication: the parent's select cannot own a child island's option state. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from './helpers/named-build';
import { watching } from './helpers/watch';
import type { BuildConfig } from '../src/types';
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-select-publish-')); roots.push(root);
  const entry = join(root, 'app.ts'), core = join(root, 'node_modules/@getforma/core');
  mkdirSync(core, {recursive: true});
  writeFileSync(join(core, 'package.json'), JSON.stringify({name: '@getforma/core', version: '3.0.0-dev', type: 'module', exports: './index.js'}));
  writeFileSync(join(core, 'index.js'), 'export const h=()=>{};export const mount=()=>{};export const activateIslands=()=>{};export const __islandRegistration=(f)=>f;');
  const write = (independent: boolean, label = 'B') => writeFileSync(entry, [
    "import {h,mount,activateIslands} from '@getforma/core';",
    `export function Choice(){return h('option',{value:'b',selected:false},'${label}');}`,
    "export function Picker(){return h('select',{value:'b'},h('option',{value:'a'},'A'),Choice());}",
    "export function Page(){return h('main',null,Picker());}",
    `activateIslands({Picker${independent ? ',Choice' : ''}});mount(()=>Page(),'#app');`,
  ].join('\n'));
  write(false);
  const config: BuildConfig = { entryPoints: [{ entry, outfile: 'app.js' }], routes: { '/': { js: ['app'], css: [] } },
    ssr: true, strict: false, outputDir: join(root, 'dist'), diagnosticsJson: join(root, 'diagnostics.json') };
  return { root, write, config };
}
it('a default build refuses BUILD-617 with source/fix and retains the complete accepted product', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
  const f = fixture(); await build(f.config);
  const manifest = readFileSync(join(f.config.outputDir, 'manifest.json'), 'utf8');
  const old = JSON.parse(manifest), ir = readFileSync(join(f.config.outputDir, old.aliases['app.ir']));
  f.write(true);
  await expect(build(f.config)).rejects.toThrow(/BUILD-617/);
  const report = JSON.parse(readFileSync(f.config.diagnosticsJson!, 'utf8'));
  expect(report.strict).toBe(true);
  expect(report.diagnostics).toEqual([expect.objectContaining({code: 'BUILD-617', severity: 'error', line: 2, fix: expect.stringContaining('unregistered')})]);
  expect(readFileSync(join(f.config.outputDir, 'manifest.json'), 'utf8')).toBe(manifest);
  expect(readFileSync(join(f.config.outputDir, old.aliases['app.ir']))).toEqual(ir);
});
it('watch retains a real previous module on refusal and publishes a repaired source', async () => {
  const f = fixture();
  await watching(f.config, async ({ready, change, manifest, output}) => {
    await ready();
    const previous = manifest(), bytes = readFileSync(join(f.config.outputDir, previous.aliases['app.ir']));
    await change(() => f.write(true));
    expect(output()).toContain('BUILD-617');
    expect(manifest()).toEqual(previous);
    expect(readFileSync(join(f.config.outputDir, previous.aliases['app.ir']))).toEqual(bytes);
    await change(() => f.write(false, 'Repaired'));
    const repaired = manifest();
    expect(repaired.aliases['app.ir']).not.toBe(previous.aliases['app.ir']);
    expect(readFileSync(join(f.config.outputDir, repaired.aliases['app.ir'])).includes(Buffer.from('Repaired'))).toBe(true);
  });
}, 30_000);
