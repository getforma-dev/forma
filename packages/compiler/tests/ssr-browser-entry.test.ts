import {afterEach,expect,it} from 'vitest';
import {build,context,type Plugin} from 'esbuild';
import {mkdirSync,mkdtempSync,realpathSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {formaSsrPlugin,generateRealIr} from '../src/esbuild-ssr-plugin';
import {getSsrEntryProducts} from '../src/ssr-product';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'forma-browser-entry-')));roots.push(root);const entry=join(root,'app.ts'),outdir=join(root,'dist'),core=join(root,'core.ts');
 writeFileSync(join(root,'package.json'),'{"type":"module"}');
 writeFileSync(core,`export const h=(...args)=>args;export const mount=()=>{globalThis.mounts=(globalThis.mounts??0)+1};export const activateIslands=()=>{};export const __islandRegistration=f=>f;`);
 writeFileSync(join(root,'shared.ts'),`export const singleton={};`);
 writeFileSync(entry,`import {h,mount,activateIslands} from '@getforma/core';import {singleton} from './shared';export function Island(){return h('b',null,'content');}function Page(){return h('main',null,Island());}activateIslands({Island});mount(Page,'#app');export {singleton};`);
 const alias={path:'forma-browser-entry:browser.js',entryPoint:entry};
 const plugin=formaSsrPlugin({page:'ssr',outDir:outdir,entryPoint:entry,browserEntryPoints:[alias]});
 return {root,entry,outdir,plugin,options:{entryPoints:[{in:entry,out:'ssr'},{in:alias.path,out:'browser'}],outdir,bundle:true,splitting:true,format:'esm' as const,write:false,metafile:true,logLevel:'silent' as const,alias:{'@getforma/core':core},plugins:[plugin]}};
}
it('maps the virtual root to the same physical product snapshot and native bytes',async()=>{
 const f=fixture(),result=await build(f.options);const product=getSsrEntryProducts(result)[0];
 expect(product).toMatchObject({page:'ssr',sourceEntry:f.entry,browserEntry:f.entry});
 expect(Buffer.from(result.outputFiles!.find(file=>basename(file.path)==='ssr.ir')!.contents)).toEqual(Buffer.from(generateRealIr(f.entry)!.binary));
 expect(Object.values(result.metafile!.outputs).map(output=>output.entryPoint)).toContain('forma-browser-entry:browser.js');
 for(const output of result.outputFiles!){mkdirSync(dirname(output.path),{recursive:true});writeFileSync(output.path,output.contents);}
 writeFileSync(join(f.root,'run.mjs'),`import {singleton as a} from './dist/ssr.js';import {singleton as b} from './dist/browser.js';console.log(JSON.stringify({mounts:globalThis.mounts,same:a===b}));`);
 const child=spawnSync(process.execPath,[join(f.root,'run.mjs')],{encoding:'utf8'});expect(child.status,child.stderr).toBe(0);expect(JSON.parse(child.stdout)).toEqual({mounts:1,same:true});
});
it('refuses edits after native analysis before the virtual Browser load and recovers together',async()=>{
 const f=fixture(),original=readFileSync(f.entry,'utf8');let mutate=false;
 const drift:Plugin={name:'edit-before-browser-load',setup(b){b.onLoad({filter:/.*/,namespace:'forma-browser-entry'},()=>{if(mutate){mutate=false;writeFileSync(f.entry,original+'\n// late edit');}return undefined;});}};
 const ctx=await context({...f.options,plugins:[drift,f.plugin]});try{const before=await ctx.rebuild(),records=getSsrEntryProducts(before);mutate=true;await expect(ctx.rebuild()).rejects.toThrow(/BUILD-610.*sources changed/);expect(getSsrEntryProducts(before)).toEqual(records);writeFileSync(f.entry,original);const after=await ctx.rebuild();expect(getSsrEntryProducts(after)).toEqual(records);expect(after.outputFiles!.map(file=>file.hash)).toEqual(before.outputFiles!.map(file=>file.hash));}finally{await ctx.dispose();}
});
it('refuses an alias claiming a different physical client source',async()=>{const f=fixture();await expect(build({...f.options,plugins:[formaSsrPlugin({page:'ssr',outDir:f.outdir,entryPoint:f.entry,browserEntryPoints:[{path:'forma-browser-entry:browser.js',entryPoint:join(f.root,'shared.ts')}]})]})).rejects.toThrow(/BUILD-611.*paired physical client entry/);});
