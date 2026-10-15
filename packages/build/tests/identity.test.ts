/**
 * FORMA-186 slice 1: the deployment identity (DR-29, L-6 as amended by L-56).
 *
 * The identity is computed first, from every output of a first bundling pass
 * (browser-facing files and the `.ir` modules) plus the writer versions, then
 * compiled into each bundle (the `__FORMA_BUILD__` constant core reads and a
 * per-file banner), whose names then hash content that includes it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from './helpers/named-build';
import { watching } from './helpers/watch';
import { buildInChild } from './helpers/child-build';
import { computeIdentity, IDENTITY_PATTERN, identityBanner } from '../src/identity';
import type { BuildConfig } from '../src/types';

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })));

/** Two entries sharing a runtime chunk and one lazy chunk; `seen` reads the
 * constant the way core does, so the identity lands in the files that use it. */
function fixture(options: { codeSplitting?: boolean; label?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'forma-identity-')); temporary.push(root);
  const src = join(root, 'src'); const dist = join(root, 'dist'); mkdirSync(src);
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(src, 'shared.ts'), `declare const __FORMA_BUILD__: string | undefined;
export const seen = typeof __FORMA_BUILD__ === 'string' ? __FORMA_BUILD__ : null;
export const label = ${JSON.stringify(options.label ?? 'one')};`);
  writeFileSync(join(src, 'later.ts'), 'import { label } from "./shared"; export const later = "LAZY " + label;');
  writeFileSync(join(src, 'phone.ts'), 'import { seen, label } from "./shared"; export const first = [seen, label]; export const open = () => import("./later");');
  writeFileSync(join(src, 'desktop.ts'), 'import { seen } from "./shared"; export const second = seen;');
  const config: BuildConfig = {
    entryPoints: [{ entry: join(src, 'phone.ts'), outfile: 'phone.js' }, { entry: join(src, 'desktop.ts'), outfile: 'desktop.js' }],
    outputDir: dist,
    routes: { '/phone': { js: ['phone'], css: [] }, '/desktop': { js: ['desktop'], css: [] } },
    codeSplitting: options.codeSplitting ?? true,
  };
  return { root, src, dist, config };
}

/** A server-rendered page with one island, as build.test.ts writes one: `formajs` is
 * aliased to a stub so esbuild can bundle; the compiler reads the source. */
function ssrFixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-identity-ssr-')); temporary.push(root);
  const src = join(root, 'src'); const dist = join(root, 'dist'); mkdirSync(src);
  const core = join(root, 'node_modules', '@getforma', 'core'); mkdirSync(core, { recursive: true });
  writeFileSync(join(core, 'package.json'), JSON.stringify({ name: '@getforma/core', version: '3.0.0-dev', type: 'module', exports: './index.js' }));
  writeFileSync(join(core, 'index.js'), 'export const __islandRegistration=(component,metadata)=>component;');
  writeFileSync(join(src, 'stub.js'), 'export const h=()=>{}; export const mount=()=>{}; export const activateIslands=()=>{}; export const createSignal=(v)=>[()=>v,()=>{}];');
  writeFileSync(join(src, 'Panel.ts'), `import { h, createSignal } from 'formajs';
export const [text] = createSignal('idle');
export function Panel() { return h('section', null, h('span', null, () => text())); }`);
  writeFileSync(join(src, 'Home.ts'), `import { h } from 'formajs';
import { Panel } from './Panel';
export function HomePage() { return h('main', { id: 'app' }, h('h1', null, 'Home'), Panel()); }`);
  // The page the server renders and the browser entry are different files, so an
  // edit to the page's markup moves the .ir and leaves the browser product alone.
  writeFileSync(join(src, 'page.ts'), `import { activateIslands } from 'formajs';
import { HomePage } from './Home';
import { Panel } from './Panel';
activateIslands({ Panel });
export { HomePage };`);
  writeFileSync(join(src, 'app.ts'), `import { activateIslands } from 'formajs';
import { Panel } from './Panel';
activateIslands({ Panel });`);
  const config: BuildConfig = {
    entryPoints: [{ entry: join(src, 'app.ts'), outfile: 'app.js' }], routes: { '/': { js: ['app'], css: [] } },
    outputDir: dist, formaAlias: join(src, 'stub.js'), ssr: true, ssrEntryPoints: { app: join(src, 'page.ts') },
  };
  return { root, src, dist, config };
}

/** The shipped JavaScript: every `.js` the manifest lists, never the worker. */
const scripts = (dist: string) => readdirSync(dist).filter(file => file.endsWith('.js') && file !== 'sw.js');

describe('computeIdentity', () => {
  const writers = [{ name: '@getforma/build', version: [3, 0, 0] as const }];
  const files = [{ name: 'a.js', bytes: Buffer.from('one') }, { name: 'b.ir', bytes: Buffer.from('two') }];

  it('is 16 lowercase hex characters, the same for the same inputs in any order', () => {
    const id = computeIdentity({ writers, files });
    expect(id).toMatch(IDENTITY_PATTERN);
    expect(computeIdentity({ writers, files: [...files].reverse() })).toBe(id);
  });

  it('changes with one byte of one file, one file name, a writer version, or a file added', () => {
    const id = computeIdentity({ writers, files });
    const variants = [
      { writers, files: [{ ...files[0], bytes: Buffer.from('onE') }, files[1]] },
      { writers, files: [{ ...files[0], name: 'c.js' }, files[1]] },
      { writers: [{ ...writers[0], version: [3, 1, 0] as const }], files },
      { writers: [...writers, { name: '@getforma/compiler', version: [3, 0, 0] as const }], files },
      { writers, files: [...files, { name: 'c.css', bytes: Buffer.from('') }] },
    ];
    for (const variant of variants) expect(computeIdentity(variant)).not.toBe(id);
    expect(new Set(variants.map(computeIdentity)).size).toBe(variants.length);
  });

  it('cannot be forged by moving bytes between a name and its content', () => {
    // "ab" + "c" and "a" + "bc" must not collide: names and hashes are delimited.
    const left = computeIdentity({ writers, files: [{ name: 'ab', bytes: Buffer.from('c') }] });
    const right = computeIdentity({ writers, files: [{ name: 'a', bytes: Buffer.from('bc') }] });
    expect(left).not.toBe(right);
  });

  it('banners with the identity as a comment and refuses a malformed one', () => {
    expect(identityBanner('5f0c9a1e7d2b4c86')).toBe('/*forma-build:5f0c9a1e7d2b4c86*/');
    expect(() => identityBanner('*/alert(1)')).toThrow();
  });
});

describe('the identity of a build', () => {
  // esbuild hashes the paths of a build's inputs relative to its working
  // directory, which it takes from the process (helpers/child-build.ts): an
  // application builds from its project root, so each fixture does too.
  it.each([true, false])('manifest.build is a 16-hex identity, equal for identical inputs built in two directories from their own roots (codeSplitting: %s)', async codeSplitting => {
    const one = fixture({ codeSplitting }); const two = fixture({ codeSplitting });
    const scratch = mkdtempSync(join(tmpdir(), 'forma-identity-scratch-')); temporary.push(scratch);
    const first = await buildInChild(one.config, one.root, scratch); const second = await buildInChild(two.config, two.root, scratch);
    expect(first.message, first.output).toBeUndefined();
    expect(first.manifest!.build).toMatch(IDENTITY_PATTERN);
    expect(second.manifest!.build).toBe(first.manifest!.build);
    expect(scripts(one.dist)).toEqual(scripts(two.dist));
    for (const file of scripts(one.dist)) expect(readFileSync(join(one.dist, file))).toEqual(readFileSync(join(two.dist, file)));
  }, 30_000);

  it('manifest.build is the build result\'s buildHash', async () => {
    const { config } = fixture();
    const result = await build(config);
    expect(result.manifest.build).toMatch(IDENTITY_PATTERN);
    expect(result.buildHash).toBe(result.manifest.build);
  });

  it('is equal for identical inputs including the compiled .ir modules, built in two directories', async () => {
    const [one, two] = [ssrFixture(), ssrFixture()];
    const first = await build(one.config); const second = await build(two.config);
    // The .ir modules are part of the pre-image; two directories must produce
    // the same bytes or the identity would depend on where a build ran.
    const ir = (fixture: typeof one, manifest: typeof first.manifest) => readFileSync(join(fixture.dist, manifest.routes['/'].ir!));
    expect(ir(one, first.manifest).equals(ir(two, second.manifest))).toBe(true);
    expect(first.manifest.build).toMatch(IDENTITY_PATTERN);
    expect(second.manifest.build).toBe(first.manifest.build);
  }, 30_000);

  it('moves with an edit that changes only a compiled .ir module', async () => {
    const { src, dist, config } = ssrFixture();
    const before = await build(config);
    const scriptsBefore = scripts(dist).map(file => readFileSync(join(dist, file), 'utf8').split(before.manifest.build).join('ID'));
    const irBefore = readFileSync(join(dist, before.manifest.routes['/'].ir!));
    writeFileSync(join(src, 'Home.ts'), readFileSync(join(src, 'Home.ts'), 'utf8').replace("'Home'", "'Home, changed'"));
    const after = await build(config);
    const irAfter = readFileSync(join(dist, after.manifest.routes['/'].ir!));
    // The page's heading is server markup: the .ir moved, the browser product did not.
    expect(irAfter.equals(irBefore)).toBe(false);
    expect(scripts(dist).map(file => readFileSync(join(dist, file), 'utf8').split(after.manifest.build).join('ID'))).toEqual(scriptsBefore);
    expect(after.manifest.build).not.toBe(before.manifest.build);
  }, 30_000);

  it('changes with one changed source byte that changes an output, and not with an edit that changes none', async () => {
    const { src, config } = fixture();
    const before = await build(config);
    // A comment is stripped by the minifier: no output byte moves, so no open tab is disturbed.
    writeFileSync(join(src, 'later.ts'), 'import { label } from "./shared"; /* a comment */ export const later = "LAZY " + label;');
    const comment = await build(config);
    expect(comment.manifest.build).toBe(before.manifest.build);
    expect(comment.manifest.aliases).toEqual(before.manifest.aliases);
    // A string literal is output: the identity moves.
    writeFileSync(join(src, 'later.ts'), 'import { label } from "./shared"; export const later = "LAZY! " + label;');
    const changed = await build(config);
    expect(changed.manifest.build).not.toBe(before.manifest.build);
  });

  it('changes with a changed css input', async () => {
    const { src, dist, config } = fixture();
    const css = join(src, 'site.css');
    const withCss: BuildConfig = { ...config, cssEntries: [{ input: css, outfile: 'site.css' }], routes: { ...config.routes, '/phone': { js: ['phone'], css: ['site'] } } };
    writeFileSync(css, 'main { color: red; }');
    const red = await build(withCss);
    writeFileSync(css, 'main { color: blue; }');
    const blue = await build(withCss);
    expect(blue.manifest.build).not.toBe(red.manifest.build);
    expect(readdirSync(dist).some(file => file.endsWith('.css'))).toBe(true);
  });

  it.each([true, false])('every JavaScript output carries the identity, and every JavaScript name changes with it (codeSplitting: %s)', async codeSplitting => {
    const { src, dist, config } = fixture({ codeSplitting });
    const before = await build(config);
    const oldNames = scripts(dist);
    expect(oldNames.length).toBeGreaterThanOrEqual(codeSplitting ? 4 : 2); // entries; with splitting also a shared and a lazy chunk
    for (const file of oldNames) expect(readFileSync(join(dist, file), 'utf8')).toContain(identityBanner(before.manifest.build));
    // Change one source byte that reaches only a single entry's output.
    writeFileSync(join(src, 'desktop.ts'), 'import { seen } from "./shared"; export const second = seen + "!";');
    const after = await build(config);
    expect(after.manifest.build).not.toBe(before.manifest.build);
    const newNames = scripts(dist);
    for (const file of newNames) expect(readFileSync(join(dist, file), 'utf8')).toContain(identityBanner(after.manifest.build));
    // L-6: every deploy renames every bundle, including the entry and chunks the edit did not touch.
    expect(newNames.filter(name => oldNames.includes(name))).toEqual([]);
  });

  it('compiles the identity into the bundle as the constant core reads', async () => {
    const { dist, config } = fixture();
    const { manifest } = await build(config);
    const desktop = await import(pathToFileURL(join(dist, manifest.aliases['desktop.js'])).href);
    expect(desktop.second).toBe(manifest.build);
    const phone = await import(pathToFileURL(join(dist, manifest.aliases['phone.js'])).href);
    expect(phone.first[0]).toBe(manifest.build);
  });

  it('leaves the constant undefined for code that runs outside a build', () => {
    // core's guard (`typeof __FORMA_BUILD__ === 'string'`) must see no identity in an unbuilt page.
    expect(typeof (globalThis as Record<string, unknown>).__FORMA_BUILD__).toBe('undefined');
  });

  it("watch mode's identity is dev, in the manifest and in the bundle, with no banner", async () => {
    const { dist, config } = fixture({ codeSplitting: false });
    const watched = { ...config, entryPoints: [config.entryPoints[1]], routes: { '/desktop': config.routes['/desktop'] } };
    await watching(watched, async ({ manifest, ready }) => {
      await ready();
      expect(manifest().build).toBe('dev');
      const bundle = readFileSync(join(dist, manifest().aliases['desktop.js']), 'utf8');
      expect(bundle).toContain('"dev"');
      expect(bundle).not.toContain('forma-build:');
    });
  });
});
