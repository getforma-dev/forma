/**
 * Build the preview-frame lane's application with THIS working tree's
 * `@getforma/build`, against the `@getforma/core` build.sh installed into
 * e2e/frame/app from a packed tarball (FORMA-175).
 *
 *   node e2e/frame/build-app.mjs
 *
 * Writes, for the Rust server in server/ to embed:
 *
 *   out/dist-on/        `previewFrame: true`: the manifest names
 *                       `forma-runtime.js`, which forma-server's
 *                       `PreviewFrame::load` must accept;
 *   out/dist-off/       the same build without it, which names no runtime
 *                       (forma-server: FRAME-101);
 *   out/dist-tampered/  dist-on with TAMPER appended to the runtime, which
 *                       forma-server must refuse (FRAME-103), as the build
 *                       refuses a core whose runtime holds it (BUILD-806,
 *                       checked by frame.spec.ts);
 *   out/lane.json       what frame.spec.ts checks the server against.
 *
 * Fails loudly unless the build wrote core's `dist/formajs-frame.global.js`
 * minified (FORMA-190: the bytes forma-server inlines into every preview
 * document, named by their own hash and listed in the manifest with their own
 * SRI) and left core's file as published, readable and unchanged; and never
 * core's `dist/forma-runtime.js` (the CDN alias of the auto-mounting runtime,
 * which shares the target's name).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const app = join(here, 'app');
const out = join(here, 'out');
const core = join(app, 'node_modules', '@getforma', 'core');

/** Appended to the runtime to make one neither the build nor forma-server may inline. */
const TAMPER = '\n/* </script> */\n';

function fail(message) {
  console.error(`frame build-app: ${message}`);
  process.exit(1);
}

if (!existsSync(join(repo, 'packages', 'build', 'dist', 'index.js'))) fail('packages/build/dist is missing; run `npm run build` first');
if (!existsSync(join(core, 'package.json'))) fail(`${core} is missing; run e2e/frame/build.sh, which installs the packed core`);

// Core's dependencies are the ones the fixture's lockfile pins (npm ci), not
// whatever the registry served when the tarball was installed.
const lock = JSON.parse(readFileSync(join(app, 'package-lock.json'), 'utf8'));
for (const [name, range] of Object.entries(JSON.parse(readFileSync(join(core, 'package.json'), 'utf8')).dependencies ?? {})) {
  const pinned = lock.packages?.[`node_modules/${name}`]?.version;
  const installed = existsSync(join(app, 'node_modules', name, 'package.json'))
    ? JSON.parse(readFileSync(join(app, 'node_modules', name, 'package.json'), 'utf8')).version
    : undefined;
  if (!pinned || installed !== pinned) {
    fail(`@getforma/core depends on ${name} ${range}, which e2e/frame/app/package-lock.json does not pin (pinned ${pinned ?? 'nothing'}, installed ${installed ?? 'nothing'}): ` +
      'add it to e2e/frame/app/package.json and run `npm install --package-lock-only` there');
  }
}

const { build } = await import(join(repo, 'packages/build/dist/index.js'));
const sha256 = (bytes, encoding) => createHash('sha256').update(bytes).digest(encoding);

const config = (outputDir, extra = {}) => ({
  app: 'e2e-frame',
  entryPoints: [{ entry: join(app, 'src', 'app.ts'), outfile: 'app.js' }],
  routes: { '/': { js: ['app'], css: [] } },
  outputDir,
  ...extra,
});

for (const dir of ['dist-on', 'dist-off', 'dist-tampered']) rmSync(join(out, dir), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Core's file as published, read before the build and again after it.
const frame = readFileSync(join(core, 'dist', 'formajs-frame.global.js'));
const on = await build(config(join(out, 'dist-on'), { previewFrame: true }));
const asset = on.manifest.aliases['forma-runtime.js'];
if (!asset) fail(`previewFrame: true wrote no assets["forma-runtime.js"]: ${JSON.stringify(on.manifest.aliases)}`);
const written = readFileSync(join(out, 'dist-on', asset));
if (!readFileSync(join(core, 'dist', 'formajs-frame.global.js')).equals(frame)) fail("the build changed core's dist/formajs-frame.global.js");
if (frame.toString('utf8').split('\n').length < 1000) fail("core's dist/formajs-frame.global.js is not the readable file it ships as");
if (written.equals(frame)) fail(`${asset} is core's dist/formajs-frame.global.js, not minified`);
if (written.length >= frame.length * 0.6) fail(`${asset} is ${written.length} bytes against core's ${frame.length}: not minified`);
if (written.toString('utf8').split('\n').length > 100) fail(`${asset} still has its line structure`);
const cdnAlias = join(core, 'dist', 'forma-runtime.js');
if (existsSync(cdnAlias) && readFileSync(cdnAlias).equals(written)) fail(`${asset} is core's dist/forma-runtime.js, the CDN alias`);
if (asset !== `forma-runtime.${sha256(written, 'hex').slice(0, 8)}.js`) fail(`${asset} is not named by its content hash`);
const integrity = `sha384-${createHash('sha384').update(written).digest('base64')}`;
if (on.manifest.assets[asset]?.integrity !== integrity) fail(`${asset}'s SRI in the manifest is not that of the bytes written`);
if (on.sizeReport.frame?.raw !== written.length || on.sizeReport.frame?.sourceRaw !== frame.length) fail("the size report's frame row is not the served bytes beside core's");

const off = await build(config(join(out, 'dist-off')));
if ('forma-runtime.js' in off.manifest.aliases) fail('the build without previewFrame names a runtime');

cpSync(join(out, 'dist-on'), join(out, 'dist-tampered'), { recursive: true });
appendFileSync(join(out, 'dist-tampered', asset), TAMPER);

const corePackage = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
const lane = {
  core: { version: corePackage.version, dir: core, frameSha256: sha256(frame, 'base64'), frameBytes: frame.length },
  on: { dist: join(out, 'dist-on'), asset, servedSha256: sha256(written, 'base64'), servedBytes: written.length, manifest: on.manifest },
  off: { dist: join(out, 'dist-off'), manifest: off.manifest },
  tamper: TAMPER,
};
writeFileSync(join(out, 'lane.json'), JSON.stringify(lane, null, 2) + '\n');
console.log(`frame build-app: @getforma/core ${corePackage.version}: ${asset} (${written.length} bytes minified from core's ${frame.length}, sha256-${lane.on.servedSha256})`);
