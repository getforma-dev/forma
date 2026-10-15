// Builds the fixture applications with a @getforma/build `build` function the caller
// supplies: the working tree's in the source lane (build.mjs), the packed set's in P17
// (scripts/release-fixture-apps.mjs). Nothing here imports a @getforma package, so the
// two lanes cannot differ in what they build, only in whose `build` they call.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const readApps = (root = FIXTURES) => JSON.parse(readFileSync(join(root, 'apps.json'), 'utf8'));

/** The build config of one app: one entry and one route per declared route, one shared stylesheet. */
export function buildConfig(root, name, app, outputDir, diagnosticsJson) {
  const entries = Object.entries(app.routes);
  assert(entries.length > 0, `${name}: no routes`);
  return {
    app: `fixture-${name}`,
    entryPoints: entries.map(([, route]) => ({ entry: join(root, route.entry), outfile: `${route.page}.js` })),
    cssEntries: [{ input: join(root, app.css), outfile: 'app.css' }],
    routes: Object.fromEntries(entries.map(([path, route]) => [path, { js: [route.page], css: ['app'] }])),
    outputDir,
    ssr: true,
    // Strict is the only mode of 3.0.0 (FORMA-101): any construct the server cannot render
    // fails the build, all of them at once, each with a code, a file, a line and a column.
    strict: true,
    diagnosticsJson,
  };
}

/**
 * Build `names` (all apps by default) into `outRoot/<app>/dist`, with a `report.json` beside each.
 * Throws on the first app whose build reports anything above a note; the error names the codes.
 */
export async function buildApps({ build, root = FIXTURES, outRoot, names, log = () => {} }) {
  assert.equal(typeof build, 'function', 'buildApps needs a @getforma/build build()');
  const { apps } = readApps(root);
  const reports = {};
  for (const name of names ?? Object.keys(apps)) {
    const app = apps[name];
    assert(app, `unknown fixture application ${name}`);
    const dir = join(outRoot, name), dist = join(dir, 'dist');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const started = Date.now();
    const result = await build(buildConfig(root, name, app, dist, join(dir, 'diagnostics.json')));
    const loud = result.diagnostics.filter(d => d.severity !== 'note');
    assert.deepEqual(loud.map(d => `${d.code} ${d.file}:${d.line}:${d.column}`), [], `${name}: strict build reported diagnostics`);
    for (const [path, route] of Object.entries(app.routes)) {
      const built = result.manifest.routes[path];
      assert(built, `${name}: the manifest has no route ${path}`);
      assert.equal(built.mode, 'ssr', `${name} ${path}: not a server-rendered route`);
      assert(built.ir, `${name} ${path}: the build emitted no native module`);
      assert.equal(built.js.length, route.islands.length ? 1 : 0, `${name} ${path}: unexpected scripts ${JSON.stringify(built.js)}`);
    }
    const report = {
      app: name,
      buildHash: result.buildHash,
      seconds: (Date.now() - started) / 1000,
      routes: Object.fromEntries(Object.entries(result.manifest.routes).map(([path, r]) => [path, { mode: r.mode, js: r.js, css: r.css, ir: r.ir }])),
      notes: result.diagnostics.map(d => ({ code: d.code, severity: d.severity, file: d.file, line: d.line })),
      sizes: result.sizes.map(s => ({
        route: s.route, raw: s.raw, gzip: s.gzip, brotli: s.brotli,
        forma: { raw: s.forma.raw, gzip: s.forma.gzip, brotli: s.forma.brotli },
        application: { raw: s.application.raw, gzip: s.application.gzip, brotli: s.application.brotli },
        over: s.over,
      })),
    };
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    reports[name] = report;
    log(`built ${name}: ${Object.keys(report.routes).join(', ')} (${report.seconds.toFixed(1)} s)`);
  }
  return reports;
}

/**
 * Build one negative entry (apps.json "negative") and return how it failed. The entry is a single
 * route with no stylesheet; a failure is a diagnostic list (the declared-contract codes) or a
 * message (the size gate), and a build that succeeds is reported as such, not thrown.
 */
export async function buildNegative({ build, root = FIXTURES, outRoot, name }) {
  const entry = readApps(root).negative.find(each => each.name === name);
  assert(entry, `unknown negative fixture ${name}`);
  const dir = join(outRoot, 'negative', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const diagnosticsJson = join(dir, 'diagnostics.json');
  try {
    const result = await build({
      app: `fixture-negative-${name}`,
      entryPoints: [{ entry: join(root, entry.entry), outfile: 'page.js' }],
      routes: { '/': { js: ['page'], css: [] } },
      outputDir: join(dir, 'dist'),
      ssr: true,
      strict: true,
      diagnosticsJson,
    });
    return { built: true, sizes: result.sizes, diagnostics: result.diagnostics };
  } catch (error) {
    let diagnostics = [];
    try { diagnostics = JSON.parse(readFileSync(diagnosticsJson, 'utf8')).diagnostics; } catch { /* the size gate writes none */ }
    return { built: false, message: String(error.message), diagnostics };
  }
}
