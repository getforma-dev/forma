/** Real ESM products: an IIFE cannot prove authored top-level await semantics. */
import {afterEach,expect,it} from 'vitest';
import {build,type Plugin} from 'esbuild';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {formaSsrPlugin} from '../src/esbuild-ssr-plugin';
import {getSsrEntryProducts} from '../src/ssr-product';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const core:Plugin={name:'await-entry-core',setup(b){
 b.onResolve({filter:/^@getforma\/core$/},()=>({path:'core',namespace:'await-fixture'}));
 b.onLoad({filter:/.*/,namespace:'await-fixture'},()=>({loader:'js',contents:`
  export function h(...args){return args}
  export function mount(){throw Error('removed native page mount executed')}
  export function __islandRegistration(component,metadata){component.metadata=metadata;return component}
  export function activateIslands(registry,root){
   globalThis.calls.push({root,entries:Object.entries(registry).map(([name,component])=>({name,metadata:component.metadata}))});
   return new Promise(resolve=>queueMicrotask(()=>{globalThis.events.push('activation complete');resolve()}));
  }`}));
}};
function fixture(activation:string,live=false){
 const root=mkdtempSync(join(tmpdir(),'forma-entry-await-'));roots.push(root);
 const entry=join(root,'app.ts');
 writeFileSync(join(root,'island.ts'),'import {h} from "@getforma/core";export function Badge(p:{label:string}){return h("b",null,p.label)};export function Unused(){return h("i",null,"unused")}');
 writeFileSync(join(root,'page.ts'),`import {h} from "@getforma/core";import {Badge} from "./island";export function Page(){return h("main",null,${live?'Badge({label:"live"})':'"static"'})}`);
 writeFileSync(entry,`import {mount,activateIslands} from "@getforma/core";import {Page} from "./page";import {Badge,Unused} from "./island";
 globalThis.events.push('before');queueMicrotask(()=>globalThis.events.push('checkpoint'));
 ${activation}
 globalThis.events.push('after');mount(Page,"#app");`);
 return {root,entry};
}
async function compile(f:ReturnType<typeof fixture>){
 return build({entryPoints:[f.entry],outdir:join(f.root,'dist'),write:false,bundle:true,format:'esm',target:'es2022',logLevel:'silent',
  plugins:[core,formaSsrPlugin({page:'app',outDir:join(f.root,'dist'),entryPoint:f.entry,clientEntryPoint:f.entry})]});
}
function execute(f:ReturnType<typeof fixture>,result:Awaited<ReturnType<typeof compile>>){
 const product=join(f.root,'product.mjs');writeFileSync(product,result.outputFiles!.find(o=>o.path.endsWith('.js'))!.text);
 // Node imports the actual bundled ESM product, outside Vitest's module transform.
 const run=spawnSync(process.execPath,['--input-type=module','--eval',`globalThis.events=[];globalThis.calls=[];await import(${JSON.stringify(pathToFileURL(product).href)});console.log(JSON.stringify({events:globalThis.events,calls:globalThis.calls}));`],{encoding:'utf8',timeout:5000});
 expect(run.error).toBeUndefined();expect(run.signal).toBeNull();expect(run.status,run.stderr).toBe(0);
 return JSON.parse(run.stdout);
}
it('retains nonempty authored await and waits for activation completion in real ESM',async()=>{
 const f=fixture('await activateIslands({Badge,Unused},"#islands");',true),result=await compile(f),actual=execute(f,result);
 expect(actual.events).toEqual(['before','checkpoint','activation complete','after']);
 expect(actual.calls).toHaveLength(1);expect(actual.calls[0].root).toBe('#islands');
 expect(actual.calls[0].entries).toEqual([{name:'Badge',metadata:expect.objectContaining({h:expect.stringMatching(/^[a-f0-9]{16}$/),mode:0,schema:[[{name:'label',type:{kind:'string'}}]]})}]);
 expect(getSsrEntryProducts(result)[0]!.browserRequired).toBe(true);
});
it('keeps the async checkpoint when every registration is pruned',async()=>{
 const f=fixture('await activateIslands({Badge,Unused},"#islands");'),result=await compile(f),actual=execute(f,result);
 expect(actual).toEqual({events:['before','checkpoint','after'],calls:[]});
 expect(result.outputFiles!.find(o=>o.path.endsWith('.js'))!.text).toMatch(/await\s+\(?void 0\)?/);
 expect(getSsrEntryProducts(result)[0]).toMatchObject({browserRequired:false,islands:[]});
});
it('preserves ordinary standalone erasure without adding a checkpoint',async()=>{
 const f=fixture('activateIslands({Badge,Unused},"#islands");'),result=await compile(f);
 expect(execute(f,result)).toEqual({events:['before','after','checkpoint'],calls:[]});
 expect(getSsrEntryProducts(result)[0]!.browserRequired).toBe(false);
});
it('rewrites pruned awaited and retained calls independently',async()=>{
 const f=fixture('await activateIslands({Unused});globalThis.events.push("between");await activateIslands({Badge},"#islands");',true),result=await compile(f),actual=execute(f,result);
 expect(actual.events).toEqual(['before','checkpoint','between','activation complete','after']);
 expect(actual.calls).toHaveLength(1);expect(actual.calls[0].entries.map((e:{name:string})=>e.name)).toEqual(['Badge']);
});
it.each([
 ['effectful root','await activateIslands({Badge,Unused},globalThis.root());'],
 ['effectful extra argument','await activateIslands({Badge,Unused},"#islands",globalThis.extra());'],
 ['assigned await','const done=await activateIslands({Badge,Unused});'],
 ['exported await','export const done=await activateIslands({Badge,Unused});'],
 ['nested await','if(true){await activateIslands({Badge,Unused});}'],
 ['function await','async function boot(){await activateIslands({Badge,Unused});}boot();'],
 ['chained result','await activateIslands({Badge,Unused}).then(()=>{});'],
 ['composed await','await (activateIslands({Badge,Unused}),undefined);'],
])('retains BUILD-611 for all-pruned %s',async(_name,code)=>{
 await expect(compile(fixture(code))).rejects.toThrow(/BUILD-611/);
});
