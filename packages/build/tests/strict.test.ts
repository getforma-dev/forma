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
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { build } from './helpers/named-build';
import { isInsideOutputDir, resolveDiagnosticOptions, writeDiagnosticsJson } from '../src/diagnostics';
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
    expect(failure!.message).toContain('packages/compiler/docs/subset.md');
    // A failed build leaves no output (FORMA-018's staging directory).
    expect(existsSync(outDir)).toBe(false);
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
    await build(config({ ready: page('ready', [`mount(() => h('main', null, 'previous'), '#app');`]) }));
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
    await expect(build(config(entries, { diagnosticsJson: beside }))).rejects.toThrow(/SSR diagnostics are errors/);
    expect(existsSync(join(tmpRoot, 'dist-diagnostics.json'))).toBe(true);
  }, 60_000);

  // FORMA-245 (FORMA-119 round 3). A report path outside outputDir may still
  // share an inode with a file inside it; writing through the path would
  // rewrite that served file.
  it('replaces a hard-linked report path instead of writing through it: the file inside outputDir keeps its bytes', async (ctx) => {
    await build(config({ ready: page('ready', [`mount(() => h('main', null, 'previous'), '#app');`]) }));
    const served = join(outDir, 'manifest.json');
    const before = readFileSync(served, 'utf8');
    const report = join(tmpRoot, 'reports', 'diagnostics.json');
    mkdirSync(join(tmpRoot, 'reports'));
    try {
      linkSync(served, report);
    } catch (error) {
      // A filesystem or account that cannot make hard links: nothing to test.
      if (['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes((error as NodeJS.ErrnoException).code ?? '')) ctx.skip();
      throw error;
    }
    expect(statSync(served).ino).toBe(statSync(report).ino);

    await expect(build(config(twoBrokenPages(), { strict: true, diagnosticsJson: report }))).rejects.toThrow(/SSR diagnostics are errors/);

    expect(readFileSync(served, 'utf8')).toBe(before);
    expect(JSON.parse(readFileSync(report, 'utf8')).diagnostics.map((d: BuildDiagnostic) => d.code)).toEqual(['BUILD-206', 'BUILD-207']);
    expect(statSync(report).ino).not.toBe(statSync(served).ino);
    expect(readdirSync(join(tmpRoot, 'reports'))).toEqual(['diagnostics.json']);
  }, 60_000);

  it('leaves no temporary file beside the report, and replaces an existing report whole', () => {
    const report = join(tmpRoot, 'reports', 'diagnostics.json');
    mkdirSync(join(tmpRoot, 'reports'));
    writeFileSync(report, 'x'.repeat(10_000));
    writeDiagnosticsJson(report, true, []);
    expect(JSON.parse(readFileSync(report, 'utf8'))).toEqual({ version: 1, strict: true, diagnostics: [] });
    expect(readdirSync(join(tmpRoot, 'reports'))).toEqual(['diagnostics.json']);
  });

  it('follows a report path that is a link to a file: the link stays a link, its target is replaced', (ctx) => {
    const real = join(tmpRoot, 'real.json');
    writeFileSync(real, 'old');
    const link = join(tmpRoot, 'report-link.json');
    try {
      symlinkSync(real, link, 'file');
    } catch (error) {
      // A Windows account without the symlink privilege: nothing to test.
      if (['EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) ctx.skip();
      throw error;
    }
    writeDiagnosticsJson(link, true, []);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, 'utf8')).strict).toBe(true);
    expect(readdirSync(tmpRoot).sort()).toEqual(['real.json', 'report-link.json', 'src']);
  });

  const posix = process.platform === 'win32' ? it.skip : it;

  posix('writes a device in place and does not replace it: /dev/null is still a character device, with no temporary file beside it', () => {
    const before = readdirSync('/dev').filter((name) => name.endsWith('.tmp'));
    writeDiagnosticsJson('/dev/null', true, []);
    expect(statSync('/dev/null').isCharacterDevice()).toBe(true);
    expect(readdirSync('/dev').filter((name) => name.endsWith('.tmp'))).toEqual(before);
  });

  posix('writes a FIFO in place: the reader gets the report and the FIFO stays a FIFO', async (ctx) => {
    const fifo = join(tmpRoot, 'report.fifo');
    try {
      execFileSync('mkfifo', [fifo]);
    } catch {
      ctx.skip();
    }
    const reader = spawn('cat', [fifo], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    reader.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    const done = new Promise<boolean>((resolveDone) => {
      reader.on('close', () => resolveDone(true));
      setTimeout(() => resolveDone(false), 5_000);
    });
    try {
      writeDiagnosticsJson(fifo, true, []);
      expect(await done).toBe(true);
      expect(JSON.parse(out).strict).toBe(true);
      expect(statSync(fifo).isFIFO()).toBe(true);
    } finally {
      reader.kill();
    }
  }, 20_000);

  posix('keeps the permission bits of the report it replaces', () => {
    const report = join(tmpRoot, 'diagnostics.json');
    writeFileSync(report, 'old');
    chmodSync(report, 0o640);
    writeDiagnosticsJson(report, true, []);
    expect(statSync(report).mode & 0o777).toBe(0o640);
    expect(JSON.parse(readFileSync(report, 'utf8')).version).toBe(1);
  });

  it('leaves nothing behind when the report path is a directory', () => {
    const report = join(tmpRoot, 'reports');
    mkdirSync(report);
    const beside = readdirSync(tmpRoot).sort();
    expect(() => writeDiagnosticsJson(report, true, [])).toThrow(/EISDIR|EPERM|illegal operation/);
    expect(readdirSync(tmpRoot).sort()).toEqual(beside);
    expect(readdirSync(report)).toEqual([]);
  });

  it('replaces a report path that is a link to nothing (it used to be created through the link)', (ctx) => {
    const missing = join(tmpRoot, 'missing.json');
    const link = join(tmpRoot, 'report-link.json');
    try {
      symlinkSync(missing, link, 'file');
    } catch (error) {
      if (['EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) ctx.skip();
      throw error;
    }
    writeDiagnosticsJson(link, true, []);
    expect(lstatSync(link).isSymbolicLink()).toBe(false);
    expect(JSON.parse(readFileSync(link, 'utf8')).strict).toBe(true);
    expect(existsSync(missing)).toBe(false);
  });

  posix('says a link that loops back on itself loops, rather than that it does not exist', () => {
    const link = join(tmpRoot, 'loop');
    symlinkSync(link, link);
    expect(() => writeDiagnosticsJson(join(link, 'd.json'), true, [])).toThrow(/needs the directory '.*loop', a symbolic link to '.*loop', which loops back on itself/);
  });

  it('refuses a report whose parent is a link to nothing, naming the link and where it points, before creating anything', async () => {
    const link = join(tmpRoot, 'reports');
    const gone = join(tmpRoot, 'gone');
    mkdirSync(gone);
    symlinkSync(gone, link, process.platform === 'win32' ? 'junction' : 'dir');
    rmSync(gone, { recursive: true });
    const report = join(link, 'nested', 'diagnostics.json');
    const beside = readdirSync(tmpRoot).sort();
    const named = /diagnosticsJson '.*diagnostics\.json' needs the directory '.*reports', a symbolic link to '.*gone', which does not exist/;

    // The build refuses with the other config problems, before staging or compiling.
    const error = await build(config(twoBrokenPages(), { diagnosticsJson: report })).then(() => undefined, (e: unknown) => e as Error);
    expect(error?.message).toMatch(/invalid config[\s\S]*diagnosticsJson/);
    expect(error?.message).toMatch(named);
    expect(error?.message).not.toMatch(/ENOENT/);
    expect(existsSync(outDir)).toBe(false);

    // The writer itself says the same when called directly.
    expect(() => writeDiagnosticsJson(report, true, [])).toThrow(named);

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(gone)).toBe(false);
    expect(readdirSync(tmpRoot).sort()).toEqual(beside);
  }, 30_000);

  it('still writes a report beneath a link that points at a directory, creating what is missing there', () => {
    const real = join(tmpRoot, 'real');
    mkdirSync(real);
    const link = join(tmpRoot, 'reports');
    symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
    writeDiagnosticsJson(join(link, 'nested', 'diagnostics.json'), true, []);
    expect(existsSync(join(real, 'nested', 'diagnostics.json'))).toBe(true);
  });

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

describe('isInsideOutputDir and Unicode normalization (FORMA-245)', () => {
  // macOS APFS treats canonically equivalent names (NFC `é` and NFD `e` plus a
  // combining accent) as one directory. The comparison is exercised with explicit
  // spellings so it runs on every platform; neither directory needs to exist.
  const nfc = 'caf\u00e9'.normalize('NFC');
  const nfd = 'caf\u00e9'.normalize('NFD');

  it('spells the two forms differently', () => {
    expect(nfc).not.toBe(nfd);
  });

  it('counts an NFD report inside an NFC outputDir that does not exist yet, and the reverse', () => {
    const root = mkdtempSync(join(tmpdir(), 'forma-build-nfc-'));
    try {
      expect(isInsideOutputDir(join(root, nfd, 'diag.json'), join(root, nfc))).toBe(true);
      expect(isInsideOutputDir(join(root, nfc, 'diag.json'), join(root, nfd))).toBe(true);
      expect(isInsideOutputDir(join(root, nfd), join(root, nfc))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('still tells a sibling or a longer name apart', () => {
    const root = mkdtempSync(join(tmpdir(), 'forma-build-nfc-'));
    try {
      expect(isInsideOutputDir(join(root, `${nfd}-reports`, 'diag.json'), join(root, nfc))).toBe(false);
      expect(isInsideOutputDir(join(root, 'reports', nfd), join(root, nfc))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('where strict comes from', () => {
  it('keeps accepted strict switches as no-ops and validates environment spelling', () => {
    const base = config({});
    expect(resolveDiagnosticOptions(base, {})).toEqual({ strict: true });
    expect(resolveDiagnosticOptions(base, { FORMA_STRICT: '1' })).toEqual({ strict: true });
    expect(resolveDiagnosticOptions(base, { FORMA_STRICT: 'true' })).toEqual({ strict: true });
    expect(resolveDiagnosticOptions(base, { FORMA_STRICT: '0' })).toEqual({ strict: true });
    expect(resolveDiagnosticOptions(base, { FORMA_STRICT: '' })).toEqual({ strict: true });
    // A switch that fails open passes the pages it was set to check: refused.
    expect(() => resolveDiagnosticOptions(base, { FORMA_STRICT: 'yes' })).toThrow(/FORMA_STRICT is 'yes'/);
    // An explicit compatibility flag cannot disable native publication checks.
    expect(resolveDiagnosticOptions({ ...base, strict: false }, { FORMA_STRICT: '1' })).toEqual({ strict: true });
    expect(resolveDiagnosticOptions({ ...base, strict: true }, {})).toEqual({ strict: true });
    expect(resolveDiagnosticOptions({ ...base, diagnosticsJson: 'a.json' }, {}))
      .toEqual({ strict: true, diagnosticsJson: 'a.json' });
  });

  it('applies FORMA_STRICT=1 to a build whose config does not set it', async () => {
    const entries = twoBrokenPages();
    vi.stubEnv('FORMA_STRICT', '1');
    try {
      await expect(build(config(entries))).rejects.toThrow(
        /2 SSR diagnostics are errors; 3.0 requires the published server-renderable subset/,
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
      await expect(build(config(entries))).rejects.toThrow(/2 SSR diagnostics are errors/);
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
      expect(json.strict).toBe(true);
      expect(json.diagnostics.map((d: BuildDiagnostic) => [d.page, d.code, d.line, d.severity])).toEqual([[name, code, 3, 'error']]);
      expect(existsSync(outDir)).toBe(false);
    }
  }, 30_000);
});
