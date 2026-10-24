import { COMPILER_WRITER_VERSION, readFmirContainer } from '../../compiler/src/fmir';
import { SECTION_ISLANDS } from '../../compiler/src/fmir-constants';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { build } from './helpers/named-build';
import * as publicApi from '../src/index';
import type { BuildConfig, AssetManifest } from '../src/types';
import { APP_NAME_VECTORS } from './helpers/app-name-vectors';
import { buildInChild } from './helpers/child-build';
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
  mkdirSync,
  readdirSync,
  chmodSync,
  lstatSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { delimiter, join, sep } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------
//
// This replaces ten "exports X type" tests that assigned an object literal to a
// typed const and asserted a field of the literal they had just written. Vitest
// strips types without checking them, so those ran as `expect('app.js').toBe(
// 'app.js')` — they passed with build.ts deleted. Types are checked by
// `tsc --noEmit` in CI; what a runtime test can pin is the VALUE surface.

describe('@getforma/build public API', () => {
  it('exports exactly the documented runtime surface', () => {
    // Two-sided: a dropped export fails, and so does an undocumented addition.
    expect(Object.keys(publicApi).sort()).toEqual(['build']);
    expect(typeof publicApi.build).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Functional tests — actually run build() against temp directories
// ---------------------------------------------------------------------------

describe('@getforma/build — functional', () => {
  let tmpRoot: string;
  let srcDir: string;
  let outDir: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'forma-build-test-'));
    srcDir = join(tmpRoot, 'src');
    outDir = join(tmpRoot, 'dist');
    mkdirSync(srcDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ---- Test 1: Full pipeline produces manifest.json ----------------------
  it('full pipeline produces manifest.json with expected fields', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: {
        '/': { js: ['app'], css: [] },
      },
      outputDir: outDir,
    };

    const result = await build(config);

    // manifest.json must exist on disk
    const manifestPath = join(outDir, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest: AssetManifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    );

    // Required top-level fields
    expect(manifest).toHaveProperty('version');
    expect(manifest).toHaveProperty('build');
    expect(manifest).toHaveProperty('assets');
    expect(manifest).toHaveProperty('routes');

    expect(manifest.version).toBe(2);
    expect(typeof manifest.build).toBe('string');
    expect(manifest.build.length).toBeGreaterThan(0);

    // The original "app.js" should be hashed to "app.<8hex>.js"
    const hashedAppJs = manifest.aliases['app.js'];
    expect(hashedAppJs).toBeDefined();
    expect(hashedAppJs).toMatch(/^app\.[0-9a-f]{8}\.js$/);

    // Result object should agree with disk manifest
    expect(result.manifest.build).toBe(manifest.build);
    expect(result.warnings).toEqual([]);
    expect(readFileSync(join(outDir, 'sw.js'), 'utf8')).toContain(
      `const CACHE_NAME = "forma:fixture:${manifest.build.slice(0, 12)}";`,
    );
  }, 15_000);

  it('watch output wires the network-only worker to its unhashed dev manifest', async () => {
    const cssFile = join(srcDir, 'app.css');
    writeFileSync(cssFile, 'main { color: red; }');
    // A CSS-only route exercises real watch-mode orchestration without leaving
    // an esbuild watcher alive after the test finishes.
    const result = await build({
      entryPoints: [],
      routes: { '/': { js: [], css: ['app'] } },
      cssEntries: [{ input: cssFile, outfile: 'app.css' }],
      outputDir: outDir,
      watch: true,
    });
    expect(result.manifest.build).toBe('dev');
    expect(result.manifest.routes['/'].css).toEqual(['app.css']);
    const worker = readFileSync(join(outDir, 'sw.js'), 'utf8');
    expect(worker).toContain("fetch(event.request, { cache: 'no-store' })");
    expect(worker).toContain("name.startsWith('forma-')");
    expect(worker).not.toContain('caches.open');
  });

  // ---- Test 2: Content-hashed filenames exist on disk --------------------
  it('content-hashed filenames actually exist on disk', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const greeting = "hello";\n');

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
    };

    await build(config);

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );

    const hashedFilename = manifest.aliases['app.js'];
    expect(hashedFilename).toBeDefined();

    // The hashed file must actually exist on disk
    const hashedPath = join(outDir, hashedFilename);
    expect(existsSync(hashedPath)).toBe(true);

    // The ORIGINAL unhashed name should NOT exist (it was renamed)
    expect(existsSync(join(outDir, 'app.js'))).toBe(false);
  }, 15_000);

  // ---- Test 3: Compressed files are generated ----------------------------
  it('generates .br and .gz compressed files for JS output', async () => {
    // Use enough content so compressed versions are smaller than original.
    // Generate valid TS with unique variable names so esbuild doesn't error.
    const entryFile = join(srcDir, 'app.ts');
    const lines = Array.from({ length: 200 }, (_, i) =>
      `export const var_${i} = "some repeated content for compression testing ${i}";`,
    );
    writeFileSync(entryFile, lines.join('\n') + '\n');

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
    };

    await build(config);

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );

    const hashedJs = manifest.aliases['app.js'];
    expect(hashedJs).toBeDefined();

    // .br and .gz should exist alongside the hashed file
    expect(existsSync(join(outDir, `${hashedJs}.br`))).toBe(true);
    expect(existsSync(join(outDir, `${hashedJs}.gz`))).toBe(true);
  }, 15_000);

  // ---- Test 4: Font copying works ----------------------------------------
  it('copies .woff2 font files from fontDir to outputDir', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    // Create a fake font dir with a .woff2 file
    const fontDir = join(tmpRoot, 'fonts');
    mkdirSync(fontDir, { recursive: true });
    writeFileSync(join(fontDir, 'inter.woff2'), 'fake-woff2-data');

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
      fontDir,
    };

    await build(config);

    // The font file should be copied to the output directory
    expect(existsSync(join(outDir, 'inter.woff2'))).toBe(true);
    expect(readFileSync(join(outDir, 'inter.woff2'), 'utf8')).toBe(
      'fake-woff2-data',
    );

    // The manifest's route should reference the font
    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );
    expect(manifest.routes['/'].fonts).toContain('inter.woff2');
  }, 15_000);

  // ---- Test 5: Multiple entry points get separate hashed files -----------
  it('multiple entry points produce separate hashed assets', async () => {
    const appFile = join(srcDir, 'app.ts');
    const dashFile = join(srcDir, 'dashboard.ts');
    writeFileSync(appFile, 'export const app = "app";\n');
    writeFileSync(dashFile, 'export const dash = "dashboard";\n');

    const config: BuildConfig = {
      entryPoints: [
        { entry: appFile, outfile: 'app.js' },
        { entry: dashFile, outfile: 'dashboard.js' },
      ],
      routes: {
        '/': { js: ['app'], css: [] },
        '/dashboard': { js: ['dashboard'], css: [] },
      },
      outputDir: outDir,
    };

    await build(config);

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );

    // Both assets should be present and hashed
    const hashedApp = manifest.aliases['app.js'];
    const hashedDash = manifest.aliases['dashboard.js'];

    expect(hashedApp).toBeDefined();
    expect(hashedDash).toBeDefined();
    expect(hashedApp).toMatch(/^app\.[0-9a-f]{8}\.js$/);
    expect(hashedDash).toMatch(/^dashboard\.[0-9a-f]{8}\.js$/);

    // They should have DIFFERENT hashes (different content)
    expect(hashedApp).not.toBe(hashedDash);

    // Both hashed files should exist on disk
    expect(existsSync(join(outDir, hashedApp))).toBe(true);
    expect(existsSync(join(outDir, hashedDash))).toBe(true);

    // Routes should reference the correct hashed files
    expect(manifest.routes['/'].js).toEqual([hashedApp]);
    expect(manifest.routes['/dashboard'].js).toEqual([hashedDash]);
  }, 15_000);

  // ---- Test 6: Tailwind entries run the locally installed CLI ------------
  it('runs a locally installed @tailwindcss/cli via node (no npx, no shell)', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    const cssFile = join(srcDir, 'main.css');
    writeFileSync(cssFile, '.a { color: red; }\n');

    // Fake @tailwindcss/cli installed in the project's node_modules — the
    // build must resolve it from cwd and run its bin script with
    // process.execPath, which works identically on POSIX and Windows.
    const cliDir = join(tmpRoot, 'node_modules', '@tailwindcss', 'cli');
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(
      join(cliDir, 'package.json'),
      JSON.stringify({
        name: '@tailwindcss/cli',
        version: '0.0.0-test',
        bin: { tailwindcss: './cli.mjs' },
      }),
    );
    writeFileSync(
      join(cliDir, 'cli.mjs'),
      [
        `import { readFileSync, writeFileSync } from 'node:fs';`,
        `const args = process.argv.slice(2);`,
        `const input = args[args.indexOf('-i') + 1];`,
        `const output = args[args.indexOf('-o') + 1];`,
        `writeFileSync(output, '/* built-by-fake-tailwind */\\n' + readFileSync(input, 'utf8'));`,
      ].join('\n'),
    );

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: ['main'] } },
      cssEntries: [{ input: cssFile, outfile: 'main.css', tailwind: true }],
      outputDir: outDir,
    };

    // Resolution starts from cwd, so run the build from the fake project root
    const prevCwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await build(config);
    } finally {
      process.chdir(prevCwd);
    }

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );

    const hashedCss = manifest.aliases['main.css'];
    expect(hashedCss).toBeDefined();
    expect(hashedCss).toMatch(/^main\.[0-9a-f]{8}\.css$/);

    const cssOut = readFileSync(join(outDir, hashedCss), 'utf8');
    expect(cssOut).toContain('/* built-by-fake-tailwind */');
    expect(cssOut).toContain('.a { color: red; }');

    expect(manifest.routes['/'].css).toEqual([hashedCss]);
  }, 15_000);

  it('refuses a missing local Tailwind CLI without fetching a tool or replacing existing output', async () => {
    const entryFile = join(srcDir, 'app.ts');
    const cssFile = join(srcDir, 'main.css');
    writeFileSync(entryFile, 'export const x = 1;\n');
    writeFileSync(cssFile, '.safe { color: green; }\n');
    mkdirSync(outDir);
    writeFileSync(join(outDir, 'old.txt'), 'previous complete build');
    // A local npx stand-in prevents the pre-fix path from accessing a network.
    const bin = join(tmpRoot, 'bin');
    const marker = join(tmpRoot, 'fetched-tool');
    mkdirSync(bin);
    const stub = join(bin, 'npx.mjs');
    writeFileSync(stub, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'npx ran');\nprocess.exit(86);\n`);
    writeFileSync(join(bin, 'npx'), `#!${process.execPath}\nimport ${JSON.stringify(stub)};\n`);
    chmodSync(join(bin, 'npx'), 0o755);
    writeFileSync(join(bin, 'npx.cmd'), `@"${process.execPath}" "${stub}" %*\r\n`);
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}${delimiter}${oldPath ?? ''}`;
    const oldCwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await expect(build({
        entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
        routes: { '/': { js: ['app'], css: ['main'] } },
        cssEntries: [{ input: cssFile, outfile: 'main.css', tailwind: true }],
        outputDir: outDir,
      })).rejects.toThrow('Install @tailwindcss/cli locally');
      expect(existsSync(marker)).toBe(false);
      expect(readFileSync(join(outDir, 'old.txt'), 'utf8')).toBe('previous complete build');
      expect(readdirSync(outDir)).toEqual(['old.txt']);
    } finally {
      process.chdir(oldCwd);
      process.env.PATH = oldPath;
    }
  });

  // ---- Test 7: Build creates output directory if it doesn't exist --------
  it('creates outputDir if it does not already exist', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    // Point to a deeply nested dir that doesn't exist yet
    const deepOutDir = join(tmpRoot, 'nested', 'deep', 'dist');
    expect(existsSync(deepOutDir)).toBe(false);

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: deepOutDir,
    };

    await build(config);

    // The directory should now exist with manifest inside
    expect(existsSync(deepOutDir)).toBe(true);
    expect(existsSync(join(deepOutDir, 'manifest.json'))).toBe(true);
  }, 15_000);

  // ---- Test 8: serverInlined keeps the unhashed copy ----------------------
  it('keeps an unhashed copy of a serverInlined asset and hashes it too', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
      serverInlined: ['app.js'],
    };

    await build(config);

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );

    // Both names exist and hold identical bytes — the server inlines the
    // unhashed one, the browser fetches the hashed one.
    expect(existsSync(join(outDir, 'app.js'))).toBe(true);
    expect(readFileSync(join(outDir, manifest.aliases['app.js']!), 'utf8')).toBe(
      readFileSync(join(outDir, 'app.js'), 'utf8'),
    );
    // The route still points at the hashed name, not the inlined copy.
    expect(manifest.routes['/']!.js).toEqual([manifest.aliases['app.js']]);
  }, 15_000);

  // ---- Test 9: budget warnings ------------------------------------------
  it('reports a budget warning on the result AND still writes the manifest', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(
      entryFile,
      Array.from({ length: 400 }, (_, i) => `export const v${i} = "${i}-${'x'.repeat(40)}";`).join('\n'),
    );

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
      budgetThreshold: 128,
    };

    const result = await build(config);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Budget exceeded: /');
    // A budget warning is advisory: the build still completes.
    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );
    expect(manifest.routes['/']!.total_size_br).toBeGreaterThan(128);
    expect(manifest.routes['/']!.budget_warn_threshold).toBe(128);
  }, 15_000);

  // ---- Test 10/11: config validation ------------------------------------
  it('rejects a route that names an asset no entry produces', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');
    writeFileSync(join(outDir, '..', 'sentinel'), 'x'); // outDir does not exist yet

    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      // 'dashboard' is a typo for 'app', and 'main' has no cssEntry.
      routes: { '/': { js: ['dashboard'], css: ['main'] } },
      outputDir: outDir,
    };

    await expect(build(config)).rejects.toThrow(
      /routes\['\/'\]\.js names 'dashboard'[\s\S]*routes\['\/'\]\.css names 'main'/,
    );
    // Validation runs BEFORE the output directory is cleaned, so a config typo
    // never destroys the previous build.
    expect(existsSync(outDir)).toBe(false);
  }, 15_000);

  it('rejects an outfile that is a path rather than a filename', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    const config: BuildConfig = {
      // esbuild would happily write dist/pages/app.js, but the hashing pass
      // only reads the top level of outputDir — the asset would vanish from
      // the manifest and the route would 404 in production.
      entryPoints: [{ entry: entryFile, outfile: 'pages/app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
    };

    await expect(build(config)).rejects.toThrow(/contains a path separator/);
  }, 15_000);

  it('rejects two entryPoints that share an outfile', async () => {
    const first = join(srcDir, 'first.ts');
    const second = join(srcDir, 'second.ts');
    writeFileSync(first, 'export const first = 1;\n');
    writeFileSync(second, 'export const second = 2;\n');

    const config: BuildConfig = {
      // Both bundles would be written to dist/app.js, and the route would
      // serve whichever build finished last.
      entryPoints: [
        { entry: first, outfile: 'app.js' },
        { entry: second, outfile: 'app.js' },
      ],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
    };

    await expect(build(config)).rejects.toThrow(
      "entryPoints: duplicate outfile 'app.js'",
    );
    expect(existsSync(outDir)).toBe(false);
  }, 15_000);

  // A JavaScript config (or a TypeScript one run through tsx, which strips
  // types without checking them) can omit a route's `css` or `js`. Validation
  // used to iterate both unguarded and threw `TypeError: mapping.css is not
  // iterable`, which names neither the route nor the key.
  async function rejection(config: unknown): Promise<Error> {
    const outcome = await build(config as BuildConfig).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome).not.toBeInstanceOf(TypeError);
    return outcome as Error;
  }

  it('rejects a route without css, naming the route', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    const error = await rejection({
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'] } },
      outputDir: outDir,
    });

    expect(error.message).toContain('@getforma/build: invalid config');
    expect(error.message).toContain(
      "routes['/'].css is missing: list the route's CSS base names, or [] for none",
    );
    expect(existsSync(outDir)).toBe(false);
  }, 15_000);

  it('rejects a route whose js is missing or not an array, naming each route', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');

    const error = await rejection({
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      // A string is iterable, so `js: 'app'` used to be read letter by letter
      // ("names 'a', but no entryPoint produces 'a.js'").
      routes: { '/': { css: [] }, '/admin': { js: 'app', css: [] } },
      outputDir: outDir,
    });

    expect(error.message).toContain(
      "routes['/'].js is missing: list the route's JS base names, or [] for none",
    );
    expect(error.message).toContain(
      "routes['/admin'].js is not an array: list the route's JS base names, or [] for none",
    );
    expect(error.message).not.toContain("names 'a'");
    expect(existsSync(outDir)).toBe(false);
  }, 15_000);

  it('rejects an unknown serviceWorker value, naming it', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');
    const config = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
    };

    // A JavaScript config with a near miss used to get the precache worker
    // silently.
    const error = await rejection({ ...config, serviceWorker: 'ondemand' });
    expect(error.message).toContain(
      "serviceWorker is 'ondemand': use 'on-demand' (the default); precache was removed in v3",
    );
    expect(existsSync(outDir)).toBe(false);

    // Explicit legacy mode refuses before output; default and on-demand build.
    const legacy = await rejection({ ...config, serviceWorker: 'precache' });
    expect(legacy.message).toContain('precache was removed in v3');
    expect(existsSync(outDir)).toBe(false);
    for (const serviceWorker of [undefined, 'on-demand'] as const) {
      await build({ ...config, serviceWorker });
      expect(existsSync(join(outDir, 'sw.js'))).toBe(true);
    }
  }, 15_000);

  it('names the worker\'s cache per application and build, and gives it a waiting upgrade', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');
    const config: BuildConfig = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
      app: 'ledger',
    };
    for (const serviceWorker of [undefined, 'on-demand'] as const) {
      const { manifest } = await build({ ...config, serviceWorker });
      const worker = readFileSync(join(outDir, 'sw.js'), 'utf8');
      // The name forma-server's sw::ServiceWorker::for_app("ledger") retires.
      expect(worker).toContain(`const CACHE_NAME = "forma:ledger:${manifest.build.slice(0, 12)}";`);
      expect(worker).not.toContain('skipWaiting');
      expect(worker).not.toContain('clients.claim');
    }
  }, 15_000);

  it('rejects an application name forma-server cannot take, naming it', async () => {
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(entryFile, 'export const x = 1;\n');
    const config = {
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
    };
    // The shared table (forma-server's for_app takes the same), plus values a
    // JavaScript config could hold that are not strings at all.
    for (const app of [...APP_NAME_VECTORS.refused, 42, null, Object.create(null)]) {
      const error = await rejection({ ...config, app });
      // Printed escaped, as forma-server's {:?} does: control characters and
      // lookalikes stay visible.
      const shown = typeof app === 'string' ? JSON.stringify(app) : String(JSON.stringify(app) ?? typeof app);
      expect(error.message, shown).toContain(`app is ${shown}`);
      expect(error.message).toContain('sw::ServiceWorker::for_app');
      expect(existsSync(outDir)).toBe(false);
    }
    // Two-sided: every name the grammar accepts builds, its trailing-hyphen
    // and one-character edges included.
    for (const app of APP_NAME_VECTORS.accepted) {
      await build({ ...config, app });
      expect(readFileSync(join(outDir, 'sw.js'), 'utf8')).toContain(`"forma:${app}:`);
    }
  }, 60_000);

  it('writes a named manifest and worker without the retired unnamed-worker warning', async () => {
    const entry = join(srcDir, 'app.ts'); writeFileSync(entry, 'export const x = 1;');
    for (const serviceWorker of [undefined, 'on-demand'] as const) {
      const result = await build({entryPoints: [{entry, outfile: 'app.js'}], routes: {'/': {js: ['app'], css: []}}, outputDir: outDir, app: 'ledger', serviceWorker});
      expect(result.manifest.app).toBe('ledger');
      expect(result.warnings.filter(w => w.includes('BUILD-802'))).toEqual([]);
      expect(readFileSync(join(outDir, 'sw.js'), 'utf8')).toContain(`forma:ledger:${result.manifest.build.slice(0, 12)}`);
    }
  });

});

// ---------------------------------------------------------------------------
// Atomic output: a failed build never leaves half a build (L-21, FORMA-018)
// ---------------------------------------------------------------------------
//
// The application embeds `outputDir` in its binary (rust-embed), so whatever is
// there when `cargo build` runs ships. The build used to empty `outputDir`
// first and write into it step by step, so a failure after writing an asset (here the second CSS input)
// left the previous good build deleted and half of the new one in its place.

/** Every file under `dir`, by relative path, with its bytes. */
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string, prefix: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else files[`${prefix}${entry.name}`] = readFileSync(path).toString('base64');
    }
  };
  walk(dir, '');
  return files;
}

describe('@getforma/build — atomic output (L-21)', () => {
  let tmpRoot: string;
  let srcDir: string;
  let outDir: string;
  let config: BuildConfig;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'forma-build-atomic-'));
    srcDir = join(tmpRoot, 'src');
    outDir = join(tmpRoot, 'dist');
    mkdirSync(srcDir, { recursive: true });
    const fontDir = join(tmpRoot, 'fonts');
    mkdirSync(fontDir);
    writeFileSync(join(fontDir, 'inter.woff2'), 'fake-woff2-data');
    writeFileSync(join(srcDir, 'app.ts'), 'export const label = "first good build";\n');
    writeFileSync(join(srcDir, 'main.css'), '.first { color: red; }\n');
    config = {
      entryPoints: [{ entry: join(srcDir, 'app.ts'), outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: ['main'] } },
      cssEntries: [{ input: join(srcDir, 'main.css'), outfile: 'main.css' }],
      fontDir,
      outputDir: outDir,
    };
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  /** The first CSS entry writes successfully; the second fails before promotion. */
  async function failingBuild(): Promise<Error> {
    const outcome = await build({ ...config, cssEntries: [
      ...config.cssEntries!, { input: join(srcDir, 'missing.css'), outfile: 'missing.css' },
    ] }).then(() => undefined, (error: unknown) => error);
    expect(outcome).toBeInstanceOf(Error);
    return outcome as Error;
  }

  it('leaves the previous build byte-identical when a build fails after writing files', async () => {
    await build(config);
    const good = snapshot(outDir);
    expect(Object.keys(good)).toContain('manifest.json');
    const besideOutput = readdirSync(tmpRoot).sort();

    // The next build changes every input, writes its first CSS file, then
    // fails reading the second CSS input.
    writeFileSync(join(srcDir, 'app.ts'), 'export const label = "second, failed build";\n');
    writeFileSync(join(srcDir, 'main.css'), '.second { color: blue; }\n');
    const error = await failingBuild();
    expect(error.message).toMatch(/missing\.css/);

    expect(snapshot(outDir)).toEqual(good);
    // Nothing is left beside the output either: the staging directory the
    // failed build wrote into is gone.
    expect(readdirSync(tmpRoot).sort()).toEqual(besideOutput);
  }, 30_000);

  it('a failed first build leaves no output directory and nothing beside it', async () => {
    const error = await failingBuild();
    expect(error.message).toMatch(/missing\.css/);

    expect(existsSync(outDir)).toBe(false);
    expect(readdirSync(tmpRoot).sort()).toEqual(['fonts', 'src']);
  }, 30_000);

  it('a successful build replaces the previous output whole', async () => {
    await build(config);
    // A file the next build does not produce (a stale asset, or one the
    // developer dropped in by hand) must not survive into the next output.
    writeFileSync(join(outDir, 'stale.js'), 'stale');
    writeFileSync(join(srcDir, 'app.ts'), 'export const label = "second good build";\n');

    const result = await build(config);

    const files = readdirSync(outDir);
    expect(files).not.toContain('stale.js');
    expect(files).toContain(result.manifest.aliases['app.js']);
    expect(readFileSync(join(outDir, result.manifest.aliases['app.js']!), 'utf8')).toContain('second good build');
    expect(readdirSync(tmpRoot).sort()).toEqual(['dist', 'fonts', 'src']);
  }, 30_000);

  // FORMA-170. The swap renames a real staging directory over `outputDir`; over
  // a symlink that turns the link into a directory and leaves the previous
  // build in the link's old target, where whatever serves the link keeps
  // reading it (watch mode removes the link outright). Following the link is
  // not offered: the build refuses a symlinked `outputDir` (a junction on
  // Windows) before it writes anything.
  describe('a symlinked outputDir (BUILD-824)', () => {
    /** A link (a junction on Windows, which needs no privilege) at `link` to `target`. */
    const linkTo = (target: string, link: string) => symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    const refused = /invalid config[\s\S]*BUILD-824 outputDir .* is a symbolic link to .*the build replaces outputDir whole/;

    /** A served folder holding a previous build's files, and `outDir` linked to it. */
    function linkedOutput(): { served: string; before: Record<string, string> } {
      const served = join(tmpRoot, 'served');
      mkdirSync(join(served, 'assets'), { recursive: true });
      writeFileSync(join(served, 'index.html'), '<p>previous build</p>');
      writeFileSync(join(served, 'assets', 'app.0123abcd.js'), Buffer.from([0, 255, 1, 254, 2]));
      linkTo(served, outDir);
      return { served, before: snapshot(served) };
    }

    it('refuses before writing: the link stays a link to the same target, whose files are unchanged, with nothing left beside it', async () => {
      const { served, before } = linkedOutput();
      const beside = readdirSync(tmpRoot).sort();

      const error = await build(config).then(() => undefined, (e: unknown) => e as Error);
      expect(error?.message).toMatch(refused);
      expect(error?.message).toContain(outDir);
      expect(error?.message).toContain(realpathSync(served));

      expect(lstatSync(outDir).isSymbolicLink()).toBe(true);
      expect(realpathSync(outDir)).toBe(realpathSync(served));
      expect(snapshot(served)).toEqual(before);
      expect(readdirSync(tmpRoot).sort()).toEqual(beside);
      expect(readdirSync(served).sort()).toEqual(['assets', 'index.html']);
    }, 30_000);

    it('refuses a link written with a trailing separator, which the filesystem would otherwise resolve', async () => {
      const { served, before } = linkedOutput();
      const beside = readdirSync(tmpRoot).sort();

      await expect(build({ ...config, outputDir: `${outDir}${sep}` })).rejects.toThrow(refused);

      expect(lstatSync(outDir).isSymbolicLink()).toBe(true);
      expect(snapshot(served)).toEqual(before);
      expect(readdirSync(tmpRoot).sort()).toEqual(beside);
    }, 30_000);

    it('refuses a link to a directory that no longer exists, naming where it pointed', async () => {
      const gone = join(tmpRoot, 'gone');
      mkdirSync(gone);
      linkTo(gone, outDir);
      rmSync(gone, { recursive: true });
      const beside = readdirSync(tmpRoot).sort();

      const error = await build(config).then(() => undefined, (e: unknown) => e as Error);
      expect(error?.message).toMatch(/BUILD-824 outputDir .* is a symbolic link to .*gone.*which does not exist/);

      expect(lstatSync(outDir).isSymbolicLink()).toBe(true);
      expect(existsSync(gone)).toBe(false);
      expect(readdirSync(tmpRoot).sort()).toEqual(beside);
    }, 30_000);

    it('does not refuse a symlinked parent: the output is swapped in beside outputDir, inside the parent the link names', async () => {
      const realParent = join(tmpRoot, 'real-parent');
      mkdirSync(realParent);
      const via = join(tmpRoot, 'via');
      linkTo(realParent, via);
      const outputDir = join(via, 'dist');

      await build({ ...config, outputDir });
      writeFileSync(join(srcDir, 'app.ts'), 'export const label = "second, through the parent link";\n');
      const result = await build({ ...config, outputDir });

      expect(lstatSync(via).isSymbolicLink()).toBe(true);
      expect(lstatSync(join(realParent, 'dist')).isDirectory()).toBe(true);
      expect(lstatSync(join(realParent, 'dist')).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(realParent, 'dist', result.manifest.aliases['app.js']!), 'utf8')).toContain('through the parent link');
      expect(readdirSync(realParent)).toEqual(['dist']);
    }, 60_000);

    it('still swaps a real outputDir in whole, the previous output replaced and nothing left beside it', async () => {
      await build(config);
      writeFileSync(join(outDir, 'stale.js'), 'stale');
      writeFileSync(join(srcDir, 'app.ts'), 'export const label = "after the link check";\n');

      const result = await build(config);

      expect(lstatSync(outDir).isSymbolicLink()).toBe(false);
      expect(readdirSync(outDir)).not.toContain('stale.js');
      expect(readFileSync(join(outDir, result.manifest.aliases['app.js']!), 'utf8')).toContain('after the link check');
      expect(readdirSync(tmpRoot).sort()).toEqual(['dist', 'fonts', 'src']);
    }, 60_000);

    it('refuses watch mode too: it empties outputDir first, which would remove the link', async () => {
      const { served, before } = linkedOutput();
      const beside = readdirSync(tmpRoot).sort();

      await expect(build({ ...config, watch: true })).rejects.toThrow(refused);

      expect(lstatSync(outDir).isSymbolicLink()).toBe(true);
      expect(realpathSync(outDir)).toBe(realpathSync(served));
      expect(snapshot(served)).toEqual(before);
      expect(readdirSync(tmpRoot).sort()).toEqual(beside);
    }, 30_000);
  });
});

// ---------------------------------------------------------------------------
// SSR builds: the .ir is the only island artifact
// ---------------------------------------------------------------------------

describe('@getforma/build — SSR output', () => {
  let tmpRoot: string;
  let srcDir: string;
  let outDir: string;

  /**
   * A page with one registered island, wired the way the compiler requires:
   * `activateIslands({ StatusPanel })` in the entry, the root `*Page` component
   * imported from a relative path. Returns the entry file path.
   *
   * `formajs` is aliased to a local stub so esbuild can bundle without the real
   * runtime installed; the compiler reads the SOURCE, so the stub is invisible
   * to IR emission.
   */
  function writeIslandPage(): string {
    const core=join(tmpRoot,'node_modules','@getforma','core');mkdirSync(core,{recursive:true});
    writeFileSync(join(core,'package.json'),JSON.stringify({name:'@getforma/core',version:'3.0.0-dev',type:'module',exports:'./index.js'}));
    writeFileSync(join(core,'index.js'),'export const __islandRegistration=(component,metadata)=>component;');
    writeFileSync(
      join(srcDir, 'forma-stub.js'),
      [
        'export const h = () => {};',
        'export const mount = () => {};',
        'export const activateIslands = () => {};',
        'export const createSignal = (v) => [() => v, () => {}];',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(srcDir, 'StatusPanel.ts'),
      [
        `import { h, createSignal } from 'formajs';`,
        `export const [statusText, setStatusText] = createSignal('idle');`,
        `export function StatusPanel() {`,
        `  return h('section', { class: 'status' }, h('span', null, () => statusText()));`,
        `}`,
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(srcDir, 'HomePage.ts'),
      [
        `import { h } from 'formajs';`,
        `import { StatusPanel } from './StatusPanel';`,
        `export function HomePage() {`,
        `  return h('main', { id: 'app' }, h('h1', null, 'Home'), StatusPanel());`,
        `}`,
        '',
      ].join('\n'),
    );
    const entryFile = join(srcDir, 'app.ts');
    writeFileSync(
      entryFile,
      [
        `import { activateIslands } from 'formajs';`,
        `import { HomePage } from './HomePage';`,
        `import { StatusPanel } from './StatusPanel';`,
        `activateIslands({ StatusPanel });`,
        `export { HomePage };`,
        '',
      ].join('\n'),
    );
    return entryFile;
  }

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'forma-build-ssr-'));
    srcDir = join(tmpRoot, 'src');
    outDir = join(tmpRoot, 'dist');
    mkdirSync(srcDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('emits the .ir and NO island byproducts', async () => {
    const entryFile = writeIslandPage();

    await build({
      entryPoints: [{ entry: entryFile, outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: outDir,
      formaAlias: join(srcDir, 'forma-stub.js'),
      ssr: true,
      ssrEntryPoints: { app: entryFile },
    });

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    );

    // The page really does have an island, so this test is not vacuous: the
    // IR is bigger than the ~136-byte placeholder and the route is wired to it.
    const irName = manifest.aliases['app.ir'];
    expect(irName).toMatch(/^app\.[0-9a-f]{8}\.ir$/);
    expect(manifest.routes['/']!.ir).toBe(irName);
    const ir = readFileSync(join(outDir, irName!));
    const container = readFmirContainer(ir);
    expect(container.writer).toEqual(COMPILER_WRITER_VERSION);
    expect(ir.length).toBeGreaterThan(200);
    // Island table entry count (u16 at the islands section offset) is 1.
    const islands = container.sections.find(section => section.id === SECTION_ISLANDS)!;
    expect(new DataView(islands.bytes.buffer, islands.bytes.byteOffset).getUint16(0, true)).toBe(1);

    // …and NOTHING island-shaped is left in the output directory or the
    // manifest. The generated `<page>.islands.js` registry was unusable in
    // every dimension — an unbundled bare `@getforma/core` import, a
    // `../src/...` path that cannot resolve from the output directory, and a
    // mapping of every island to the page ROOT component — while
    // `<page>.islands.json` was build metadata nothing read. Both were hashed,
    // compressed and manifested, so consumers had to delete them by hand.
    const stray = readdirSync(outDir).filter((f) => f.includes('.islands.'));
    expect(stray).toEqual([]);
    expect(Object.keys(manifest.aliases).filter((k) => k.includes('.islands.'))).toEqual([]);
  }, 30_000);

  it('emits one .ir per entry for a multi-route build', async () => {
    const entryFile = writeIslandPage();
    const secondEntry = join(srcDir, 'about.ts');
    writeFileSync(
      secondEntry,
      [
        `import { h, mount } from 'formajs';`,
        `mount(() => h('main', { id: 'app' }, h('h1', null, 'About')), '#app');`,
        '',
      ].join('\n'),
    );

    const manifestResult = await build({
      entryPoints: [
        { entry: entryFile, outfile: 'app.js' },
        { entry: secondEntry, outfile: 'about.js' },
      ],
      routes: {
        '/': { js: ['app'], css: [] },
        '/about': { js: ['about'], css: [] },
      },
      outputDir: outDir,
      formaAlias: join(srcDir, 'forma-stub.js'),
      ssr: true,
      ssrEntryPoints: { app: entryFile, about: secondEntry },
    });

    // Per-route IR, each addressed by its own hashed name — and still no
    // per-entry byproducts to clean up (the ksx ledger's #12: the scrub had to
    // be repeated for every entry).
    expect(manifestResult.manifest.routes['/']!.ir).toBe(
      manifestResult.manifest.aliases['app.ir'],
    );
    expect(manifestResult.manifest.routes['/about']!.ir).toBe(
      manifestResult.manifest.aliases['about.ir'],
    );
    expect(manifestResult.manifest.routes['/']!.ir)
      .not.toBe(manifestResult.manifest.routes['/about']!.ir);
    expect(readdirSync(outDir).filter((f) => f.includes('.islands.'))).toEqual([]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// The production build's console summary (FORMA-180 F3)
// ---------------------------------------------------------------------------
//
// A production build bundles into a staging directory and renames it into
// place, so esbuild's own summary named `.dist.forma-staging-<pid>-<hex>/app.js`,
// a path nothing reads. The build now prints its own summary under
// `outputDir`, with the hashed names the manifest holds, and runs esbuild at
// `logLevel: 'warning'`, so its warnings and errors still print. The build
// runs in a child so the test sees what a terminal sees, by stream.

describe('@getforma/build — the production build\'s console summary (FORMA-180 F3)', () => {
  let tmpRoot: string;
  let srcDir: string;
  let outDir: string;
  let scratch: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'forma-build-summary-'));
    srcDir = join(tmpRoot, 'src');
    outDir = join(tmpRoot, 'dist');
    scratch = join(tmpRoot, 'scratch');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(scratch, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  const config = (entries: string[], codeSplitting = false): BuildConfig => ({
    entryPoints: entries.map((name) => ({ entry: join(srcDir, `${name}.ts`), outfile: `${name}.js` })),
    routes: Object.fromEntries(entries.map((name) => [`/${name}`, { js: [name], css: [] }])),
    outputDir: outDir,
    codeSplitting,
  });

  it('a production build\'s summary names dist/<entry>.<hash>.js, never the staging directory', async () => {
    writeFileSync(join(srcDir, 'app.ts'), 'export const x = 1;\n');
    writeFileSync(join(srcDir, 'about.ts'), 'export const y = 2;\n');

    const { manifest, output, stdout } = await buildInChild(config(['app', 'about']), tmpRoot, scratch);
    expect(manifest).toBeDefined();

    // The summary names each bundle as the manifest names it, under outputDir,
    // with forward slashes on every platform (so on Windows too).
    const shown = outDir.split(sep).join('/');
    for (const name of ['app.js', 'about.js']) {
      const hashed = manifest!.aliases[name]!;
      expect(hashed).toMatch(/^(app|about)\.[0-9a-f]{8}\.js$/);
      expect(stdout).toContain(`${shown}/${hashed}`);
    }
    // The summary's own lines: no backslash, on Windows either (the other
    // lines print outputDir as the configuration spelled it).
    const summaryLines = stdout.split('\n').filter((line) => /\.[0-9a-f]{8}\.js\s+\d/.test(line));
    expect(summaryLines).toHaveLength(2);
    for (const line of summaryLines) expect(line).not.toContain('\\');
    expect(stdout).toMatch(/dist\/app\.[0-9a-f]{8}\.js\s+\d+(\.\d+)?k?b/);
    // Neither stream names the staging directory, by either of its forms.
    expect(output).not.toContain('forma-staging');
    expect(output).not.toContain('.dist.forma-');
  }, 30_000);

  it('a code-splitting build\'s summary names the hashed entries and chunks under outputDir', async () => {
    writeFileSync(join(srcDir, 'shared.ts'), 'export const shared = "s".repeat(64);\n');
    writeFileSync(join(srcDir, 'app.ts'), 'import { shared } from "./shared"; export const x = shared + 1;\n');
    writeFileSync(join(srcDir, 'about.ts'), 'import { shared } from "./shared"; export const y = shared + 2;\n');

    const { manifest, output, stdout } = await buildInChild(config(['app', 'about'], true), tmpRoot, scratch);
    expect(manifest).toBeDefined();

    const hashedEntries = ['app.js', 'about.js'].map((name) => manifest!.aliases[name]!);
    const chunks = readdirSync(outDir).filter((f) => /^chunk\.[0-9A-Z]+\.js$/.test(f));
    expect(chunks.length).toBeGreaterThan(0);
    const shown = outDir.split(sep).join('/');
    for (const file of [...hashedEntries, ...chunks]) expect(stdout).toContain(`${shown}/${file}`);
    expect(output).not.toContain('forma-staging');
    expect(output).not.toContain('.dist.forma-');
  }, 30_000);

  it('a production build still prints esbuild\'s warnings', async () => {
    // A duplicate object key is an esbuild warning, not an error: the build
    // succeeds and the warning must still reach the terminal.
    writeFileSync(join(srcDir, 'app.ts'), 'export const o = { a: 1, a: 2 };\n');

    const { manifest, stderr } = await buildInChild(config(['app']), tmpRoot, scratch);
    expect(manifest).toBeDefined();
    expect(stderr).toContain('[WARNING]');
    expect(stderr).toContain('Duplicate key "a"');
  }, 30_000);

  it('a production build still prints esbuild\'s errors, and fails', async () => {
    writeFileSync(join(srcDir, 'app.ts'), 'export const x = ;\n');

    const { manifest, message, stderr } = await buildInChild(config(['app']), tmpRoot, scratch);
    expect(manifest).toBeUndefined();
    expect(message).toContain('Build failed with 1 error');
    expect(stderr).toContain('[ERROR]');
    expect(stderr).toContain('Unexpected ";"');
  }, 30_000);
});
