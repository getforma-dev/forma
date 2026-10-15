/**
 * The size report per route: Forma's code and the route's own, the route's
 * class and its ceilings, the service worker, the preview frame's document,
 * and the build's times; and the gate on it (FORMA-021, FORMA-190; decision
 * brief L-55, DR-34, DR-35). One report: the build prints it, returns it as
 * `BuildResult.sizeReport`, and writes it beside the manifest as
 * `size-report.json`.
 *
 * N2 as restated by L-55: Forma's own browser code, `@getforma/core` and its
 * signal library `alien-signals` as the route's bundles carry them, is at most
 * 25,500 B gzip at level 9 (1 KB = 1,000 B) on a route that has any, Brotli
 * reported beside it; the application's own code is outside that ceiling. The
 * 10 KB of v2's appendix C is unreachable under the accepted strict adoption
 * (FORMA-104) and the declared island state block (FORMA-103), so the ceiling
 * is the measured Forma code rounded up to the next 500 B (DR-35's fallback).
 *
 * The route classes (DR-35; the manifest decides them, see `generateManifest`)
 * and what each may ship, in gzip -9 bytes (1 KiB = 1,024 B):
 *
 * - `no-interactive-region`: a page with nothing to activate. It ships 0 bytes
 *   of JavaScript, a service worker counted: its manifest lists no script, and
 *   forma-server writes the worker's registration only on a page that publishes
 *   a JavaScript entry.
 * - `islands`: a server-rendered page that activates its islands. Forma's code
 *   at most 25,500 B; all of its JavaScript at most 75 KiB, the "other
 *   server-rendered pages" ceiling of N2, or 365 KiB if the route is declared a
 *   canvas (`canvas: true` on the route).
 * - `whole-page-mount`: a route whose page the browser mounts whole (a declared
 *   `ssr: false` entry, or any route of an application built without `ssr`),
 *   one island spanning the page: the same ceilings as islands.
 *
 * What a route loads cold is what the manifest lists for it: its `js` files
 * and their static `modulepreload` dependencies (dynamic `import()` chunks are
 * loaded later, if at all, and are not counted, as the manifest excludes
 * them), and the service worker a route with JavaScript registers. A route with
 * no JavaScript (a static SSR route) is 0 bytes.
 *
 * How the bytes are attributed. A route's file is one minified bundle, so its
 * gzip size is a property of the whole file; the bundler's metafile says how
 * many of its raw bytes each input module contributed (`bytesInOutput`, the
 * minified bytes). Forma's share of the file's raw bytes is applied to the
 * file's gzip and Brotli sizes: `formaGzip = round(gzip × formaRaw / raw)`.
 * That is an estimate, stated as such; a marginal measurement (gzip with and
 * without Forma's bytes) is not additive either, and the two agree to within
 * one percent on the minimal template's Counter route (FORMA-021's analysis).
 *
 * The file holds no clock reading: the application embeds the output directory
 * in its binary, and two builds of the same sources write the same bytes. The
 * build's times are in the printed report and in `BuildResult.sizeReport.times`.
 *
 * Verified by: packages/build/tests/route-size.test.ts > "reports each route's Forma code beside its own, in gzip -9 and Brotli, from the bundler's metafile"
 * Verified by: packages/build/tests/route-size.test.ts > "fails the build with BUILD-819 when a route's Forma code is over the ceiling, leaving no output"
 */
import type { Metafile } from 'esbuild';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import type { RouteManifest } from './types.js';

/** N2's ceiling: Forma's code per route, bytes gzip -9 (L-55). */
export const FORMA_CODE_CEILING_GZIP = 25_500;

/** N2's "other server-rendered pages": all of a route's JavaScript, bytes gzip -9 (75 KiB). */
export const PAGE_JAVASCRIPT_CEILING_GZIP = 75 * 1024;

/** N2's canvas, the JavaScript-heavy budget: all of a declared canvas route's JavaScript, bytes gzip -9 (365 KiB). */
export const CANVAS_JAVASCRIPT_CEILING_GZIP = 365 * 1024;

/** The packages whose bundled bytes are Forma's code under N2. */
export const FORMA_PACKAGES: ReadonlySet<string> = new Set(['@getforma/core', 'alien-signals']);

/** The generated service worker, a file of every production build. */
export const WORKER_FILE = 'sw.js';

/** How a route is classified (DR-35). */
export type RouteClass = 'no-interactive-region' | 'islands' | 'whole-page-mount';

const CLASS_LABEL: Readonly<Record<RouteClass, string>> = {
  'no-interactive-region': 'no interactive region',
  islands: 'islands',
  'whole-page-mount': 'whole-page mount',
};

/** What a class may ship, bytes gzip -9: Forma's code, and all of the route's JavaScript. */
export interface RouteCeilings {
  forma: number;
  javascript: number;
}

/** The ceilings of a class; a canvas declaration raises only the JavaScript of a route that has JavaScript. */
export function routeCeilings(routeClass: RouteClass, canvas = false): RouteCeilings {
  if (routeClass === 'no-interactive-region') return { forma: 0, javascript: 0 };
  return { forma: FORMA_CODE_CEILING_GZIP, javascript: canvas ? CANVAS_JAVASCRIPT_CEILING_GZIP : PAGE_JAVASCRIPT_CEILING_GZIP };
}

/** Raw (minified), gzip -9 and Brotli-11 bytes. */
export interface ByteSizes {
  raw: number;
  gzip: number;
  brotli: number;
}

/** One file a route loads cold, with Forma's share of it. */
export interface RouteSizeFile extends ByteSizes {
  file: string;
  forma: ByteSizes;
}

/** One route's size report. */
export interface RouteSize extends ByteSizes {
  route: string;
  /** What the route is: the ceilings follow from it (`ceilings`). */
  class: RouteClass;
  /** The route is declared a canvas (`canvas: true`): 365 KiB of JavaScript instead of 75 KiB. */
  canvas: boolean;
  /** The files the route loads cold: its `js` and `modulepreload` lists. Empty for a route with no JavaScript. */
  files: RouteSizeFile[];
  /** `@getforma/core` and `alien-signals` as bundled: N2's figure is `forma.gzip`. */
  forma: ByteSizes;
  /** Everything else in the route's files: the application's own code and its other dependencies. */
  application: ByteSizes;
  /** The service worker the route registers: `sw.js` for a route with JavaScript, zero for one without. */
  worker: ByteSizes;
  /** All the JavaScript the route ships: `files` and `worker`. The class's JavaScript ceiling is measured on `javascript.gzip`. */
  javascript: ByteSizes;
  ceilings: RouteCeilings;
  /** Which ceilings the route is over: Forma's code, all of its JavaScript, or both. */
  exceeded: Array<'forma' | 'javascript'>;
  /** `exceeded` is not empty: the build fails. */
  over: boolean;
}

/** A file the build writes that is not a route's: the service worker, the preview frame's runtime. */
export interface FileSize extends ByteSizes {
  file: string;
}

/** Wall-clock milliseconds, per phase of a production build and in all (N7). */
export interface BuildTimes {
  totalMs: number;
  phases: {
    /** CSS, fonts, the JavaScript bundles and the SSR modules. */
    bundle: number;
    /** Content hashing. */
    hash: number;
    /** Brotli 11 and gzip 9 of every script and style. */
    compress: number;
    /** The manifest. */
    manifest: number;
  };
}

/** The one report of a production build. */
export interface SizeReport {
  version: 1;
  /** The policy: Forma's code per route, then all of a page's JavaScript, then a canvas's (gzip -9 bytes). */
  ceilings: { forma: number; page: number; canvas: number };
  routes: RouteSize[];
  /** The generated `sw.js`. */
  worker?: FileSize;
  /** The preview frame's runtime, inlined into every preview document and never fetched (`previewFrame`); the frame document row. */
  frame?: FileSize;
  /** In the printed report and the build result; never in the file. */
  times?: BuildTimes;
}

/** The name in the nearest `package.json` above `file`, or undefined outside any package. */
export function packageNameOf(file: string, cache: Map<string, string | undefined>): string | undefined {
  const walked: string[] = [];
  let dir = dirname(file);
  let found: string | undefined;
  for (;;) {
    if (cache.has(dir)) {
      found = cache.get(dir);
      break;
    }
    walked.push(dir);
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name;
        found = typeof name === 'string' ? name : undefined;
      } catch {
        found = undefined;
      }
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const each of walked) cache.set(each, found);
  return found;
}

/**
 * Whether a metafile input is Forma's code: a file inside `@getforma/core` or
 * `alien-signals`, however the bundle reached it (`formaAlias`, a workspace
 * link, a nested `node_modules`). The compatibility guard's virtual inputs are
 * nobody's bytes.
 *
 * Verified by: packages/build/tests/route-size.test.ts > "counts the bytes of @getforma/core and alien-signals as Forma's, wherever they are installed, and nothing else"
 */
export function isFormaInput(input: string, cache: Map<string, string | undefined>): boolean {
  if (input.startsWith('forma-compatibility:')) return false;
  const name = packageNameOf(resolve(input), cache);
  return name !== undefined && FORMA_PACKAGES.has(name);
}

/** Raw, gzip -9 and Brotli-11 bytes of content held in memory. */
export function measureBytes(content: Buffer): ByteSizes {
  return {
    raw: content.length,
    gzip: gzipSync(content, { level: 9 }).length,
    brotli: brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
}

/**
 * A file's sizes. The compression pass has already written `.gz` (gzip -9)
 * and `.br` (Brotli 11) beside every file it could shrink, with the settings
 * N2 counts, so those are read rather than compressed again (Brotli 11 is the
 * slow part of a build); a file without one is compressed here.
 */
function compressed(path: string): ByteSizes {
  const content = readFileSync(path);
  const sidecar = (extension: string): number | undefined => (existsSync(`${path}${extension}`) ? statSync(`${path}${extension}`).size : undefined);
  return {
    raw: content.length,
    gzip: sidecar('.gz') ?? gzipSync(content, { level: 9 }).length,
    brotli: sidecar('.br') ?? brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
}

const ZERO: ByteSizes = { raw: 0, gzip: 0, brotli: 0 };

const sum = (sizes: ByteSizes[]): ByteSizes => ({
  raw: sizes.reduce((total, each) => total + each.raw, 0),
  gzip: sizes.reduce((total, each) => total + each.gzip, 0),
  brotli: sizes.reduce((total, each) => total + each.brotli, 0),
});

/**
 * One route's report from its cold-load files and the service worker: the
 * sums, the class's ceilings and the verdict. The worker counts only for a
 * route that has JavaScript, since forma-server writes its registration only
 * on a page that publishes a JavaScript entry (static pages never bootstrap a
 * worker): N2's "a service worker counted" is nothing for a route without any.
 *
 * Verified by: packages/build/tests/route-size.test.ts > "S7: a route at its ceiling passes, a route one byte over fails naming the route and its bytes"
 * Verified by: packages/build/tests/route-size.test.ts > "counts the service worker in the JavaScript of a route that has JavaScript, and never in one that has none"
 */
export function assembleRoute(
  route: string,
  routeClass: RouteClass,
  canvas: boolean,
  files: RouteSizeFile[],
  worker: ByteSizes = ZERO,
): RouteSize {
  const total = sum(files);
  const forma = sum(files.map((file) => file.forma));
  const registered: ByteSizes = files.length > 0 ? { raw: worker.raw, gzip: worker.gzip, brotli: worker.brotli } : ZERO;
  const javascript = sum([total, registered]);
  const ceilings = routeCeilings(routeClass, canvas);
  const exceeded: RouteSize['exceeded'] = [];
  if (forma.gzip > ceilings.forma) exceeded.push('forma');
  if (javascript.gzip > ceilings.javascript) exceeded.push('javascript');
  return {
    route,
    class: routeClass,
    canvas,
    files,
    ...total,
    forma,
    application: { raw: total.raw - forma.raw, gzip: total.gzip - forma.gzip, brotli: total.brotli - forma.brotli },
    worker: registered,
    javascript,
    ceilings,
    exceeded,
    over: exceeded.length > 0,
  };
}

/** What `routeSizes` needs besides the files: how each route is classified, which are canvases, the worker. */
export interface RouteSizeContext {
  /** Each route's class, as `generateManifest` decided it. */
  classes: Readonly<Record<string, RouteClass>>;
  /** The routes declared `canvas: true`. */
  canvases?: ReadonlySet<string>;
  /** The generated `sw.js`, which a route with JavaScript registers. */
  worker?: ByteSizes;
}

/**
 * The size report for every route of a production build: `routes` as the
 * manifest names them (hashed files), `metafiles` from every bundling pass,
 * `assets` the hashing pass's map of pre-hash to hashed names, `distDir`
 * where the files are.
 */
export function routeSizes(
  routes: Record<string, Pick<RouteManifest, 'js' | 'modulepreload'>>,
  metafiles: readonly Metafile[],
  assets: Record<string, string>,
  distDir: string,
  context: RouteSizeContext,
): RouteSize[] {
  // Each file the manifest names, by its final name, to the metafile output
  // that wrote it: the bundling pass names the pre-hash file, the hashing
  // pass renames it, and a code-split pass hashes as it writes.
  const outputs = new Map<string, Metafile['outputs'][string]>();
  for (const metafile of metafiles) {
    for (const [path, output] of Object.entries(metafile.outputs)) {
      const name = basename(path);
      outputs.set(assets[name] ?? name, output);
    }
  }
  const packages = new Map<string, string | undefined>();
  const measured = new Map<string, RouteSizeFile>();
  const measure = (file: string): RouteSizeFile => {
    const known = measured.get(file);
    if (known) return known;
    const output = outputs.get(file);
    if (!output) throw new Error(`BUILD-819 route file ${file} was written by no bundling pass, so its Forma code cannot be attributed`);
    const sizes = compressed(join(distDir, file));
    let formaRaw = 0;
    for (const [input, contribution] of Object.entries(output.inputs)) {
      if (isFormaInput(input, packages)) formaRaw += contribution.bytesInOutput;
    }
    // The file's own bytes are the denominator: its module wrapper and export
    // lines, which no input owns, count as the application's.
    const share = sizes.raw > 0 ? formaRaw / sizes.raw : 0;
    const result: RouteSizeFile = {
      file,
      ...sizes,
      forma: { raw: formaRaw, gzip: Math.round(sizes.gzip * share), brotli: Math.round(sizes.brotli * share) },
    };
    measured.set(file, result);
    return result;
  };

  return Object.entries(routes).map(([route, mapping]) => {
    const routeClass = context.classes[route];
    if (!routeClass) throw new Error(`BUILD-819 route ${route} was given no class, so its ceilings cannot be chosen`);
    const files = [...new Set([...mapping.js, ...(mapping.modulepreload ?? [])])].map(measure);
    return assembleRoute(route, routeClass, context.canvases?.has(route) === true, files, context.worker);
  });
}

/** The worker the build generated, from its source: the same bytes it writes as `sw.js`. */
export function workerSize(source: string): FileSize {
  return { file: WORKER_FILE, ...measureBytes(Buffer.from(source)) };
}

/** The preview frame's runtime as the build wrote it into `distDir`: the file forma-server inlines into every frame document. */
export function frameSize(file: string, distDir: string): FileSize {
  return { file, ...compressed(join(distDir, file)) };
}

/** The ceilings the report states. */
export const REPORT_CEILINGS: SizeReport['ceilings'] = {
  forma: FORMA_CODE_CEILING_GZIP,
  page: PAGE_JAVASCRIPT_CEILING_GZIP,
  canvas: CANVAS_JAVASCRIPT_CEILING_GZIP,
};

/** The report as `size-report.json` holds it: without the times, so the file is the same bytes for the same sources. */
export function serializeSizeReport(report: SizeReport): string {
  const { times: _times, ...file } = report;
  return `${JSON.stringify(file, null, 2)}\n`;
}

const bytes = (n: number): string => n.toLocaleString('en-US');

const time = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);

const classOf = (size: RouteSize): string => `${CLASS_LABEL[size.class]}${size.canvas && size.class !== 'no-interactive-region' ? ', canvas' : ''}`;

/** The report as the build prints it: one line per route, then the worker, the frame document and the times. */
export function formatSizeReport(report: SizeReport): string[] {
  const { routes } = report;
  const routeWidth = Math.max(1, ...routes.map((size) => size.route.length));
  const classWidth = Math.max(1, ...routes.map((size) => classOf(size).length));
  const label = (name: string): string => `   ${name.padEnd(14)}   `;
  const lines = [
    '   Size report (gzip -9, Brotli beside it; 1 KB = 1,000 B, 1 KiB = 1,024 B). Forma code is @getforma/core and alien-signals as bundled;',
    `   N2's ceilings are policy (decision brief L-55, DR-35): Forma code ${bytes(report.ceilings.forma)} B, the JavaScript of a page ${bytes(report.ceilings.page)} B, of a canvas ${bytes(report.ceilings.canvas)} B, a route with no interactive region none.`,
  ];
  for (const size of routes) {
    const route = size.route.padEnd(routeWidth);
    const kind = classOf(size).padEnd(classWidth);
    if (size.files.length === 0) {
      lines.push(`   ${route}  ${kind}  no JavaScript`);
      continue;
    }
    const over: string[] = [];
    if (size.exceeded.includes('forma')) over.push(`Forma code by ${bytes(size.forma.gzip - size.ceilings.forma)} B`);
    if (size.exceeded.includes('javascript')) over.push(`JavaScript by ${bytes(size.javascript.gzip - size.ceilings.javascript)} B`);
    lines.push(
      `   ${route}  ${kind}` +
        `  Forma ${bytes(size.forma.gzip)} of ${bytes(size.ceilings.forma)} B` +
        `  JavaScript ${bytes(size.javascript.gzip)} of ${bytes(size.ceilings.javascript)} B` +
        `  (Brotli ${bytes(size.forma.brotli)} and ${bytes(size.javascript.brotli)})` +
        `  ${size.files.map((file) => file.file).join(' ')}` +
        (over.length > 0 ? `  OVER: ${over.join(', ')}` : ''),
    );
  }
  if (report.worker) {
    const { file, raw, gzip, brotli } = report.worker;
    lines.push(`${label('Service worker')}${file}  ${bytes(raw)} B raw, ${bytes(gzip)} B gzip, ${bytes(brotli)} B Brotli; counted in the JavaScript of each route that has JavaScript`);
  }
  if (report.frame) {
    const { file, raw, gzip, brotli } = report.frame;
    lines.push(`${label('Frame document')}${file}  ${bytes(raw)} B raw, ${bytes(gzip)} B gzip, ${bytes(brotli)} B Brotli; inlined into every preview document, never fetched, and not a route's`);
  }
  if (report.times) {
    const { totalMs, phases } = report.times;
    lines.push(
      `${label('Build time')}${time(totalMs)}: ` +
        `bundle ${time(phases.bundle)}, hash ${time(phases.hash)}, compress ${time(phases.compress)}, manifest ${time(phases.manifest)}`,
    );
  }
  return lines;
}

/**
 * The failure for the routes over a ceiling, naming each with its class and
 * bytes, or undefined when every route is within its own.
 */
export function routeSizeFailure(sizes: readonly RouteSize[]): Error | undefined {
  const over = sizes.filter((size) => size.over);
  if (over.length === 0) return undefined;
  const listed = over
    .map((size) => {
      const measures = size.exceeded.map((each) =>
        each === 'forma'
          ? `Forma code ${bytes(size.forma.gzip)} B against ${bytes(size.ceilings.forma)} B`
          : `JavaScript ${bytes(size.javascript.gzip)} B against ${bytes(size.ceilings.javascript)} B`,
      );
      // The worker is named where it is part of the figure: not Forma's code, but JavaScript the route ships.
      const files = [...size.files.map((file) => file.file), ...(size.exceeded.includes('javascript') && size.worker.gzip > 0 ? [WORKER_FILE] : [])];
      return `${size.route} (${classOf(size)}) ${measures.join(' and ')} (${files.length > 0 ? files.join(', ') : 'no files'})`;
    })
    .join('; ');
  return new Error(
    `BUILD-819 ${over.length === 1 ? 'a route is over its size ceiling' : `${over.length} routes are over their size ceilings`} ` +
      `(gzip -9; decision brief L-55 and DR-35; 1 KB = 1,000 B, 1 KiB = 1,024 B): ${listed}. ` +
      'Trim what the route imports or ships, split it, or declare a heavy page\'s route `canvas: true` (365 KiB of JavaScript instead of 75 KiB); the ceilings are policy and not configurable.',
  );
}
