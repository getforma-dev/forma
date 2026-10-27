import {afterEach,describe,expect,it} from 'vitest';
import {build,context,type BuildOptions,type BuildResult,type Plugin} from 'esbuild';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {formaSsrPlugin} from '../src/esbuild-ssr-plugin';
import {getSsrEntryProducts} from '../src/ssr-product';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const core:Plugin={name:'coordinator-core',setup(b){
 b.onResolve({filter:/^@getforma\/core$/},()=>({path:'core',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:'export function h(...args){return args};export function mount(){throw Error("unexpected native mount")};export function activateIslands(registry){globalThis.events.push(Object.keys(registry))};export function __islandRegistration(component,metadata){component.metadata=metadata;return component};'}));
}};
function fixture(onSourcesChanged?: (page:string)=>void){
 const root=mkdtempSync(join(tmpdir(),'forma-compilation-context-'));roots.push(root);
 const outdir=join(root,'dist');
 writeFileSync(join(root,'shared.ts'),'import {h} from "@getforma/core";globalThis.events??=[];globalThis.events.push("shared once");export function A(){return h("b",null,"A")};export function B(){return h("i",null,"B")}');
 for(const [entry,island] of [['a','A'],['b','B']]) {
  writeFileSync(join(root,`${entry}-page.ts`),`import {h} from "@getforma/core";import {${island}} from "./shared";export function Page(){return h("main",null,${island}())}`);
  writeFileSync(join(root,`${entry}.ts`),`import {mount,activateIslands} from "@getforma/core";import {Page} from "./${entry}-page";import {${island}} from "./shared";activateIslands({${island}});mount(Page,"#app");`);
 }
 const plugins=['a','b'].map(page=>formaSsrPlugin({page,outDir:outdir,entryPoint:join(root,`${page}.ts`),onSourcesChanged}));
 const options:BuildOptions={entryPoints:[join(root,'a.ts'),join(root,'b.ts')],outdir,bundle:true,splitting:true,format:'esm',write:false,logLevel:'silent',plugins:[core,...plugins]};
 return {root,outdir,plugins,options};
}
function execute(f:ReturnType<typeof fixture>,result:BuildResult):unknown {
 for(const output of result.outputFiles!)if(output.path.endsWith('.js')){mkdirSync(dirname(output.path),{recursive:true});writeFileSync(output.path,output.contents);}
 writeFileSync(join(f.root,'package.json'),'{"type":"module"}');
 writeFileSync(join(f.root,'run.mjs'),'import "./dist/a.js";import "./dist/b.js";console.log(JSON.stringify(globalThis.events));');
 const child=spawnSync(process.execPath,[join(f.root,'run.mjs')],{encoding:'utf8',timeout:25_000});
 expect(child.status,[child.stderr,child.error?.message].filter(Boolean).join('\n')).toBe(0);return JSON.parse(child.stdout);
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve};}

describe('build-scoped original compilation coordinator',()=>{
 it('composes disjoint islands from a shared module before the first split load',async()=>{
  const f=fixture(),result=await build(f.options);
  expect(getSsrEntryProducts(result).map(p=>p.islands.map(i=>i.name))).toEqual([['A'],['B']]);
  expect(execute(f,result)).toEqual(['shared once',['A'],['B']]);
 });
 it('allows two concurrent independent option objects while plugin setup interleaves',async()=>{
  const first=fixture(),second=fixture(),arrived=deferred(),release=deferred();let count=0;
  const pause:Plugin={name:'interleaved-setup',async setup(){if(++count===2)arrived.resolve();await release.promise;}};
  first.options.plugins=[core,first.plugins[0]!,pause,first.plugins[1]!];
  second.options.plugins=[core,second.plugins[0]!,pause,second.plugins[1]!];
  const pending=Promise.all([build(first.options),build(second.options)]);void pending.catch(()=>{});
  try {await arrived.promise;release.resolve();const results=await pending;
   expect(getSsrEntryProducts(results[0]!)[0]!.sourceEntry).toContain(first.root.split('/').pop());
   expect(getSsrEntryProducts(results[1]!)[0]!.sourceEntry).toContain(second.root.split('/').pop());
   expect(execute(first,results[0]!)).toEqual(['shared once',['A'],['B']]);
   expect(execute(second,results[1]!)).toEqual(['shared once',['A'],['B']]);
  } finally {release.resolve();await pending.catch(()=>{});}
  // Windows reached 6.645s in this interleaved build/child execution case.
  // Both Node children are individually bounded at 25s; retain the full oracle.
 },60_000);
 it('permits sequential reuse of one options object with distinct fresh result records',async()=>{
  const f=fixture(),first=await build(f.options),second=await build(f.options);
  expect(getSsrEntryProducts(second)).toEqual(getSsrEntryProducts(first));
  expect(getSsrEntryProducts(second)[0]).not.toBe(getSsrEntryProducts(first)[0]);
  expect(execute(f,second)).toEqual(['shared once',['A'],['B']]);
 });
 it('retains captured completed contexts when the same options creates a later context',async()=>{
  const f=fixture(),first=await context(f.options),second=await context(f.options);
  try {
   const results=await Promise.all([first.rebuild(),second.rebuild()]);
   expect(getSsrEntryProducts(results[0])).toEqual(getSsrEntryProducts(results[1]));
   expect(getSsrEntryProducts(await first.rebuild())).toEqual(getSsrEntryProducts(results[0]));
  } finally {await Promise.all([first.dispose(),second.dispose()]);}
 });
 it('refuses ambiguous overlapping setup on one options object, then permits reuse after completion',async()=>{
  const f=fixture(),arrived=deferred(),release=deferred();
  const pause:Plugin={name:'held-setup',async setup(){arrived.resolve();await release.promise;}};
  f.options.plugins=[core,f.plugins[0]!,pause,f.plugins[1]!];
  const first=build(f.options);void first.catch(()=>{});
  try {
   await arrived.promise;
   await expect(build(f.options)).rejects.toThrow(/BUILD-611.*same options object/);
   release.resolve();expect(getSsrEntryProducts(await first)).toHaveLength(2);
   expect(getSsrEntryProducts(await build(f.options))).toHaveLength(2);
  } finally {release.resolve();await first.catch(()=>{});}
 });
 it('refuses unequal original source snapshots between entries instead of picking the first load',async()=>{
  const changed:string[]=[],f=fixture(page=>changed.push(page)),path=join(f.root,'shared.ts'),original=readFileSync(path,'utf8');let mutate=true;
  const edit:Plugin={name:'between-entry-analyses',setup(b){b.onStart(()=>{if(mutate)writeFileSync(path,original.replace('"B"','"changed B"'));});}};
  f.options.plugins=[core,f.plugins[0]!,edit,f.plugins[1]!];
  await expect(build(f.options)).rejects.toThrow(/BUILD-610.*different original source bytes/);
  expect(changed).toEqual(['a','b']);
  mutate=false;writeFileSync(path,original);expect(getSsrEntryProducts(await build(f.options))).toHaveLength(2);
 });
 it('retains the second contributor snapshot guard across refused and recovered cycles',async()=>{
  const f=fixture(),path=join(f.root,'b-page.ts'),original=readFileSync(path,'utf8');let mutate=false;
  const edit:Plugin={name:'late-second-source-change',setup(b){b.onLoad({filter:/[/\\]a\.ts$/,namespace:'file'},()=>{
   if(mutate){mutate=false;writeFileSync(path,original+'\n// later source edit');}return undefined;
  });}};
  f.options.plugins=[core,edit,...f.plugins];const ctx=await context(f.options);
  try {
   const accepted=await ctx.rebuild(),records=getSsrEntryProducts(accepted);
   mutate=true;await expect(ctx.rebuild()).rejects.toThrow(/BUILD-610.*sources changed/);
   expect(getSsrEntryProducts(accepted)).toEqual(records);
   writeFileSync(path,original);expect(getSsrEntryProducts(await ctx.rebuild())).toEqual(records);
  } finally {await ctx.dispose();}
 });
 it('leaves custom non-file loader namespaces to their owning plugin',async()=>{
  const f=fixture();writeFileSync(join(f.root,'a.ts'),readFileSync(join(f.root,'a.ts'),'utf8')+'import "virtual-entry";');
  const virtual:Plugin={name:'virtual-module',setup(b){
   b.onResolve({filter:/^virtual-entry$/},()=>({path:'not-a-disk-file.ts',namespace:'virtual'}));
   b.onLoad({filter:/.*/,namespace:'virtual'},()=>({contents:'globalThis.virtualLoaded=true;',loader:'ts'}));
  }};
  f.options.plugins!.push(virtual);expect(getSsrEntryProducts(await build(f.options))).toHaveLength(2);
 });
});
