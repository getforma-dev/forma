import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { build } from 'esbuild';
import * as compiler from '../src/index';
import { renderDefaults } from './helpers/render';

const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });

it('exposes native FMIR compilation without the retired plugin APIs or Vite peer', () => {
  for (const name of ['formaCompiler', 'formaServer', 'transformServerFunctions', 'compileFormaJSX']) {
    expect(compiler, name).not.toHaveProperty(name);
  }
  expect(compiler.formaSsrPlugin).toBeTypeOf('function');
  expect(compiler.generateRealIr).toBeTypeOf('function');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  // The core peer is the compatibility window the version script writes (scripts/release-set.mjs,
  // compatibilityPeer): the current minor's caret, plus the exact coordinated pre-release or
  // -dev version when the set carries a suffix, since carets exclude pre-releases.
  const [major, minor] = pkg.version.split('.');
  const window = `^${major}.${minor}.0`;
  const corePeer = pkg.version.includes('-') ? `${window} || =${pkg.version}` : window;
  expect(pkg.version).toMatch(/^3\.\d+\.\d+(?:-(?:dev|(?:alpha|beta|rc)\.[1-9]\d*))?$/);
  expect(pkg.peerDependencies).toEqual({ esbuild: '>=0.17.0', '@getforma/core': corePeer });
});

it('omits the static native page renderer while preserving its IR and root import boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forma-supported-compiler-')); scratch.push(root);
  const entry = join(root, 'app.ts');
  writeFileSync(entry, 'import { h, mount } from "@getforma/core"; function App() { return h("p", null, "native SSR"); } mount(() => App(), "#app");');
  const result = await build({
    entryPoints: [entry], outdir: root, bundle: true, write: false,
    format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [compiler.formaSsrPlugin({ page: 'app', outDir: root, entryPoint: entry, strict: true })],
  });
  const js = result.outputFiles![0]!.text;
  expect(js).toContain('from "@getforma/core"');
  expect(js).not.toContain('h("p", null, "native SSR")');
  expect(js).not.toMatch(/\bmount\(/);
  expect(compiler.getSsrEntryProducts(result)[0]).toMatchObject({ mode: 'ssr', browserRequired: false, islands: [] });
  expect(js).not.toMatch(/(?:from|import)\s*[('"]+formajs(?:['"/])|@getforma\/core\/server/);
  // esbuild reports native paths; on Windows the separator is a backslash.
  const ir = result.outputFiles!.find(file=>basename(file.path)==='app.ir')!.contents;
  expect(renderDefaults(ir)).toBe('<p>native SSR</p>');
});

it('exports only documented compilation, emission and diagnostic entrypoints', () => {
  expect(Object.keys(compiler).sort()).toEqual([
    'COMPILER_WRITER_VERSION', 'DIAGNOSTIC_CATALOGUE', 'FmirContainerError', 'IrEmitContext',
    'baseWriterVersion', 'collectDiagnostics', 'crc32', 'diagnosticEntry', 'dumpFmir',
    'encodeFmirSections', 'formaSsrPlugin', 'formatDiagnostic', 'generateRealIr', 'getSsrEntryProducts', 'makeDiagnostic', 'readFmirContainer',
  ].sort());
});
