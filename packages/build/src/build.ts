/**
 * @getforma/build — Build Pipeline
 *
 * Parameterized build pipeline extracted from the GateWASM admin build.ts.
 * Handles: esbuild bundling, CSS generation, font copying, SSR IR emission,
 * island registry generation, the preview frame's runtime
 * (previewFrame), content hashing, compression, manifest generation, service
 * worker generation, and budget warnings.
 */

import { applySizeBudgets, SizeBudgetError, sizeBudgetWarnings, sizePolicyFromEnvironment, validateSizeBudgets, validateResolvedSizeBudgets } from './size-budgets.js';
import { validateNavigation, navigationOptions, navigationFilename, validateNavigationProduct, navigationExecutableGuard } from './navigation.js';
import {jsxNamespaceFallback} from './jsx-namespace.js';
import * as esbuild from 'esbuild';
import { generateManifest } from './manifest.js';
import { BUILD_WRITER_VERSION, checkProjectCompatibility, requireCompatibleCompiler, resolveAppName } from './compatibility.js';
import { compatibilityGuard } from './compatibility-watch.js';
import { watchSourceRecovery } from './watch-source-recovery.js';
import { duplicateCoreDiagnostic } from './core-instances.js';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  realpathSync,
  existsSync,
} from 'node:fs';
import { join, extname, basename, dirname, sep, resolve } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { APP_NAME, serviceWorkerSource } from './service-worker.js';
import { splitGraph, type SplitGraph } from './split-graph.js';
import { entryProducts, browserEntries, type EntryProduct, type EntryProducts } from './entry-products.js';
import { createStagingDirectory, replaceDirectory, writeFileAtomic, publishOutputFiles, symlinkedOutputProblem } from './output.js';
import { computeIdentity, DEV_IDENTITY, identityBanner, type IdentityFile } from './identity.js';
import { readPreviousDist, retainFrom, type PreviousRelease } from './retention.js';
import { FRAME_RUNTIME_ASSET, readFrameRuntime, type FrameRuntime } from './preview-frame.js';
import { REPORT_CEILINGS, formatSizeReport, frameSize, routeSizeFailure, routeSizes, serializeSizeReport, workerSize, type BuildTimes, type SizeReport } from './route-size.js';
import { assertNoServerFunctions, serverDirectiveGuard } from './server-directives.js';
import {
  DiagnosticsCollector,
  danglingReportParent,
  isInsideOutputDir,
  resolveDiagnosticOptions,
  strictFailure,
  writeDiagnosticsJson,
  type CompilerDiagnostic,
} from './diagnostics.js';

import type {
  BuildConfig,
  BuildEntry,
  BuildResult,
  AssetManifest,
  RouteManifest,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a bundling pass whose output is only read, without the SSR plugin's two
 * kinds of line: "IR emitted" (console.log) and "IR: <code> ..." diagnostics
 * (console.warn). The plugin prints them each time it compiles a page, and the
 * identity's first pass (FORMA-186) compiles every page once more than the
 * build reports. Only those lines are dropped, and one wrapper serves any
 * number of passes running at once in a process, so nothing else is lost.
 */
let quietPasses = 0;
let consoleOriginals: { log: typeof console.log; warn: typeof console.warn } | undefined;
async function withoutIrChatter<T>(run: () => Promise<T>): Promise<T> {
  if (quietPasses++ === 0) {
    const original = (consoleOriginals = { log: console.log, warn: console.warn });
    const drop = (args: unknown[], pattern: RegExp) => typeof args[0] === 'string' && pattern.test(args[0]);
    console.log = (...args: unknown[]) => { if (!drop(args, /^\s+IR emitted \(/)) original.log.apply(console, args); };
    console.warn = (...args: unknown[]) => { if (!drop(args, /^\s+IR: /)) original.warn.apply(console, args); };
  }
  try { return await run(); }
  finally {
    if (--quietPasses === 0) { console.log = consoleOriginals!.log; console.warn = consoleOriginals!.warn; consoleOriginals = undefined; }
  }
}

/**
 * `FORMA_SECURITY_RELEASE`, read as FORMA_STRICT is, but case-insensitive and trimmed:
 * `1` or `true` marks the release; unset, empty, `0` or `false` leaves it unmarked; any
 * other value fails the build (BUILD-822). A mark that fails open (`yes` read as off)
 * would retain the revoked build's assets in a release that exists to remove them.
 * Verified by: packages/build/tests/retention.test.ts > "reads FORMA_SECURITY_RELEASE as FORMA_STRICT is read, and refuses any other value (BUILD-822)"
 */
function securityFromEnvironment(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '' || value === '0' || value === 'false') return false;
  if (value === '1' || value === 'true') return true;
  throw new Error(`BUILD-822 FORMA_SECURITY_RELEASE is ${JSON.stringify(raw)}: set it to 1 or true to mark a release that fixes a vulnerability, or unset it (0 and false also leave it unmarked)`);
}

/** Hash a file and return an 8-char hex prefix. */
function contentHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

// ---------------------------------------------------------------------------
// CSS Generation
// ---------------------------------------------------------------------------

/**
 * Locate the consuming project's installed @tailwindcss/cli entry script,
 * resolving from the current working directory. Returns null if the package
 * is not installed locally.
 */
function resolveTailwindCli(): string | null {
  try {
    const projectRequire = createRequire(join(process.cwd(), 'package.json'));
    const pkgPath = projectRequire.resolve('@tailwindcss/cli/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.tailwindcss;
    if (!bin) return null;
    const cliPath = join(dirname(pkgPath), bin);
    return existsSync(cliPath) ? cliPath : null;
  } catch {
    return null;
  }
}

/**
 * Run @tailwindcss/cli on an input file. Requires the locally installed CLI
 * script executed with the current Node binary — no shell on any platform,
 * so paths with spaces survive and nothing is exposed to shell injection.
 * Missing tools fail locally; a build never downloads an executable (N11).
 */
function runTailwind(input: string, outPath: string): void {
  const args = ['-i', input, '-o', outPath, '--minify'];

  const cli = resolveTailwindCli();
  if (cli) {
    execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
    return;
  }

  throw new Error('Install @tailwindcss/cli locally as a development dependency before building CSS. Forma never fetches build tools.');
}

function generateCss(
  config: BuildConfig,
): void {
  if (!config.cssEntries || config.cssEntries.length === 0) return;

  for (const entry of config.cssEntries) {
    const inputs = Array.isArray(entry.input) ? entry.input : [entry.input];
    const outPath = join(config.outputDir, entry.outfile);

    if (entry.tailwind && inputs.length > 0) {
      runTailwind(inputs[0], outPath);
    } else {
      // Concatenate all input CSS files
      const cssConcat = inputs
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n');
      writeFileSync(outPath, cssConcat);
    }
  }
}

// ---------------------------------------------------------------------------
// Font Copying
// ---------------------------------------------------------------------------

function copyFonts(config: BuildConfig): void {
  if (!config.fontDir || !existsSync(config.fontDir)) return;

  for (const fontFile of readdirSync(config.fontDir)) {
    if (fontFile.endsWith('.woff2')) {
      cpSync(join(config.fontDir, fontFile), join(config.outputDir, fontFile));
    }
  }
}

// ---------------------------------------------------------------------------
// Content Hashing
// ---------------------------------------------------------------------------

function hashAssets(
  config: BuildConfig,
  preserved: Record<string, string> = {},
): Record<string, string> {
  const distDir = config.outputDir;
  const files = readdirSync(distDir);
  const assets: Record<string, string> = { ...preserved };
  const graphFiles = new Set(Object.values(preserved));
  const serverInlinedSet = new Set(config.serverInlined ?? []);

  for (const file of files) {
    if (graphFiles.has(file) || Object.hasOwn(preserved, file)) continue;
    const ext = extname(file);
    // Only hash .js, .css, .wasm, .ir files; skip manifest.json, .woff2, etc.
    if (ext !== '.js' && ext !== '.css' && ext !== '.wasm' && ext !== '.ir')
      continue;

    const filePath = join(distDir, file);
    // Skip directories
    if (!statSync(filePath).isFile()) continue;

    const hash = contentHash(filePath);
    const base = basename(file, ext);
    const hashedName = `${base}.${hash}${ext}`;

    // Keep unhashed copy for files inlined by the server
    if (serverInlinedSet.has(file)) {
      cpSync(filePath, join(distDir, hashedName));
    } else {
      renameSync(filePath, join(distDir, hashedName));
    }
    assets[file] = hashedName;
  }

  return assets;
}

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------

/**
 * `skip` names files nothing fetches, which get no compressed copies: the
 * preview frame's runtime, which forma-server inlines (FORMA-175).
 */
function compressAssets(distDir: string, skip: ReadonlySet<string> = new Set()): number {
  const COMPRESSIBLE_EXTS = new Set(['.js', '.css']);
  let compressCount = 0;

  for (const file of readdirSync(distDir)) {
    const ext = extname(file);
    if (!COMPRESSIBLE_EXTS.has(ext) || skip.has(file)) continue;

    const filePath = join(distDir, file);
    if (!statSync(filePath).isFile()) continue;

    const content = readFileSync(filePath);

    // Brotli (level 11 — max compression)
    const br = brotliCompressSync(content, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
      },
    });
    if (br.length < content.length) {
      writeFileSync(`${filePath}.br`, br);
    }

    // Gzip (level 9 — max compression)
    const gz = gzipSync(content, { level: 9 });
    if (gz.length < content.length) {
      writeFileSync(`${filePath}.gz`, gz);
    }

    compressCount++;
  }

  console.log(`   ${compressCount} files compressed (brotli 11 + gzip 9)`);
  return compressCount;
}

// ---------------------------------------------------------------------------
// Config Validation
// ---------------------------------------------------------------------------

/**
 * A config value as an error message shows it: escaped, the way forma-server
 * prints a refused name (`{:?}`), so a control character or a lookalike stays
 * visible; never a throw, whatever a JavaScript config holds.
 */
function shown(value: unknown): string {
  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    return typeof value;
  }
}

/**
 * Reject configurations whose output cannot be correct, BEFORE anything is
 * written. The first four checks close a silent failure mode; the fifth
 * turns a crash into a message:
 *
 *  - An unknown `serviceWorker` value (a near miss such as 'ondemand' in a
 *    JavaScript config) silently produced the precache worker.
 *  - Two entries sharing an `outfile` write one file, and the route serves
 *    whichever build finished last.
 *  - An `outfile` containing a path separator lands esbuild's output in a
 *    subdirectory, which the (non-recursive) hashing pass never sees. The asset
 *    was silently absent from the manifest and its route fell back to an
 *    unhashed name that 404s in production.
 *  - A route naming a JS/CSS base that no entry produces is a typo that
 *    manifests as a missing script tag on a deployed page, not at build time.
 *  - A route whose `js` or `css` is missing (a JavaScript config is not type
 *    checked) threw `TypeError: mapping.css is not iterable`, naming neither
 *    the route nor the key; a string there was read letter by letter.
 *
 * Verified by: packages/build/tests/build.test.ts > "rejects an unknown serviceWorker value, naming it"
 * Verified by: packages/build/tests/build.test.ts > "rejects an application name forma-server cannot take, naming it"
 * Verified by: packages/build/tests/build.test.ts > "rejects two entryPoints that share an outfile"
 * Verified by: packages/build/tests/build.test.ts > "rejects a route that names an asset no entry produces"
 * Verified by: packages/build/tests/build.test.ts > "rejects a route without css, naming the route"
 * Verified by: packages/build/tests/build.test.ts > "rejects a route whose js is missing or not an array, naming each route"
 */
function validateConfig(config: BuildConfig): void {
  validateSizeBudgets(config.sizeBudgets, Object.keys(config.routes));
  sizePolicyFromEnvironment(process.env.FORMA_SIZE_POLICY);
  const problems: string[] = [];
  const entryNames = new Set<string>();

  const serviceWorker: unknown = config.serviceWorker;
  if (serviceWorker !== undefined && serviceWorker !== 'on-demand') {
    problems.push(
      `serviceWorker is '${String(serviceWorker)}': use 'on-demand' (the default); precache was removed in v3`,
    );
  }

  const clientTemplates: unknown = config.clientTemplates;
  if (clientTemplates !== undefined && typeof clientTemplates !== 'boolean') {
    problems.push(`clientTemplates is ${shown(clientTemplates)}: use true to opt in to compiled list templates, or false (the default)`);
  }

  // The worker's cache names carry it between colons, and the server must
  // name the same application to retire them (FORMA-130).
  const app: unknown = config.app;
  if (app !== undefined && (typeof app !== 'string' || !APP_NAME.test(app))) {
    problems.push(
      `BUILD-815 app is ${shown(app)}: use 1 to 63 of a-z, 0-9 and -, starting with a letter or digit ` +
        `(the name forma-server's sw::ServiceWorker::for_app takes)`,
    );
  }

  // A JavaScript config is not type checked: a string here would read as on.
  // Verified by: packages/build/tests/preview-frame.test.ts > "refuses a previewFrame that is not a boolean, and an entry that takes forma-runtime.js, before anything is written"
  const previewFrame: unknown = config.previewFrame;
  if (previewFrame !== undefined && typeof previewFrame !== 'boolean') {
    problems.push(
      `previewFrame is ${shown(previewFrame)}: use true to copy @getforma/core's preview-frame runtime, or false (the default)`,
    );
  }

  // The previous release and the security mark (FORMA-186): a JavaScript config is not
  // type checked, and `security: 'false'` would otherwise mark a release.
  // Verified by: packages/build/tests/retention.test.ts > "is checked as configuration: a path, and a boolean mark"
  const previousDist: unknown = config.previousDist;
  if (previousDist !== undefined && (typeof previousDist !== 'string' || previousDist === '')) {
    problems.push(`previousDist is ${shown(previousDist)}: use the path of the previous release's dist/, or leave it out for a first deploy`);
  }
  const security: unknown = config.security;
  if (security !== undefined && typeof security !== 'boolean') {
    problems.push(`security is ${shown(security)}: use true to mark a release that fixes a vulnerability, or false`);
  }

  for (const entry of config.entryPoints) {
    if (entryNames.has(entry.outfile)) problems.push(`entryPoints: duplicate outfile '${entry.outfile}'`);
    entryNames.add(entry.outfile);
    // The manifest would name the application's bundle where forma-server
    // reads the frame's runtime, and the two files would be one: compared
    // without case, as the file systems of macOS and Windows compare names.
    if (previewFrame === true && entry.outfile.toLowerCase() === FRAME_RUNTIME_ASSET) {
      problems.push(
        `entryPoints: outfile '${entry.outfile}' is the preview frame runtime's name in the manifest (previewFrame): name the entry something else`,
      );
    }
    if (/[\\/]/.test(entry.outfile)) {
      problems.push(
        `entryPoints: outfile '${entry.outfile}' contains a path separator — outfile is a bare filename inside outputDir`,
      );
    }
    if (!entry.outfile.endsWith('.js')) {
      problems.push(
        `entryPoints: outfile '${entry.outfile}' must end in .js (routes and the SSR page name are derived from it)`,
      );
    }
  }

  const jsBases = new Set(
    config.entryPoints.map((e) => basename(e.outfile, '.js')),
  );
  const cssBases = new Set(
    (config.cssEntries ?? []).map((e) => basename(e.outfile, '.css')),
  );

  const baseNames = (route: string, key: 'js' | 'css', value: unknown): string[] => {
    if (Array.isArray(value)) return value;
    problems.push(
      `routes['${route}'].${key} is ${value === undefined ? 'missing' : 'not an array'}: list the route's ${key.toUpperCase()} base names, or [] for none`,
    );
    return [];
  };

  for (const [route, mapping] of Object.entries(config.routes)) {
    for (const name of baseNames(route, 'js', mapping?.js)) {
      if (!jsBases.has(name)) {
        problems.push(
          `routes['${route}'].js names '${name}', but no entryPoint produces '${name}.js'`,
        );
      }
    }
    for (const name of baseNames(route, 'css', mapping?.css)) {
      if (!cssBases.has(name)) {
        problems.push(
          `routes['${route}'].css names '${name}', but no cssEntry produces '${name}.css'`,
        );
      }
    }
    // A JavaScript config is not type checked: a string here would read as on.
    // Verified by: packages/build/tests/route-size.test.ts > "refuses a canvas that is not a boolean before writing anything"
    const canvas: unknown = mapping?.canvas;
    if (canvas !== undefined && typeof canvas !== 'boolean') {
      problems.push(
        `routes['${route}'].canvas is ${shown(canvas)}: use true to declare the route a canvas (365 KiB of JavaScript instead of 75 KiB, N2), or leave it out`,
      );
    }
  }

  // The JSON report is a build-time record, not an asset: inside outputDir it
  // would be swapped away with the staging directory on success, written into
  // the previous build on failure (which must stay untouched, L-21), and
  // served or embedded with the assets (FORMA-119).
  // Verified by: packages/build/tests/strict.test.ts > "refuses a JSON report path inside outputDir, before anything is written"
  if (config.diagnosticsJson !== undefined) {
    if (isInsideOutputDir(config.diagnosticsJson, config.outputDir)) {
      problems.push(
        `diagnosticsJson '${config.diagnosticsJson}' is inside outputDir '${config.outputDir}': the build replaces outputDir whole, and its files are served; write the report outside it`,
      );
    }
    // A parent that is a link to nothing would fail the write with a bare
    // ENOENT after the whole build ran (FORMA-245).
    // Verified by: packages/build/tests/strict.test.ts > "refuses a report whose parent is a link to nothing, naming the link and where it points, before creating anything"
    const dangling = danglingReportParent(config.diagnosticsJson);
    if (dangling) problems.push(dangling);
  }

  const sizeReportJson = config.sizeReportJson ?? `${resolve(config.outputDir)}.size-report.json`;
  if (typeof sizeReportJson !== 'string' || !sizeReportJson.trim()) problems.push('sizeReportJson must be a nonempty path');
  else {
    if (isInsideOutputDir(sizeReportJson, config.outputDir)) problems.push('sizeReportJson must be outside outputDir');
    const dangling = danglingReportParent(sizeReportJson);
    if (dangling) problems.push(dangling);
  }

  // A production build swaps a real directory over outputDir, and watch mode
  // empties it with rmSync and mkdirSync (which removes a link, not its
  // target); either way a symlink becomes a directory and the previous build
  // is stranded in its target (FORMA-170). Refused here, before anything is
  // written, in both modes.
  // Verified by: packages/build/tests/build.test.ts > "refuses before writing: the link stays a link to the same target, whose files are unchanged, with nothing left beside it"
  // Verified by: packages/build/tests/build.test.ts > "refuses watch mode too: it empties outputDir first, which would remove the link"
  if (typeof config.outputDir === 'string') {
    const linked = symlinkedOutputProblem(config.outputDir);
    if (linked) problems.push(linked);
  }

  if (problems.length > 0) {
    throw new Error(
      `@getforma/build: invalid config\n  - ${problems.join('\n  - ')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Build Summary
// ---------------------------------------------------------------------------

/** esbuild's size notation: `842b`, `1.2kb`, `3.4mb`. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}

/**
 * The production build's summary, in place of esbuild's: every file the
 * bundling pass wrote, by the name it has after hashing and under `shownDir`,
 * the directory the application reads, never the staging directory the
 * pass wrote into (FORMA-180 F3). Sizes are the metafile's, the bytes
 * before compression. Forward slashes on every platform, as the manifest
 * and the URLs name the files, so the line reads the same on Windows.
 * Verified by: packages/build/tests/build.test.ts > "a production build's summary names dist/<entry>.<hash>.js, never the staging directory"
 */
function printBundleSummary(metafiles: esbuild.Metafile[], assets: Record<string, string>, shownDir: string): void {
  const lines: string[] = [];
  const dir = shownDir.split(sep).join('/');
  for (const metafile of metafiles) {
    for (const [path, output] of Object.entries(metafile.outputs)) {
      const name = basename(path);
      lines.push(`   ${dir}/${assets[name] ?? name}  ${formatBytes(output.bytes)}`);
    }
  }
  if (lines.length) console.log(`\n${lines.join('\n')}\n`);
}

// ---------------------------------------------------------------------------
// Manifest Generation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Service Worker Generation
// ---------------------------------------------------------------------------

/** The worker's source: production, from the finished manifest; watch mode's network-only worker. */
function workerSourceFor(
  config: BuildConfig,
  manifest: Pick<AssetManifest, 'app' | 'build' | 'assets'>,
  excludedFiles: string[] = [],
): string {
  return serviceWorkerSource({ ...manifest, development: config.watch === true, excludedFiles });
}

function generateServiceWorker(config: BuildConfig, source: string): void {
  writeFileAtomic(join(config.outputDir, 'sw.js'), source);
  console.log(`   SW generated: dist/sw.js (${config.watch ? 'network-only development' : 'verified on-demand assets'})`);
}

// ---------------------------------------------------------------------------
// Watch Mode: a Development Build
// ---------------------------------------------------------------------------

/**
 * What watch mode adds to esbuild's options; a production build adds nothing,
 * so its options, and the bytes it writes, are what they were (FORMA-169).
 *
 * - `conditions`: watch mode resolves each package's `development` export
 *   condition. `@getforma/core` points it at a build of every entry that
 *   keeps its development warnings (hydration mismatches, dropped props, the
 *   deprecations' codes); a production build resolves the files it always
 *   did. esbuild adds the `module` condition by itself only while no custom
 *   conditions are configured, so the list names it too: with it, the list
 *   is what esbuild would have used plus `development`. (`browser`, `import`
 *   or `require`, and `default` esbuild adds whatever the list says.)
 * - `process.env.NODE_ENV`: esbuild already defines it as `"development"` in a
 *   browser build that is not minified, as watch mode's is; stated here so a
 *   development build says so whatever its minify setting. It does not reach
 *   core's own source check, which tests `typeof process` first and finds no
 *   `process` in a browser, and core's development build needs no define.
 *
 * Verified by: packages/build/tests/development-condition.test.ts > "watch mode resolves the development condition and keeps module and browser, with and without code splitting"
 * Verified by: packages/build/tests/development-condition.test.ts > "a production build resolves the production files, with module and browser, as it did"
 */
const WATCH_RESOLUTION: Pick<esbuild.BuildOptions, 'conditions' | 'define'> = {
  conditions: ['development', 'module'],
  define: { 'process.env.NODE_ENV': '"development"' },
};

/**
 * What compiling the deployment identity in adds to the esbuild options
 * (FORMA-186, DR-29; L-6 as amended by L-56): the constant core compares the
 * page's `data-forma-build` with, and, in a production build, a banner that
 * puts the identity in every JavaScript output so that every deploy renames
 * every bundle. Watch mode's identity is the constant `dev` and has no banner:
 * a development build renames nothing.
 * Verified by: packages/build/tests/identity.test.ts > "compiles the identity into the bundle as the constant core reads"
 * Verified by: packages/build/tests/identity.test.ts > "watch mode's identity is dev, in the manifest and in the bundle, with no banner"
 */
function identityOptions(config: BuildConfig, identity?: string): Pick<esbuild.BuildOptions, 'define' | 'banner'> {
  if (identity === undefined) return {};
  return {
    define: { ...(config.watch ? WATCH_RESOLUTION.define : {}), __FORMA_BUILD__: JSON.stringify(identity) },
    ...(config.watch ? {} : { banner: { js: identityBanner(identity) } }),
  };
}

/**
 * The esbuild options every bundle of a build shares. previewFrame's reading
 * of which core the bundles import (preview-frame.ts) bundles each entry in
 * memory with these same options, so its answer is the bundles'.
 */
function sharedOptions(config: BuildConfig, compatibility?: () => void, identity?: string): Partial<esbuild.BuildOptions> {
  return {
    plugins: [serverDirectiveGuard(), ...(compatibility ? [compatibilityGuard(process.cwd(), compatibility)] : [])],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    alias: config.formaAlias
      ? { 'formajs': config.formaAlias }
      : {},
    minify: !config.watch,
    sourcemap: config.watch ? 'inline' : false,
    // A production build writes into a staging directory, so esbuild's own
    // summary would name `.dist.forma-staging-<pid>-<hex>/app.js`, a path
    // nothing reads; the build prints its own from the metafile, under the
    // names the application reads (FORMA-180 F3). Warnings and errors still
    // print. Watch mode writes in place and keeps esbuild's summary.
    // Verified by: packages/build/tests/build.test.ts > "a production build's summary names dist/<entry>.<hash>.js, never the staging directory"
    // Verified by: packages/build/tests/build.test.ts > "a production build still prints esbuild's warnings"
    logLevel: config.watch ? 'info' : 'warning',
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    // Watch mode is a development build (FORMA-169).
    ...(config.watch ? WATCH_RESOLUTION : {}),
    ...identityOptions(config, identity),
  };
}

// ---------------------------------------------------------------------------
// Watch Mode: Server-Rendered Pages
// ---------------------------------------------------------------------------

/** `formaSsrPlugin` from `@getforma/compiler`, loaded only for SSR builds.
 *  `strict` and `onDiagnostics` are read by compiler 0.3.7 and later. */
type SsrPluginFactory = (opts: {
  page: string;
  outDir: string;
  entryPoint?: string;
  clientEntryPoint?: string;
  browserEntryPoints?: readonly { path: string; entryPoint: string }[];
  navigationOwner?: boolean;
  strict?: boolean;
  onDiagnostics?: (diagnostics: CompilerDiagnostic[], page: string) => void;
  onSourcesChanged?: (page: string) => void;
}) => esbuild.Plugin;

/** What every SSR plugin instance of one build is given besides its page. */
type SsrPluginShared = Pick<Parameters<SsrPluginFactory>[0], 'strict' | 'onDiagnostics' | 'onSourcesChanged'>;

// ---------------------------------------------------------------------------
// Main Build Function
// ---------------------------------------------------------------------------

/**
 * Run the Forma build pipeline.
 *
 * Orchestrates: clean, CSS generation, font copying, esbuild bundling
 * (with optional SSR IR emission), island registry generation,
 * content hashing, compression, manifest generation, service worker
 * generation, and budget warnings.
 *
 * A production build writes into a staging directory beside `outputDir` and
 * swaps it in only when every step has succeeded, so a build that fails part
 * way leaves the previous assets exactly as they were (L-21). External size
 * and diagnostic reports can retain evidence of a rejected build. The application embeds `outputDir` in its binary, and used to embed
 * half a build after a failure. Watch mode writes in place, as before.
 * Verified by: packages/build/tests/build.test.ts > "leaves the previous build byte-identical when a build fails after writing files"
 * Verified by: packages/build/tests/build.test.ts > "a failed first build leaves no output directory and nothing beside it"
 */
export async function build(userConfig: BuildConfig): Promise<BuildResult> {
  // Validate before anything is written: a config error must not touch the
  // previous build's output on its way to failing.
  validateConfig(userConfig);
  validateNavigation(userConfig);
  validateResolvedSizeBudgets(userConfig);
  // 3.0 strict-only publication; validate legacy flag spelling.
  const project = process.cwd();
  // A release marked security retains nothing (L-16, SR45); the environment marks it too, and
  // a `false` in the configuration does not unmark it: the mark can only be forgotten safely.
  const environmentSecurity = securityFromEnvironment(process.env.FORMA_SECURITY_RELEASE);
  const security = userConfig.security === true || environmentSecurity;
  const config: BuildConfig = { ...userConfig, sizeReportJson: userConfig.sizeReportJson ?? `${resolve(userConfig.outputDir)}.size-report.json`, ...resolveDiagnosticOptions(userConfig), app: resolveAppName(project, userConfig.app), security };
  // The previous release is read and checked before anything is bundled or written, so a wrong
  // path fails at once (BUILD-820). Watch mode and a security release never read it.
  // Verified by: packages/build/tests/retention.test.ts > "is ignored by watch mode, which is a development build"
  // Verified by: packages/build/tests/retention.test.ts > "with %s, a previous dist is ignored: no retained entry and a dist holding only its own files"
  let previous: PreviousRelease | undefined;
  if (config.previousDist !== undefined) {
    if (config.watch) console.log('   previousDist is ignored in watch mode: a development build retains nothing');
    else if (security) console.log('   Security release: the previous dist is ignored and nothing is retained (L-16, SR45)');
    else previous = readPreviousDist(config.previousDist, config.outputDir, config.app!);
  } else if (security && !config.watch) console.log('   Security release: nothing is retained (L-16, SR45)');
  let compiler: typeof import('@getforma/compiler') | undefined;
  try { compiler = await import('@getforma/compiler'); }
  catch (error) {
    let cause: unknown = error;
    for (let depth = 0; depth < 8 && cause && (cause as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND'; depth++) cause = (cause as Error).cause;
    if ((cause as NodeJS.ErrnoException | undefined)?.code !== 'ERR_MODULE_NOT_FOUND' || !(cause as Error).message.includes("'@getforma/compiler'")) throw error;
  }
  if (compiler) {
    if (!('COMPILER_WRITER_VERSION' in compiler) || !Array.isArray(compiler.COMPILER_WRITER_VERSION) || compiler.COMPILER_WRITER_VERSION.length !== 3) throw new Error('BUILD-809 installed @getforma/compiler has no compatible writer-version metadata; install the same Forma release set');
    requireCompatibleCompiler(compiler.COMPILER_WRITER_VERSION);
  }
  if (config.ssr && !compiler) throw new Error('BUILD-801 SSR requires @getforma/compiler; install a compatible compiler before building');
  if (config.clientTemplates && typeof compiler?.formaClientPlugin !== 'function') {
    throw new Error('BUILD-809 clientTemplates requires a compatible @getforma/compiler with formaClientPlugin; install the same Forma release set');
  }
  const writers = [
    { name: '@getforma/build', version: BUILD_WRITER_VERSION },
    ...((config.ssr || config.clientTemplates) && compiler ? [{ name: '@getforma/compiler', version: compiler.COMPILER_WRITER_VERSION }] : []),
  ];
  const compatibility = () => { checkProjectCompatibility(project, writers, config.ssr === true); };
  const compatibilityWarnings = checkProjectCompatibility(project, writers, config.ssr === true);
  const legacyImports = config.formaAlias ? new Set<string>() : undefined;
  await assertNoServerFunctions(config, sharedOptions(config), legacyImports);
  // What the config itself deprecates, each said once per build() call,
  // production and watch alike, on the console and in BuildResult.warnings.
  const deprecations = [...compatibilityWarnings];
  if (legacyImports?.size) deprecations.push(
    `formaAlias is a 3.x migration bridge. Replace bare formajs imports with @getforma/core (preserving any subpath) in: ${[...legacyImports].sort().join(', ')}`,
  );
  for (const line of deprecations) console.warn(`Warning: ${line}`);
  const withDeprecations = (result: BuildResult): BuildResult =>
    deprecations.length > 0 ? { ...result, warnings: [...result.warnings, ...deprecations] } : result;
  // The preview frame's runtime (FORMA-175), found from the core the bundles
  // import, read and checked before anything is written: no runtime
  // (BUILD-805), one forma-server would refuse (BUILD-806) or bundles that
  // import cores with different runtimes (BUILD-807) leave the previous
  // output as it was, in watch mode too. Off, nothing is read.
  const frame = config.previewFrame === true
    ? await readFrameRuntime(config, sharedOptions(config), config.strict === true)
    : undefined;
  if (config.watch) return withDeprecations(await buildInto(config, config.outputDir, frame, compiler, compatibility));

  const staging = createStagingDirectory(config.outputDir);
  let result: BuildResult;
  try {
    result = await buildInto({ ...config, outputDir: staging }, config.outputDir, frame, compiler, compatibility, previous);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  // Throws with the previous output restored if the swap itself fails.
  replaceDirectory(staging, config.outputDir);
  return withDeprecations(result);
}

/**
 * The pipeline, writing into `config.outputDir`: the staging directory for a
 * production build, the output itself in watch mode. `shownDir` is the
 * directory named in log lines, the one the application reads. `frame` is
 * the preview frame's runtime, already read and checked, when `previewFrame`
 * is on.
 */
async function buildInto(config: BuildConfig, shownDir: string, frame: FrameRuntime | undefined, compiler: typeof import('@getforma/compiler') | undefined, compatibility: () => void, previous?: PreviousRelease): Promise<BuildResult> {
  const distDir = config.outputDir;
  const createdDir = !existsSync(distDir);

  // The production build's times, by phase (N7, FORMA-190): wall-clock
  // milliseconds from here to each mark, for the printed report and the
  // result; the size-report.json file holds none.
  const phases: BuildTimes['phases'] = { bundle: 0, hash: 0, compress: 0, manifest: 0 };
  let lap = performance.now();
  const mark = (phase: keyof BuildTimes['phases']): void => {
    const now = performance.now();
    phases[phase] = Math.round(now - lap);
    lap = now;
  };

  // ── Clean output directory (watch mode; a staging directory is new) ──
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  try {
    // ── CSS generation ────────────────────────────────────────────────
    generateCss(config);

    // ── Font copying ──────────────────────────────────────────────────
    copyFonts(config);

    // ── The preview frame's runtime (previewFrame, FORMA-175) ─────────
    // Core's bytes as they are, under the name forma-server reads from the
    // manifest: the hashing pass below makes it forma-runtime.<hash>.js like
    // any asset; watch mode keeps the name, as it does every asset's.
    // Verified by: packages/build/tests/preview-frame.test.ts > "copies core's dist/formajs-frame.global.js unchanged as a hashed forma-runtime.<hash>.js and names it in the manifest's assets"
    if (frame) {
      const target = join(distDir, FRAME_RUNTIME_ASSET);
      if (config.watch) writeFileAtomic(target, frame.bytes);
      else writeFileSync(target, frame.bytes);
      console.log(`   Preview frame runtime: ${FRAME_RUNTIME_ASSET} from @getforma/core ${frame.version} (${frame.source}), ${frame.found}${frame.minified ? `; minified ${frame.sourceBytes.toLocaleString('en-US')} -> ${frame.bytes.length.toLocaleString('en-US')} B` : ''}`);
    }
    // The dev manifest names it as itself, as it names every watched asset.
    const frameAssets: Record<string, string> = frame ? { [FRAME_RUNTIME_ASSET]: FRAME_RUNTIME_ASSET } : {};

    // ── esbuild shared config ─────────────────────────────────────────
    // Without the deployment identity: the first pass bundles with these, and
    // `shared` below (the same options plus the identity) is what is built.
    const base = sharedOptions(config, compatibility);

    // ── Lazy-load SSR plugin only when needed ─────────────────────────
    let formaSsrPlugin: SsrPluginFactory | undefined;
    // Every page refuses unsupported native contracts. Production waits for
    // every entry before returning the aggregate diagnostic report.
    const strict = config.strict === true;
    const collector = new DiagnosticsCollector(strict, config.entryPoints.map((entry) => basename(entry.outfile, '.js')));
    const pluginShared: SsrPluginShared = {
      onDiagnostics: collector.onDiagnostics,
      ...(config.watch && strict ? { strict: true } : {}),
    };

    if (config.ssr) {
      console.log('SSR mode enabled — emitting IR files');
      formaSsrPlugin = compiler!.formaSsrPlugin;
      if (typeof formaSsrPlugin !== 'function') throw new Error('BUILD-809 installed compiler has no supported formaSsrPlugin');
    }

    // Only colliding explicit Browser roots need a second module identity.
    // Imports below the entry remain in the same graph, including core.
    const nativeClients=new Set(config.ssr?config.entryPoints.filter(entry=>entry.ssr!==false).map(entry=>realpathSync(entry.entry)):[]);
    const browserAliases=new Map(config.codeSplitting?config.entryPoints.filter(entry=>entry.ssr===false&&nativeClients.has(realpathSync(entry.entry)))
      .map(entry=>[entry.outfile,{path:`forma-browser-entry:${entry.outfile}`,entryPoint:entry.entry}]):[]);
    const graphEntries=new Map([...browserAliases].map(([outfile,alias])=>[outfile,alias.path]));

    let graph: SplitGraph | undefined;
    let products: EntryProducts = new Map();
    const classify = (result: esbuild.BuildResult, entries: readonly BuildEntry[]) => {
      if (!result.metafile) throw new Error('BUILD-611 entry result is missing its output graph');
      const candidates = entryProducts(config, entries, result, compiler?.getSsrEntryProducts);
      const nextGraph = splitGraph(result.metafile, [...entries], distDir, browserEntries(config, entries, candidates), graphEntries);
      const outputs = (result.outputFiles ?? []).filter(file => file.path.endsWith('.ir') || nextGraph.files.has(basename(file.path)));
      const metafile = { ...result.metafile, outputs: Object.fromEntries(Object.entries(result.metafile.outputs)
        .filter(([file]) => nextGraph.files.has(basename(file)))) };
      return { candidates, nextGraph, outputs, metafile };
    };
    const coreGraphs = new Map<string, esbuild.Metafile>();
    let duplicateCore: ReturnType<typeof duplicateCoreDiagnostic>;
    const recordCoreGraph = (key: string, metafile: esbuild.Metafile) => {
      coreGraphs.set(key, metafile);
      const next = duplicateCoreDiagnostic([...coreGraphs.values()]);
      if (next && next.message !== duplicateCore?.message) console.warn(`${next.code}: ${next.message}`);
      duplicateCore = next;
    };
    // The SSR plugin instances of a build, one per server-rendered entry.
    const navigationGroups = config.navigationGroups ?? [];
    const groupedOwners = new Set(navigationGroups.flatMap(group => [...group.owners]));
    const ordinaryEntries = config.entryPoints.filter(entry => !groupedOwners.has(basename(entry.outfile, '.js')));
    const ssrPluginsFor = (entries: readonly BuildEntry[], options: SsrPluginShared) =>
      config.ssr && formaSsrPlugin ? entries.filter(entry => entry.ssr !== false).map(entry => formaSsrPlugin!({
        page: basename(entry.outfile, '.js'),
        outDir: distDir,
        entryPoint: config.ssrEntryPoints?.[basename(entry.outfile, '.js')] ?? entry.entry,
        clientEntryPoint: entry.entry,
        ...(groupedOwners.has(basename(entry.outfile, '.js')) ? { navigationOwner: true } : {}),
        browserEntryPoints: entries.find(candidate=>candidate.ssr!==false&&realpathSync(candidate.entry)===realpathSync(entry.entry))===entry
          ? [...browserAliases.values()].filter(alias=>realpathSync(alias.entryPoint)===realpathSync(entry.entry)) : [],
        ...options,
      })) : [];
    // One shared graph (`codeSplitting`), or one bundle per entry; both passes
    // of a production build, and watch mode's split build, take their options
    // from these.
    const splitOptionsFor = (options: Partial<esbuild.BuildOptions>, plugin: SsrPluginShared): esbuild.BuildOptions => ({
      ...options,
      entryPoints: config.entryPoints.map(entry => ({ in: browserAliases.get(entry.outfile)?.path ?? entry.entry, out: basename(entry.outfile, '.js') })),
      outdir: distDir,
      splitting: true,
      metafile: true,
      write: false,
      entryNames: '[name].[hash]',
      chunkNames: 'chunk.[hash]',
      assetNames: 'asset.[hash]',
      plugins: [...(options.plugins ?? []), ...ssrPluginsFor(config.entryPoints, plugin), ...(config.clientTemplates ? [compiler!.formaClientPlugin()] : []), jsxNamespaceFallback()],
    });
    const entryOptionsFor = (entry: BuildEntry, options: Partial<esbuild.BuildOptions>, plugin: SsrPluginShared): esbuild.BuildOptions => ({
      ...options,
      entryPoints: [entry.entry],
      outfile: join(distDir, entry.outfile),
      metafile: true,
      write: false,
      plugins: [...(options.plugins ?? []), ...ssrPluginsFor([entry], plugin), ...(config.clientTemplates ? [compiler!.formaClientPlugin()] : []), jsxNamespaceFallback()],
    });

    const groupOptionsFor = (group: NonNullable<BuildConfig['navigationGroups']>[number], options: Partial<esbuild.BuildOptions>, plugin: SsrPluginShared) => {
      const entries = config.entryPoints.filter(entry => group.owners.includes(basename(entry.outfile, '.js')));
      return navigationOptions(config, group, { ...options, plugins: [...(options.plugins ?? []), navigationExecutableGuard(), ...ssrPluginsFor(entries, plugin),
        ...(config.clientTemplates ? [compiler!.formaClientPlugin()] : []), jsxNamespaceFallback()] });
    };
    const classifyGroup = (group: NonNullable<BuildConfig['navigationGroups']>[number], result: esbuild.BuildResult) => {
      const entries = config.entryPoints.filter(entry => group.owners.includes(basename(entry.outfile, '.js')));
      const candidates = entryProducts(config, entries, result, compiler?.getSsrEntryProducts);
      validateNavigationProduct(group, result, candidates);
      return candidates;
    };

    // ── The deployment identity (FORMA-186, DR-29; L-6 as amended by L-56) ──
    // Computed first, from every output of a bundling pass that has no
    // identity: the files the build would publish (browser-facing bundles and
    // the `.ir` modules), the css entries and fonts already in staging, and the
    // writers' versions. Nothing is written or published from this pass, and
    // its diagnostics are dropped: the real pass reports them. The previous
    // release's dist/ is never read here, so retention cannot move it.
    // A failure here is not reported here: the real pass fails the same way and
    // reports through the collector, so the JSON report and `--strict` behave as
    // they always did; the error surfaces below if the real pass did not.
    // Verified by: packages/build/tests/identity.test.ts > "is equal for identical inputs including the compiled .ir modules, built in two directories"
    // Verified by: packages/build/tests/identity.test.ts > "changes with one changed source byte that changes an output, and not with an edit that changes none"
    let identity = DEV_IDENTITY;
    let firstPassFailure: unknown;
    if (!config.watch) {
      try {
        const quietBase = { ...base, logLevel: 'silent' as const };
        const noDiagnostics: SsrPluginShared = { onDiagnostics: () => {} };
        const files: IdentityFile[] = [];
        const take = (outputs: readonly esbuild.OutputFile[]) => {
          for (const file of outputs) files.push({ name: basename(file.path), bytes: file.contents });
        };
        await withoutIrChatter(async () => {
          if (config.codeSplitting && config.entryPoints.length) {
            take(classify(await esbuild.build(splitOptionsFor(quietBase, noDiagnostics)), config.entryPoints).outputs);
          } else {
            const results = await Promise.all(ordinaryEntries.map(async entry =>
              classify(await esbuild.build(entryOptionsFor(entry, quietBase, noDiagnostics)), [entry]).outputs));
            for (const outputs of results) take(outputs);
            for (const group of navigationGroups) {
              const result = await esbuild.build(groupOptionsFor(group, quietBase, noDiagnostics));
              classifyGroup(group, result); take(result.outputFiles!);
            }
          }
        });
        for (const name of readdirSync(distDir)) {
          if (name === FRAME_RUNTIME_ASSET || !statSync(join(distDir, name)).isFile()) continue;
          files.push({ name, bytes: readFileSync(join(distDir, name)) });
        }
        identity = computeIdentity({
          writers: [
            { name: '@getforma/build', version: BUILD_WRITER_VERSION },
            ...((config.ssr || config.clientTemplates) && compiler ? [{ name: '@getforma/compiler', version: compiler.COMPILER_WRITER_VERSION as readonly [number, number, number] }] : []),
          ],
          files,
        });
      } catch (error) {
        firstPassFailure = error;
        identity = '0'.repeat(16);
      }
    }
    const shared = sharedOptions(config, compatibility, identity);
    const splitOptions = splitOptionsFor(shared, pluginShared);

    // ── Build entries ─────────────────────────────────────────────────
    if (config.watch) {
      // Watch mode publishes immutable data generations before switching the
      // manifest. A reader holding an earlier manifest keeps its exact URLs.
      const irAssets: Record<string, string> = {};
      let lastManifest = '';
      let ready!: (value: ReturnType<typeof generateManifest>) => void;
      const firstManifest = new Promise<ReturnType<typeof generateManifest>>(resolve => { ready = resolve; });
      const writeDevManifest = (): ReturnType<typeof generateManifest> | undefined => {
        let result: ReturnType<typeof generateManifest>;
        try { result = generateManifest(config, { ...graph?.assets, ...irAssets, ...frameAssets }, graph?.staticDependencies, graph?.files, products); }
        catch (error) {
          if (!(error as Error).message.startsWith('BUILD-817')) throw error;
          console.warn(`Dev manifest not published: ${(error as Error).message}; waiting for valid output`);
          return undefined;
        }
        const { manifest, warnings } = result;
        if (duplicateCore) warnings.push(`${duplicateCore.code}: ${duplicateCore.message}`);
        const text = JSON.stringify(manifest, null, 2) + '\n';
        if (text !== lastManifest) writeFileAtomic(join(distDir, 'manifest.json'), text);
        lastManifest = text;
        ready(result);
        return result;
      };

      const acceptedGraphs = new Map<string, SplitGraph>();
      const acceptedProducts = new Map<string, EntryProducts>();
      // Before the first complete manifest, independent entry results remain
      // candidates. They become accepted together with that first publication.
      const initialGraphs = new Map<string, SplitGraph>();
      const initialProducts = new Map<string, EntryProducts>();
      const initialCoreGraphs = new Map<string, esbuild.Metafile>();
      const initialIr: Record<string, string> = {};
      const publishWatch=(result:esbuild.BuildResult,key:string,entries:readonly BuildEntry[])=>{
        if(result.errors.length||!result.metafile)return false;
        let classified: ReturnType<typeof classify>;
        try { classified = classify(result, entries); }
        catch (error) { console.error(`   IR not written for ${key}: ${(error as Error).message} (the last good browser/IR pair stays)`); return false; }
        const { candidates, nextGraph } = classified;
        const nextIr={...irAssets,...initialIr},nextGraphs=new Map([...acceptedGraphs,...initialGraphs]);nextGraphs.set(key,nextGraph);
        const nextProducts = new Map([...acceptedProducts,...initialProducts]); nextProducts.set(key,candidates);
        const combinedProducts = new Map<string, EntryProduct>();
        for (const current of nextProducts.values()) for (const [name, product] of current) combinedProducts.set(name,product);
        const combined:SplitGraph={assets:{},staticDependencies:{},files:new Set()};
        for(const current of nextGraphs.values()){
          Object.assign(combined.assets,current.assets);Object.assign(combined.staticDependencies,current.staticDependencies);
          for(const file of current.files)combined.files.add(file);
        }
        const outputs=classified.outputs.map(file=>{
          if(!file.path.endsWith('.ir'))return {path:file.path,contents:file.contents};
          const logical=basename(file.path),name=logical.slice(0,-3)+'.'+createHash('sha256').update(file.contents).digest('hex')+'.ir';
          nextIr[logical]=name;return {path:join(distDir,name),contents:file.contents};
        });
        let accepted:ReturnType<typeof generateManifest>|undefined,text='';
        try {
          // Data filenames are generation identities. Never replace accepted
          // bytes under a previous URL, even in the unlikely event of a hash collision.
          for(const file of outputs)if(existsSync(file.path)&&!readFileSync(file.path).equals(file.contents))throw new Error(`generation filename collision: ${file.path}`);
          publishOutputFiles(outputs,()=>{
            try {accepted=generateManifest(config,{...combined.assets,...nextIr,...frameAssets},combined.staticDependencies,combined.files,combinedProducts);}
            catch(error){
              if(!lastManifest&&(error as Error).message.startsWith('BUILD-817'))return [];
              throw error;
            }
            text=JSON.stringify(accepted.manifest,null,2)+'\n';
            return [{path:join(distDir,'manifest.json'),contents:text}];
          });
        } catch(error) {
          console.error(`   IR not written for ${key}: ${(error as Error).message} (the last good browser/IR pair stays)`);
          return false;
        }
        if (accepted) {
          Object.assign(irAssets,nextIr); graph=combined; products=combinedProducts;
          acceptedGraphs.clear(); for (const [name,value] of nextGraphs) acceptedGraphs.set(name,value);
          acceptedProducts.clear(); for (const [name,value] of nextProducts) acceptedProducts.set(name,value);
          initialGraphs.clear(); initialProducts.clear(); for (const name of Object.keys(initialIr)) delete initialIr[name];
          for (const [name,value] of initialCoreGraphs) recordCoreGraph(name,value);
          initialCoreGraphs.clear(); recordCoreGraph(key,classified.metafile);
        } else {
          initialGraphs.set(key,nextGraph); initialProducts.set(key,candidates); Object.assign(initialIr,nextIr);
          initialCoreGraphs.set(key,classified.metafile);
        }
        for(const file of result.outputFiles??[])if(file.path.endsWith('.ir'))console.log(`   IR rewritten: ${basename(file.path)} in ${Math.round(performance.now()-cycleStarted)} ms`);
        if(accepted){lastManifest=text;ready(accepted);}
        return true;
      };
      let cycleStarted=performance.now();
      const clock:esbuild.Plugin={name:'forma-paired-clock',setup(builder){builder.onStart(()=>{cycleStarted=performance.now();});}};

      if (config.codeSplitting && config.entryPoints.length) {
        const recovery=watchSourceRecovery();
        const watchOptions=splitOptionsFor(shared,{...pluginShared,onSourcesChanged:()=>recovery.changed()});
        let firstBuilt!:()=>void;const firstBuild=new Promise<void>(resolve=>{firstBuilt=resolve;});
        const ctx = recovery.attach(await esbuild.context({
          ...watchOptions,
          write: false,
          plugins: [clock,...(watchOptions.plugins ?? []), {
            name: 'forma-split-manifest',
            setup(builder) {
              builder.onEnd(result => {
                firstBuilt();
                if (result.errors.length || !result.metafile) return;
                publishWatch(result,'split',config.entryPoints);
              });
            },
          },recovery.plugin],
        }));
        await ctx.watch();
        await firstBuild;
      } else for (const entry of config.entryPoints) {
        const recovery=watchSourceRecovery();
        let firstBuilt!:()=>void;const firstBuild=new Promise<void>(resolve=>{firstBuilt=resolve;});
        const ctx = recovery.attach(await esbuild.context({
          ...shared,
          entryPoints: [{in:entry.entry,out:basename(entry.outfile,'.js')}],
          outdir: distDir,
          entryNames: '[name].[hash]',
          assetNames: 'asset.[hash]',
          metafile: true,
          write: false,
          plugins: [clock,...(shared.plugins??[]),...(formaSsrPlugin&&entry.ssr!==false?[formaSsrPlugin({page:basename(entry.outfile,'.js'),outDir:distDir,entryPoint:config.ssrEntryPoints?.[basename(entry.outfile,'.js')]??entry.entry,clientEntryPoint:entry.entry,...pluginShared,onSourcesChanged:()=>recovery.changed()})]:[]),...(config.clientTemplates?[compiler!.formaClientPlugin()]:[]),jsxNamespaceFallback(),{name:'forma-paired-publish',setup(builder){
            builder.onEnd(result=>{try{if(!result.errors.length&&result.metafile)publishWatch(result,basename(entry.outfile,'.js'),[entry]);}finally{firstBuilt();}});
          }},recovery.plugin],
        }));
        await ctx.watch();
        await firstBuild;
      }

      // The dev manifest selects a complete retained generation. Old URLs stay
      // readable for requests already holding an earlier manifest/HTML response.
      const { manifest, warnings } = writeDevManifest() ?? await firstManifest;
      console.log(`\nDev manifest written: ${shownDir}/manifest.json`);

      // Generate a dev service worker so /sw.js doesn't 404
      generateServiceWorker(config, workerSourceFor(config, { app: config.app!, assets: {}, build: 'dev' }));

      // The pages' first compilation; each rebuild replaces its page's own.
      const diagnostics = [...collector.all(), ...(duplicateCore ? [duplicateCore] : [])];
      if (config.diagnosticsJson) writeDiagnosticsJson(config.diagnosticsJson, strict, diagnostics);

      return {
        manifest,
        buildHash: 'dev',
        warnings,
        diagnostics,
        // Watch mode is a development build, unminified and inline-mapped:
        // its bytes are not what a route ships, so there is no report.
        sizes: [],
        sizeReport: { version: 1, ceilings: REPORT_CEILINGS, routes: [] },
      };
    }

    // ── Parallel production builds ────────────────────────────────────
    // Each pass's metafile feeds the summary printed once the files have
    // their hashed names (FORMA-180 F3).
    const metafiles: esbuild.Metafile[] = [];
    const buildFailures: unknown[] = [];
    if (config.codeSplitting && config.entryPoints.length) {
      try {
        const result = await esbuild.build(splitOptions);
        const classified = classify(result, config.entryPoints);
        publishOutputFiles(classified.outputs);
        metafiles.push(classified.metafile);
        graph = classified.nextGraph; products = classified.candidates;
        for (const entry of config.entryPoints) {
          if (config.serverInlined?.includes(entry.outfile)) cpSync(join(distDir, graph.assets[entry.outfile]), join(distDir, entry.outfile));
        }
      } catch (error) { buildFailures.push(error); }
    } else {
      const attempts = await Promise.allSettled(
        ordinaryEntries.map(async (entry) => {
          const result = await esbuild.build(entryOptionsFor(entry, shared, pluginShared));
          const classified = classify(result, [entry]);
          publishOutputFiles(classified.outputs);
          products = new Map([...products, ...classified.candidates]);
          metafiles.push(classified.metafile);
        }),
      );
      for (const attempt of attempts) if (attempt.status === 'rejected') buildFailures.push(attempt.reason);
      for (const group of navigationGroups) {
        try {
          const result = await esbuild.build(groupOptionsFor(group, shared, pluginShared));
          const candidates = classifyGroup(group, result);
          publishOutputFiles(result.outputFiles!);
          products = new Map([...products, ...candidates]); metafiles.push(result.metafile!);
        } catch (error) { buildFailures.push(error); }
      }
    }

    duplicateCore = duplicateCoreDiagnostic(metafiles);
    if (duplicateCore) console.warn(`${duplicateCore.code}: ${duplicateCore.message}`);

    // ── SSR diagnostics: the JSON report, then publication refusal ─────
    // Every page is compiled by now, so the aggregate failure names them all.
    const diagnostics = [...collector.all(), ...(duplicateCore ? [duplicateCore] : [])];
    if (config.diagnosticsJson) {
      const written = writeDiagnosticsJson(config.diagnosticsJson, strict, diagnostics);
      console.log(`   SSR diagnostics written: ${written} (${diagnostics.length})`);
    }
    // Every entry has completed. Report all source diagnostics before a
    // bundler failure so strict-only publication never hides later pages.
    const errors = collector.errors();
    if (errors.length > 0) throw strictFailure(errors);
    if (buildFailures.length) throw buildFailures[0];
    if (firstPassFailure) throw firstPassFailure;

    mark('bundle');

    // ── Content hashing ───────────────────────────────────────────────
    const assets = hashAssets(config, graph?.assets);
    for (const group of navigationGroups) for (const owner of group.owners) assets[`${owner}.js`] = assets[navigationFilename(group)];
    printBundleSummary(metafiles, assets, shownDir);
    console.log(`   ${Object.keys(assets).length} assets hashed`);
    mark('hash');

    // ── Retention (FORMA-186, DR-29, L-25) ────────────────────────────
    // The previous release's own hashed assets, copied into staging after this
    // build's are hashed and before anything is compressed, so they get the same
    // compressed siblings and the same manifest metadata, flagged. A failure
    // here leaves the existing output as it was, like any other.
    let retained: ReadonlySet<string> = new Set();
    if (previous) {
      if (previous.note) console.log(`   ${previous.note}`);
      retained = retainFrom(previous, distDir).retained;
      if (!previous.note) console.log(`   ${retained.size} files retained from the previous release (build ${previous.build.slice(0, 12)}...)`);
    }

    // ── Compression ───────────────────────────────────────────────────
    // The preview frame's runtime is inlined by forma-server, never fetched:
    // no compressed copies of it, and no place in the worker's lists.
    // Verified by: packages/build/tests/preview-frame.test.ts > "the runtime is inlined, never fetched: no compressed copies, and no entry in the on-demand worker's immutable list"
    const frameFile = frame ? assets[FRAME_RUNTIME_ASSET] : undefined;
    compressAssets(distDir, new Set(frameFile ? [frameFile] : []));
    mark('compress');

    // ── Manifest generation ───────────────────────────────────────────
    const { manifest, warnings, classes } = generateManifest(config, assets, graph?.staticDependencies, graph?.files, products, identity, retained);
    if (duplicateCore) warnings.push(`${duplicateCore.code}: ${duplicateCore.message}`);
    mark('manifest');

    // ── The size report, and the gate on it (FORMA-021, FORMA-190, L-55) ──
    // Each route's class and Forma's code, from the bundler's metafile and the
    // hashed files the manifest names, with the service worker a route with
    // JavaScript registers, the preview frame's runtime when it is on, and the
    // times above; printed for every route. A route over a ceiling fails the
    // build here, before the manifest is written and the staging directory
    // swapped in, so the previous output stays as it was (L-21).
    // Verified by: packages/build/tests/route-size.test.ts > "fails the build with BUILD-819 when a route's Forma code is over the ceiling, leaving no output"
    // Verified by: packages/build/tests/route-size.test.ts > "fails the build with BUILD-819 when a route's JavaScript is over 75 KiB, unless the route is declared a canvas, and a canvas is held to 365 KiB"
    const workerSource = workerSourceFor(config, manifest, frameFile ? [frameFile] : []);
    const worker = workerSize(workerSource);
    const sizes = routeSizes(manifest.routes, metafiles, assets, distDir, {
      classes,
      canvases: new Set(Object.entries(config.routes).filter(([, mapping]) => mapping.canvas === true).map(([route]) => route)),
      worker,
    });
    applySizeBudgets(sizes, config.sizeBudgets, sizePolicyFromEnvironment(process.env.FORMA_SIZE_POLICY));
    const budgetWarnings = sizeBudgetWarnings(sizes);
    warnings.push(...budgetWarnings);
    for (const warning of budgetWarnings) console.warn(warning);
    const times: BuildTimes = { totalMs: Object.values(phases).reduce((total, ms) => total + ms, 0), phases };
    const sizeReport: SizeReport = {
      version: 1,
      ceilings: REPORT_CEILINGS,
      routes: sizes,
      worker,
      ...(frameFile && frame ? { frame: frameSize(frameFile, distDir, frame.sourceBytes) } : {}),
      times,
    };
    console.log(`\n${formatSizeReport(sizeReport).join('\n')}`);
    const overCeiling = routeSizeFailure(sizes);
    // Retain measurements outside the staged product even if publication is refused.
    mkdirSync(dirname(config.sizeReportJson!), { recursive: true });
    writeFileAtomic(config.sizeReportJson!, serializeSizeReport(sizeReport));
    if (overCeiling) throw new SizeBudgetError(overCeiling.message, sizeReport, config.sizeReportJson!);

    writeFileSync(
      join(distDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    // Beside the manifest, without the times: the application embeds this
    // directory, and the same sources are the same bytes. forma-server refuses
    // to serve it, as it refuses the manifest.
    // Verified by: packages/build/tests/route-size.test.ts > "writes size-report.json beside the manifest: every route with its class, ceilings and verdict, the service worker, and no clock reading"
    writeFileSync(join(distDir, 'size-report.json'), serializeSizeReport(sizeReport));
    console.log(
      `\nManifest written: ${shownDir}/manifest.json (build: ${manifest.build.slice(0, 12)}...)`,
    );
    console.log(`Size report written: ${shownDir}/size-report.json`);

    // ── Service worker generation ─────────────────────────────────────
    generateServiceWorker(config, workerSource);

    return {
      manifest,
      buildHash: manifest.build,
      warnings,
      diagnostics,
      sizes,
      sizeReport,
    };
  } catch (err) {
    // Watch mode: remove the output directory if this build created it. A
    // production build's caller removes the staging directory.
    if (createdDir && existsSync(distDir)) {
      rmSync(distDir, { recursive: true, force: true });
    }
    throw err;
  }
}
