// Measure the exact named fixture through the production native build, without
// changing its source or attributing copied framework files to the application.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = join(repo, 'packages/compiler/tests/fixtures/conformance/composition-canvas');
const output = resolve(process.argv[2] ?? '');
assert(process.argv[2] && !existsSync(output), 'Pass a new evidence directory; existing evidence is never overwritten');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = file => sha256(readFileSync(file));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
assert.equal(git('diff', '--name-only', 'HEAD', '--', 'packages/core/src', 'packages/build/src', 'packages/compiler/src', 'package-lock.json'), '', 'Build only reviewed production sources');
const packageProducts = {};
for (const name of ['core', 'compiler', 'build']) {
  const root = join(repo, 'packages', name);
  const files = [];
  const visit = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (file.endsWith('.js')) files.push([relative(root, file), hash(file)]);
    }
  };
  visit(join(root, 'dist'));
  files.sort(([a], [b]) => a.localeCompare(b, 'en'));
  packageProducts[name] = {
    version: JSON.parse(readFileSync(join(root, 'package.json'))).version,
    manifestSha256: hash(join(root, 'package.json')),
    javascriptFiles: files.length,
    javascriptInventorySha256: sha256(JSON.stringify(files)),
  };
}
const config = {
  app: 'composition-canvas',
  entryPoints: [{ entry: 'src/home/app.tsx', outfile: 'home.js' }],
  outputDir: 'dist',
  routes: { '/': { js: ['home'], css: [] } },
  ssr: true,
  strict: true,
  ssrEntryPoints: { home: 'src/home/app.tsx' },
};
const scratch = mkdtempSync(join(tmpdir(), 'forma-composition-canvas-size-'));
const previousCwd = process.cwd();
const previousPolicy = process.env.FORMA_SIZE_POLICY;
try {
  mkdirSync(join(scratch, 'src/home'), { recursive: true });
  mkdirSync(join(scratch, 'node_modules/@getforma'), { recursive: true });
  const sourceHashes = {};
  for (const file of ['app.tsx', 'page.tsx']) {
    cpSync(join(fixture, file), join(scratch, 'src/home', file));
    sourceHashes[file] = hash(join(fixture, file));
    assert.equal(hash(join(scratch, 'src/home', file)), sourceHashes[file]);
  }
  for (const name of ['core', 'compiler', 'build']) {
    symlinkSync(join(repo, 'packages', name), join(scratch, 'node_modules/@getforma', name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'composition-canvas-size-wrapper', private: true, type: 'module' }));
  process.chdir(scratch);
  process.env.FORMA_SIZE_POLICY = 'framework';
  // Load esbuild after entering the consumer root: its service captures cwd.
  const { build } = await import('../../build/dist/index.js');
  const result = await build(config);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.sizes.length, 1);
  const route = result.sizes[0];
  assert.equal(route.class, 'islands');
  assert.equal(route.canvas, false);
  assert.equal(route.over, false);
  assert.deepEqual(route.ceilings, { forma: 28_420, javascript: 76_800 });
  const native = readFileSync(join(scratch, 'dist', result.manifest.routes['/'].ir));
  assert.deepEqual(native, readFileSync(join(repo, 'crates/forma-server/tests/fixtures/composition-canvas/home.ir')), 'Measure the final named fixture, not the original exploratory spike');
  const assets = Object.fromEntries([...new Set([...route.files.map(file => file.file), 'sw.js', result.manifest.routes['/'].ir])].map(file => [file, hash(join(scratch, 'dist', file))]));
  const measurement = {
    recordedAt: new Date().toISOString(), sourceCommit: git('rev-parse', 'HEAD'),
    scope: 'Exact named composition-canvas in a clean single-route native wrapper; source checkout packages, not a new registry qualification',
    toolchain: { node: process.version, platform: process.platform, arch: process.arch, esbuild: createRequire(import.meta.url)('esbuild/package.json').version },
    packageLockSha256: hash(join(repo, 'package-lock.json')), packageProducts,
    producerSha256: hash(fileURLToPath(import.meta.url)), fixtureSourceSha256: sourceHashes,
    compilerDiagnostics: result.diagnostics,
    buildWarnings: result.warnings.map(message => message.replaceAll(realpathSync(scratch), '<consumer-wrapper>').replaceAll(scratch, '<consumer-wrapper>')),
    wrapper: { config, sourceCopies: 'app.tsx and page.tsx copied byte-for-byte; no alternate renderer or data bootstrap', dependencies: 'Canonical @getforma package-root links; no framework bytes copied into application files', css: false, router: false, serverStateIncludedInJavascript: false },
    policy: { mode: 'framework', applicationOverrides: false, formaGzip: 28_420, javascriptGzip: 76_800 },
    attribution: 'Production metafile raw contributions: core/router/alien-signals plus identity banner; gzip-9 shares allocated by raw proportion. Total JavaScript includes generated service worker.',
    native: { bytes: native.length, sha256: sha256(native), equalsFrozenNamedFixture: true },
    route, assets,
    limits: ['Not the historical 4752-byte four-card spike', 'Not full GenUI primitive-library or consumer qualification', 'JavaScript size wrapper has no Cargo.lock; this run does not repeat Rust compatibility or rendering qualification', 'No application budget override, canvas ceiling increase or release claim'],
  };
  mkdirSync(output, { recursive: true });
  cpSync(join(scratch, 'dist', 'size-report.json'), join(output, 'size-report.json'));
  writeFileSync(join(output, 'measurement.json'), `${JSON.stringify(measurement, null, 2)}\n`);
  console.log(JSON.stringify({ nativeBytes: native.length, formaGzip: route.forma.gzip, javascriptGzip: route.javascript.gzip, output }, null, 2));
} finally {
  process.chdir(previousCwd);
  if (previousPolicy === undefined) delete process.env.FORMA_SIZE_POLICY;
  else process.env.FORMA_SIZE_POLICY = previousPolicy;
  rmSync(scratch, { recursive: true, force: true });
}
