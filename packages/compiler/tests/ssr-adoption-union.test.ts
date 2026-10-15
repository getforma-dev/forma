import {afterEach,describe,expect,it} from 'vitest';
import {build,context,type BuildOptions,type BuildResult,type Plugin} from 'esbuild';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {formaSsrPlugin,generateRealIr} from '../src/esbuild-ssr-plugin';
import {getSsrEntryProducts} from '../src/ssr-product';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const coreRoot=resolve('../core/src');
const prelude='import {h,createSignal} from "@getforma/core";';
function fixture(kind:'disjoint'|'same'|'conflict'='disjoint') {
 const root=mkdtempSync(join(tmpdir(),'forma-ssr-adoption-union-'));roots.push(root);
 const outdir=join(root,'dist'),shared=join(root,'shared.ts');
 const shim=join(root,'core.ts');
 writeFileSync(shim,`export * from ${JSON.stringify(join(coreRoot,'index.ts'))};export function mount(){throw Error('native mount survived')};export function activateIslands(registry){globalThis.registries??=[];globalThis.registries.push(registry)};`);
 const body=kind==='disjoint'
  ? `${prelude}const __forma_adoptSignal=1;export function A(p:{initial:number}){const [value]=createSignal(p.initial);return h('input',{value});}export function B(p:{initial:number}){const [value]=createSignal(p.initial);return h('input',{value});}`
  : `${prelude}function Field(p){const [value]=createSignal(p.initial);return h('input',{value});}export function A(p:{initial:string}){return Field({initial:p.initial});}export function B(p:{initial:${kind==='conflict'?'number':'string'}}){return Field({initial:p.initial});}`;
 writeFileSync(shared,body);
 for(const [entry,island] of [['a','A'],['b','B']]) {
  const value=kind==='disjoint'||(kind==='conflict'&&entry==='b')?'7':'"seven"';
  writeFileSync(join(root,`${entry}-page.ts`),`import {h} from "@getforma/core";import {${island}} from "./shared";export function Page(){return h('main',null,${island}({initial:${value}}));}`);
  writeFileSync(join(root,`${entry}.ts`),`import {mount,activateIslands} from "@getforma/core";import {Page} from "./${entry}-page";import {${island}} from "./shared";activateIslands({${island}});mount(Page,'#app');export {${island}};export {withAdoptionSink} from ${JSON.stringify(join(coreRoot,'reactive/adoption-hooks.ts'))};export {withAdoptionDescription} from ${JSON.stringify(join(coreRoot,'dom/adoption-description.ts'))};`);
 }
 const plugins=['a','b'].map(page=>formaSsrPlugin({page,outDir:outdir,entryPoint:join(root,`${page}.ts`)}));
 const options:BuildOptions={entryPoints:[join(root,'a.ts'),join(root,'b.ts')],outdir,bundle:true,splitting:true,format:'esm',write:false,logLevel:'silent',alias:{'@getforma/core':shim},plugins};
 return {root,outdir,shared,plugins,options,kind};
}
function execute(f:ReturnType<typeof fixture>,result:BuildResult) {
 for(const output of result.outputFiles!)if(output.path.endsWith('.js')){mkdirSync(dirname(output.path),{recursive:true});writeFileSync(output.path,output.contents);}
 writeFileSync(join(f.root,'package.json'),'{"type":"module"}');
 writeFileSync(join(f.root,'run.mjs'),`import * as a from './dist/a.js';import * as b from './dist/b.js';
 const captured=[],pairs=[],reads=[];
 const sink={capture:(...p)=>captured.push(p),enroll:(_site,p)=>pairs.push(p),writable:(read,get,codec)=>{reads.push({read,get,codec});return read;}};
 const first=${f.kind==='disjoint'?'7':'"seven"'},second=${f.kind==='same'?'"eight"':'8'};
 const results=a.withAdoptionSink(sink,()=>a.withAdoptionDescription(()=>[a.A({initial:first}),b.B({initial:second})]));
 const before=results.map(r=>r.props.value());pairs[0][1](${f.kind==='disjoint'?'9':'"changed"'});
 console.log(JSON.stringify({registries:globalThis.registries.map(Object.keys),captured:captured.length,pairs:pairs.length,
 exact:pairs.every((p,i)=>p[0]===captured[i][0]&&p[1]===captured[i][1]),distinct:pairs[0][0]!==pairs[1][0],
 reads:reads.length,codecs:reads.map(r=>r.codec),getters:reads.every((r,i)=>r.get===pairs[i][0]),before,after:results.map(r=>r.props.value())}));`);
 const child=spawnSync(process.execPath,[join(f.root,'run.mjs')],{encoding:'utf8'});
 expect(child.status,child.stderr).toBe(0);return JSON.parse(child.stdout);
}
function expectNative(f:ReturnType<typeof fixture>,result:BuildResult) {
 for(const page of ['a','b']) {
  const native=generateRealIr(join(f.root,`${page}.ts`))!;
  const actual=result.outputFiles!.find(output=>output.path===join(f.outdir,`${page}.ir`))!;
  expect(Buffer.from(actual.contents)).toEqual(Buffer.from(native.binary));
  expect(getSsrEntryProducts(result).find(record=>record.page===page)!.islands).toHaveLength(1);
 }
}

describe('actual split-plugin adoption hook union',()=>{
 it('instruments both disjoint islands in one shared module using actual built-in tuples',async()=>{
  const f=fixture(),result=await build(f.options);expectNative(f,result);
  expect(execute(f,result)).toEqual({registries:[['A'],['B']],captured:2,pairs:2,exact:true,distinct:true,reads:2,codecs:['number','number'],getters:true,before:[7,8],after:[9,8]});
 });
 it('composes inline component hooks with entry registry replacement and mount removal',async()=>{
  const f=fixture(),entry=join(f.root,'a.ts');
  writeFileSync(entry,`${prelude}import {mount,activateIslands} from '@getforma/core';export function A(p:{initial:number}){const [value]=createSignal(p.initial);return h('input',{value});}function Page(){return h('main',null,A({initial:7}));}activateIslands({A});mount(Page,'#app');export {withAdoptionSink} from ${JSON.stringify(join(coreRoot,'reactive/adoption-hooks.ts'))};export {withAdoptionDescription} from ${JSON.stringify(join(coreRoot,'dom/adoption-description.ts'))};`);
  const result=await build(f.options);expectNative(f,result);
  expect(execute(f,result)).toEqual({registries:[['A'],['B']],captured:2,pairs:2,exact:true,distinct:true,reads:2,codecs:['number','number'],getters:true,before:[7,8],after:[9,8]});
 });
 it.each([false,true])('keeps conflicting shared-helper codecs unseedable independent of plugin order (%s)',async reverse=>{
  const f=fixture('conflict');if(reverse)f.options.plugins!.reverse();const result=await build(f.options);expectNative(f,result);
  expect(execute(f,result)).toEqual({registries:[['A'],['B']],captured:2,pairs:2,exact:true,distinct:true,reads:0,codecs:[],getters:true,before:['seven',8],after:['changed',8]});
 });
 it('deduplicates agreeing helper hooks while retaining separate executions and getter identity',async()=>{
  const f=fixture('same'),result=await build(f.options);expectNative(f,result);
  expect(execute(f,result)).toEqual({registries:[['A'],['B']],captured:2,pairs:2,exact:true,distinct:true,reads:2,codecs:['string','string'],getters:true,before:['seven','eight'],after:['changed','eight']});
 });
 it('refuses shared hook-source drift and preserves prior records through recovery',async()=>{
  const f=fixture(),original=readFileSync(f.shared,'utf8');let mutate=false;
  const edit:Plugin={name:'late-hook-source-edit',setup(b){b.onLoad({filter:/[/\\]a\.ts$/,namespace:'file'},()=>{if(mutate){mutate=false;writeFileSync(f.shared,original+'\n// changed after analyses');}return undefined;});}};
  f.options.plugins=[edit,...f.plugins];const ctx=await context(f.options);
  try {
   const prior=await ctx.rebuild(),records=getSsrEntryProducts(prior);mutate=true;
   await expect(ctx.rebuild()).rejects.toThrow(/BUILD-610.*sources changed/);expect(getSsrEntryProducts(prior)).toEqual(records);
   writeFileSync(f.shared,original);const recovered=await ctx.rebuild();expectNative(f,recovered);expect(getSsrEntryProducts(recovered)).toEqual(records);
   expect(execute(f,recovered).reads).toBe(2);
  } finally {await ctx.dispose();}
 });
});
