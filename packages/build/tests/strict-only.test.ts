import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from './helpers/named-build';
import { resolveDiagnosticOptions } from '../src/diagnostics';
import type { BuildConfig, BuildDiagnostic } from '../src/types';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(strict?: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'forma-strict-only-')); roots.push(root);
  const source = join(root, 'src'); mkdirSync(source);
  const stub = join(source, 'core.js'); writeFileSync(stub, 'export const h=()=>{};export const mount=()=>{};');
  const a = join(source, 'a.ts'), b = join(source, 'b.ts');
  const clean = "import { h, mount } from 'formajs';\nmount(() => h('main', null, 'benign'), '#app');\n";
  writeFileSync(a, clean); writeFileSync(b, clean);
  const config: BuildConfig = {
    entryPoints: [{ entry: a, outfile: 'a.js' }, { entry: b, outfile: 'b.js' }],
    routes: { '/a': { js: ['a'], css: [] }, '/b': { js: ['b'], css: [] } },
    ssr: true, outputDir: join(root, 'dist'), formaAlias: stub,
    diagnosticsJson: join(root, 'diagnostics.json'), ...(strict === undefined ? {} : { strict }),
  };
  const breakPages = () => {
    writeFileSync(a, "import { h, mount } from 'formajs';\nfunction unknown() { return 'https://example.test/'; }\nmount(() => h('main', null, h('a', { href: () => unknown() }, 'benign link')), '#app');\n");
    writeFileSync(b, "import { h, mount } from 'formajs';\nfunction unknown() { return 'title'; }\nmount(() => h('main', null, h('p', { title: unknown() }, 'benign text')), '#app');\n");
  };
  return { config, breakPages };
}

describe('3.0 strict-only publication', () => {
  it.each([undefined, false, true])('strict=%s refuses every unsupported page and preserves the previous product', async strict => {
    vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('FORMA_STRICT', '0');
    const { config, breakPages } = fixture(strict);
    await build(config);
    const previous = readFileSync(join(config.outputDir, 'manifest.json'), 'utf8');
    breakPages();
    let failure: (Error & { diagnostics: BuildDiagnostic[] }) | undefined;
    try { await build(config); } catch (error) { failure = error as typeof failure; }
    expect(failure?.name).toBe('FormaStrictBuildError');
    expect(failure?.diagnostics.map(d => [d.page, d.code, d.line, d.severity])).toEqual([
      ['a', 'BUILD-206', 3, 'error'], ['b', 'BUILD-207', 3, 'error'],
    ]);
    expect(failure?.message).toContain('browserOnly');
    expect(readFileSync(join(config.outputDir, 'manifest.json'), 'utf8')).toBe(previous);
    expect(JSON.parse(readFileSync(config.diagnosticsJson!, 'utf8')).strict).toBe(true);
  });

  it('accepts old false flags as no-ops while reporting the effective strict mode', () => {
    const { config } = fixture();
    for (const value of [undefined, '', '0', 'false', '1', 'true']) {
      expect(resolveDiagnosticOptions(config, { FORMA_STRICT: value }).strict).toBe(true);
      expect(resolveDiagnosticOptions({ ...config, strict: false }, { FORMA_STRICT: value }).strict).toBe(true);
    }
  });
});
