import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from './helpers/named-build';
import { watching } from './helpers/watch';
import type { BuildConfig } from '../src/types';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })));
const badge = `export function Badge(p:{value:string}){return h('b',null,p.value);}`;
const staticPage = `import {h} from '@getforma/core'; ${badge} export function Page(){return h('main',null,'STATIC_NATIVE');}`;
const islandPage = `import {h} from '@getforma/core'; ${badge} export function Page(){return h('main',null,Badge({value:'LIVE_NATIVE'}));}`;
function fixture(codeSplitting: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'forma-static-product-')); roots.push(root);
  const src = join(root, 'src'), dist = join(root, 'dist'), core = join(root, 'node_modules/@getforma/core');
  mkdirSync(src); mkdirSync(core, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(core, 'package.json'), '{"name":"@getforma/core","version":"3.0.0-dev","type":"module","exports":"./index.js"}');
  writeFileSync(join(core, 'index.js'), `export const h=(...x)=>x;export const mount=f=>f();export const activateIslands=x=>x;export const __islandRegistration=(f,m)=>f;export const createShow=(c,f)=>c()?f():null;`);
  writeFileSync(join(src, 'home-page.ts'), staticPage);
  writeFileSync(join(src, 'live-page.ts'), islandPage);
  writeFileSync(join(src, 'shared.ts'), `export const singleton={label:'SHARED_ACTIVE'};`);
  writeFileSync(join(src, 'static-only.ts'), `export const staticOnly='STATIC_EXCLUSIVE';`);
  writeFileSync(join(src, 'lazy.ts'), `export const lazy='LAZY_ACTIVE';`);
  writeFileSync(join(src, 'home.ts'), `import {mount,activateIslands} from '@getforma/core';import {Page,Badge} from './home-page';import {singleton} from './shared';import {staticOnly} from './static-only';globalThis.staticSide=[singleton,staticOnly];activateIslands({Badge});mount(()=>Page(),'#app');`);
  writeFileSync(join(src, 'live.ts'), `import {mount,activateIslands} from '@getforma/core';import {Page,Badge} from './live-page';import {singleton} from './shared';globalThis.liveSide=singleton;export const lazy=()=>import('./lazy');activateIslands({Badge});mount(()=>Page(),'#app');`);
  writeFileSync(join(src, 'browser.ts'), `import {singleton} from './shared';globalThis.browserSide=singleton;`);
  writeFileSync(join(src, 'style.css'), 'main{color:purple}');
  const fonts = join(root, 'fonts'); mkdirSync(fonts); writeFileSync(join(fonts, 'fixture.woff2'), 'fixed-font');
  const config: BuildConfig = { outputDir: dist, ssr: true, codeSplitting, fontDir: fonts,
    entryPoints: [{ entry: join(src, 'home.ts'), outfile: 'home.js' }, { entry: join(src, 'live.ts'), outfile: 'live.js' }, { entry: join(src, 'browser.ts'), outfile: 'browser.js', ssr: false }],
    routes: { '/': { js: ['home'], css: ['style'] }, '/live': { js: ['live'], css: ['style'] }, '/browser': { js: ['browser'], css: [] } },
    cssEntries: [{ input: join(src, 'style.css'), outfile: 'style.css' }] };
  return { root, src, dist, config };
}
for (const codeSplitting of [false, true]) {
  it(`keeps the configured separate native owner while its activation-only browser candidate becomes static (split=${codeSplitting})`, async () => {
    const { src, dist, config } = fixture(codeSplitting);
    writeFileSync(join(src, 'home-browser.ts'), `import {activateIslands} from '@getforma/core';import {Badge} from './home-page';activateIslands({Badge});`);
    config.ssrEntryPoints = { home: config.entryPoints[0].entry };
    config.entryPoints[0].entry = join(src, 'home-browser.ts');
    const { manifest } = await build(config);
    expect(manifest.routes['/']).toMatchObject({ mode: 'ssr', js: [] });
    expect(readFileSync(join(dist, manifest.routes['/'].ir!)).toString()).toContain('STATIC_NATIVE');
    expect(manifest.aliases['home.js']).toBeUndefined();
  });
  it(`keeps browser code for a request-conditional island definition (split=${codeSplitting})`, async () => {
    const { src, config } = fixture(codeSplitting);
    writeFileSync(join(src, 'home-page.ts'), `import {h,createShow} from '@getforma/core';${badge} export function Page(p:{visible:boolean}){return h('main',null,createShow(()=>p.visible,()=>Badge({value:'conditional'})));}`);
    const app = join(src, 'home.ts'); writeFileSync(app, readFileSync(app, 'utf8').replace('mount(()=>Page()', 'mount(()=>Page({visible:false})'));
    const { manifest } = await build(config);
    expect(manifest.routes['/'].mode).toBe('ssr'); expect(manifest.routes['/'].js).toHaveLength(1);
  });
  it(`publishes native static, island and explicit Browser routes from actual compiler products (split=${codeSplitting})`, async () => {
    const { dist, config } = fixture(codeSplitting);
    const { manifest } = await build(config);
    expect(manifest.routes['/']).toMatchObject({ mode: 'ssr', js: [], fonts: ['fixture.woff2'] });
    expect(manifest.routes['/'].ir).toBeDefined(); expect(manifest.routes['/'].modulepreload).toBeUndefined();
    expect(manifest.routes['/'].css).toHaveLength(1);
    expect(readFileSync(join(dist, manifest.routes['/'].ir!)).toString()).toContain('STATIC_NATIVE');
    expect(manifest.routes['/live']).toMatchObject({ mode: 'ssr' }); expect(manifest.routes['/live'].js).toHaveLength(1);
    expect(manifest.routes['/browser'].mode).toBe('browser'); expect(manifest.routes['/browser'].js).toHaveLength(1); expect(manifest.routes['/browser'].ir).toBeUndefined();
    expect(manifest.aliases['home.js']).toBeUndefined();
    const scripts = readdirSync(dist).filter(file => file.endsWith('.js') && file !== 'sw.js').map(file => readFileSync(join(dist, file), 'utf8')).join('\n');
    expect(scripts).not.toContain('STATIC_EXCLUSIVE'); expect(scripts).toContain('SHARED_ACTIVE'); expect(scripts).toContain('LAZY_ACTIVE');
    for (const file of [...manifest.routes['/'].css, ...manifest.routes['/'].fonts]) expect(manifest.assets[file].integrity).toMatch(/^sha384-/);
  });
  it(`keeps accepted metadata and old referenced bytes through static→island→refusal→static watch (split=${codeSplitting})`, async () => {
    const { src, dist, config } = fixture(codeSplitting);
    // Keep every source edit coherent: writeFileSync can expose a truncated module
    // to the child watcher before it writes the replacement contents.
    const replacePage = (source: string) => {
      const page = join(src, 'home-page.ts'), pending = `${page}.next`;
      writeFileSync(pending, source); renameSync(pending, page);
    };
    await watching(config, async watcher => {
      await watcher.ready();
      await vi.waitFor(() => expect(watcher.manifest().routes['/'].js).toEqual([]));
      await watcher.change(() => replacePage(islandPage));
      const live = await vi.waitFor(() => { const value = watcher.manifest(); expect(value.routes['/'].js).toHaveLength(1); return value; });
      const held = [...live.routes['/'].js, live.routes['/'].ir].map(file => ({ file, bytes: readFileSync(join(dist, file)) }));
      const accepted = readFileSync(join(dist, 'manifest.json'));
      const refusalStart = watcher.output().length;
      await watcher.change(() => replacePage(islandPage.replace("Badge({value:'LIVE_NATIVE'})", 'unknownRuntime()')));
      // A prior cycle can finish first. Require this edit's specific refusal and
      // its completed watch snapshot before restoring the accepted static page.
      await vi.waitFor(() => expect(watcher.output().slice(refusalStart)).toMatch(/BUILD-610[^\n]*unknownRuntime[^\n]*\n[\s\S]*\[watch\] build finished/), { timeout: 10_000 });
      expect(readFileSync(join(dist, 'manifest.json'))).toEqual(accepted);
      await watcher.change(() => replacePage(staticPage));
      const final = await vi.waitFor(() => { const value = watcher.manifest(); expect(value.routes['/'].js, watcher.output()).toEqual([]); expect(value.routes['/'].mode, watcher.output()).toBe('ssr'); return value; }, { timeout: 10_000 });
      expect(final.routes['/'].ir).toBeDefined(); expect(final.routes['/'].modulepreload).toBeUndefined(); expect(final.aliases['home.js']).toBeUndefined();
      for (const old of held) expect(readFileSync(join(dist, old.file))).toEqual(old.bytes);
    });
  }, 20_000);
}
