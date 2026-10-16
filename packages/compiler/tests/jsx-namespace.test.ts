import {afterEach,expect,it} from 'vitest';
import {build,context,type Plugin} from 'esbuild';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {formaSsrPlugin,generateRealIr} from '../src/esbuild-ssr-plugin';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'forma-compiler-jsx-ns-')));roots.push(root);
  const entry=join(root,'app.tsx'),core=join(root,'core.ts'),outdir=join(root,'dist');
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  writeFileSync(core,`let namespace='html';export function svg(fn){const before=namespace;namespace='svg';try{return fn()}finally{namespace=before}}export function h(tag,props,...children){if(typeof tag==='function')return tag({...props,children});return {tag,ns:tag==='svg'?'svg':namespace,children}}export const createSignal=v=>[()=>v,n=>v=n];export const mount=fn=>{globalThis.tree=fn()};export const activateIslands=r=>{globalThis.registry=r};export const __islandRegistration=f=>f;export const __adoptionSignal=(site,tuple)=>{globalThis.hooks=(globalThis.hooks??0)+1;return tuple};export const __adoptionWritable=x=>x;export const __adoptionChild=(_,fn,args)=>fn(...args);`);
  writeFileSync(entry,`import {h,createSignal,mount,activateIslands} from '@getforma/core';export function Icon(){const[count,setCount]=createSignal(1);return <svg data-count={count}><a href="#x"><title>Icon</title></a></svg>}function Page(){return <main><Icon/></main>}activateIslands({Icon});mount(Page,'#app');`);
  const alias={path:'forma-browser-entry:browser.js',entryPoint:entry};
  const plugin=formaSsrPlugin({page:'ssr',outDir:outdir,entryPoint:entry,browserEntryPoints:[alias]});
  return {root,entry,outdir,plugin,options:{entryPoints:[{in:entry,out:'ssr'},{in:alias.path,out:'browser'}],outdir,bundle:true,splitting:true,format:'esm' as const,jsxFactory:'h',write:false,metafile:true,logLevel:'silent' as const,alias:{'@getforma/core':core},plugins:[plugin]}};
}
function namespaces(tree:any):string[]{return typeof tree==='object'&&tree!==null?[`${tree.tag}:${tree.ns}`,...(tree.children??[]).flatMap(namespaces)]:[];}
it('composes lexical namespace edits with adoption hooks and both entry roles without changing native IR',async()=>{
  const f=fixture(),native=generateRealIr(f.entry)!.binary,result=await build(f.options);
  expect(Buffer.from(result.outputFiles!.find(file=>basename(file.path)==='ssr.ir')!.contents)).toEqual(Buffer.from(native));
  const js=result.outputFiles!.filter(file=>file.path.endsWith('.js')).map(file=>file.text).join('\n');expect(js).toContain('__adoptionSignal');expect(js).toContain('__formaSvg');
  for(const output of result.outputFiles!){mkdirSync(dirname(output.path),{recursive:true});writeFileSync(output.path,output.contents);}
  writeFileSync(join(f.root,'run.mjs'),`await import('./dist/ssr.js');const ssr=globalThis.registry.Icon();const before=globalThis.tree;await import('./dist/browser.js');console.log(JSON.stringify({ssr,browser:globalThis.tree,noSsrMount:before===undefined,hooks:globalThis.hooks}));`);
  const got=spawnSync(process.execPath,[join(f.root,'run.mjs')],{encoding:'utf8'});expect(got.status,got.stderr).toBe(0);const value=JSON.parse(got.stdout);
  expect(value.noSsrMount).toBe(true);expect(value.hooks).toBe(2);expect(namespaces(value.ssr)).toEqual(['svg:svg','a:svg','title:svg']);expect(namespaces(value.browser)).toEqual(['main:html','svg:svg','a:svg','title:svg']);
});
it('retains the original snapshot guard and recovers after a namespace source drifts',async()=>{
  const f=fixture(),original=readFileSync(f.entry,'utf8');let mutate=false;
  const drift:Plugin={name:'namespace-drift',setup(b){b.onLoad({filter:/.*/,namespace:'forma-browser-entry'},()=>{if(mutate){mutate=false;writeFileSync(f.entry,original+'\n// drift')}return undefined;});}};
  const ctx=await context({...f.options,plugins:[drift,f.plugin]});try{const before=await ctx.rebuild();mutate=true;await expect(ctx.rebuild()).rejects.toThrow(/BUILD-610.*sources changed/);writeFileSync(f.entry,original);const after=await ctx.rebuild();expect(after.outputFiles!.map(file=>file.hash)).toEqual(before.outputFiles!.map(file=>file.hash));}finally{await ctx.dispose();}
});
it('preserves a configured custom JSX factory in the direct compiler plugin',async()=>{
  const f=fixture();writeFileSync(f.entry,readFileSync(f.entry,'utf8')+`\nfunction custom(tag,props,...children){return h(tag,props,...children)}\n`);
  const result=await build({...f.options,jsxFactory:'custom'});
  const js=result.outputFiles!.filter(file=>file.path.endsWith('.js')).map(file=>file.text).join('\n');expect(js).not.toContain('__formaSvg');expect(js).toContain('custom(');
});
it('captures browser-only JSX from the same direct-plugin loader and guards its source',async()=>{
  const f=fixture(),addon=join(f.root,'addon.tsx');const original=`import {h} from '@getforma/core';export const tree=<svg><a/></svg>;`;writeFileSync(addon,original);let mutate=false;
  const drift:Plugin={name:'browser-only-jsx-drift',setup(b){b.onEnd(()=>{if(mutate){mutate=false;writeFileSync(addon,original+'\n// late')}});}};
  const ctx=await context({...f.options,entryPoints:[...f.options.entryPoints,{in:addon,out:'addon'}],plugins:[drift,f.plugin]});
  try{const before=await ctx.rebuild();expect(before.outputFiles!.find(file=>basename(file.path)==='addon.js')!.text).toContain('__formaSvg');mutate=true;await expect(ctx.rebuild()).rejects.toThrow(/BUILD-610.*sources changed/);writeFileSync(addon,original);const after=await ctx.rebuild();expect(after.outputFiles!.map(file=>file.hash)).toEqual(before.outputFiles!.map(file=>file.hash));}finally{await ctx.dispose();}
});
it('keeps the six canonical namespace JSX vectors inside the admitted native subset',()=>{
  const result=generateRealIr(join(import.meta.dirname,'../../../e2e/ssr/cases/namespaces/app.tsx'));
  expect(result).not.toBeNull();expect(result!.binary.length).toBeGreaterThan(100);expect(result!.islands.map(island=>island.name)).toEqual(['NamespaceVectors']);
});
it('preserves native dynamic SVG title emission without widening the deferred adoption contract',async()=>{
  const f=fixture();writeFileSync(f.entry,readFileSync(f.entry,'utf8').replace('<title>Icon</title>','<title>{()=>count()}</title>'));
  const native=generateRealIr(f.entry)!.binary,result=await build(f.options);
  expect(Buffer.from(result.outputFiles!.find(file=>basename(file.path)==='ssr.ir')!.contents)).toEqual(Buffer.from(native));
});
