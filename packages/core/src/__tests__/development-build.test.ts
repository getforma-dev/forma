/**
 * The development build (FORMA-169), as a consumer's resolver sees it.
 *
 * Every published file folds `__DEV__` to `false`, so before this build no
 * development warning in core reached anyone who installed it. Each `exports`
 * subpath now has a `development` condition pointing at a twin of its file
 * under dist/dev/, built with `__DEV__` folded to `true`.
 *
 * This file builds the real npm configs of tsup.config.ts, the production ones
 * and their development twins, into a private package directory with this
 * repo's package.json, and runs Node against it in child processes, with and
 * without `--conditions=development`. Node's resolver is the reference
 * implementation of the `exports` algorithm that bundlers follow; a bundler in
 * development mode (Vite, webpack, or @getforma/build in watch mode) passes the
 * same condition. scripts/verify-dist.mjs repeats the resolution check against
 * the real dist/ after every `npm run build`.
 *
 * The dual-instance question: core keeps its reactive state in module scope,
 * so a process that loads both builds has two unrelated copies of it. A
 * resolver applies one set of conditions to every specifier, and a twin
 * imports only twins (verify-dist checks the graphs never cross), so one
 * resolver loads one build. Only two resolvers with different conditions in
 * one process can load both. The duplicate-instance warning is the
 * development build's (FORMA-021 C3): it names a second development copy, and
 * the production build keeps no registry at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Options } from 'tsup';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import rawConfig from '../../tsup.config';
import { DEV_CONDITION, DEV_OUT_DIR } from '../../scripts/build-defines.mjs';

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const configs = rawConfig as Options[];

/** Each subpath key of `exports` (but ./package.json) and its specifier. */
const SUBPATHS: Array<[key: string, specifier: string]> = Object.keys(pkg.exports)
  .filter((key) => key !== './package.json')
  .map((key) => [key, key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`]);

/**
 * The subpaths that share core's code-split module graph. `./runtime-hardened`
 * and `./runtime-csp` bundle a private copy of core by design (the
 * duplicate-instance warning names them), so a process loading them alongside
 * the root has two copies whichever build it resolves.
 */
const SHARED_GRAPH = SUBPATHS.filter(([key]) => !/^\.\/runtime-(?:hardened|csp)$/.test(key));

let scratch: string;
let pkgDir: string;

beforeAll(async () => {
  // The real path: Node reports resolved files by it (/var is /private/var on macOS).
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'forma-development-')));
  pkgDir = join(scratch, 'node_modules', '@getforma', 'core');
  mkdirSync(pkgDir, { recursive: true });
  copyFileSync(resolve(ROOT, 'package.json'), join(pkgDir, 'package.json'));
  // dist/*.js import "alien-signals"; Node finds it from the package's own
  // node_modules ancestors, so link it where the walk up will look.
  symlinkSync(resolve(ROOT, 'node_modules/alien-signals'), join(scratch, 'node_modules', 'alien-signals'), 'junction');
  // The configs `exports` reaches, production and development: the ones that
  // emit CommonJS (the CDN configs emit IIFE or browser ESM only).
  const npmConfigs = configs.filter((c) => (c.format as string[]).includes('cjs'));
  expect(npmConfigs.map((c) => c.outDir).sort()).toEqual(['dist', 'dist', DEV_OUT_DIR, DEV_OUT_DIR]);
  for (const config of npmConfigs) {
    await build({
      ...config,
      // As in build-artifacts.test.ts: never load tsup.config.ts from cwd and
      // merge it over these options.
      config: false,
      dts: false,
      sourcemap: false,
      silent: true,
      outDir: join(pkgDir, config.outDir!),
    });
  }
}, 120_000);

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

/** Run an ES module script in a fresh Node from the scratch app; return its last line, parsed. */
function runNode(conditions: string[], script: string): any {
  const result = spawnSync(
    process.execPath,
    [...conditions.map((c) => `--conditions=${c}`), '--input-type=module', '-e', script],
    { cwd: scratch, encoding: 'utf8' },
  );
  expect(result.stderr, 'the child process wrote to stderr').toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split('\n').pop()!);
}

/** Collect console.warn's first arguments while `body` runs, then report them as `warns`. */
const capturingWarnings = (body: string): string => `
  const warns = [];
  const original = console.warn;
  console.warn = (...args) => { warns.push(String(args[0])); };
  ${body}
  console.warn = original;
`;

const INSTANCES = "globalThis[Symbol.for('@getforma/core#instances')]?.count";

describe('resolving @getforma/core with and without the development condition (Node)', () => {
  it('every subpath resolves to production files without the condition and to their development twins with it', () => {
    const script = `
      import { createRequire } from 'node:module';
      import { fileURLToPath } from 'node:url';
      const require = createRequire(${JSON.stringify(join(scratch, 'app.cjs'))});
      const out = {};
      for (const spec of ${JSON.stringify(SUBPATHS.map(([, spec]) => spec))}) {
        out[spec] = { import: fileURLToPath(import.meta.resolve(spec)), require: require.resolve(spec) };
      }
      console.log(JSON.stringify(out));
    `;
    for (const [conditions, leaf, dir] of [
      [[], 'default', 'dist/'],
      [[DEV_CONDITION], DEV_CONDITION, `${DEV_OUT_DIR}/`],
    ] as const) {
      const resolved = runNode([...conditions], script);
      for (const [key, spec] of SUBPATHS) {
        for (const system of ['import', 'require'] as const) {
          const actual = relative(pkgDir, resolved[spec][system]).replace(/\\/g, '/');
          expect(`./${actual}`, `${system} ${spec} ${conditions.join(' ')}`).toBe(pkg.exports[key][system][leaf]);
          expect(actual.startsWith(dir), `${system} ${spec} ${conditions.join(' ')}`).toBe(true);
          // The production build never resolves to a development file.
          if (leaf === 'default') expect(actual.startsWith(`${DEV_OUT_DIR}/`)).toBe(false);
        }
      }
    }
  });

  it('a process resolving with the development condition loads one copy of core, and it is the development build', () => {
    const imports = SHARED_GRAPH.map(([, spec]) => `await import(${JSON.stringify(spec)});`).join('\n');
    const esm = runNode([DEV_CONDITION], capturingWarnings(`
      ${imports}
      const core = await import('@getforma/core');
      const [named] = core.createSignal(0, { name: 'probe' });
    `) + `console.log(JSON.stringify({ instances: ${INSTANCES}, name: core.getSignalName(named) ?? null, warns }));`);

    // One copy of core's reactive state across every subpath that shares it.
    expect(esm.instances).toBe(1);
    // __DEV__ is true: a signal keeps its debug name only in development.
    expect(esm.name).toBe('probe');
    // Retired entry points no longer load or log warnings.
    expect(esm.warns).toEqual([]);

    // The same through require(), which the condition selects for too.
    const cjs = runNode([DEV_CONDITION], capturingWarnings(`
      import { createRequire } from 'node:module';
      const require = createRequire(${JSON.stringify(join(scratch, 'app.cjs'))});
      for (const spec of ${JSON.stringify(SHARED_GRAPH.map(([, spec]) => spec))}) require(spec);
      const core = require('@getforma/core');
      const [named] = core.createSignal(0, { name: 'probe' });
    `) + `console.log(JSON.stringify({ instances: ${INSTANCES}, name: core.getSignalName(named) ?? null, warns: warns.length }));`);
    expect(cjs).toEqual({ instances: 1, name: 'probe', warns: 0 });
  });

  it('a process resolving without the condition loads one copy of core, and it is the production build', () => {
    const imports = SHARED_GRAPH.map(([, spec]) => `await import(${JSON.stringify(spec)});`).join('\n');
    const esm = runNode([], capturingWarnings(`
      ${imports}
      const core = await import('@getforma/core');
      const [named] = core.createSignal(0, { name: 'probe' });
    `) + `console.log(JSON.stringify({ instances: ${INSTANCES} ?? null, name: core.getSignalName(named) ?? null, warns }));`);

    // The production build keeps no instance registry (FORMA-021 C3): the
    // global the development build counts copies in is never created.
    expect(esm).toEqual({ instances: null, name: null, warns: [] });
  });

  it('a process that loads the development build twice is told so by the duplicate-instance warning; the production build keeps no registry', () => {
    // Two copies of the development build in one process: its ESM twin by
    // `import` and its CJS twin by `require`, both resolved with the
    // condition (mixing the two module systems is one of the topologies the
    // warning names). Each copy registers; the second one warns, once.
    const twice = runNode([DEV_CONDITION], capturingWarnings(`
      import { createRequire } from 'node:module';
      const require = createRequire(${JSON.stringify(join(scratch, 'app.cjs'))});
      const esm = await import('@getforma/core');
      const cjs = require('@getforma/core');
      const [named] = esm.createSignal(0, { name: 'probe' });
      const sameState = cjs.getSignalName(named) === esm.getSignalName(named);
    `) + `console.log(JSON.stringify({ instances: ${INSTANCES} ?? null, sameState, warns }));`);
    expect(twice.instances).toBe(2);
    expect(twice.sameState).toBe(false);
    expect(twice.warns).toHaveLength(1);
    expect(twice.warns[0]).toContain('Duplicate @getforma/core instance detected (2 copies loaded)');

    // Two resolvers in one process, one passing the condition and one not (a
    // development server whose externalized dependencies Node resolves
    // without it): the production root by specifier, its development twin by
    // the file the other resolver would have reached. The copies still do not
    // share state, but only the development copy registers, so no warning
    // names the mix: the production build carries no registry and no warning
    // text (FORMA-021 C3; two physical copies in one bundle are the build's
    // BUILD-816 diagnostic, @getforma/build's core-instances.ts).
    const devRoot = pathToFileURL(join(pkgDir, pkg.exports['.'].import[DEV_CONDITION])).href;
    const mixed = runNode([], capturingWarnings(`
      const production = await import('@getforma/core');
      const development = await import(${JSON.stringify(devRoot)});
      const [named] = development.createSignal(0, { name: 'probe' });
      const sameState = production.getSignalName(named) === development.getSignalName(named);
    `) + `console.log(JSON.stringify({ instances: ${INSTANCES} ?? null, sameState, warns }));`);

    expect(mixed.instances).toBe(1);
    // The two copies do not share state: the name lives in the development copy only.
    expect(mixed.sameState).toBe(false);
    expect(mixed.warns).toEqual([]);
  });
});
