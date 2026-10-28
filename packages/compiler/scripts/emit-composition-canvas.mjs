// FORMA-246: freeze the actual compiler product for the derived Rust fixture.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { collectDiagnostics, generateRealIr, formaSsrPlugin } from '../dist/index.js';
import { build } from 'esbuild';
import { assertCurrentFmir, packageWriter } from '../../../scripts/fmir-corpus.mjs';
const root = new URL('../../../crates/forma-server/tests/fixtures/composition-canvas/', import.meta.url);
const entry = fileURLToPath(new URL('../tests/fixtures/conformance/composition-canvas/app.tsx', import.meta.url));
const { result, diagnostics } = collectDiagnostics(() => generateRealIr(entry));
if (!result || diagnostics.length || result.islands.length !== 1 || result.islands[0].name !== 'Canvas') {
  throw new Error(`composition-canvas did not emit one native Canvas without diagnostics: ${JSON.stringify(diagnostics)}`);
}
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const integrity = bytes => `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
const file = new URL('home.ir', root), manifestFile = new URL('manifest.json', root);
const scratch = mkdtempSync(join(tmpdir(), 'forma-canvas-emit-'));
try {
  const product = await build({ absWorkingDir: fileURLToPath(new URL('../../../', import.meta.url)), entryPoints: [entry], bundle: true, write: false, format: 'esm', packages: 'external', outdir: scratch,
    jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment', logLevel: 'silent',
    plugins: [formaSsrPlugin({ page: 'home', outDir: scratch, entryPoint: entry, strict: true })] });
  const script = product.outputFiles.find(file => file.path.endsWith('.js')).contents;
  if (process.argv.includes('--check')) {
    const frozen = readFileSync(file);
    assertCurrentFmir({ name: 'composition-canvas', bytes: result.binary, frozenBytes: frozen, expectedVersion: packageWriter(version) });
    const manifest = JSON.parse(readFileSync(manifestFile));
    if (manifest.assets['home.ir'].integrity !== integrity(frozen)) throw new Error('composition-canvas integrity mismatch');
    assert.deepEqual(Buffer.from(script), readFileSync(new URL('app.js', root)), 'composition-canvas client code differs from the frozen product');
    if (manifest.assets['app.js'].integrity !== integrity(script)) throw new Error('composition-canvas script integrity mismatch');
  } else {
    mkdirSync(root, { recursive: true });
    writeFileSync(new URL('app.js', root), script);
    writeFileSync(file, result.binary);
    writeFileSync(manifestFile, `${JSON.stringify({
      version: 2, writer: version, app: 'composition-canvas', build: 'fixture',
      aliases: { 'home.ir': 'home.ir' },
      assets: { 'home.ir': { immutable: false, integrity: integrity(result.binary) }, 'app.js': { immutable: false, integrity: integrity(script) } },
      routes: { '/': { mode: 'ssr', ir: 'home.ir', js: ['app.js'], css: [], fonts: [], total_size_br: 0, budget_warn_threshold: 0 } },
    }, null, 2)}\n`);
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
console.log(`composition-canvas: ${result.binary.length} bytes; zero diagnostics; one native Canvas`);
