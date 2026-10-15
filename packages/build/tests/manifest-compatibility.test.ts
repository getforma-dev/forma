import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../src/build';
import { buildInChild } from './helpers/child-build';
import { watching } from './helpers/watch';
import { requireCompatibleCompiler } from '../src/compatibility';
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-manifest2-')); roots.push(root);
  const entry = join(root, 'app.ts'); writeFileSync(entry, 'export const message = "healthy";');
  return {root, entry, outputDir: join(root, 'dist')};
}
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => rmSync(root, {recursive: true, force: true})); });

describe('manifest2 compatibility through real builds', () => {
  it('emits a suffix-free writer, named browser route, aliases and full uncompressed SHA384 metadata', async () => {
    const {root, entry, outputDir} = fixture();
    writeFileSync(entry, `export const message = ${JSON.stringify('healthy '.repeat(300))};`);
    const fontDir = join(root, 'fonts'); mkdirSync(fontDir); writeFileSync(join(fontDir, 'plain.woff2'), 'font bytes');
    const result = await build({app: 'ledger', entryPoints: [{entry, outfile: 'app.js'}], routes: {'/': {js: ['app'], css: []}}, outputDir, fontDir});
    const manifest = result.manifest;
    expect(manifest.version).toBe(2); expect(manifest.writer).toBe('3.0.0'); expect(manifest.app).toBe('ledger');
    expect(manifest.routes['/'].mode).toBe('browser'); expect(manifest.routes['/'].ir).toBeUndefined();
    expect(readFileSync(join(outputDir, 'manifest.json'), 'utf8')).not.toContain('-dev');
    const script = manifest.aliases['app.js'];
    expect(manifest.routes['/'].js).toEqual([script]);
    expect(manifest.assets[script].immutable).toBe(true);
    expect(manifest.assets['plain.woff2'].immutable).toBe(false);
    for (const [file, metadata] of Object.entries(manifest.assets)) {
      expect(metadata.integrity).toBe(`sha384-${createHash('sha384').update(readFileSync(join(outputDir, file))).digest('base64')}`);
    }
    expect(readdirSync(outputDir)).toContain(`${script}.br`);
    expect(manifest.assets).not.toHaveProperty(`${script}.br`);
  });

  it('marks esbuild split chunks immutable by graph membership, including uppercase hashes', async () => {
    const {root, entry, outputDir} = fixture();
    writeFileSync(join(root, 'shared.ts'), 'export let n = 1; export function next() { return n++; }');
    writeFileSync(entry, 'import {next} from "./shared"; export const first = next();');
    const other = join(root, 'other.ts'); writeFileSync(other, 'import {next} from "./shared"; export const second = next();');
    const {manifest} = await build({app: 'ledger', codeSplitting: true, entryPoints: [{entry, outfile: 'app.js'}, {entry: other, outfile: 'other.js'}], routes: {'/': {js: ['app'], css: []}, '/other': {js: ['other'], css: []}}, outputDir});
    const chunks = Object.keys(manifest.assets).filter(file => file.startsWith('chunk.'));
    expect(chunks.length).toBeGreaterThan(0);
    for (const file of chunks) expect(manifest.assets[file].immutable).toBe(true);
    expect(manifest.routes['/'].modulepreload).toEqual(chunks);
    expect(manifest.routes['/other'].modulepreload).toEqual(chunks);
  });

  it('fails incompatible Cargo.lock before writes, then accepts renderer-first upgrades and inferred app', async () => {
    const {root, entry, outputDir} = fixture();
    writeFileSync(join(root, 'Cargo.toml'), '[package]\nname="ledger"\nversion="0.1.0"\n');
    const lock = join(root, 'Cargo.lock');
    const config = {app: undefined, entryPoints: [{entry, outfile: 'app.js'}], routes: {'/': {js: ['app'], css: []}}, outputDir};
    mkdirSync(outputDir); writeFileSync(join(outputDir, 'sentinel'), 'last good build');
    writeFileSync(lock, 'version=4\n[[package]]\nname="forma-server"\nversion="2.9.0"\n');
    const refused = await buildInChild(config, root, root);
    expect(refused.message).toContain('@getforma/build writer 3.0.0 is incompatible with forma-server 2.9.0');
    expect(refused.message).toContain('upgrade forma-server to at least 3.0.0');
    expect(readFileSync(join(outputDir, 'sentinel'), 'utf8')).toBe('last good build');
    expect(readdirSync(root).filter(name => name.includes('forma-staging'))).toEqual([]);
    writeFileSync(lock, 'version=4\n[[package]]\nname="forma-server"\nversion="3.1.0"\n');
    const accepted = await buildInChild(config, root, root);
    expect(accepted.message, accepted.output).toBeUndefined();
    expect(accepted.manifest?.app).toBe('ledger');
    expect(accepted.manifest?.writer).toBe('3.0.0');
    expect(existsSync(join(outputDir, 'sentinel'))).toBe(false);
  });

  it.each([false, true])('watches Cargo.lock and preserves valid output through incompatible rebuilds and recovery with splitting=%s', async codeSplitting => {
    const {root, entry, outputDir} = fixture();
    const lock = join(root, 'Cargo.lock');
    const setServer = (version: string) => writeFileSync(lock, `version=4\n[[package]]\nname="forma-server"\nversion="${version}"\n`);
    setServer('3.0.0');
    await watching({app: 'ledger', codeSplitting, entryPoints: [{entry, outfile: 'app.js'}], routes: {'/': {js: ['app'], css: []}}, outputDir}, async ({manifest, output, ready, change}) => {
      await ready();
      await vi.waitFor(() => expect(existsSync(join(outputDir, 'manifest.json')), output()).toBe(true));
      const original = readFileSync(join(outputDir, 'app.js'), 'utf8');
      const originalManifest = readFileSync(join(outputDir, 'manifest.json'), 'utf8');
      await change(() => setServer('2.9.0'));
      await vi.waitFor(() => expect(output()).toContain('incompatible with forma-server 2.9.0'), {timeout: 10_000});
      expect(readFileSync(join(outputDir, 'app.js'), 'utf8')).toBe(original);
      expect(readFileSync(join(outputDir, 'manifest.json'), 'utf8')).toBe(originalManifest);
      await change(() => writeFileSync(entry, 'export const message = "changed while refused";'));
      expect(readFileSync(join(outputDir, 'app.js'), 'utf8')).toBe(original);
      expect(readFileSync(join(outputDir, 'manifest.json'), 'utf8')).toBe(originalManifest);
      await change(() => setServer('3.1.0'));
      await vi.waitFor(() => expect(readFileSync(join(outputDir, 'app.js'), 'utf8')).toContain('changed while refused'), {timeout: 10_000});
      expect(manifest().writer).toBe('3.0.0');
      const recovered = readFileSync(join(outputDir, 'app.js'), 'utf8');
      await change(() => setServer('4.0.0'));
      await vi.waitFor(() => expect(output()).toContain('incompatible with forma-server 4.0.0'), {timeout: 10_000});
      expect(readFileSync(join(outputDir, 'app.js'), 'utf8')).toBe(recovered);
      const recoveredManifest = readFileSync(join(outputDir, 'manifest.json'), 'utf8');
      await change(() => writeFileSync(entry, 'export const message = "patch recovery";'));
      expect(readFileSync(join(outputDir, 'app.js'), 'utf8')).toBe(recovered);
      expect(readFileSync(join(outputDir, 'manifest.json'), 'utf8')).toBe(recoveredManifest);
      await change(() => setServer('3.0.99'));
      await vi.waitFor(() => expect(readFileSync(join(outputDir, 'app.js'), 'utf8')).toContain('patch recovery'), {timeout: 10_000});
      expect(manifest().assets['app.js'].immutable).toBe(false);
      expect(manifest().assets['app.js'].integrity).toBe(`sha384-${createHash('sha384').update(readFileSync(join(outputDir, 'app.js'))).digest('base64')}`);
    }, root);
  }, 30_000);

  it('checks the optional installed compiler floor independently of the renderer window', () => {
    expect(() => requireCompatibleCompiler([3, 1, 0], [3, 2, 0])).toThrow('installed compiler is 3.1.0');
    expect(requireCompatibleCompiler([3, 2, 0], [3, 1, 99])).toBeUndefined();
    expect(requireCompatibleCompiler([3, 2, 0], [3, 2, 99])).toBeUndefined();
  });
});

describe('SR24 production duplicate core reporting', () => {
  it.each([[false, '3.0.0-dev'], [true, '3.0.0-dev'], [false, '3.1.0'], [true, '3.1.0']] as const)('reports two physical copies with splitting=%s, second version=%s and previewFrame off', async (codeSplitting, secondVersion) => {
    const {root, entry, outputDir} = fixture();
    for (const name of ['one', 'two']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'package.json'), JSON.stringify({name: '@getforma/core', version: name === 'one' ? '3.0.0-dev' : secondVersion, type: 'module'}));
      writeFileSync(join(root, name, 'index.js'), `let value = 0; export function signal() { return ++value; }`);
    }
    writeFileSync(entry, 'import {signal as a} from "./one/index.js"; import {signal as b} from "./two/index.js"; export const values = [a(), b()];');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = {app: 'ledger', codeSplitting, entryPoints: [{entry, outfile: 'app.js'}], routes: {'/': {js: ['app'], css: []}}, outputDir};
    const result = await build(config);
    const diagnostics = result.diagnostics.filter(d => d.code === 'BUILD-816');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
    expect(diagnostics[0].message).toContain('3.0.0-dev');
    expect(diagnostics[0].message).toContain(secondVersion);
    for (const name of ['one', 'two']) expect(diagnostics[0].message).toContain(join(root, name));
    expect(warn.mock.calls.flat().filter(line => String(line).startsWith('BUILD-816:'))).toHaveLength(1);
    expect(readFileSync(join(outputDir, result.manifest.aliases['app.js']), 'utf8')).toContain('values');
    writeFileSync(entry, 'import {signal as a} from "./one/index.js"; import {signal as b} from "./one/index.js"; export const values = [a(), b()];');
    const single = await build(config);
    expect(single.diagnostics.filter(d => d.code === 'BUILD-816')).toEqual([]);
    // A second path to one physical package is not an independent runtime.
    symlinkSync(join(root, 'one'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(entry, 'import {signal as a} from "./one/index.js"; import {signal as b} from "./alias/index.js"; export const values = [a(), b()];');
    const linked = await build(config);
    expect(linked.diagnostics.filter(d => d.code === 'BUILD-816')).toEqual([]);
    expect(readFileSync(join(outputDir, single.manifest.aliases['app.js']), 'utf8')).toContain('values');
  });
});
