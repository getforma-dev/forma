/**
 * The size report per route and N2's gate (FORMA-021; decision brief L-55).
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
import {
  FORMA_CODE_CEILING_GZIP,
  formatRouteSizes,
  identityBannerBytes,
  isFormaInput,
  packageNameOf,
  routeSizeFailure,
  type RouteSize,
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

function fixture(corePad = padding(CORE_PAD, 1)) {
  const root = mkdtempSync(join(tmpdir(), 'forma-route-size-'));
  temporary.push(root);
  const src = join(root, 'src');
  const dist = join(root, 'dist');
  mkdirSync(src);
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  standIn(root, '@getforma/core', corePad);
  standIn(root, 'alien-signals', padding(SIGNALS_PAD, 2));
  writeFileSync(join(src, 'app-code.ts'), `export const APP = ${JSON.stringify(padding(APP_PAD, 3))};`);
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
      '/': { js: ['home'], css: [] },
      '/about': { js: ['about'], css: [] },
      '/static': { js: [], css: [] },
    },
  };
  return { root, dist, config };
}

// The identity banner (a block comment with a 16-hex id) and the newline esbuild writes after a banner.
const BANNER_BYTES = '/*forma-build:'.length + 16 + '*/\n'.length;

const gzip9 = (buffer: Buffer) => gzipSync(buffer, { level: 9 }).length;
const brotli11 = (buffer: Buffer) => brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

describe('the size report per route (FORMA-021)', () => {
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
    // ...except the identity banner Forma's build writes at the top of every JavaScript
    // file (FORMA-186): the ruling is that it is Forma's code, so even a route with none of
    // core's bytes carries it in its figure, and nothing else of the file.
    expect(about.forma.raw).toBe(BANNER_BYTES);
    expect(about.forma.gzip).toBeGreaterThan(0);
    expect(about.forma.gzip).toBeLessThan(about.gzip); // the rest of the file is the application's
    expect(about.application.gzip).toBe(about.gzip - about.forma.gzip);
    expect(byRoute['/static']).toMatchObject({ files: [], raw: 0, gzip: 0, brotli: 0, forma: { raw: 0, gzip: 0, brotli: 0 }, over: false });

    // The build printed the same figures, one line per route, under the ceiling.
    const printed = lines.join('\n');
    expect(printed).toContain(`ceiling ${FORMA_CODE_CEILING_GZIP.toLocaleString('en-US')} B`);
    expect(printed).toContain(`${home.forma.gzip.toLocaleString('en-US')} B of ${home.gzip.toLocaleString('en-US')} B gzip`);
    expect(printed).toContain(home.files[0].file);
    expect(printed).toContain('/static  no JavaScript');
    expect(printed).not.toContain('OVER');
  });

  it('fails the build with BUILD-819 when a route\'s Forma code is over the ceiling, leaving no output', async () => {
    // A core whose bytes alone are over the ceiling: gzip cannot take seeded
    // text of this length under 25,500 B.
    const { dist, config } = fixture(padding(40_000, 4));
    await expect(build(config)).rejects.toThrow(/BUILD-819 a route is over N2's ceiling of 25,500 B gzip -9 of Forma code per route: \/ loads [\d,]+ B gzip -9 of Forma code \(home\.[A-Za-z0-9]+\.js\)/);
    // The gate ran before the staging directory was swapped in: a first build
    // leaves no output directory and nothing beside it (L-21).
    expect(existsSync(dist)).toBe(false);
    expect(readdirSync(join(dist, '..')).filter((name) => name.includes('forma-staging'))).toEqual([]);
  });

  it('names every route over the ceiling, and none under it', () => {
    const sizes = (route: string, formaGzip: number): RouteSize => ({
      route, files: [{ file: `${route.slice(1) || 'home'}.abc12345.js`, raw: 0, gzip: formaGzip + 100, brotli: 0, forma: { raw: 0, gzip: formaGzip, brotli: 0 } }],
      raw: 0, gzip: formaGzip + 100, brotli: 0,
      forma: { raw: 0, gzip: formaGzip, brotli: 0 }, application: { raw: 0, gzip: 100, brotli: 0 }, over: formaGzip > 1000,
    });
    expect(routeSizeFailure([sizes('/', 1000), sizes('/about', 0)], 1000)).toBeUndefined();
    const failure = routeSizeFailure([sizes('/', 1001), sizes('/about', 999), sizes('/admin', 5000)], 1000)!;
    expect(failure.message).toMatch(/^BUILD-819 2 routes are over N2's ceiling of 1,000 B/);
    expect(failure.message).toContain('/ loads 1,001 B gzip -9 of Forma code (home.abc12345.js)');
    expect(failure.message).toContain('/admin loads 5,000 B gzip -9 of Forma code (admin.abc12345.js)');
    expect(failure.message).not.toContain('/about');
    // The printed report marks the same routes.
    const printed = formatRouteSizes([sizes('/', 1001), sizes('/about', 999)], 1000).join('\n');
    expect(printed).toContain('1,001 B of 1,101 B gzip');
    expect(printed).toMatch(/\/ .*OVER by 1 B/);
    expect(printed).not.toMatch(/\/about.*OVER/);
  });

  it('counts the identity banner at the top of a file as Forma\'s code, and a comment anywhere else as nobody\'s', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forma-route-size-banner-'));
    temporary.push(dir);
    const write = (name: string, text: string) => { writeFileSync(join(dir, name), text); return join(dir, name); };
    const banner = '/*forma-build:5f0c9a1e7d2b4c86*/';
    expect(identityBannerBytes(write('banner.js', `${banner}\nexport const a=1;`))).toBe(banner.length + 1);
    expect(identityBannerBytes(write('no-newline.js', `${banner}export const a=1;`))).toBe(banner.length);
    // Only the exact header the build writes: not another comment, not a short or upper-case id,
    // not the banner further down a file.
    expect(identityBannerBytes(write('other.js', '/*a comment*/\nexport const a=1;'))).toBe(0);
    expect(identityBannerBytes(write('short.js', '/*forma-build:5f0c9a1e*/\n'))).toBe(0);
    expect(identityBannerBytes(write('upper.js', '/*forma-build:5F0C9A1E7D2B4C86*/\n'))).toBe(0);
    expect(identityBannerBytes(write('later.js', `export const a=1;\n${banner}\n`))).toBe(0);
    expect(identityBannerBytes(join(dir, 'missing.js'))).toBe(0);
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
