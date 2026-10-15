/**
 * @getforma/build — Build Pipeline
 *
 * Parameterized build pipeline extracted from the GateWASM admin build.ts.
 * Handles: esbuild bundling, CSS generation, font copying, SSR IR emission,
 * island registry generation, the preview frame's runtime
 * (previewFrame), content hashing, compression, manifest generation, service
 * worker generation, and budget warnings.
 */

import * as esbuild from 'esbuild';
import { generateManifest } from './manifest.js';
import { BUILD_WRITER_VERSION, checkProjectCompatibility, requireCompatibleCompiler, resolveAppName } from './compatibility.js';
import { compatibilityGuard } from './compatibility-watch.js';
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
  existsSync,
} from 'node:fs';
import { join, extname, basename, dirname, sep } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { APP_NAME, serviceWorkerSource } from './service-worker.js';
import { splitGraph, type SplitGraph } from './split-graph.js';
import { createStagingDirectory, replaceDirectory, writeFileAtomic, publishOutputFiles } from './output.js';
import { FRAME_RUNTIME_ASSET, readFrameRuntime, type FrameRuntime } from './preview-frame.js';
import { assertNoServerFunctions, serverDirectiveGuard } from './server-directives.js';
import {
  DiagnosticsCollector,
  isInsideOutputDir,
  resolveDiagnosticOptions,
  strictFailure,
  writeDiagnosticsJson,
  type CompilerDiagnostic,
} from './diagnostics.js';

import type {
  BuildConfig,
  BuildResult,
  AssetManifest,
  RouteManifest,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  const problems: string[] = [];
  const entryNames = new Set<string>();

  const serviceWorker: unknown = config.serviceWorker;
  if (serviceWorker !== undefined && serviceWorker !== 'on-demand') {
    problems.push(
      `serviceWorker is '${String(serviceWorker)}': use 'on-demand' (the default); precache was removed in v3`,
    );
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

function generateServiceWorker(
  config: BuildConfig,
  manifest: Pick<AssetManifest, 'app' | 'build' | 'assets'>,
  excludedFiles: string[] = [],
): void {
  const source = serviceWorkerSource({ ...manifest, development: config.watch === true, excludedFiles });
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
 * The esbuild options every bundle of a build shares. previewFrame's reading
 * of which core the bundles import (preview-frame.ts) bundles each entry in
 * memory with these same options, so its answer is the bundles'.
 */
function sharedOptions(config: BuildConfig, compatibility?: () => void): Partial<esbuild.BuildOptions> {
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
    // Watch mode is a development build (FORMA-169); production adds nothing.
    ...(config.watch ? WATCH_RESOLUTION : {}),
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
  strict?: boolean;
  onDiagnostics?: (diagnostics: CompilerDiagnostic[], page: string) => void;
}) => esbuild.Plugin;

/** What every SSR plugin instance of one build is given besides its page. */
type SsrPluginShared = Pick<Parameters<SsrPluginFactory>[0], 'strict' | 'onDiagnostics'>;

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
 * way leaves the previous output exactly as it was, and nothing beside it
 * (L-21). The application embeds `outputDir` in its binary, and used to embed
 * half a build after a failure. Watch mode writes in place, as before.
 * Verified by: packages/build/tests/build.test.ts > "leaves the previous build byte-identical when a build fails after writing files"
 * Verified by: packages/build/tests/build.test.ts > "a failed first build leaves no output directory and nothing beside it"
 */
export async function build(userConfig: BuildConfig): Promise<BuildResult> {
  // Validate before anything is written: a config error must not touch the
  // previous build's output on its way to failing.
  validateConfig(userConfig);
  // `strict` from the config, else FORMA_STRICT (FORMA-119).
  const project = process.cwd();
  const config: BuildConfig = { ...userConfig, ...resolveDiagnosticOptions(userConfig), app: resolveAppName(project, userConfig.app) };
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
  const writers = [
    { name: '@getforma/build', version: BUILD_WRITER_VERSION },
    ...(config.ssr && compiler ? [{ name: '@getforma/compiler', version: compiler.COMPILER_WRITER_VERSION }] : []),
  ];
  const compatibility = () => { checkProjectCompatibility(project, writers, config.ssr === true); };
  const compatibilityWarnings = checkProjectCompatibility(project, writers, config.ssr === true);
  await assertNoServerFunctions(config, sharedOptions(config));
  // What the config itself deprecates, each said once per build() call,
  // production and watch alike, on the console and in BuildResult.warnings.
  const deprecations = compatibilityWarnings;
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
    result = await buildInto({ ...config, outputDir: staging }, config.outputDir, frame, compiler, compatibility);
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
async function buildInto(config: BuildConfig, shownDir: string, frame: FrameRuntime | undefined, compiler: typeof import('@getforma/compiler') | undefined, compatibility: () => void): Promise<BuildResult> {
  const distDir = config.outputDir;
  const createdDir = !existsSync(distDir);

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
      console.log(`   Preview frame runtime: ${FRAME_RUNTIME_ASSET} from @getforma/core ${frame.version} (${frame.source}), ${frame.found}`);
    }
    // The dev manifest names it as itself, as it names every watched asset.
    const frameAssets: Record<string, string> = frame ? { [FRAME_RUNTIME_ASSET]: FRAME_RUNTIME_ASSET } : {};

    // ── esbuild shared config ─────────────────────────────────────────
    const shared = sharedOptions(config, compatibility);

    // ── Lazy-load SSR plugin only when needed ─────────────────────────
    let formaSsrPlugin: SsrPluginFactory | undefined;
    // Every page's coded diagnostics (FORMA-119). A production build applies
    // --strict itself, once every page is compiled, so the failure lists all
    // of them; watch mode hands it to each page's plugin.
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

    let graph: SplitGraph | undefined;
    const coreGraphs = new Map<string, esbuild.Metafile>();
    let duplicateCore: ReturnType<typeof duplicateCoreDiagnostic>;
    const recordCoreGraph = (key: string, metafile: esbuild.Metafile) => {
      coreGraphs.set(key, metafile);
      const next = duplicateCoreDiagnostic([...coreGraphs.values()]);
      if (next && next.message !== duplicateCore?.message) console.warn(`${next.code}: ${next.message}`);
      duplicateCore = next;
    };
    const splitOptions: esbuild.BuildOptions = {
      ...shared,
      entryPoints: config.entryPoints.map(entry => ({ in: entry.entry, out: basename(entry.outfile, '.js') })),
      outdir: distDir,
      splitting: true,
      metafile: true,
      write: false,
      entryNames: '[name].[hash]',
      chunkNames: 'chunk.[hash]',
      assetNames: 'asset.[hash]',
      plugins: [...(shared.plugins ?? []), ...(config.ssr && formaSsrPlugin ? config.entryPoints.filter(entry => entry.ssr !== false).map(entry => formaSsrPlugin!({
        page: basename(entry.outfile, '.js'),
        outDir: distDir,
        entryPoint: config.ssrEntryPoints?.[basename(entry.outfile, '.js')] ?? entry.entry,
        clientEntryPoint: entry.entry,
        ...pluginShared,
      })) : [])],
    };

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
        try { result = generateManifest(config, { ...graph?.assets, ...irAssets, ...frameAssets }, graph?.staticDependencies); }
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

      const acceptedGraphs=new Map<string,SplitGraph>();
      const publishWatch=(result:esbuild.BuildResult,key:string,nextGraph:SplitGraph)=>{
        if(result.errors.length||!result.metafile)return false;
        const nextIr={...irAssets},nextGraphs=new Map(acceptedGraphs);nextGraphs.set(key,nextGraph);
        const combined:SplitGraph={assets:{},staticDependencies:{},files:new Set()};
        for(const current of nextGraphs.values()){
          Object.assign(combined.assets,current.assets);Object.assign(combined.staticDependencies,current.staticDependencies);
          for(const file of current.files)combined.files.add(file);
        }
        const outputs=(result.outputFiles??[]).map(file=>{
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
            try {accepted=generateManifest(config,{...combined.assets,...nextIr,...frameAssets},combined.staticDependencies);}
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
        Object.assign(irAssets,nextIr);acceptedGraphs.set(key,nextGraph);graph=combined;
        recordCoreGraph(key,result.metafile);
        for(const file of result.outputFiles??[])if(file.path.endsWith('.ir'))console.log(`   IR rewritten: ${basename(file.path)} in ${Math.round(performance.now()-cycleStarted)} ms`);
        if(accepted){lastManifest=text;ready(accepted);}
        return true;
      };
      let cycleStarted=performance.now();
      const clock:esbuild.Plugin={name:'forma-paired-clock',setup(builder){builder.onStart(()=>{cycleStarted=performance.now();});}};

      if (config.codeSplitting && config.entryPoints.length) {
        let firstBuilt!:()=>void;const firstBuild=new Promise<void>(resolve=>{firstBuilt=resolve;});
        const ctx = await esbuild.context({
          ...splitOptions,
          write: false,
          plugins: [clock,...(splitOptions.plugins ?? []), {
            name: 'forma-split-manifest',
            setup(builder) {
              builder.onEnd(result => {
                firstBuilt();
                if (result.errors.length || !result.metafile) return;
                const next=splitGraph(result.metafile,config.entryPoints,distDir);
                publishWatch(result,'split',next);
              });
            },
          }],
        });
        await ctx.watch();
        await firstBuild;
      } else for (const entry of config.entryPoints) {
        let firstBuilt!:()=>void;const firstBuild=new Promise<void>(resolve=>{firstBuilt=resolve;});
        const ctx = await esbuild.context({
          ...shared,
          entryPoints: [{in:entry.entry,out:basename(entry.outfile,'.js')}],
          outdir: distDir,
          entryNames: '[name].[hash]',
          assetNames: 'asset.[hash]',
          metafile: true,
          write: false,
          plugins: [clock,...(shared.plugins??[]),...(formaSsrPlugin&&entry.ssr!==false?[formaSsrPlugin({page:basename(entry.outfile,'.js'),outDir:distDir,entryPoint:config.ssrEntryPoints?.[basename(entry.outfile,'.js')]??entry.entry,clientEntryPoint:entry.entry,...pluginShared})]:[]),{name:'forma-paired-publish',setup(builder){
            builder.onEnd(result=>{try{if(!result.errors.length&&result.metafile)publishWatch(result,basename(entry.outfile,'.js'),splitGraph(result.metafile,[entry],distDir));}finally{firstBuilt();}});
          }}],
        });
        await ctx.watch();
        await firstBuild;
      }

      // The dev manifest selects a complete retained generation. Old URLs stay
      // readable for requests already holding an earlier manifest/HTML response.
      const { manifest, warnings } = writeDevManifest() ?? await firstManifest;
      console.log(`\nDev manifest written: ${shownDir}/manifest.json`);

      // Generate a dev service worker so /sw.js doesn't 404
      generateServiceWorker(config, { app: config.app!, assets: {}, build: 'dev' });

      // The pages' first compilation; each rebuild replaces its page's own.
      const diagnostics = [...collector.all(), ...(duplicateCore ? [duplicateCore] : [])];
      if (config.diagnosticsJson) writeDiagnosticsJson(config.diagnosticsJson, strict, diagnostics);

      return {
        manifest,
        buildHash: 'dev',
        warnings,
        diagnostics,
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
        publishOutputFiles(result.outputFiles??[]);
        if (!result.metafile) throw new Error('Split build did not return its module graph.');
        metafiles.push(result.metafile);
        graph = splitGraph(result.metafile, config.entryPoints, distDir);
        for (const entry of config.entryPoints) {
          if (config.serverInlined?.includes(entry.outfile)) cpSync(join(distDir, graph.assets[entry.outfile]), join(distDir, entry.outfile));
        }
      } catch (error) { buildFailures.push(error); }
    } else {
      const attempts = await Promise.allSettled(
        config.entryPoints.map(async (entry) => {
          const buildOptions: esbuild.BuildOptions = {
            ...shared,
            entryPoints: [entry.entry],
            outfile: join(distDir, entry.outfile),
            metafile: true,
            write: false,
          };

          if (config.ssr && entry.ssr !== false && formaSsrPlugin) {
            const pageName = basename(entry.outfile, '.js');
            const ssrEntryPoint =
              config.ssrEntryPoints?.[pageName] ?? entry.entry;
            buildOptions.plugins = [
              ...(buildOptions.plugins || []),
              formaSsrPlugin({
                page: pageName,
                outDir: distDir,
                entryPoint: ssrEntryPoint,
                clientEntryPoint: entry.entry,
                ...pluginShared,
              }),
            ];
          }

          const result = await esbuild.build(buildOptions);
          publishOutputFiles(result.outputFiles??[]);
          if (result.metafile) metafiles.push(result.metafile);
        }),
      );
      for (const attempt of attempts) if (attempt.status === 'rejected') buildFailures.push(attempt.reason);
    }

    duplicateCore = duplicateCoreDiagnostic(metafiles);
    if (duplicateCore) console.warn(`${duplicateCore.code}: ${duplicateCore.message}`);

    // ── SSR diagnostics: the JSON report, then strict mode ────────────
    // Every page is compiled by now, so a strict failure names them all.
    const diagnostics = [...collector.all(), ...(duplicateCore ? [duplicateCore] : [])];
    if (config.diagnosticsJson) {
      const written = writeDiagnosticsJson(config.diagnosticsJson, strict, diagnostics);
      console.log(`   SSR diagnostics written: ${written} (${diagnostics.length})`);
    }
    // Wait for every entry before removing staging or writing the report. A
    // mandatory compiler refusal stays fatal even when strict mode is off.
    if (buildFailures.length) throw buildFailures[0];
    if (strict) {
      const errors = collector.errors();
      if (errors.length > 0) throw strictFailure(errors);
    }

    // ── Content hashing ───────────────────────────────────────────────
    const assets = hashAssets(config, graph?.assets);
    printBundleSummary(metafiles, assets, shownDir);
    console.log(`   ${Object.keys(assets).length} assets hashed`);

    // ── Compression ───────────────────────────────────────────────────
    // The preview frame's runtime is inlined by forma-server, never fetched:
    // no compressed copies of it, and no place in the worker's lists.
    // Verified by: packages/build/tests/preview-frame.test.ts > "the runtime is inlined, never fetched: no compressed copies, and no entry in the on-demand worker's immutable list"
    const frameFile = frame ? assets[FRAME_RUNTIME_ASSET] : undefined;
    compressAssets(distDir, new Set(frameFile ? [frameFile] : []));

    // ── Manifest generation ───────────────────────────────────────────
    const { manifest, warnings } = generateManifest(config, assets, graph?.staticDependencies, graph?.files);
    if (duplicateCore) warnings.push(`${duplicateCore.code}: ${duplicateCore.message}`);

    writeFileSync(
      join(distDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    console.log(
      `\nManifest written: ${shownDir}/manifest.json (build: ${manifest.build.slice(0, 12)}...)`,
    );

    // ── Service worker generation ─────────────────────────────────────
    generateServiceWorker(config, manifest, frameFile ? [frameFile] : []);

    return {
      manifest,
      buildHash: manifest.build,
      warnings,
      diagnostics,
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
