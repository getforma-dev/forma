/**
 * Watch mode and server-rendered pages (N7, L-31, FORMA-022).
 *
 * N7: an incremental rebuild reaches an updated page in under a second. v1
 * found watch mode rebuilt the bundles but wrote no FMIR module, so a page the
 * server renders never changed on an incremental rebuild (v1 6.4): without
 * code splitting no `.ir` was written at all and the dev manifest named none,
 * and with it the modules were re-emitted only when the BROWSER bundle's graph
 * changed, which a page's own SSR entry need not be part of. L-31: watch mode
 * rewrites the modules of the pages a change touches.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuildConfig } from '../src/types';
import { watching } from './helpers/watch';
import {generateRealIr} from '../../compiler/src/esbuild-ssr-plugin';

const temporary: string[] = [];
// The killed watcher's esbuild service can still write for a moment.
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })));

/** Two server-rendered pages; only `home` renders `Greeting`. */
function site() {
  const root = mkdtempSync(join(tmpdir(), 'forma-watch-ir-')); temporary.push(root);
  const src = join(root, 'src'); const dist = join(root, 'dist'); mkdirSync(src);
  // `formajs` resolves to a stub for the browser bundle; the compiler reads
  // the source, so the stub is invisible to the FMIR it emits.
  const stub = 'export const h = () => {}; export const mount = () => {}; export const activateIslands = x => x; export const __islandRegistration = (component,metadata) => component;\n';
  writeFileSync(join(src, 'forma-stub.js'), stub);
  const core = join(root, 'node_modules', '@getforma', 'core'); mkdirSync(core, {recursive: true});
  writeFileSync(join(core, 'package.json'), '{"name":"@getforma/core","version":"3.0.0-dev","type":"module","exports":"./index.js"}');
  writeFileSync(join(core, 'index.js'), stub);
  writeFileSync(join(src, 'Greeting.ts'), greeting('Hello from the first build'));
  writeFileSync(join(src, 'home.ts'), [
    `import { h, mount, activateIslands } from 'formajs';`,
    `import { Greeting } from './Greeting';`,
    `activateIslands({ Greeting });`,
    `mount(() => h('main', { id: 'app' }, h('h1', null, 'Home'), Greeting()), '#app');`,
    '',
  ].join('\n'));
  writeFileSync(join(src, 'about.ts'), `import { h, mount } from 'formajs';\nmount(() => h('main', { id: 'app' }, h('h1', null, 'About')), '#app');\n`);
  const config: BuildConfig = {
    entryPoints: [{ entry: join(src, 'home.ts'), outfile: 'home.js' }, { entry: join(src, 'about.ts'), outfile: 'about.js' }],
    routes: { '/': { js: ['home'], css: [] }, '/about': { js: ['about'], css: [] } },
    outputDir: dist,
    formaAlias: join(src, 'forma-stub.js'),
    ssr: true,
  };
  return { src, dist, config };
}

function greeting(text: string): string {
  return `import { h } from 'formajs';\nexport function Greeting() { return h('p', { class: 'greeting' }, ${JSON.stringify(text)}); }\n`;
}

const currentManifest=(dist:string)=>JSON.parse(readFileSync(join(dist,'manifest.json'),'utf8'));
const irPath=(dist:string,page:string)=>currentManifest(dist).aliases[`${page}.ir`];
const ir = (dist: string, page: string) => readFileSync(join(dist, irPath(dist,page))).toString('latin1');
const inode = (dist: string, file: string) => statSync(join(dist, file), { bigint: true }).ino;
/** How many times the compiler has emitted `page`'s module (its own log line). */
const emissions = (output: string, page: string) => output.split(`IR emitted (real): ${page}.ir`).length - 1;

describe('watch mode rewrites the FMIR modules of the pages a change touches (N7, L-31)', () => {
  it('rebuilds browser metadata and native schema together after a type-only edit',async()=>{
    const {src,dist,config}=site();
    config.entryPoints=config.entryPoints.slice(0,1);delete config.routes['/about'];
    const core=join(src,'..','node_modules','@getforma','core');mkdirSync(core,{recursive:true});
    writeFileSync(join(core,'package.json'),JSON.stringify({name:'@getforma/core',version:'3.0.0-dev',type:'module',exports:'./index.js'}));
    writeFileSync(join(core,'index.js'),'export const h=(...a)=>a;export const mount=()=>{};export const activateIslands=r=>{globalThis.registry=r};export function __islandRegistration(component,metadata){const fn=p=>component(p);fn.metadata=metadata;return fn;}');
    const types=join(src,'props.ts'),entry=join(src,'home.ts');
    writeFileSync(types,'export interface Props { title:string }');
    writeFileSync(join(src,'Badge.ts'),'import {h} from "@getforma/core";import type {Props} from "./props";export function Badge(p:Props){return h("b",null,p.title);}');
    writeFileSync(join(src,'Page.ts'),'import {h} from "@getforma/core";import {Badge} from "./Badge";export function Page(p:{title:string}){return h("main",null,Badge({title:p.title}));}');
    writeFileSync(entry,'import {mount,activateIslands} from "@getforma/core";import {Page} from "./Page";import {Badge} from "./Badge";activateIslands({Badge});mount(()=>Page(),"#app");');
    await watching(config,async({manifest,ready,change})=>{
      await ready();await vi.waitFor(()=>expect(manifest().routes['/'].ir).toBeDefined(),{timeout:10_000});
      const before=manifest(),oldFiles=[before.routes['/'].js[0],before.routes['/'].ir].map(file=>({file,bytes:readFileSync(join(dist,file))}));
      const oldDigest=generateRealIr(entry)!.islands[0]!.contract!.digest;
      expect(readFileSync(join(dist,before.routes['/'].js[0]),'utf8')).toContain(oldDigest);
      await change(()=>writeFileSync(types,'export interface Props { title:string;note?:string }'));
      const after=manifest(),product=generateRealIr(entry)!;
      expect(after.routes['/'].js[0]).not.toBe(before.routes['/'].js[0]);
      expect(after.routes['/'].ir).not.toBe(before.routes['/'].ir);
      expect(readFileSync(join(dist,after.routes['/'].ir))).toEqual(Buffer.from(product.binary));
      const js=readFileSync(join(dist,after.routes['/'].js[0]),'utf8');
      expect(js).toContain(product.islands[0]!.contract!.digest);expect(js).not.toContain(oldDigest);
      for(const old of oldFiles)expect(readFileSync(join(dist,old.file))).toEqual(old.bytes);
    });
  },30_000);
  it("rewrites a page's .ir when a component it renders changes, and no other page's", async () => {
    const { src, dist, config } = site();
    await watching(config, async ({ manifest, output }) => {
      // The dev manifest names each page's module, so the server renders
      // Phase 2 in development as it does in production.
      await vi.waitFor(() => {
        const current = manifest();
        expect(current.routes['/'].ir).toMatch(/^home\.[0-9a-f]{64}\.ir$/);
        expect(current.routes['/about'].ir).toMatch(/^about\.[0-9a-f]{64}\.ir$/);
      }, { timeout: 10_000 });
      expect(ir(dist, 'home')).toContain('Hello from the first build');
      // The child's log reaches this process after the files it wrote do, so
      // the counts are waited for, not read once.
      await vi.waitFor(() => {
        expect(emissions(output(), 'home')).toBe(1);
        expect(emissions(output(), 'about')).toBe(1);
      }, { timeout: 10_000 });
      const oldManifest=manifest();
      const homeFile=oldManifest.routes['/'].ir,aboutFile=oldManifest.routes['/about'].ir;
      const home = inode(dist,homeFile);
      const about = inode(dist,aboutFile);
      const heldFiles=[oldManifest.routes['/'].js[0],homeFile].map(file=>({file,bytes:readFileSync(join(dist,file))}));

      writeFileSync(join(src, 'Greeting.ts'), greeting('Hello after an edit'));

      await vi.waitFor(() => expect(ir(dist, 'home')).toContain('Hello after an edit'), { timeout: 10_000 });
      expect(ir(dist, 'home')).not.toContain('Hello from the first build');
      // Replaced by rename, so the server never reads half a module.
      expect(inode(dist,irPath(dist,'home'))).not.toBe(home);
      expect(irPath(dist,'home')).not.toBe(homeFile);
      for(const held of heldFiles)expect(readFileSync(join(dist,held.file))).toEqual(held.bytes);
      await vi.waitFor(() => {
        expect(emissions(output(), 'home')).toBe(2);
        expect(output()).toMatch(/IR rewritten: home\.ir in \d+ ms/);
      }, { timeout: 10_000 });
      // `about` does not render Greeting: its module is neither re-emitted
      // nor rewritten.
      expect(emissions(output(), 'about')).toBe(1);
      expect(inode(dist,irPath(dist,'about'))).toBe(about);
      expect(irPath(dist,'about')).toBe(aboutFile);
      expect(manifest().routes['/'].ir).toMatch(/^home\.[0-9a-f]{64}\.ir$/);
      // No temporary file is left behind. One may be in flight: the browser
      // rebuild changes the route's size, so the manifest is rewritten too.
      await vi.waitFor(() => expect(readdirSync(dist).filter(file => file.endsWith('.tmp'))).toEqual([]), { timeout: 5000 });
    });
  }, 30_000);

  it("logs a page's module it could not publish, naming the page, and recovers", async () => {
    // The page watchers run with esbuild's logging off, so an exception while
    // publishing (a module Windows will not let go of, a full disk) became an
    // esbuild result error nobody printed: a stale page with no message.
    const { src, dist, config } = site();
    await watching(config, async ({ manifest, output,ready }) => {
      await vi.waitFor(() => expect(manifest().routes['/'].ir).toMatch(/^home\.[0-9a-f]{64}\.ir$/), { timeout: 10_000 });
      await ready();
      const accepted=manifest(),manifestPath=join(dist,'manifest.json'),manifestBytes=readFileSync(manifestPath);
      const browserPath=join(dist,accepted.routes['/'].js[0]),modulePath=join(dist,accepted.routes['/'].ir);
      const browser=readFileSync(browserPath),module=readFileSync(modulePath);
      // A final manifest write fails after new candidate data files were staged.
      rmSync(manifestPath);mkdirSync(manifestPath);
      writeFileSync(join(src, 'Greeting.ts'), greeting('Hello while home.ir is blocked'));
      // The page is named; the cause is the filesystem's (EISDIR here).
      await vi.waitFor(() => expect(output()).toMatch(/IR not written for home: \S/), { timeout: 10_000 });
      expect(readFileSync(browserPath)).toEqual(browser);expect(readFileSync(modulePath)).toEqual(module);

      // The watcher survives: once the path is free, the next edit publishes.
      rmSync(manifestPath,{recursive:true});writeFileSync(manifestPath,manifestBytes);
      writeFileSync(join(src, 'Greeting.ts'), greeting('Hello once home.ir is free'));
      await vi.waitFor(() => expect(ir(dist, 'home')).toContain('Hello once home.ir is free'), { timeout: 10_000 });
    });
  }, 30_000);

  it.each([false,true])('retains the complete accepted browser/IR pair after compilation refusal and recovers (split=%s)',async(codeSplitting)=>{
    const {src,dist,config}=site();
    config.entryPoints=config.entryPoints.slice(0,1);delete config.routes['/about'];
    await watching({...config,codeSplitting},async({manifest,output,ready,change})=>{
      await vi.waitFor(()=>expect(manifest().routes['/'].ir).toMatch(/^home\.[0-9a-f]{64}\.ir$/),{timeout:10_000});await ready();
      const held=manifest();
      const paths=[held.routes['/'].js[0],held.routes['/'].ir,'manifest.json'].map(name=>join(dist,name));
      const accepted=paths.map(path=>readFileSync(path));
      await change(()=>writeFileSync(join(src,'home.ts'),'import {h,mount} from "formajs";function Home(p:{bad:()=>void}){return h("main",null,"must not publish");}mount(()=>Home(),"#app");'));
      expect(output()).toContain('BUILD-610');
      paths.forEach((path,index)=>expect(readFileSync(path)).toEqual(accepted[index]));
      await change(()=>writeFileSync(join(src,'home.ts'),'import {h,mount,activateIslands} from "formajs";function Recovered(){return h("p",null,"paired recovery");}function Home(){return h("main",null,Recovered());}activateIslands({Recovered});mount(()=>Home(),"#app");'));
      await vi.waitFor(()=>expect(ir(dist,'home')).toContain('paired recovery'),{timeout:10_000});
      expect(readFileSync(join(dist,manifest().routes['/'].js[0]),'utf8')).toContain('paired recovery');
      for(const index of [0,1])expect(readFileSync(paths[index]!)).toEqual(accepted[index]);
      expect(readFileSync(paths[2]!)).not.toEqual(accepted[2]);
    });
  },30_000);

  it("rewrites a page's .ir when only its SSR entry changes, in a code-splitting build", async () => {
    // The SSR entry is a separate file the browser bundle never imports, so
    // only a watcher over the SSR entry's own graph sees an edit to it.
    const { src, dist, config } = site();
    writeFileSync(join(src, 'about-ssr.ts'), `import { h, mount } from 'formajs';\nmount(() => h('main', { id: 'app' }, h('h1', null, 'About, server-rendered')), '#app');\n`);
    await watching({ ...config, codeSplitting: true, ssrEntryPoints: { about: join(src, 'about-ssr.ts') } }, async ({ manifest }) => {
      await vi.waitFor(() => expect(manifest().routes['/about'].ir).toMatch(/^about\.[0-9a-f]{64}\.ir$/), { timeout: 10_000 });
      expect(ir(dist, 'about')).toContain('About, server-rendered');

      writeFileSync(join(src, 'about-ssr.ts'), `import { h, mount } from 'formajs';\nmount(() => h('main', { id: 'app' }, h('h1', null, 'About, edited')), '#app');\n`);

      await vi.waitFor(() => expect(ir(dist, 'about')).toContain('About, edited'), { timeout: 10_000 });
      expect(manifest().routes['/about'].ir).toMatch(/^about\.[0-9a-f]{64}\.ir$/);
      expect(manifest().routes['/'].ir).toMatch(/^home\.[0-9a-f]{64}\.ir$/);
    });
  }, 30_000);
});
