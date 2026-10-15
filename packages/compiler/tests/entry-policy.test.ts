import {afterEach,describe,expect,it} from 'vitest';
import {build,context,type Plugin} from 'esbuild';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {formaSsrPlugin,generateRealIr} from '../src/esbuild-ssr-plugin';
import {getSsrEntryProducts} from '../src/ssr-product';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const stub:Plugin={name:'entry-core',setup(b){
  b.onResolve({filter:/^@getforma\/core$/},()=>({path:'core',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`
    export function h(...args){return args};
    export function mount(){throw Error('native page must not run in browser')};
    export function createSignal(v){return [()=>v,()=>{}]};
    export function activateIslands(registry,root){globalThis.calls.push({registry,root})};
    export function __islandRegistration(component,metadata){const wrapper=p=>component(p);wrapper.metadata=metadata;return wrapper};
    export function createShow(){};export function browserOnly(fn){return fn};`,loader:'js'}));
}};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'forma-entry-policy-'));roots.push(root);
 const entry=join(root,'app.ts');
 writeFileSync(join(root,'island.ts'),'import {h} from "@getforma/core";export function Badge(p:{label:string}){return h("b",null,p.label)};export function Unused(){return h("i",null,"unused")}');
 writeFileSync(join(root,'page.ts'),'import {h} from "@getforma/core";import {Badge} from "./island";export function Page(p:{label:string}){return h("main",null,Badge({label:p.label}))}');
 writeFileSync(entry,'import {mount,activateIslands} from "@getforma/core";import {Page} from "./page";import {Badge,Unused} from "./island";activateIslands({Badge,Unused},"#islands");mount(Page,"#app");');
 return {root,entry};
}
async function compile(f:ReturnType<typeof fixture>,source=f.entry){
 return build({entryPoints:[f.entry],outdir:join(f.root,'dist'),write:false,bundle:true,format:'iife',logLevel:'silent',
  plugins:[stub,formaSsrPlugin({page:'app',outDir:join(f.root,'dist'),entryPoint:source,clientEntryPoint:f.entry})]});
}
function execute(result:Awaited<ReturnType<typeof compile>>){const globalThis:any={calls:[],events:[]};runInNewContext(result.outputFiles!.find(o=>o.path.endsWith('.js'))!.text,{globalThis});return globalThis;}
function edit(f:ReturnType<typeof fixture>,before:string,after:string){writeFileSync(f.entry,readFileSync(f.entry,'utf8').replace(before,after));}

describe('authenticated islands-only entry policy',()=>{
 it('omits core alias mount, prunes unused registration and preserves user functions and root arguments',async()=>{
  const f=fixture();edit(f,'{mount,activateIslands}','{mount as render,activateIslands as activate}');
  edit(f,'activateIslands({','activate({');edit(f,'mount(Page','render(Page');
  writeFileSync(f.entry,readFileSync(f.entry,'utf8')+'function mount(){globalThis.events.push("user mount")};mount();');
  const native=generateRealIr(f.entry)!,result=await compile(f),actual=execute(result);
  expect(result.outputFiles!.find(o=>o.path.endsWith('.ir'))!.contents).toEqual(native.binary);
  expect(actual.events).toEqual(['user mount']);expect(actual.calls).toHaveLength(1);
  expect(Object.keys(actual.calls[0].registry)).toEqual(['Badge']);expect(actual.calls[0].root).toBe('#islands');
  expect(getSsrEntryProducts(result)[0]!.browserRequired).toBe(true);
 });
 it('preserves one shared initializer and the actual captured getter shared by two islands',async()=>{
  const f=fixture();
  writeFileSync(join(f.root,'shared.ts'),'import {createSignal} from "@getforma/core";globalThis.events.push("shared initializer");export const [read]=createSignal(7);globalThis.sharedRead=read;');
  writeFileSync(join(f.root,'island.ts'),'import {h} from "@getforma/core";import {read} from "./shared";export function Badge(){return h("b",{onClick:read},()=>read())};export function Other(){return h("i",{onClick:read},()=>read())}');
  writeFileSync(join(f.root,'page.ts'),'import {h} from "@getforma/core";import {Badge,Other} from "./island";export function Page(){return h("main",null,Badge(),Other())}');
  writeFileSync(f.entry,'import "./shared";import {mount,activateIslands} from "@getforma/core";import {Page} from "./page";import {Badge,Other} from "./island";activateIslands({Badge,Other});mount(Page,"#app");');
  const actual=execute(await compile(f));expect(actual.events).toEqual(['shared initializer']);
  const registry=actual.calls[0].registry;
  expect(registry.Badge({})[1].onClick).toBe(actual.sharedRead);
  expect(registry.Other({})[1].onClick).toBe(actual.sharedRead);
  expect(registry.Badge({})[2]()).toBe(7);expect(registry.Other({})[2]()).toBe(7);
 });
 it('accepts activation-only browser code paired with a distinct native entry',async()=>{
  const f=fixture(),server=join(f.root,'server.ts');writeFileSync(server,readFileSync(f.entry));
  edit(f,'mount(Page,"#app");','');const actual=execute(await compile(f,server));
  expect(Object.keys(actual.calls[0].registry)).toEqual(['Badge']);
 });
 it('authenticates the same named page through an export alias across separate mounts',async()=>{
  const f=fixture(),server=join(f.root,'server.ts');writeFileSync(server,readFileSync(f.entry));
  writeFileSync(join(f.root,'barrel.ts'),'export {Page as Root} from "./page";');
  edit(f,'import {Page} from "./page"','import {Root as Alias} from "./barrel"');edit(f,'mount(Page,','mount(Alias,');
  expect(execute(await compile(f,server)).calls).toHaveLength(1);
 });
 it('refuses a different same-named browser page declaration',async()=>{
  const f=fixture(),server=join(f.root,'server.ts');writeFileSync(server,readFileSync(f.entry));
  writeFileSync(join(f.root,'other-page.ts'),readFileSync(join(f.root,'page.ts')));edit(f,'"./page"','"./other-page"');
  await expect(compile(f,server)).rejects.toThrow(/BUILD-611.*same original native page/);
 });
 it('removes empty registry and page mount without inferring static from registry length',async()=>{
  const f=fixture();writeFileSync(join(f.root,'page.ts'),'import {h} from "@getforma/core";export function Page(){return h("main",null,"static")}');
  const result=await compile(f);expect(execute(result).calls).toEqual([]);
  expect(getSsrEntryProducts(result)[0]).toMatchObject({browserRequired:false,islands:[]});
 });
 it('retains conditional reachable definitions even when the native request condition may be false',async()=>{
  const f=fixture();writeFileSync(join(f.root,'page.ts'),'import {h,createShow} from "@getforma/core";import {Badge} from "./island";export function Page(p:{show:boolean;label:string}){return h("main",null,createShow(()=>p.show,()=>Badge({label:p.label})))}');
  const result=await compile(f);expect(getSsrEntryProducts(result)[0]!.browserRequired).toBe(true);
  expect(Object.keys(execute(result).calls[0].registry)).toEqual(['Badge']);
 });
 it.each([
  ['assigned return','const dispose=mount(Page,"#app");'],
  ['exported return','export const dispose=mount(Page,"#app");'],
  ['nested invocation','if(true){mount(Page,"#app")}'],
  ['multiple mounts','mount(Page,"#app");mount(Page,"#other");'],
  ['effectful target','mount(Page,globalThis.target());'],
  ['extra arguments','mount(Page,"#app",globalThis.extra());'],
 ])('refuses %s with source location even without strict mode',async(_name,code)=>{
  const f=fixture();edit(f,'mount(Page,"#app");','\n'+code);
  try{await compile(f);throw Error('expected refusal');}catch(error:any){
   expect(error.errors[0]).toMatchObject({id:'BUILD-611',location:{line:2,column:expect.any(Number)}});
   expect(error.errors[0].notes.map((n:any)=>n.text).join('\n')).toContain('fix:');
  }
  expect(existsSync(join(f.root,'dist'))).toBe(false);
 });
 it.each(['if(true){activateIslands({Badge,Unused})}', 'activateIslands({Badge,Unused},globalThis.root())'])('refuses unsafe empty activation: %s',async(code)=>{
  const f=fixture();writeFileSync(join(f.root,'page.ts'),'import {h} from "@getforma/core";export function Page(){return h("main",null,"static")}');
  edit(f,'activateIslands({Badge,Unused},"#islands")',code);await expect(compile(f)).rejects.toThrow(/BUILD-611/);
 });
 it('keeps nonempty activation placement and argument effects exactly once',async()=>{
  const f=fixture();edit(f,'activateIslands({Badge,Unused},"#islands")','if(true){activateIslands({Badge,Unused},(globalThis.events.push("root"),"#root"))}');
  const actual=execute(await compile(f));expect(actual.events).toEqual(['root']);expect(actual.calls[0].root).toBe('#root');
 });
 it('refuses an indirect core mount alias instead of deleting arbitrary calls',async()=>{
  const f=fixture();edit(f,'mount(Page,"#app");','const render=mount;render(Page,"#app");');
  await expect(compile(f)).rejects.toThrow(/BUILD-611.*called directly/);
 });
 it('refuses a namespace core mount with an actionable named-import fix',async()=>{
  const f=fixture();edit(f,'mount(Page,"#app");','core.mount(Page,"#app");');
  writeFileSync(f.entry,'import * as core from "@getforma/core";'+readFileSync(f.entry,'utf8'));
  await expect(compile(f)).rejects.toThrow(/BUILD-611.*named core import/);
 });
 it('does not select an unrelated Page when the explicit mount component is unsupported',async()=>{
  const f=fixture();edit(f,'import {Page} from "./page"','import {Page as MainPage} from "./page"');
  edit(f,'mount(Page,"#app");','mount(globalThis.component(),"#app");');
  await expect(compile(f)).rejects.toThrow(/BUILD-610.*successful native product/);
 });
 it('refuses ambiguous activation-only Page imports',async()=>{
  const f=fixture();edit(f,'import {Page} from "./page"','import {Page as MainPage,Page as OtherPage} from "./page"');
  edit(f,'mount(Page,"#app");','');await expect(compile(f)).rejects.toThrow(/BUILD-611.*multiple Page imports/);
 });
 it('supports multiple independent activation calls and prunes only the unused one',async()=>{
  const f=fixture();edit(f,'activateIslands({Badge,Unused},"#islands")','activateIslands({Unused});activateIslands({Badge},"#islands")');
  const actual=execute(await compile(f));expect(actual.calls).toHaveLength(1);expect(Object.keys(actual.calls[0].registry)).toEqual(['Badge']);
 });
 it('rejects activation inside the compile-time mount instead of deleting its behavior',async()=>{
  const f=fixture();edit(f,'activateIslands({Badge,Unused},"#islands");mount(Page,"#app");','mount(()=>{activateIslands({Badge,Unused});return Page()},"#app");');
  await expect(compile(f)).rejects.toThrow(/BUILD-611.*outside/);
 });

 it('retains module target initialization even though the pure target reference is removed',async()=>{
  const f=fixture();edit(f,'mount(Page,"#app");','const target=(globalThis.events.push("target initializer"),"#app");mount(Page,target);');
  expect(execute(await compile(f)).events).toEqual(['target initializer']);
 });
 it('preserves explicit browserOnly mode as a browser-required island',async()=>{
  const f=fixture();writeFileSync(join(f.root,'island.ts'),'import {h,browserOnly} from "@getforma/core";export const Badge=browserOnly((p:{label:string})=>h("canvas",null,p.label));export function Unused(){return h("i",null,"unused")}');
  const result=await compile(f);expect(getSsrEntryProducts(result)[0]).toMatchObject({browserRequired:true,islands:[{name:'Badge',mode:'browserOnly'}]});
  expect(execute(result).calls[0].registry.Badge.metadata.mode).toBe(1);
 });
 it('refuses equal-looking inline roots in distinct entries instead of guessing identity',async()=>{
  const f=fixture();edit(f,'{mount,activateIslands}','{h,mount,activateIslands}');
  edit(f,'mount(Page,"#app");','mount(()=>h("main",null,Badge({label:"native"})),"#app");');
  const server=join(f.root,'server.ts');writeFileSync(server,readFileSync(f.entry));
  await expect(compile(f,server)).rejects.toThrow(/BUILD-611.*same original native page/);
 });
 it('keeps the preceding exact result usable across a refused entry-rewrite cycle, then recovers',async()=>{
  const f=fixture(),original=readFileSync(f.entry,'utf8');
  const ctx=await context({entryPoints:[f.entry],outdir:join(f.root,'dist'),write:false,bundle:true,format:'iife',logLevel:'silent',
   plugins:[stub,formaSsrPlugin({page:'app',outDir:join(f.root,'dist'),entryPoint:f.entry})]});
  try {
   const accepted=await ctx.rebuild(),record=getSsrEntryProducts(accepted)[0],bytes=accepted.outputFiles!.map(o=>Buffer.from(o.contents));
   edit(f,'mount(Page,"#app");','export const dispose=mount(Page,"#app");');
   await expect(ctx.rebuild()).rejects.toThrow(/BUILD-611/);
   expect(getSsrEntryProducts(accepted)[0]).toBe(record);
   expect(accepted.outputFiles!.map(o=>Buffer.from(o.contents))).toEqual(bytes);
   writeFileSync(f.entry,original);const recovered=await ctx.rebuild();
   expect(getSsrEntryProducts(recovered)[0]).toEqual(record);expect(execute(recovered).calls).toHaveLength(1);
  } finally {await ctx.dispose();}
 });

});
