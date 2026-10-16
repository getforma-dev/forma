/**
 * FORMA-186 slice 2: asset retention (DR-29, L-25; L-16 and SR45 for a security
 * release). The application's pipeline keeps the previous release's `dist/` and
 * passes its path; the build copies that release's own hashed assets into the new
 * `dist/`, listed `retained` and `immutable`, so one `dist/` is embedded and a tab
 * one deploy old still loads its chunks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from './helpers/named-build';
import { watching } from './helpers/watch';
import { readPreviousDist, retainFrom } from '../src/retention';
import type { AssetManifest, BuildConfig } from '../src/types';

const temporary: string[] = [];
afterEach(() => { vi.restoreAllMocks(); temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })); });
const scratch = (prefix = 'forma-retention-') => { const dir = mkdtempSync(join(tmpdir(), prefix)); temporary.push(dir); return dir; };
const sha384 = (bytes: Uint8Array | string) => `sha384-${createHash('sha384').update(bytes).digest('base64')}`;

/** One application whose single label is the source change between releases. The
 * css is the same in every release, so its hashed name is shared by them. */
function app(label: string, root = scratch()) {
  const src = join(root, 'src'); mkdirSync(src, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(src, 'shared.ts'), `export const label = ${JSON.stringify(label)};`);
  writeFileSync(join(src, 'later.ts'), 'import { label } from "./shared"; export const later = "LAZY " + label;');
  writeFileSync(join(src, 'phone.ts'), 'import { label } from "./shared"; export const first = label; export const open = () => import("./later");');
  writeFileSync(join(src, 'site.css'), 'main { color: green; }');
  const config = (outputDir: string, extra: Partial<BuildConfig> = {}): BuildConfig => ({
    entryPoints: [{ entry: join(src, 'phone.ts'), outfile: 'phone.js' }], outputDir, codeSplitting: true,
    cssEntries: [{ input: join(src, 'site.css'), outfile: 'site.css' }],
    routes: { '/phone': { js: ['phone'], css: ['site'] } }, ...extra,
  });
  return { root, src, config, relabel: (next: string) => writeFileSync(join(src, 'shared.ts'), `export const label = ${JSON.stringify(next)};`) };
}

const read = (path: string) => readFileSync(path);
const retainedOf = (manifest: AssetManifest) => Object.entries(manifest.assets).filter(([, meta]) => meta.retained).map(([name]) => name).sort();
const ownOf = (manifest: AssetManifest) => Object.entries(manifest.assets).filter(([, meta]) => !meta.retained).map(([name]) => name).sort();
function tree(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(out, tree(path, `${prefix}${name}/`));
    else out[prefix + name] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return out;
}
const scripts = (manifest: AssetManifest) => Object.keys(manifest.assets).filter(name => name.endsWith('.js')).sort();

describe('retention in a build', () => {
  it("copies the previous build's own hashed assets, flagged retained and immutable, with matching SHA-384 and compressed siblings", async () => {
    const one = app('one'); const distA = join(scratch(), 'dist'); const distB = join(scratch(), 'dist');
    const a = await build(one.config(distA));
    one.relabel('two');
    const b = await build(one.config(distB, { previousDist: distA }));

    const aScripts = scripts(a.manifest);
    expect(aScripts.length).toBeGreaterThanOrEqual(3); // entry, shared chunk, lazy chunk
    // Every JavaScript file of A is in B's dist, byte for byte, flagged, and listed with its own SHA-384.
    expect(retainedOf(b.manifest)).toEqual(aScripts);
    for (const name of aScripts) {
      const bytes = read(join(distA, name));
      expect(read(join(distB, name)).equals(bytes)).toBe(true);
      expect(b.manifest.assets[name]).toEqual({ immutable: true, integrity: sha384(bytes), retained: true });
      expect(b.manifest.assets[name].integrity).toBe(a.manifest.assets[name].integrity);
      // The compressed sibling is the retained file's own, so serve_asset negotiates it as for any asset.
      for (const [suffix, decode] of [['.br', (await import('node:zlib')).brotliDecompressSync], ['.gz', (await import('node:zlib')).gunzipSync]] as const) {
        expect(existsSync(join(distB, name + suffix))).toBe(existsSync(join(distA, name + suffix)));
        if (existsSync(join(distB, name + suffix))) expect(decode(read(join(distB, name + suffix))).equals(bytes)).toBe(true);
      }
    }
    // B's own route names only B's files; nothing retained is a route's, an alias or a worker-excluded file.
    const referenced = Object.values(b.manifest.routes).flatMap(route => [...route.js, ...(route.modulepreload ?? []), ...route.css]);
    expect(referenced.filter(name => b.manifest.assets[name].retained)).toEqual([]);
    expect(Object.values(b.manifest.aliases).filter(name => b.manifest.assets[name].retained)).toEqual([]);
    // The css is the same in both releases: one file with one name, B's own, not retained.
    const css = Object.keys(b.manifest.assets).find(name => name.endsWith('.css'))!;
    expect(Object.keys(a.manifest.assets)).toContain(css);
    expect(b.manifest.assets[css].retained).toBeUndefined();
    // The worker serves what the manifest lists immutable, retained included, by the manifest's digest.
    const worker = readFileSync(join(distB, 'sw.js'), 'utf8');
    for (const name of aScripts) expect(worker).toContain(`/_assets/${name}`);
  }, 30_000);

  it('retains exactly one previous build: what a build itself retained is not copied again', async () => {
    const one = app('one'); const [distA, distB, distC] = [1, 2, 3].map(() => join(scratch(), 'dist'));
    const a = await build(one.config(distA));
    one.relabel('two'); const b = await build(one.config(distB, { previousDist: distA }));
    one.relabel('three'); const c = await build(one.config(distC, { previousDist: distB }));
    expect(retainedOf(b.manifest)).toEqual(scripts(a.manifest));
    // C keeps B's own files only; A, two deploys old, is gone.
    expect(retainedOf(c.manifest)).toEqual(scripts(b.manifest).filter(name => !b.manifest.assets[name].retained));
    for (const name of scripts(a.manifest)) { expect(c.manifest.assets[name]).toBeUndefined(); expect(existsSync(join(distC, name))).toBe(false); }
    // At most doubling (L-25): C's own files plus one previous build's.
    expect(Object.keys(c.manifest.assets).length).toBeLessThanOrEqual(2 * ownOf(c.manifest).length);
  }, 30_000);

  it('does not depend on the previous dist for the identity, and is byte-identical for identical inputs', async () => {
    const one = app('one'); const [distA, distA2] = [1, 2].map(() => join(scratch(), 'dist'));
    await build(one.config(distA)); await build(one.config(distA2));
    one.relabel('two');
    // One build at a time, each into its own directory.
    const plan = [{ previousDist: undefined }, { previousDist: distA }, { previousDist: distA2 }, { previousDist: distA }]
      .map(item => ({ ...item, dist: join(scratch(), 'dist') }));
    const [none, withA, withA2, again] = plan;
    const results = [];
    for (const item of plan) results.push(await build(one.config(item.dist, item.previousDist ? { previousDist: item.previousDist } : {})));
    const [rNone, rA, rA2] = results;
    // The identity and every non-retained entry are the same whatever the previous release was, or none.
    expect(rA.manifest.build).toBe(rNone.manifest.build);
    expect(rA2.manifest.build).toBe(rNone.manifest.build);
    for (const r of [rA, rA2]) {
      expect(r.manifest.routes).toEqual(rNone.manifest.routes);
      expect(r.manifest.aliases).toEqual(rNone.manifest.aliases);
      expect(ownOf(r.manifest)).toEqual(ownOf(rNone.manifest));
    }
    // The same inputs with the same previous release write the same tree, byte for byte.
    expect(tree(again.dist)).toEqual(tree(withA.dist));
    expect(tree(withA2.dist)).toEqual(tree(withA.dist)); // A and A2 are the same release built twice
    expect(retainedOf(rNone.manifest)).toEqual([]);
  }, 60_000);

  it('a failed build with a previous dist leaves the existing output byte-identical (L-21)', async () => {
    const one = app('one'); const distA = join(scratch(), 'dist'); const distB = join(scratch(), 'dist');
    await build(one.config(distA));
    one.relabel('two'); await build(one.config(distB, { previousDist: distA }));
    const before = tree(distB);
    writeFileSync(join(one.src, 'later.ts'), 'export const later = ;');
    await expect(build(one.config(distB, { previousDist: distA }))).rejects.toThrow();
    expect(tree(distB)).toEqual(before);
  }, 30_000);

  it('refuses a previous dist whose bytes no longer match its manifest (BUILD-821), leaving the output as it was', async () => {
    const one = app('one'); const distA = join(scratch(), 'dist'); const distB = join(scratch(), 'dist');
    const a = await build(one.config(distA));
    const victim = scripts(a.manifest)[0];
    writeFileSync(join(distA, victim), read(join(distA, victim)).toString() + '\n// altered');
    one.relabel('two');
    await expect(build(one.config(distB, { previousDist: distA }))).rejects.toThrow(/BUILD-821.*SHA-384/s);
    expect(existsSync(distB)).toBe(false);
  }, 30_000);
});

describe('a security release (L-16, SR45)', () => {
  it.each(['the security option', 'FORMA_SECURITY_RELEASE=1'])('with %s, a previous dist is ignored: no retained entry and a dist holding only its own files', async how => {
    const one = app('one'); const distA = join(scratch(), 'dist'); const [plain, marked] = [1, 2].map(() => join(scratch(), 'dist'));
    await build(one.config(distA));
    one.relabel('two');
    const lines: string[] = []; vi.spyOn(console, 'log').mockImplementation((...args) => { lines.push(args.join(' ')); });
    const reference = await build(one.config(plain));
    if (how === 'FORMA_SECURITY_RELEASE=1') vi.stubEnv('FORMA_SECURITY_RELEASE', '1');
    const secured = await build(one.config(marked, { previousDist: distA, ...(how === 'the security option' ? { security: true } : {}) }));
    vi.unstubAllEnvs();
    expect(retainedOf(secured.manifest)).toEqual([]);
    expect(Object.values(secured.manifest.assets).some(meta => 'retained' in meta)).toBe(false);
    // The dist holds exactly what the same build holds without any previous dist.
    expect(readdirSync(marked).sort()).toEqual(readdirSync(plain).sort());
    expect(tree(marked)).toEqual(tree(plain));
    expect(lines.some(line => /security release/i.test(line))).toBe(true);
    expect(reference.manifest.build).toBe(secured.manifest.build);
  }, 30_000);

  it('a security release with an unusable previous dist still builds: nothing is read from it', async () => {
    const one = app('one');
    const { manifest } = await build(one.config(join(scratch(), 'dist'), { previousDist: join(scratch(), 'missing'), security: true }));
    expect(retainedOf(manifest)).toEqual([]);
  });
});

describe('FORMA_SECURITY_RELEASE', () => {
  it('reads FORMA_SECURITY_RELEASE as FORMA_STRICT is read, and refuses any other value (BUILD-822)', async () => {
    const one = app('one'); const distA = join(scratch(), 'dist');
    await build(one.config(distA));
    one.relabel('two');
    const run = async (value: string, security?: boolean) => { vi.stubEnv('FORMA_SECURITY_RELEASE', value); try { return await build(one.config(join(scratch(), 'dist'), { previousDist: distA, security })); } finally { vi.unstubAllEnvs(); } };
    for (const marked of ['1', 'true', 'TRUE', ' 1 ', 'True']) expect(retainedOf((await run(marked)).manifest), marked).toEqual([]);
    for (const unmarked of ['0', 'false', '', ' FALSE ']) expect(retainedOf((await run(unmarked)).manifest).length, unmarked).toBeGreaterThan(0);
    for (const bad of ['yes', 'on', '2', 'tru']) {
      await expect(run(bad), bad).rejects.toThrow(/BUILD-822.*FORMA_SECURITY_RELEASE/s);
      await expect(run(bad, true), `${bad} with security:true`).rejects.toThrow(/BUILD-822.*FORMA_SECURITY_RELEASE/s);
    }
  }, 60_000);
});

describe('the previousDist option', () => {
  it('is checked as configuration: a path, and a boolean mark', async () => {
    const one = app('one');
    await expect(build(one.config(join(scratch(), 'dist'), { previousDist: 42 as unknown as string }))).rejects.toThrow(/previousDist/);
    await expect(build(one.config(join(scratch(), 'dist'), { previousDist: '' }))).rejects.toThrow(/previousDist/);
    await expect(build(one.config(join(scratch(), 'dist'), { security: 'yes' as unknown as boolean }))).rejects.toThrow(/security/);
  });

  it('is ignored by watch mode, which is a development build', async () => {
    const one = app('one'); const distA = join(scratch(), 'dist');
    await build(one.config(distA));
    one.relabel('two');
    const dist = join(scratch(), 'dist');
    await watching(one.config(dist, { codeSplitting: false, previousDist: distA }), async ({ manifest, ready, output }) => {
      await ready();
      expect(manifest().build).toBe('dev');
      expect(retainedOf(manifest())).toEqual([]);
      expect(output()).toMatch(/previousDist is ignored in watch mode/);
    });
  });
});

/** A hand-made previous release, so the edge cases need no second build. */
function previous(files: Record<string, { bytes?: string; immutable?: boolean; retained?: boolean; integrity?: string; listed?: boolean }>, manifest: Record<string, unknown> = {}) {
  const dir = scratch('forma-previous-');
  const assets: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(files)) {
    const bytes = spec.bytes ?? `bytes of ${name}`;
    if (!name.includes('/') && spec.bytes !== null) writeFileSync(join(dir, name), bytes);
    if (spec.listed !== false) assets[name] = { immutable: spec.immutable ?? true, integrity: spec.integrity ?? sha384(bytes), ...(spec.retained ? { retained: true } : {}) };
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version: 2, writer: '3.0.0', app: 'fixture', build: '0123456789abcdef', aliases: {}, assets, routes: {}, ...manifest }));
  return dir;
}
const staging = (files: Record<string, string> = {}) => { const dir = scratch('forma-staging-'); for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes); return dir; };
const read1 = (dir: string, outputDir = join(scratch(), 'dist')) => readPreviousDist(dir, outputDir, 'fixture');

describe('readPreviousDist and retainFrom', () => {
  it('copies hashed immutable files, and never .ir, sw.js, manifest.json, mutable files or what the previous build retained', () => {
    const dir = previous({
      'app.aaaa1111.js': {}, 'chunk.BBBB2222.js': {}, 'style.cccc3333.css': {},
      'home.dddd4444.ir': {}, 'sw.js': {}, 'manifest.json': { bytes: 'not the manifest' }, 'font.woff2': { immutable: false },
      'old.eeee5555.js': { retained: true },
    });
    const target = staging();
    const { retained } = retainFrom(read1(dir), target);
    expect([...retained].sort()).toEqual(['app.aaaa1111.js', 'chunk.BBBB2222.js', 'style.cccc3333.css']);
    expect(readdirSync(target).sort()).toEqual(['app.aaaa1111.js', 'chunk.BBBB2222.js', 'style.cccc3333.css']);
  });

  it("treats a file both builds emit as the new build's own, and refuses the same name with other bytes (BUILD-821)", () => {
    const dir = previous({ 'shared.aaaa1111.css': { bytes: 'same' }, 'other.bbbb2222.js': {} });
    const same = staging({ 'shared.aaaa1111.css': 'same' });
    expect([...retainFrom(read1(dir), same).retained]).toEqual(['other.bbbb2222.js']);
    const different = staging({ 'shared.aaaa1111.css': 'DIFFERENT' });
    expect(() => retainFrom(read1(dir), different)).toThrow(/BUILD-821.*shared\.aaaa1111\.css/s);
  });

  it('refuses bytes that do not match the recorded SHA-384, a missing file, a link and a directory (BUILD-821)', () => {
    expect(() => retainFrom(read1(previous({ 'a.aaaa1111.js': { integrity: sha384('other bytes') } })), staging())).toThrow(/BUILD-821.*SHA-384/s);
    const absent = previous({ 'a.aaaa1111.js': {} });
    rmSync(join(absent, 'a.aaaa1111.js'));
    expect(() => retainFrom(read1(absent), staging())).toThrow(/BUILD-821.*a\.aaaa1111\.js/s);
    const linked = previous({ 'a.aaaa1111.js': {} });
    rmSync(join(linked, 'a.aaaa1111.js')); writeFileSync(join(linked, 'real.js'), 'bytes of a.aaaa1111.js'); symlinkSync(join(linked, 'real.js'), join(linked, 'a.aaaa1111.js'));
    expect(() => retainFrom(read1(linked), staging())).toThrow(/BUILD-821.*regular file/s);
    const folder = previous({ 'a.aaaa1111.js': {} });
    rmSync(join(folder, 'a.aaaa1111.js')); mkdirSync(join(folder, 'a.aaaa1111.js'));
    expect(() => retainFrom(read1(folder), staging())).toThrow(/BUILD-821/);
  });

  it.each([
    ['a path that does not exist', () => join(scratch(), 'nowhere'), /BUILD-820.*does not exist/s],
    ['a file, not a directory', () => { const file = join(scratch(), 'file'); writeFileSync(file, 'x'); return file; }, /BUILD-820.*directory/s],
    ['a directory with no manifest.json', () => scratch(), /BUILD-820.*manifest\.json/s],
    ['a manifest that is not JSON', () => { const dir = scratch(); writeFileSync(join(dir, 'manifest.json'), '{nope'); return dir; }, /BUILD-820.*manifest\.json/s],
    ['another application\'s dist', () => previous({ 'a.aaaa1111.js': {} }, { app: 'someone-else' }), /BUILD-820.*someone-else/s],
    ['a watch build\'s dev manifest', () => previous({ 'a.js': {} }, { build: 'dev' }), /BUILD-820.*dev/s],
    ['assets that are not an object', () => previous({}, { assets: [] }), /BUILD-820.*assets/s],
    ['an asset name that leaves the directory', () => previous({ '../evil.js': { bytes: 'x' } }), /BUILD-820.*\.\.\/evil\.js/s],
    ['an asset name with a separator', () => previous({ 'sub/a.aaaa1111.js': { bytes: 'x' } }), /BUILD-820.*sub\/a\.aaaa1111\.js/s],
  ])('refuses %s (BUILD-820)', (_name, make, message) => {
    expect(() => read1(make())).toThrow(message);
  });

  it('refuses a previous dist that is, contains or is inside the output directory (BUILD-820)', () => {
    const dir = previous({ 'a.aaaa1111.js': {} });
    expect(() => readPreviousDist(dir, dir, 'fixture')).toThrow(/BUILD-820.*outputDir/s);
    expect(() => readPreviousDist(dir, join(dir, 'inside'), 'fixture')).toThrow(/BUILD-820.*outputDir/s);
    expect(() => readPreviousDist(join(dir), join(dir, '..'), 'fixture')).toThrow(/BUILD-820.*outputDir/s);
  });

  it('retains nothing, and says so, from a manifest that is not schema 2 (the first 3.0.0 deploy)', () => {
    const dir = previous({ 'a.aaaa1111.js': {} }, { version: 1 });
    const outcome = read1(dir);
    expect(outcome.candidates).toEqual([]);
    expect(outcome.note).toMatch(/not schema 2.*nothing is retained/s);
    expect([...retainFrom(outcome, staging()).retained]).toEqual([]);
    const dirOld = scratch(); writeFileSync(join(dirOld, 'manifest.json'), JSON.stringify({ build: 'abc', routes: {}, assets: {} }));
    expect(read1(dirOld).candidates).toEqual([]);
    expect(read1(dirOld).note).toMatch(/nothing is retained/);
  });
});
