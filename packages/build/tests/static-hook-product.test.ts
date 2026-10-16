/** Thin package/build bridge. Full native HTTP and strict island adoption are
 * separate144/104 controls; this exercises emitted packages and paired products. */
import {afterEach,expect,it,vi} from 'vitest';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {generateRealIr} from '@getforma/compiler';
import {build} from './helpers/named-build';
import {watching} from './helpers/watch';
import type {BuildConfig,AssetManifest} from '../src/types';

const roots:string[]=[];
afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50})));
const sharedSource=`import {h,createSignal} from '@getforma/core';
function Field(p){const [value,setValue]=createSignal(p.initial);return h('div',null,h('input',{value,onInput:(e)=>setValue(e.currentTarget.value)}),h('b',null,value));}
export function A(p:{initial:string}){return Field({initial:p.initial});}
export function B(p:{initial:string}){return Field({initial:p.initial});}`;
function fixture() {
 const root=mkdtempSync(join(tmpdir(),'forma-static-hooks-package-'));roots.push(root);
 const src=join(root,'src'),dist=join(root,'dist'),installed=join(root,'node_modules/@getforma/core');mkdirSync(src);mkdirSync(installed,{recursive:true});
 // Exact built distribution and real installed dependency, no mock core exports,
 // package scripts, network resolution or source alias. R17 builds core first.
 const core=resolve('../core');
 cpSync(join(core,'dist'),join(installed,'dist'),{recursive:true});cpSync(join(core,'package.json'),join(installed,'package.json'));
 const alien=dirname(dirname(createRequire(join(core,'package.json')).resolve('alien-signals')));
 expect(JSON.parse(readFileSync(join(alien,'package.json'),'utf8')).name).toBe('alien-signals');
 cpSync(alien,join(root,'node_modules/alien-signals'),{recursive:true});
 writeFileSync(join(root,'package.json'),'{"type":"module"}');
 writeFileSync(join(src,'shared.ts'),sharedSource);
 for(const [entry,island] of [['a','A'],['b','B']]) {
  writeFileSync(join(src,`${entry}-page.ts`),`import {h} from '@getforma/core';import {${island}} from './shared';export function Page(){return h('main',null,${island}({initial:'${entry}-native'}));}`);
  writeFileSync(join(src,`${entry}.ts`),`import {mount,activateIslands} from '@getforma/core';import {Page} from './${entry}-page';import {${island}} from './shared';activateIslands({${island}});mount(Page,'#app');export {${island}};`);
 }
 writeFileSync(join(src,'static.ts'),`import {h,mount} from '@getforma/core';function StaticPage(){return h('main',null,'STATIC_NATIVE');}mount(StaticPage,'#app');`);
 writeFileSync(join(src,'browser.ts'),`import {h,mount} from '@getforma/core';mount(()=>h('p',{id:'browser-ready'},'BROWSER'),'#browser');`);
 const config:BuildConfig={outputDir:dist,ssr:true,codeSplitting:true,entryPoints:['a','b','static','browser'].map(name=>({entry:join(src,`${name}.ts`),outfile:`${name}.js`,...(name==='browser'?{ssr:false}:{})})),routes:{'/a':{js:['a'],css:[]},'/b':{js:['b'],css:[]},'/static':{js:['static'],css:[]},'/browser':{js:['browser'],css:[]}}};
 return {root,src,dist,config};
}
function paired(f:ReturnType<typeof fixture>,manifest:AssetManifest) {
 expect(manifest.routes['/static']).toMatchObject({mode:'ssr',js:[]});expect(manifest.routes['/static'].modulepreload).toBeUndefined();expect(manifest.aliases['static.js']).toBeUndefined();
 expect(manifest.routes['/browser']).toMatchObject({mode:'browser'});expect(manifest.routes['/browser'].ir).toBeUndefined();
 for(const [route,entry] of [['/a','a'],['/b','b'],['/static','static']]) {
  const file=manifest.routes[route].ir!;expect(readFileSync(join(f.dist,file))).toEqual(Buffer.from(generateRealIr(join(f.src,`${entry}.ts`))!.binary));
 }
 for(const [file,metadata] of Object.entries(manifest.assets)) {
  const bytes=readFileSync(join(f.dist,file));expect(metadata.integrity).toBe(`sha384-${createHash('sha384').update(bytes).digest('base64')}`);
 }
 expect(manifest.routes['/a'].js).toHaveLength(1);expect(manifest.routes['/b'].js).toHaveLength(1);
 const shared=manifest.routes['/a'].modulepreload!.filter(file=>manifest.routes['/b'].modulepreload!.includes(file));expect(shared.length).toBeGreaterThan(0);
}
function execute(f:ReturnType<typeof fixture>,manifest:AssetManifest) {
 const runner=join(f.root,'observe.mjs'),html=pathToFileURL(createRequire(resolve('../core/package.json')).resolve('happy-dom')).href;
 const file=(route:string)=>pathToFileURL(join(f.dist,manifest.routes[route].js[0])).href;
 writeFileSync(runner,`import {Window} from ${JSON.stringify(html)};
 const window=new Window({url:'http://localhost/'});for(const name of ['window','document','Node','Element','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','HTMLOptionElement','SVGElement','DocumentFragment','Text','Comment','MutationObserver','CustomEvent','Event'])Object.defineProperty(globalThis,name,{value:name==='window'?window:window[name],configurable:true});
 document.body.innerHTML='<main id="app">native sentinel</main><section id="browser"></section>';
 const sentinel=document.querySelector('#app'),original=sentinel.firstChild;
 const a=await import(${JSON.stringify(file('/a'))}),b=await import(${JSON.stringify(file('/b'))});
 const nodes=[a.A({initial:'one'}),b.B({initial:'two'})];for(const node of nodes)document.body.append(node);const inputs=nodes.map(node=>node.querySelector('input'));
 const initial=inputs.map(input=>input.value);inputs[0].value='edited';inputs[0].dispatchEvent(new Event('input'));
 await import(${JSON.stringify(file('/browser'))});await Promise.resolve();
 console.log(JSON.stringify({initial,after:inputs.map(input=>input.value),labels:nodes.map(node=>node.querySelector('b').textContent),nativeUnchanged:sentinel.firstChild===original&&sentinel.textContent==='native sentinel',browser:document.querySelector('#browser-ready')?.textContent,hosts:document.querySelectorAll('[data-forma-island]').length}));await window.happyDOM.close();`);
 const child=spawnSync(process.execPath,[runner],{encoding:'utf8',timeout:10000});expect(child.status,child.stderr).toBe(0);
 expect(JSON.parse(child.stdout)).toEqual({initial:['one','two'],after:['edited','two'],labels:['edited','two'],nativeUnchanged:true,browser:'BROWSER',hosts:0});
}
it('publishes actual core hooks/shared chunks, exact native products and a static route together',async()=>{
 const f=fixture(),result=await build(f.config);paired(f,result.manifest);execute(f,result.manifest);
},30_000);// a real build plus a child process that executes it: seconds on a busy machine
it('keeps actual package/IR/manifest bytes on refusal and publishes a recovered coherent generation',async()=>{
 const f=fixture();await watching(f.config,async watcher=>{
  await watcher.ready();const accepted=watcher.manifest() as AssetManifest;paired(f,accepted);execute(f,accepted);
  const manifestBytes=readFileSync(join(f.dist,'manifest.json'));
  const old=new Map(Object.keys(accepted.assets).map(file=>[file,readFileSync(join(f.dist,file))]));
  await watcher.change(()=>writeFileSync(join(f.src,'shared.ts'),sharedSource.replace('Field({initial:p.initial})','Field({initial:unknownRuntime()})')));
  await vi.waitFor(()=>expect(watcher.output()).toContain('BUILD-610'));
  expect(readFileSync(join(f.dist,'manifest.json'))).toEqual(manifestBytes);for(const [file,bytes] of old)expect(readFileSync(join(f.dist,file))).toEqual(bytes);
  await watcher.change(()=>{
   writeFileSync(join(f.src,'shared.ts'),sharedSource+'\n// coherent recovered source');
   const page=join(f.src,'a-page.ts');writeFileSync(page,readFileSync(page,'utf8').replace('a-native','a-recovered'));
  });
  const recovered=await vi.waitFor(()=>{const current=watcher.manifest() as AssetManifest;expect(current.routes['/a'].ir,watcher.output()).not.toBe(accepted.routes['/a'].ir);return current;},{timeout:10_000});
  expect(readFileSync(join(f.dist,'manifest.json'))).not.toEqual(manifestBytes);
  paired(f,recovered);execute(f,recovered);
  for(const [file,bytes] of old)expect(readFileSync(join(f.dist,file))).toEqual(bytes);
 });
},20000);
