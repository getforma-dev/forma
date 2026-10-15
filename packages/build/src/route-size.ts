/**
 * The size report per route, and N2's gate on it (FORMA-021; decision brief
 * L-55, DR-34, DR-35).
 *
 * N2 as restated by L-55: Forma's own browser code on a route, `@getforma/core`
 * and its signal library `alien-signals` as the route's bundles carry them, is
 * at most 25,500 B gzip at level 9 (1 KB = 1,000 B), Brotli reported beside
 * it; the application's own code is outside the ceiling; a route over it fails
 * the build. The 10 KB of v2's appendix C is unreachable under the accepted
 * strict adoption (FORMA-104) and the declared island state block (FORMA-103),
 * so the ceiling is the measured Forma code rounded up to the next 500 B.
 *
 * What a route loads cold is what the manifest lists for it: its `js` files
 * and their static `modulepreload` dependencies (dynamic `import()` chunks are
 * loaded later, if at all, and are not counted, as the manifest excludes
 * them). A route with no JavaScript (a static SSR route) is 0 bytes.
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
 * One thing besides those packages' bytes is Forma's: the identity banner
 * (FORMA-186, DR-29) that Forma's build writes at the top of every JavaScript
 * file, the lead's ruling. No input owns it, so it is counted from the file's
 * own first bytes. It is a 16-hex id, which does not compress, so it costs about
 * 30 B gzip for each JavaScript file a route loads cold (measured on the SSR
 * lane's Counter: 29 B for one file, 74 B for the same page split in two).
 *
 * Verified by: packages/build/tests/route-size.test.ts > "reports each route's Forma code beside its own, in gzip -9 and Brotli, from the bundler's metafile"
 * Verified by: packages/build/tests/route-size.test.ts > "counts the identity banner at the top of a file as Forma's code, and a comment anywhere else as nobody's"
 * Verified by: packages/build/tests/route-size.test.ts > "fails the build with BUILD-819 when a route's Forma code is over the ceiling, leaving no output"
 */
import type { Metafile } from 'esbuild';
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { IDENTITY_BANNER_HEAD } from './identity.js';
import type { RouteManifest } from './types.js';

/** N2's ceiling: Forma's code per route, bytes gzip -9 (L-55). */
export const FORMA_CODE_CEILING_GZIP = 25_500;

/** The packages whose bundled bytes are Forma's code under N2. */
export const FORMA_PACKAGES: ReadonlySet<string> = new Set(['@getforma/core', 'alien-signals']);

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
  /** The files the route loads cold: its `js` and `modulepreload` lists. Empty for a route with no JavaScript. */
  files: RouteSizeFile[];
  /** `@getforma/core` and `alien-signals` as bundled: N2's figure is `forma.gzip`. */
  forma: ByteSizes;
  /** Everything else in the route's files: the application's own code and its other dependencies. */
  application: ByteSizes;
  /** `forma.gzip` over the ceiling. */
  over: boolean;
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

/**
 * The bytes of the identity banner at the top of `path`, or 0: Forma's build writes
 * it into every JavaScript file (identity.ts), so N2 counts it as Forma's code. Only
 * the exact header counts, and only at the very start.
 */
export function identityBannerBytes(path: string): number {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const head = Buffer.alloc(64);
    const read = readSync(fd, head, 0, head.length, 0);
    const match = IDENTITY_BANNER_HEAD.exec(head.subarray(0, read).toString('latin1'));
    return match ? match[0].length : 0;
  } catch {
    return 0;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
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

const sum = (sizes: ByteSizes[]): ByteSizes => ({
  raw: sizes.reduce((total, each) => total + each.raw, 0),
  gzip: sizes.reduce((total, each) => total + each.gzip, 0),
  brotli: sizes.reduce((total, each) => total + each.brotli, 0),
});

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
  ceiling = FORMA_CODE_CEILING_GZIP,
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
    // The identity banner is Forma's (see the header). The file's own bytes are the
    // denominator: its module wrapper and export lines, which no input owns, count as
    // the application's.
    formaRaw += identityBannerBytes(join(distDir, file));
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
    const files = [...new Set([...mapping.js, ...(mapping.modulepreload ?? [])])].map(measure);
    const total = sum(files);
    const forma = sum(files.map((file) => file.forma));
    return {
      route,
      files,
      ...total,
      forma,
      application: { raw: total.raw - forma.raw, gzip: total.gzip - forma.gzip, brotli: total.brotli - forma.brotli },
      over: forma.gzip > ceiling,
    };
  });
}

const bytes = (n: number): string => n.toLocaleString('en-US');

/** The report as the build prints it, one line per route. */
export function formatRouteSizes(sizes: readonly RouteSize[], ceiling = FORMA_CODE_CEILING_GZIP): string[] {
  const width = Math.max(1, ...sizes.map((size) => size.route.length));
  const lines = [
    `   Forma code per route (N2: @getforma/core and alien-signals as bundled, gzip -9, ceiling ${bytes(ceiling)} B; Brotli beside it):`,
  ];
  for (const size of sizes) {
    const route = size.route.padEnd(width);
    if (size.files.length === 0) {
      lines.push(`   ${route}  no JavaScript`);
      continue;
    }
    const verdict = size.over ? `  OVER by ${bytes(size.forma.gzip - ceiling)} B` : '';
    lines.push(
      `   ${route}  ${bytes(size.forma.gzip)} B of ${bytes(size.gzip)} B gzip` +
        ` (Brotli ${bytes(size.forma.brotli)} of ${bytes(size.brotli)})` +
        `  ${size.files.map((file) => file.file).join(' ')}${verdict}`,
    );
  }
  return lines;
}

/**
 * The failure for the routes over the ceiling, naming each with its bytes, or
 * undefined when every route is under it.
 */
export function routeSizeFailure(sizes: readonly RouteSize[], ceiling = FORMA_CODE_CEILING_GZIP): Error | undefined {
  const over = sizes.filter((size) => size.forma.gzip > ceiling);
  if (over.length === 0) return undefined;
  const listed = over
    .map((size) => `${size.route} loads ${bytes(size.forma.gzip)} B gzip -9 of Forma code (${size.files.map((file) => file.file).join(', ')})`)
    .join('; ');
  return new Error(
    `BUILD-819 ${over.length === 1 ? 'a route is' : `${over.length} routes are`} over N2's ceiling of ${bytes(ceiling)} B gzip -9 of Forma code per route: ${listed}. ` +
      'Trim what the route imports from @getforma/core, or split it; the ceiling is decision brief L-55 (DR-35) and is not configurable.',
  );
}
