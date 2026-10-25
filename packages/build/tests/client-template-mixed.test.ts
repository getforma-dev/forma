import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import type { BuildConfig } from '../src/types';
import { build } from './helpers/named-build';
import { watching } from './helpers/watch';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-client-template-mixed-')); roots.push(root);
  const src = join(root, 'src'), dist = join(root, 'dist'), core = join(root, 'node_modules/@getforma/core');
  mkdirSync(src); mkdirSync(core, { recursive: true });
  // The watch helper bundles the compiler into this fixture directory. Its
  // synchronous JSX loader must resolve the real installed esbuild from here.
  symlinkSync(dirname(createRequire(import.meta.url).resolve('esbuild/package.json')),
    join(root, 'node_modules/esbuild'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(core, 'package.json'), JSON.stringify({
    name: '@getforma/core', version: '3.1.0-rc.2', type: 'module',
    exports: { '.': './index.js', './compiled': './compiled.js' },
  }));
  // These observable stubs distinguish actual invocation from a helper name
  // surviving in output. The compiled subpath must share the same core graph.
  writeFileSync(join(core, 'index.js'), `
    export const identity={};
    export const h=(tag,props,...children)=>({tag,props,children});
    export const trustedHtml=value=>value;
    export const createList=(source,key,render)=>(render??key)(source()[0]);
    export const createSignal=value=>[()=>value,next=>{value=next}];
    export const __adoptionSignal=(_site,tuple)=>{globalThis.adoptionSignals=(globalThis.adoptionSignals??0)+1;return tuple};
    export const __adoptionWritable=reader=>reader;
    export const activateIslands=registry=>(globalThis.registries??=[]).push(registry);
    export const __islandRegistration=(component,metadata)=>{component.metadata=metadata;return component};
    export const mount=(fn,target)=>(globalThis.mounts??=[]).push({target,value:fn({count:3,rows:[{id:1,label:'row'}]}),identity});
  `);
  writeFileSync(join(core, 'compiled.js'), `
    import {identity} from './index.js';
    export function __createCompiledTemplate(markup,bindings){return initialize=>{
      const values=[];initialize((i,value)=>{values[i]=typeof value==='function'?value():value});
      const result={compiled:true,html:markup(),bindings,values,identity};
      (globalThis.compiledCalls??=[]).push(result);return result;
    }}
  `);
  writeFileSync(join(src, 'shared.ts'), 'export const singleton={};');
  const entry = join(src, 'app.tsx');
  const source = (generation: number) => `
    import {h,mount,activateIslands,createSignal,createList,identity} from '@getforma/core';
    import {singleton} from './shared';
    function Counter(p:{count:number;rows:{id:number;label:string}[]}){
      const[n,setN]=createSignal(p.count);
      return <section><button onClick={()=>setN(n()+1)}>{n}</button><ul>{createList(
        ()=>p.rows,row=>row.id,row=><li data-generation="${generation}"><span>{row.label}</span></li>
      )}</ul></section>;
    }
    function Page(p:{count:number;rows:{id:number;label:string}[]}){return <main>{Counter({count:p.count,rows:p.rows})}</main>}
    activateIslands({Counter});mount(Page,'#app');export {identity,singleton};
  `;
  writeFileSync(entry, source(1));
  const config: BuildConfig = {
    entryPoints: [{ entry, outfile: 'ssr.js' }, { entry, outfile: 'browser.js', ssr: false }],
    routes: { '/': { js: ['ssr'], css: [] }, '/csr': { js: ['browser'], css: [] } },
    outputDir: dist, ssr: true, codeSplitting: true, clientTemplates: true,
  };
  return { root, dist, entry, source, config };
}

function execute(f: ReturnType<typeof fixture>, manifest: any) {
  const files = [manifest.aliases['ssr.js'], manifest.aliases['browser.js']];
  const runner = join(f.root, 'execute.mjs');
  writeFileSync(runner, `
    const modules=[];for(const file of ${JSON.stringify(files)})modules.push(await import('./dist/'+file));
    const mountedCalls=globalThis.compiledCalls?.length??0;
    const adoptionBefore=globalThis.adoptionSignals??0;
    globalThis.registries[0].Counter({count:3,rows:[{id:1,label:'row'}]});
    const nativeAdoptionSignals=(globalThis.adoptionSignals??0)-adoptionBefore;
    globalThis.registries[1].Counter({count:3,rows:[{id:1,label:'row'}]});
    console.log(JSON.stringify({
      mounts:globalThis.mounts.length,target:globalThis.mounts[0].target,
      registries:globalThis.registries.length,mountedCalls,
      sameCore:modules.every(m=>m.identity===modules[0].identity)&&globalThis.compiledCalls.every(row=>row.identity===modules[0].identity),
      sameShared:modules.every(m=>m.singleton===modules[0].singleton),
      rows:globalThis.compiledCalls.map(({html,bindings,values})=>({html,bindings,values})),
      nativeMetadata:globalThis.registries[0].Counter.metadata,
      browserMetadata:globalThis.registries[1].Counter.metadata??null,
      nativeAdoptionSignals
    }));
  `);
  const result = spawnSync(process.execPath, [runner], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

function assertProduct(f: ReturnType<typeof fixture>, manifest: any, generation: number) {
  expect(manifest.routes['/']).toMatchObject({ mode: 'ssr', ir: expect.any(String) });
  expect(manifest.routes['/csr'].mode).toBe('browser');
  expect(manifest.routes['/csr'].ir).toBeUndefined();
  const result = execute(f, manifest);
  expect(result).toMatchObject({ mounts: 1, target: '#app', registries: 2, mountedCalls: 1,
    sameCore: true, sameShared: true, browserMetadata: null, nativeAdoptionSignals: 1 });
  expect(result.nativeMetadata).toMatchObject({ h: expect.any(String), schema: expect.any(Object), mode: 0 });
  expect(result.nativeMetadata.h.length).toBeGreaterThan(0);
  expect(result.rows).toEqual(Array.from({ length: 3 }, () => ({
    html: `<li data-generation="${generation}"><span></span></li>`, bindings: [[[0], 1]], values: ['row'],
  })));
  return readFileSync(join(f.dist, manifest.routes['/'].ir));
}

it('preserves compiled Browser and native roles of one physical entry through a split watch generation', async () => {
  const f = fixture();
  const off = await build({ ...f.config, clientTemplates: false });
  const originalIr = readFileSync(join(f.dist, off.manifest.routes['/'].ir!));
  const on = await build(f.config);
  expect(assertProduct(f, on.manifest, 1)).toEqual(originalIr);
  expect(originalIr.length).toBeGreaterThan(200);

  await watching(f.config, async watcher => {
    await watcher.ready();
    const before = watcher.manifest();
    expect(assertProduct(f, before, 1)).toEqual(originalIr);
    await watcher.change(() => writeFileSync(f.entry, f.source(2)));
    const after = await vi.waitFor(() => {
      const manifest = watcher.manifest();
      for (const alias of ['ssr.js', 'browser.js']) expect(manifest.aliases[alias]).not.toBe(before.aliases[alias]);
      expect(assertProduct(f, manifest, 2)).not.toEqual(originalIr);
      return manifest;
    }, { timeout: 5_000 });
    expect(after.routes['/'].ir).not.toBe(before.routes['/'].ir);
  });
}, 20_000);
