/** Optional compiler installation cannot silently downgrade a declared SSR route. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BuildConfig } from '../src/types';
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'forma-build-compiler-'));
  writeFileSync(join(root, 'home.ts'), 'export const home = 1;');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.resetModules();
});
afterEach(() => { vi.doUnmock('@getforma/compiler'); vi.restoreAllMocks(); rmSync(root, {recursive: true, force: true}); });
const config = (extra: Partial<BuildConfig> = {}): BuildConfig => ({app: 'fixture', entryPoints: [{entry: join(root, 'home.ts'), outfile: 'home.js'}], routes: {'/': {js: ['home'], css: []}}, outputDir: join(root, 'dist'), ssr: true, ...extra});

describe('optional compiler boundary', () => {
  it('refuses missing compiler for SSR before writes, while browser-only output remains supported', async () => {
    vi.doMock('@getforma/compiler', () => { throw Object.assign(new Error("Cannot find package '@getforma/compiler'"), {code: 'ERR_MODULE_NOT_FOUND'}); });
    const {build} = await import('../src/build');
    for (const strict of [false, true]) await expect(build(config({strict}))).rejects.toThrow('BUILD-801');
    expect(existsSync(join(root, 'dist'))).toBe(false);
    const result = await build(config({ssr: false}));
    expect(result.manifest.routes['/'].mode).toBe('browser');
    expect(result.manifest.routes['/'].ir).toBeUndefined();
    expect(readFileSync(join(root, 'dist', result.manifest.aliases['home.js']), 'utf8')).toContain('home');
  });
  it('refuses an installed compiler outside the window even for a browser build, preserving prior output', async () => {
    vi.doMock('@getforma/compiler', () => ({COMPILER_WRITER_VERSION: [2, 9, 0]}));
    const {build} = await import('../src/build');
    mkdirSync(join(root, 'dist')); writeFileSync(join(root, 'dist', 'sentinel'), 'prior valid build');
    for (const ssr of [false, true]) await expect(build(config({ssr}))).rejects.toThrow(/BUILD-809.*@getforma\/build 3\.0\.0.*installed compiler is 2\.9\.0/);
    expect(readFileSync(join(root, 'dist', 'sentinel'), 'utf8')).toBe('prior valid build');
  });
  it('refuses a pre-v3 compiler lacking writer metadata instead of silently skipping IR', async () => {
    vi.doMock('@getforma/compiler', () => ({formaSsrPlugin: () => ({name: 'old', setup() {}})}));
    const {build} = await import('../src/build');
    await expect(build(config())).rejects.toThrow('BUILD-809 installed @getforma/compiler has no compatible writer-version metadata');
    expect(existsSync(join(root, 'dist'))).toBe(false);
  });
});
