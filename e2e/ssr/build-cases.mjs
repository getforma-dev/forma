/**
 * Build every SSR e2e case with the REAL build pipeline, exactly as an
 * application's `build.ts --ssr` does: `@getforma/build`'s `build()` with
 * `ssr: true`, which bundles the browser entry with esbuild and runs
 * `@getforma/compiler`'s SSR plugin to emit the page's `.ir` module.
 *
 *   node e2e/ssr/build-cases.mjs
 *
 * Inputs: `e2e/ssr/cases/<case>/app.tsx` (plus `slots.json`, read later by the
 * Rust renderer). `@getforma/core` resolves through the symlink build.sh puts at
 * `e2e/ssr/node_modules/@getforma/core` (the FormaJS checkout under test).
 *
 * Outputs: `e2e/ssr/out/build/<case>/` (the build's dist) and every hashed
 * asset copied into `e2e/ssr/out/site/_assets/`, where the pages rendered by
 * render/ reference them (`/_assets/<file>`).
 *
 * Declared native contracts refuse unsupported expressions. This harness also
 * re-emits each accepted entry and checks that the served IR is byte-identical,
 * with exactly the expected registered island definitions.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const casesDir = join(here, 'cases');
const outDir = join(here, 'out');
const buildDir = join(outDir, 'build');
const assetsDir = join(outDir, 'site', '_assets');

/**
 * Islands each case must compile to, by name. A case with none is a static
 * route: since 3.0.0 (FORMA-105, DR-6) a server-rendered page with no island
 * loads no JavaScript at all, so its `/` route has an empty `js` list.
 */
const expectedIslands = {
  'browser-only': ['Chart'],
  'edited-controls': ['Controls'],
  'generic-state': ['Counter'],
  'ledger-arrival': ['Arrival'],
  'keyed-moves': ['KeyedRows'],
  'root-fragment': [],
  select: ['Picker'],
  'textarea-child': ['Editor'],
  'textarea-value': ['Editor'],
  title: ['Heading'],
};

function fail(message) {
  console.error(`build-cases: ${message}`);
  process.exit(1);
}

for (const pkg of ['build', 'compiler']) {
  if (!existsSync(join(repo, 'packages', pkg, 'dist', 'index.js'))) {
    fail(`packages/${pkg}/dist is missing; run \`npm run build\` first`);
  }
}
if (!existsSync(join(here, 'node_modules', '@getforma', 'core', 'package.json'))) {
  fail('e2e/ssr/node_modules/@getforma/core is missing; run e2e/ssr/build.sh, which links the FormaJS checkout');
}

const { build } = await import(join(repo, 'packages/build/dist/index.js'));
const { generateRealIr } = await import(join(repo, 'packages/compiler/dist/index.js'));

const cases = readdirSync(casesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (cases.length === 0) fail(`no cases in ${casesDir}`);
for (const name of Object.keys(expectedIslands)) {
  if (!cases.includes(name)) fail(`expectedIslands names ${name}, which is not a case`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });

for (const name of cases) {
  const entry = join(casesDir, name, 'app.tsx');
  if (!existsSync(entry)) fail(`${name}: no app.tsx`);
  const dist = join(buildDir, name);

  // One page per case, built under its own name so the hashed files of all
  // cases can share one /_assets/ directory without colliding. The same
  // app.tsx is built twice, as an application declares a page in both modes:
  // `/` is the server-rendered route (Phase 2), whose browser product the
  // compiler reduces to island activation, and `/csr` is the explicit Browser
  // route (`ssr: false`, Phase 1), which keeps the entry's mount and renders
  // the page whole from an empty #app.
  const { manifest } = await build({
    app: 'e2e-ssr',
    entryPoints: [
      { entry, outfile: `${name}.js` },
      { entry, outfile: `${name}-csr.js`, ssr: false },
    ],
    routes: { '/': { js: [name], css: [] }, '/csr': { js: [`${name}-csr`], css: [] } },
    outputDir: dist,
    ssr: true,
  });

  const route = manifest.routes['/'];
  if (!route?.ir) fail(`${name}: the build emitted no .ir module for route /`);
  if (route.mode !== 'ssr') fail(`${name}: route / is ${route.mode}, not ssr`);
  const csr = manifest.routes['/csr'];
  if (csr?.mode !== 'browser' || csr.js.length !== 1 || csr.ir) {
    fail(`${name}: route /csr must be an explicit Browser route with one script and no module; got ${JSON.stringify(csr)}`);
  }

  const real = generateRealIr(entry);
  if (!real) fail(`${name}: the compiler fell back to a placeholder module (generateRealIr returned null)`);
  const served = readFileSync(join(dist, route.ir));
  if (Buffer.compare(served, Buffer.from(real.binary)) !== 0) {
    fail(`${name}: the served ${route.ir} is not the module generateRealIr emits for ${entry}`);
  }
  const islands = real.islands.map((island) => island.name).sort();
  const expected = [...(expectedIslands[name] ?? [])].sort();
  if (JSON.stringify(islands) !== JSON.stringify(expected)) {
    fail(`${name}: expected islands ${JSON.stringify(expected)}, the compiler emitted ${JSON.stringify(islands)}`);
  }
  // A static page ships no script; a page with islands ships exactly its own.
  if (route.js.length !== (islands.length ? 1 : 0)) {
    fail(`${name}: route / with islands ${JSON.stringify(islands)} lists scripts ${JSON.stringify(route.js)}`);
  }

  for (const file of [...route.js, route.ir, ...csr.js]) {
    copyFileSync(join(dist, file), join(assetsDir, file));
  }
  console.log(`built ${name}: ${route.js.join(', ') || 'no script'} + ${route.ir} (islands: ${islands.join(', ') || 'none'}); /csr: ${csr.js.join(', ')}`);
}
