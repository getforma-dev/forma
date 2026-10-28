import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as esbuild from 'esbuild';
import { collectDiagnostics } from '../src/diagnostics';
import { formaSsrPlugin, generateRealIr } from '../src/esbuild-ssr-plugin';
// @ts-expect-error Shared JS corpus verifier has no declaration file.
import { assertCurrentFmir, packageWriter } from '../../../scripts/fmir-corpus.mjs';

const ROOT = resolve(__dirname, 'fixtures/conformance/composition-canvas');
const FROZEN = resolve(__dirname, '../../../crates/forma-server/tests/fixtures/composition-canvas');
const version = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')).version;
afterEach(() => vi.restoreAllMocks());

async function strictBuild(variant = '') {
  const entry = join(ROOT, variant, 'app.tsx'), outDir = mkdtempSync(join(tmpdir(), 'forma-canvas-'));
  try {
    return await esbuild.build({ absWorkingDir: resolve(__dirname, '../../..'), entryPoints: [entry], bundle: true, write: false, outdir: outDir,
      format: 'esm', packages: 'external', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment', logLevel: 'silent',
      plugins: [formaSsrPlugin({ page: 'home', outDir, entryPoint: entry, strict: true })] });
  } finally { rmSync(outDir, { recursive: true, force: true }); }
}

describe('composition-canvas native conformance', () => {
  it('strictly admits one Canvas without diagnostics and emits the actual Rust fixture', async () => {
    const { result, diagnostics } = collectDiagnostics(() => generateRealIr(join(ROOT, 'app.tsx')));
    expect(diagnostics).toEqual([]);
    expect(result!.islands.map(island => island.name)).toEqual(['Canvas']);
    const frozen = readFileSync(join(FROZEN, 'home.ir'));
    assertCurrentFmir({ name: 'composition-canvas', bytes: result!.binary, frozenBytes: frozen, expectedVersion: packageWriter(version) });
    const manifest = JSON.parse(readFileSync(join(FROZEN, 'manifest.json'), 'utf8'));
    expect(manifest.assets['home.ir'].integrity).toBe(`sha384-${createHash('sha384').update(frozen).digest('base64')}`);
    expect(manifest.assets['app.js'].integrity).toBe(`sha384-${createHash('sha384').update(readFileSync(join(FROZEN, 'app.js'))).digest('base64')}`);
    expect(manifest.routes['/'].js).toEqual(['app.js']);
    const build = await strictBuild();
    expect(build.warnings).toEqual([]);
    expect(build.outputFiles!.find(file => file.path.endsWith('.js'))!.text).toBe(readFileSync(join(FROZEN, 'app.js'), 'utf8'));
    expect(build.outputFiles!.some(file => file.text.includes('activateIslands'))).toBe(true);
    expect(build.outputFiles!.every(file => !file.text.includes('"#app"'))).toBe(true);
  });

  it.each([['enum-condition', 'BUILD-610'], ['deep-composition', 'BUILD-403']])('%s refuses by name and never publishes a native product', async (variant, code) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result, diagnostics } = collectDiagnostics(() => {
      try { return generateRealIr(join(ROOT, variant, 'app.tsx')); } catch { return null; }
    });
    expect(result).toBeNull();
    expect(diagnostics.map(diagnostic => diagnostic.code)).toContain(code);
    expect(diagnostics.find(diagnostic => diagnostic.code === code)?.line).toBeGreaterThan(0);
    await expect(strictBuild(variant)).rejects.toMatchObject({ errors: expect.arrayContaining([expect.objectContaining({ id: code })]) });
    // The passing sibling is the same declared-data rendering contract.
    expect((await strictBuild()).warnings).toEqual([]);
  });
});
