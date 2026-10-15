/**
 * The size report per route, its classes and ceilings, and N2's gate
 * (FORMA-021, FORMA-190; decision brief L-55, DR-34, DR-35).
 *
 * Each case builds a fixture application against a stand-in `@getforma/core`
 * and `alien-signals` in its own node_modules, with the real pipeline, so what
 * is asserted is what a production build prints and returns, and what fails
 * it. The stand-ins carry string padding of known sizes: a string literal
 * survives minification byte for byte, so each package's contribution to the
 * bundle is known to within the module wrapper.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { build } from './helpers/named-build';
import { generateManifest } from '../src/manifest';
import type { EntryProducts } from '../src/entry-products';
import {
  CANVAS_JAVASCRIPT_CEILING_GZIP,
  FORMA_CODE_CEILING_GZIP,
  PAGE_JAVASCRIPT_CEILING_GZIP,
  assembleRoute,
  formatSizeReport,
  isFormaInput,
  packageNameOf,
  routeCeilings,
  routeSizeFailure,
  serializeSizeReport,
  type ByteSizes,
  type RouteClass,
  type RouteSize,
  type RouteSizeFile,
} from '../src/route-size';

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

/** Text of `length` bytes that gzip compresses only a little, from a fixed seed. */
function padding(length: number, seed: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let state = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    out += alphabet[state % alphabet.length];
  }
  return out;
}

const CORE_PAD = 3000;
const SIGNALS_PAD = 1000;
const APP_PAD = 500;

/** A package in the fixture's node_modules exporting `h` and a padding string. */
function standIn(root: string, name: string, pad: string): void {
  const dir = join(root, 'node_modules', ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, type: 'module', exports: './index.js' }));
  writeFileSync(join(dir, 'index.js'), `export const h = () => {}; export const PAD = ${JSON.stringify(pad)};`);
}

function fixture(corePad = padding(CORE_PAD, 1), appPad = padding(APP_PAD, 3), canvas = false) {
  const root = mkdtempSync(join(tmpdir(), 'forma-route-size-'));
  temporary.push(root);
  const src = join(root, 'src');
  const dist = join(root, 'dist');
  mkdirSync(src);
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  standIn(root, '@getforma/core', corePad);
  standIn(root, 'alien-signals', padding(SIGNALS_PAD, 2));
  writeFileSync(join(src, 'app-code.ts'), `export const APP = ${JSON.stringify(appPad)};`);
  writeFileSync(
    join(src, 'home.ts'),
    'import { h, PAD as CORE } from "@getforma/core"; import { PAD as SIGNALS } from "alien-signals"; import { APP } from "./app-code";\n' +
      'export const page = [h, CORE, SIGNALS, APP];',
  );
  writeFileSync(join(src, 'about.ts'), 'export const about = "ABOUT_PAGE";');
  const config = {
    entryPoints: [
      { entry: join(src, 'home.ts'), outfile: 'home.js' },
      { entry: join(src, 'about.ts'), outfile: 'about.js' },
    ],
    outputDir: dist,
    routes: {
      '/': { js: ['home'], css: [], ...(canvas ? { canvas: true } : {}) },
      '/about': { js: ['about'], css: [] },
      '/static': { js: [], css: [] },
    },
  };
  return { root, dist, config };
}

const gzip9 = (buffer: Buffer) => gzipSync(buffer, { level: 9 }).length;
const brotli11 = (buffer: Buffer) => brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;


const LIMITS = { forma: 25_500, page: 76_800, canvas: 373_760 };
const bytesOf = (gzip: number): ByteSizes => ({ raw: gzip * 3, gzip, brotli: gzip - Math.floor(gzip / 10) });
const none: ByteSizes = { raw: 0, gzip: 0, brotli: 0 };

/**
 * A route as the report assembles it: one cold-load file when it has any
 * Forma code or application code, whose Forma share is `forma` bytes gzip of
 * `forma + application`, and the worker the build wrote (`worker` bytes gzip).
 */
function route(name: string, routeClass: RouteClass, { forma = 0, application = 0, worker = 0, canvas = false } = {}): RouteSize {
  const files: RouteSizeFile[] = forma + application > 0
    ? [{ file: `${name.slice(1) || 'home'}.abc12345.js`, ...bytesOf(forma + application), forma: bytesOf(forma) }]
    : [];
  return assembleRoute(name, routeClass, canvas, files, worker > 0 ? bytesOf(worker) : none);
}

describe('the size report per route (FORMA-021, FORMA-190)', () => {
  it('reports each route\'s Forma code beside its own, in gzip -9 and Brotli, from the bundler\'s metafile', async () => {
    const { dist, config } = fixture();
    const lines: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    let result;
    try { result = await build(config); } finally { console.log = log; }

    const byRoute = Object.fromEntries(result.sizes.map((size) => [size.route, size]));
    expect(Object.keys(byRoute).sort()).toEqual(['/', '/about', '/static']);

    // The home route: one hashed file, measured as written, compressed as the
    // build compresses (gzip -9, Brotli 11).
    const home = byRoute['/'];
    expect(home.files.map((file) => file.file)).toEqual(result.manifest.routes['/'].js);
    const bytes = readFileSync(join(dist, home.files[0].file));
    expect(home.raw).toBe(bytes.length);
    expect(home.gzip).toBe(gzip9(bytes));
    expect(home.brotli).toBe(brotli11(bytes));

    // Forma's raw bytes are core's and alien-signals' padding plus their
    // wrappers; the application's are its own padding plus the entry's. The
    // compressed shares follow the raw share and sum to the file's size.
    expect(home.forma.raw).toBeGreaterThanOrEqual(CORE_PAD + SIGNALS_PAD);
    expect(home.forma.raw).toBeLessThan(CORE_PAD + SIGNALS_PAD + 200);
    expect(home.application.raw).toBeGreaterThanOrEqual(APP_PAD);
    expect(home.application.raw).toBeLessThan(APP_PAD + 200);
    expect(home.forma.gzip + home.application.gzip).toBe(home.gzip);
    expect(home.forma.brotli + home.application.brotli).toBe(home.brotli);
    const share = home.forma.raw / (home.forma.raw + home.application.raw);
    expect(Math.abs(home.forma.gzip - home.gzip * share)).toBeLessThanOrEqual(1);
    expect(home.forma.gzip).toBeGreaterThan(home.application.gzip);
    expect(home.over).toBe(false);

    // A route with no Forma code reports none; a route with no JavaScript is 0.
    const about = byRoute['/about'];
    expect(about.files).toHaveLength(1);
    expect(about.forma).toEqual({ raw: 0, gzip: 0, brotli: 0 });
    expect(about.application.gzip).toBe(about.gzip);
    expect(byRoute['/static']).toMatchObject({ files: [], raw: 0, gzip: 0, brotli: 0, forma: { raw: 0, gzip: 0, brotli: 0 }, over: false });

    // The build printed the same figures, one line per route, under the ceiling.
    const printed = lines.join('\n');
    expect(printed).toContain(`Forma ${home.forma.gzip.toLocaleString('en-US')} of ${FORMA_CODE_CEILING_GZIP.toLocaleString('en-US')} B`);
    expect(printed).toContain(`JavaScript ${home.javascript.gzip.toLocaleString('en-US')} of ${PAGE_JAVASCRIPT_CEILING_GZIP.toLocaleString('en-US')} B`);
    expect(printed).toContain(home.files[0].file);
    expect(printed).toMatch(/\/static +no interactive region +no JavaScript/);
    expect(printed).not.toContain('OVER');
  });

  it('fails the build with BUILD-819 when a route\'s Forma code is over the ceiling, leaving no output', async () => {
    // A core whose bytes alone are over the ceiling: gzip cannot take seeded
    // text of this length under 25,500 B.
    const { dist, config } = fixture(padding(40_000, 4));
    await expect(build(config)).rejects.toThrow(/BUILD-819 a route is over its size ceiling \(.*\): \/ \(whole-page mount\) Forma code [\d,]+ B against 25,500 B \(home\.[A-Za-z0-9]+\.js\)/);
    // The gate ran before the staging directory was swapped in: a first build
    // leaves no output directory and nothing beside it (L-21).
    expect(existsSync(dist)).toBe(false);
    expect(readdirSync(join(dist, '..')).filter((name) => name.includes('forma-staging'))).toEqual([]);
  });

  it('names every route over a ceiling, and none under it', () => {
    const sizes = [
      route('/', 'islands', { forma: 26_000, application: 100 }),
      route('/about', 'islands', { forma: 24_000 }),
      route('/admin', 'whole-page-mount', { forma: 1_000, application: 80_000 }),
      route('/plain', 'no-interactive-region'),
    ];
    const failure = routeSizeFailure(sizes)!;
    expect(failure.message).toMatch(/^BUILD-819 2 routes are over their size ceilings/);
    expect(failure.message).toContain('/ (islands) Forma code 26,000 B against 25,500 B (home.abc12345.js)');
    expect(failure.message).toContain('/admin (whole-page mount) JavaScript 81,000 B against 76,800 B (admin.abc12345.js)');
    expect(failure.message).not.toContain('/about');
    expect(failure.message).not.toContain('/plain');
    expect(routeSizeFailure(sizes.slice(1, 2))).toBeUndefined();
    // The printed report marks the same routes, and only those.
    const printed = formatSizeReport({ version: 1, ceilings: LIMITS, routes: sizes }).join('\n');
    expect(printed).toMatch(/\/ +islands .*OVER: Forma code by 500 B/);
    expect(printed).toMatch(/\/admin +whole-page mount .*OVER: JavaScript by 4,200 B/);
    expect(printed).not.toMatch(/\/about.*OVER/);
    expect(printed).not.toMatch(/\/plain.*OVER/);
  });

  it('gives each class its ceilings: none for a route without an interactive region, N2 and 75 KiB for islands and a whole-page mount, 365 KiB for a declared canvas', () => {
    expect(routeCeilings('no-interactive-region')).toEqual({ forma: 0, javascript: 0 });
    // A canvas declaration gives no JavaScript to a route that has no interactive region.
    expect(routeCeilings('no-interactive-region', true)).toEqual({ forma: 0, javascript: 0 });
    for (const routeClass of ['islands', 'whole-page-mount'] as const) {
      expect(routeCeilings(routeClass)).toEqual({ forma: 25_500, javascript: 76_800 });
      expect(routeCeilings(routeClass, true)).toEqual({ forma: 25_500, javascript: 373_760 });
    }
    // The three figures the table is built from: N2 as L-55 restates it, and a KiB of 1,024 B.
    expect([FORMA_CODE_CEILING_GZIP, PAGE_JAVASCRIPT_CEILING_GZIP, CANVAS_JAVASCRIPT_CEILING_GZIP]).toEqual([25_500, 75 * 1024, 365 * 1024]);
  });

  it('S7: a route at its ceiling passes, a route one byte over fails naming the route and its bytes', () => {
    type Bytes = { forma: number; application: number };
    // [measure, class, canvas, the bytes at the ceiling, one byte over, the figure named, the ceiling named]
    const cases: Array<[string, RouteClass, boolean, Bytes, Bytes, string, number]> = [
      ['Forma code of islands', 'islands', false, { forma: 25_500, application: 0 }, { forma: 25_501, application: 0 }, 'Forma code 25,501', 25_500],
      ['Forma code of a whole-page mount', 'whole-page-mount', false, { forma: 25_500, application: 0 }, { forma: 25_501, application: 0 }, 'Forma code 25,501', 25_500],
      ['JavaScript of islands', 'islands', false, { forma: 1_000, application: 75_800 }, { forma: 1_000, application: 75_801 }, 'JavaScript 76,801', 76_800],
      ['JavaScript of a whole-page mount', 'whole-page-mount', false, { forma: 1_000, application: 75_800 }, { forma: 1_000, application: 75_801 }, 'JavaScript 76,801', 76_800],
      ['JavaScript of a canvas', 'whole-page-mount', true, { forma: 1_000, application: 372_760 }, { forma: 1_000, application: 372_761 }, 'JavaScript 373,761', 373_760],
      ['JavaScript of a route with no interactive region', 'no-interactive-region', false, { forma: 0, application: 0 }, { forma: 0, application: 1 }, 'JavaScript 1', 0],
    ];
    const label = { 'islands': 'islands', 'whole-page-mount': 'whole-page mount', 'no-interactive-region': 'no interactive region' };
    for (const [measure, routeClass, canvas, at, over, named, ceiling] of cases) {
      const atCeiling = route('/page', routeClass, { ...at, canvas });
      expect(atCeiling.over, `${measure}: at its ceiling`).toBe(false);
      expect(routeSizeFailure([atCeiling]), `${measure}: at its ceiling`).toBeUndefined();

      const oneOver = route('/page', routeClass, { ...over, canvas });
      expect(oneOver.over, `${measure}: one byte over`).toBe(true);
      const failure = routeSizeFailure([oneOver, atCeiling])!;
      expect(failure.message, measure).toMatch(/^BUILD-819 a route is over its size ceiling/);
      expect(failure.message, measure).toContain(`/page (${label[routeClass]}${canvas ? ', canvas' : ''}) ${named} B against ${ceiling.toLocaleString('en-US')} B`);
    }
  });

  it('counts the service worker in the JavaScript of a route that has JavaScript, and never in one that has none', () => {
    const withScript = route('/', 'islands', { forma: 1_000, application: 500, worker: 700 });
    expect(withScript.worker.gzip).toBe(700);
    expect(withScript.gzip).toBe(1_500);
    expect(withScript.javascript.gzip).toBe(2_200);
    expect(withScript.javascript.raw).toBe(withScript.raw + withScript.worker.raw);
    expect(withScript.javascript.brotli).toBe(withScript.brotli + withScript.worker.brotli);
    // forma-server writes the registration only on a page that publishes a JavaScript entry.
    const without = route('/static', 'no-interactive-region', { worker: 700 });
    expect(without.worker).toEqual({ raw: 0, gzip: 0, brotli: 0 });
    expect(without.javascript).toEqual({ raw: 0, gzip: 0, brotli: 0 });
    expect(without.over).toBe(false);
    // A route with no interactive region that lists a script anyway fails, whatever the script is.
    const contradiction = route('/static', 'no-interactive-region', { application: 40, worker: 700 });
    expect(contradiction.over).toBe(true);
    expect(routeSizeFailure([contradiction])!.message).toContain('/static (no interactive region) JavaScript 740 B against 0 B');
  });

  it('classifies each route from its entry\'s native product: a static page has no interactive region, a page with islands is islands, a declared ssr:false entry is a whole-page mount', () => {
    const root = mkdtempSync(join(tmpdir(), 'forma-route-class-'));
    temporary.push(root);
    for (const file of ['home.h.ir', 'panel.h.ir', 'panel.h.js', 'studio.h.js']) writeFileSync(join(root, file), file);
    const product = (page: string, islands: number) => ({
      page, mode: 'ssr', sourceEntry: join(root, `${page}.ts`), browserEntry: join(root, `${page}.ts`),
      irFile: join(root, `${page}.ir`), irHash: 'unused', browserRequired: islands > 0,
      islands: Array.from({ length: islands }, (_, i) => ({ name: `Island${i}` })),
    });
    const products = new Map([['home.js', product('home', 0)], ['panel.js', product('panel', 2)]]) as unknown as EntryProducts;
    const entry = (name: string, ssr?: false) => ({ entry: join(root, `${name}.ts`), outfile: `${name}.js`, ...(ssr === false ? { ssr } : {}) });
    const config = {
      outputDir: root, app: 'classes', ssr: true,
      entryPoints: [entry('home'), entry('panel'), entry('studio', false)],
      routes: { '/': { js: ['home'], css: [] }, '/panel': { js: ['panel'], css: [] }, '/studio': { js: ['studio'], css: [] }, '/empty': { js: [], css: [] } },
    };
    const assets = { 'home.ir': 'home.h.ir', 'panel.ir': 'panel.h.ir', 'panel.js': 'panel.h.js', 'studio.js': 'studio.h.js' };
    const { classes, manifest } = generateManifest(config, assets, {}, new Set(), products);
    expect(classes).toEqual({
      '/': 'no-interactive-region',
      '/panel': 'islands',
      '/studio': 'whole-page-mount',
      '/empty': 'no-interactive-region',
    });
    // The class is what the manifest already says: the static route lists no script, the others do.
    expect(manifest.routes['/'].js).toEqual([]);
    expect(manifest.routes['/panel'].js).toEqual(['panel.h.js']);
    expect(manifest.routes['/studio']).toMatchObject({ mode: 'browser', js: ['studio.h.js'] });
  });

  it('writes size-report.json beside the manifest: every route with its class, ceilings and verdict, the service worker, and no clock reading', async () => {
    const { dist, config } = fixture();
    const result = await build(config);
    const path = join(dist, 'size-report.json');
    expect(existsSync(join(dist, 'manifest.json'))).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toBe(serializeSizeReport(result.sizeReport));
    const written = JSON.parse(text);

    expect(written.version).toBe(1);
    expect(written.ceilings).toEqual({ forma: 25_500, page: 76_800, canvas: 373_760 });
    expect(written.routes.map((each: RouteSize) => [each.route, each.class, each.canvas, each.over])).toEqual([
      ['/', 'whole-page-mount', false, false],
      ['/about', 'whole-page-mount', false, false],
      ['/static', 'no-interactive-region', false, false],
    ]);
    expect(written.routes[0].ceilings).toEqual({ forma: 25_500, javascript: 76_800 });
    expect(written.routes[2].ceilings).toEqual({ forma: 0, javascript: 0 });
    expect(written.routes[0]).toEqual(JSON.parse(JSON.stringify(result.sizes[0])));

    // The worker is the file the build wrote, compressed as N2 counts.
    const worker = readFileSync(join(dist, 'sw.js'));
    expect(written.worker).toEqual({ file: 'sw.js', raw: worker.length, gzip: gzip9(worker), brotli: brotli11(worker) });
    expect(written.routes[0].worker).toEqual({ raw: worker.length, gzip: gzip9(worker), brotli: brotli11(worker) });
    expect(written.routes[0].javascript.gzip).toBe(written.routes[0].gzip + gzip9(worker));
    expect(written.routes[2].javascript.gzip).toBe(0);

    // No frame row without previewFrame, no clock in the file, and the file is no asset: the manifest does not list it.
    expect(written).not.toHaveProperty('frame');
    expect(written).not.toHaveProperty('times');
    expect(Object.keys(result.manifest.assets)).not.toContain('size-report.json');

    // The application embeds this directory in its binary: another build of the same sources is the same bytes.
    const again = fixture();
    await build(again.config);
    expect(readFileSync(join(again.dist, 'size-report.json'), 'utf8')).toBe(text);
  });

  it('times the build by phase for the printed report and the result, and keeps the times out of the file', async () => {
    const { dist, config } = fixture();
    const lines: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    let result;
    try { result = await build(config); } finally { console.log = log; }
    const times = result.sizeReport.times!;
    expect(Object.keys(times.phases)).toEqual(['bundle', 'hash', 'compress', 'manifest']);
    for (const ms of [times.totalMs, ...Object.values(times.phases)]) {
      expect(Number.isInteger(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(0);
    }
    expect(times.phases.bundle).toBeGreaterThan(0);
    expect(times.totalMs).toBe(Object.values(times.phases).reduce((total, ms) => total + ms, 0));
    expect(lines.join('\n')).toMatch(/Build time +[\d.,]+ (?:ms|s): bundle [\d.,]+ (?:ms|s), hash [\d.,]+ (?:ms|s), compress [\d.,]+ (?:ms|s), manifest [\d.,]+ (?:ms|s)/);
    expect(readFileSync(join(dist, 'size-report.json'), 'utf8')).not.toMatch(/times|Ms\b/);
  });

  it('fails the build with BUILD-819 when a route\'s JavaScript is over 75 KiB, unless the route is declared a canvas, and a canvas is held to 365 KiB', async () => {
    // Application code that gzip cannot take under 76,800 B, and under 373,760 B.
    const heavy = padding(110_000, 3);
    const refused = fixture(undefined, heavy);
    await expect(build(refused.config)).rejects.toThrow(
      /BUILD-819 a route is over its size ceiling \(.*\): \/ \(whole-page mount\) JavaScript [\d,]+ B against 76,800 B \(home\.[A-Za-z0-9]+\.js, sw\.js\)/,
    );
    expect(existsSync(refused.dist)).toBe(false);

    const canvas = fixture(undefined, heavy, true);
    const result = await build(canvas.config);
    const home = result.sizes.find((each) => each.route === '/')!;
    expect(home).toMatchObject({ class: 'whole-page-mount', canvas: true, over: false, exceeded: [] });
    expect(home.ceilings).toEqual({ forma: 25_500, javascript: 373_760 });
    expect(home.javascript.gzip).toBeGreaterThan(76_800);

    // Declared or not, the canvas ceiling holds.
    const past = fixture(undefined, padding(520_000, 5), true);
    await expect(build(past.config)).rejects.toThrow(/\/ \(whole-page mount, canvas\) JavaScript [\d,]+ B against 373,760 B/);
    expect(existsSync(past.dist)).toBe(false);
  });

  it('refuses a canvas that is not a boolean before writing anything', async () => {
    const { dist, config } = fixture();
    const bad = { ...config, routes: { ...config.routes, '/': { js: ['home'], css: [], canvas: 'yes' } } };
    await expect(build(bad as never)).rejects.toThrow(/routes\['\/'\]\.canvas is "yes": use true to declare the route a canvas/);
    expect(existsSync(dist)).toBe(false);
  });

  it('counts the bytes of @getforma/core and alien-signals as Forma\'s, wherever they are installed, and nothing else', () => {
    const root = mkdtempSync(join(tmpdir(), 'forma-route-size-pkg-'));
    temporary.push(root);
    const pkg = (dir: string, name: string) => {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name }));
    };
    pkg('node_modules/@getforma/core', '@getforma/core');
    pkg('node_modules/@getforma/core/dist', '@getforma/core'); // a nested manifest keeps the name
    pkg('node_modules/alien-signals', 'alien-signals');
    pkg('node_modules/other', 'other');
    pkg('vendor/forma/packages/core', '@getforma/core'); // a workspace link, outside node_modules
    pkg('', 'app');
    mkdirSync(join(root, 'src'));
    const cache = new Map<string, string | undefined>();
    expect(packageNameOf(join(root, 'src/app.ts'), cache)).toBe('app');
    expect(isFormaInput(join(root, 'node_modules/@getforma/core/dist/chunk-ABC.js'), cache)).toBe(true);
    expect(isFormaInput(join(root, 'node_modules/@getforma/core/index.js'), cache)).toBe(true);
    expect(isFormaInput(join(root, 'node_modules/alien-signals/esm/index.mjs'), cache)).toBe(true);
    expect(isFormaInput(join(root, 'vendor/forma/packages/core/dist/index.js'), cache)).toBe(true);
    expect(isFormaInput(join(root, 'node_modules/other/index.js'), cache)).toBe(false);
    expect(isFormaInput(join(root, 'src/app.ts'), cache)).toBe(false);
    expect(isFormaInput('forma-compatibility:guard', cache)).toBe(false);
    // Outside every package: nobody's, and not Forma's.
    expect(packageNameOf('/', cache)).toBeUndefined();
  });
});
