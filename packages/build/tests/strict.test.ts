/**
 * Coded SSR diagnostics through the build: `--strict`, the JSON report and
 * `result.diagnostics` (FORMA-119; DR-1, N12, S6).
 *
 * The compiler's own conformance corpus pins each code at its line
 * (packages/compiler/tests/diagnostics-conformance.test.ts). This file pins
 * how advisory diagnostics become errors under strict mode and how mandatory
 * BUILD-610 refusals always fail while preserving reports and prior output.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { build } from './helpers/named-build';
import { resolveDiagnosticOptions } from '../src/diagnostics';
import type { BuildConfig, BuildDiagnostic } from '../src/types';

let tmpRoot: string;
let srcDir: string;
let outDir: string;
let warnings: string[];

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'forma-build-strict-'));
  srcDir = join(tmpRoot, 'src');
  outDir = join(tmpRoot, 'dist');
  mkdirSync(srcDir, { recursive: true });
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { warnings.push(args.map(String).join(' ')); });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  writeFileSync(join(srcDir, 'forma-stub.js'), [
    'export const h = () => {};',
    'export const mount = () => {};',
    'export const createSignal = (v) => [() => v, () => {}];',
    '',
  ].join('\n'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** A page per entry; each source line is one array element, so lines are known. */
function page(name: string, lines: string[]): string {
  const file = join(srcDir, `${name}.ts`);
  writeFileSync(file, [`import { h, mount, createSignal } from 'formajs';`, ...lines, ''].join('\n'));
  return file;
}

function config(entries: Record<string, string>, extra: Partial<BuildConfig> = {}): BuildConfig {
  return {
    entryPoints: Object.entries(entries).map(([name, entry]) => ({ entry, outfile: `${name}.js` })),
    routes: Object.fromEntries(Object.keys(entries).map((name) => [`/${name}`, { js: [name], css: [] }])),
    outputDir: outDir,
    formaAlias: join(srcDir, 'forma-stub.js'),
    ssr: true,
    ...extra,
  };
}

/** Two pages with advisory attribute diagnostics; strict mode promotes both. */
function twoBrokenPages() {
  return {
    home: page('home', [
      `function lookupClass() { return 'extra'; }`,
      `mount(() => h('main', null, h('div', { class: () => lookupClass() })), '#app');`,
    ]),
    about: page('about', [
      `function lookupName() { return 'pad'; }`,
      `mount(() => h('main', null, h('button', { title: 'Enable ' + lookupName() }, 'Go')), '#app');`,
    ]),
  };
}

describe('--strict', () => {
  it('S6: strict mode reports every advisory error with its code, file and line', async () => {
    const entries = twoBrokenPages();
    let failure: (Error & { diagnostics?: BuildDiagnostic[] }) | undefined;
    try {
      await build(config(entries, { strict: true }));
    } catch (err) {
      failure = err as Error & { diagnostics?: BuildDiagnostic[] };
    }
    expect(failure?.name).toBe('FormaStrictBuildError');
    // Both pages' errors, at once: the build compiled every page before failing.
    expect(failure!.diagnostics!.map((d) => [d.page, d.code, d.file, d.line, d.severity])).toEqual([
      ['home', 'BUILD-206', realpathSync(entries.home), 3, 'error'],
      ['about', 'BUILD-207', realpathSync(entries.about), 3, 'error'],
    ]);
    expect(failure!.message).toContain(`${entries.home}:3:`);
    expect(failure!.message).toContain('BUILD-206');
    expect(failure!.message).toContain(`${entries.about}:3:`);
    expect(failure!.message).toContain('BUILD-207');
    expect(failure!.message).toMatch(/why: .*\n {4}fix: /);
    expect(failure!.message).toContain('docs/DIAGNOSTICS.md');
    // A failed build leaves no output (FORMA-018's staging directory).
    expect(existsSync(outDir)).toBe(false);
  }, 30_000);

  it('without --strict the same build succeeds, prints its lines as before, and returns the diagnostics', async () => {
    const entries = twoBrokenPages();
    const result = await build(config(entries));
    expect(existsSync(join(outDir, 'manifest.json'))).toBe(true);
    expect(result.diagnostics.map((d) => [d.page, d.code, d.severity])).toEqual([
      ['home', 'BUILD-206', 'warning'],
      ['about', 'BUILD-207', 'warning'],
    ]);
    // One line each, in the 0.3.6 shape plus the code and the position (the
    // pages compile in parallel, so the lines come in either order).
    const irLines = warnings.filter((w) => w.includes('IR: '));
    expect(irLines).toHaveLength(2);
    expect(irLines.find((line) => line.includes('home.ts'))).toMatch(
      /^ {3}IR: BUILD-206 .*home\.ts:3:\d+/s,
    );
  }, 30_000);

  it('uses the required application identity without a legacy unnamed-worker diagnostic', async () => {
    const entries = { home: page('home', [`mount(() => h('main', null, 'clean'), '#app');`]) };
    const result = await build(config(entries, { strict: true, serviceWorker: 'on-demand' }));
    expect(result.diagnostics).toEqual([]);
    expect(result.manifest.app).toBe('fixture');
    expect(result.warnings.some((w) => w.startsWith('BUILD-802 '))).toBe(false);
  }, 30_000);

  it('passes closed aggregate defaults without the retired note', async () => {
    const entries = {
      home: page('home', [
        `const [rows] = createSignal([]);`,
        `mount(() => h('main', null, h('p', null, 'static')), '#app');`,
      ]),
    };
    const result = await build(config(entries, { strict: true }));
    expect(result.diagnostics).toEqual([]);
  }, 30_000);
});

describe('the JSON report', () => {
  it('pins its keys: the report, and each diagnostic', async () => {
    // A field may be added without a version change; renaming or removing one,
    // or changing what one means, increments `version` (DIAGNOSTICS.md).
    const entries = {
      home: page('home', [
        `function A() { return h('section', null, B()); }`,
        `function B() { return h('article', null, C()); }`,
        `function C() { return h('div', null, D()); }`,
        `function D() { return h('span', null, 'leaf'); }`,
        `mount(() => h('main', null, A()), '#app');`,
      ]),
    };
    const report = join(tmpRoot, 'diagnostics.json');
    await expect(build(config(entries, { diagnosticsJson: report }))).rejects.toThrow(/BUILD-610/);
    const json = JSON.parse(readFileSync(report, 'utf8'));
    expect(Object.keys(json)).toEqual(['version', 'strict', 'diagnostics']);
    expect(json.version).toBe(1);
    expect(json.diagnostics.map((d: BuildDiagnostic) => d.code)).toEqual(['BUILD-403', 'BUILD-610']);
    expect(Object.keys(json.diagnostics[0])).toEqual(
      ['code', 'severity', 'page', 'file', 'line', 'column', 'message', 'why', 'fix', 'chain'],
    );
    expect(Object.keys(json.diagnostics[0].chain[0])).toEqual(['component', 'file', 'line', 'column']);
    expect(json.diagnostics[0].chain.map((l: { component: string }) => l.component)).toEqual(['mount()', 'A', 'B', 'C', 'D']);
  }, 30_000);

  it('refuses a JSON report path inside outputDir, before anything is written', async () => {
    // Inside outputDir the report would be swapped away on success, written
    // into the previous build on failure (which must stay untouched, L-21),
    // and served with the assets. "Inside" as the filesystem sees it.
    const entries = twoBrokenPages();
    const refused = /diagnosticsJson '.*' is inside outputDir '.*': the build replaces outputDir whole/;

    // Does this filesystem ignore case? tmpRoot under another spelling.
    const flipped = tmpRoot.replace(/[A-Za-z](?=[^A-Za-z]*$)/, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    const foldsCase = (() => {
      try { return statSync(flipped).ino === statSync(tmpRoot).ino; } catch { return false; }
    })();
    const spelled = join(tmpRoot, 'DIST', 'diag.json');

    // No previous build yet: plain paths, `..` that is not a segment, and
    // (where the filesystem ignores case) another spelling of a directory
    // that does not exist yet, which no real path can canonicalize.
    const inside = [join(outDir, 'ssr-diagnostics.json'), join(outDir, 'reports', 'd.json'), outDir, join(outDir, '..diag.json')];
    for (const path of foldsCase ? [...inside, spelled] : inside) {
      await expect(build(config(entries, { diagnosticsJson: path })), path).rejects.toThrow(refused);
    }
    expect(existsSync(outDir)).toBe(false);

    // A live previous build, and a strict build that fails: the report must
    // not reach it through a symlink (a junction on Windows) or, where the
    // filesystem ignores case, through another spelling.
    await build(config(entries));
    const before = readFileSync(join(outDir, 'manifest.json'), 'utf8');
    const link = join(tmpRoot, 'reports');
    symlinkSync(outDir, link, process.platform === 'win32' ? 'junction' : 'dir');
    for (const path of [join(link, 'diag.json'), ...(foldsCase ? [spelled] : [])]) {
      await expect(build(config(entries, { strict: true, diagnosticsJson: path })), path).rejects.toThrow(refused);
    }
    expect(existsSync(join(outDir, 'diag.json'))).toBe(false);
    expect(readFileSync(join(outDir, 'manifest.json'), 'utf8')).toBe(before);
    if (!foldsCase) {
      // A case-sensitive filesystem: DIST is another directory, beside dist.
      await expect(build(config(entries, { strict: true, diagnosticsJson: spelled }))).rejects.toThrow(/SSR diagnostics are errors/);
      expect(existsSync(spelled)).toBe(true);
    }

    // Beside it is fine, `..` as a segment included.
    const beside = join(outDir, '..', 'dist-diagnostics.json');
    await build(config(entries, { diagnosticsJson: beside }));
    expect(existsSync(join(tmpRoot, 'dist-diagnostics.json'))).toBe(true);
  }, 60_000);

  it('is written on request, also when --strict fails the build', async () => {
    const entries = twoBrokenPages();
    const report = join(tmpRoot, 'reports', 'ssr-diagnostics.json');
    await expect(build(config(entries, { strict: true, diagnosticsJson: report }))).rejects.toThrow();
    const json = JSON.parse(readFileSync(report, 'utf8'));
    expect(json.version).toBe(1);
    expect(json.strict).toBe(true);
    expect(json.diagnostics.map((d: BuildDiagnostic) => d.code)).toEqual(['BUILD-206', 'BUILD-207']);
    for (const d of json.diagnostics as BuildDiagnostic[]) {
      for (const key of ['code', 'severity', 'page', 'file', 'line', 'column', 'message', 'why', 'fix']) {
        expect(d, key).toHaveProperty(key);
      }
      expect(d.line).toBe(3);
      expect(d.column).toBeGreaterThan(0);
    }
  }, 30_000);
});

describe('where strict comes from', () => {
  it('takes strict from the config, else from FORMA_STRICT, and reads no command-line flag', () => {
    const base = config({});
    expect(resolveDiagnosticOptions(base, {})).toEqual({ strict: false });
    expect(resolveDiagnosticOptions(base, { FORMA_STRICT: '1' })).toEqual({ strict: true });
    expect(resolveDiagnosticOptions(base, { FORMA_STRICT: 'true' })).toEqual({ strict: true });
    expect(resolveDiagnosticOptions(base, { FORMA_STRICT: '0' })).toEqual({ strict: false });
    expect(resolveDiagnosticOptions(base, { FORMA_STRICT: '' })).toEqual({ strict: false });
    // A switch that fails open passes the pages it was set to check: refused.
    expect(() => resolveDiagnosticOptions(base, { FORMA_STRICT: 'yes' })).toThrow(/FORMA_STRICT is 'yes'/);
    // The config wins over the environment, both ways.
    expect(resolveDiagnosticOptions({ ...base, strict: false }, { FORMA_STRICT: '1' })).toEqual({ strict: false });
    expect(resolveDiagnosticOptions({ ...base, strict: true }, {})).toEqual({ strict: true });
    expect(resolveDiagnosticOptions({ ...base, diagnosticsJson: 'a.json' }, {}))
      .toEqual({ strict: false, diagnosticsJson: 'a.json' });
  });

  it('applies FORMA_STRICT=1 to a build whose config does not set it', async () => {
    const entries = twoBrokenPages();
    vi.stubEnv('FORMA_STRICT', '1');
    try {
      await expect(build(config(entries))).rejects.toThrow(
        /strict mode \(strict: true or FORMA_STRICT=1\): 2 SSR diagnostics are errors; without it they are warnings/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30_000);

  it('ignores a --strict on the command line of the process that calls build()', async () => {
    // Another tool's flag (a wrapper, a dev server, a worker inheriting argv)
    // must not change Forma's build (FORMA-119's review).
    const entries = twoBrokenPages();
    const argv = process.argv;
    process.argv = [...argv, '--strict', '--diagnostics-json=never.json'];
    try {
      const result = await build(config(entries));
      expect(result.diagnostics.map((d) => d.severity)).toEqual(['warning', 'warning']);
      expect(existsSync('never.json')).toBe(false);
    } finally {
      process.argv = argv;
    }
  }, 30_000);
});

describe('--strict in watch mode', () => {
  it('keeps a page with an error unpublished, says why, and publishes it once fixed', async () => {
    const { watching } = await import('./helpers/watch');
    const home = page('home', [
      `const helpers = { extra: () => h('em', null, 'x') };`,
      `mount(() => h('main', null, h('div', null, helpers.extra())), '#app');`,
    ]);
    await watching(config({ home }, { strict: true }), async ({ output, manifest, change }) => {
      await vi.waitFor(() => {
        expect(output()).toMatch(/BUILD-610.*helpers\.extra/);
        expect(output()).toContain('[watch] build finished');
      }, { timeout: 10_000 });
      expect(existsSync(join(outDir, 'home.ir'))).toBe(false);

      expect(existsSync(join(outDir, 'manifest.json'))).toBe(false);
      await change(() => { page('home', [`mount(() => h('main', null, h('div', null, 'fixed')), '#app');`]); });
      await vi.waitFor(() => {
        expect(existsSync(join(outDir, manifest().aliases['home.ir']))).toBe(true);
        expect(manifest().routes['/home']).toMatchObject({mode:'ssr',js:[]});
        expect(manifest().aliases['home.js']).toBeUndefined();
      }, { timeout: 10_000 });
    });
  }, 30_000);
});

describe('FORMA-182 value rules 6 and 7 without --strict', () => {
  it('reports BUILD-614 (a boolean in text) and BUILD-615 (a condition that is not boolean-typed) as errors, as BUILD-610 to 613 are', async () => {
    // Both are mandatory refusals (docs/DIAGNOSTICS.md: "an error, and an
    // error without strict mode"); a default build fails on them, so its
    // report must not label them warnings.
    const entries = {
      text: page('text', [
        `const [done] = createSignal(false);`,
        `mount(() => h('main', null, h('p', null, () => done())), '#app');`,
      ]),
      condition: page('condition', [
        `const [count] = createSignal(0);`,
        `mount(() => h('main', null, () => count() ? h('b', null, 'some') : h('i', null, 'none')), '#app');`,
      ]),
    };
    for (const [name, code] of [['text', 'BUILD-614'], ['condition', 'BUILD-615']] as const) {
      const report = join(tmpRoot, `${name}-diagnostics.json`);
      let failure: (Error & { diagnostics?: BuildDiagnostic[] }) | undefined;
      try {
        await build(config({ [name]: entries[name] }, { strict: false, diagnosticsJson: report }));
      } catch (err) {
        failure = err as Error & { diagnostics?: BuildDiagnostic[] };
      }
      expect(failure, name).toBeDefined();
      expect(String(failure)).toContain(code);
      const json = JSON.parse(readFileSync(report, 'utf8'));
      expect(json.strict).toBe(false);
      expect(json.diagnostics.map((d: BuildDiagnostic) => [d.page, d.code, d.line, d.severity])).toEqual([[name, code, 3, 'error']]);
      expect(existsSync(outDir)).toBe(false);
    }
  }, 30_000);
});
