import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {BuildContext,BuildOptions,BuildResult,Plugin} from 'esbuild';
import {generateRealIr} from '@getforma/compiler';

const control=vi.hoisted(()=>({contexts:[] as BuildContext[],armed:false,entered:undefined as (()=>void)|undefined,
  release:undefined as (()=>void)|undefined,gate:undefined as {id:string;cycle:number}|undefined,
  ends:[] as {id:string;cycle:number;result:BuildResult}[],rebuilds:0}));
vi.mock('esbuild',async importOriginal=>{
  const actual=await importOriginal<typeof import('esbuild')>();
  return {...actual,context:async(options:BuildOptions)=>{
    const id=JSON.stringify(options.entryPoints);let cycle=0;
    // onStart has captured the actual compiler source, but no entry onLoad has
    // returned watchFiles to esbuild yet. Only this timing gap is controlled.
    const barrier:Plugin={name:'source-registration-barrier',setup(builder){
      builder.onStart(()=>{cycle++;});
      builder.onLoad({filter:/[/\\]app\.ts$/,namespace:'file'},async()=>{
        if(!control.armed)return;control.armed=false;
        control.gate={id,cycle};
        const released=new Promise<void>(resolve=>{control.release=resolve;});
        control.entered!();await released;return undefined;
      });
    }};
    const observer:Plugin={name:'observe-actual-source-result',setup(builder){builder.onEnd(result=>{control.ends.push({id,cycle,result});});}};
    const raw=await actual.context({...options,plugins:[barrier,...(options.plugins??[]),observer]});
    const context={...raw,rebuild:()=>{control.rebuilds++;return raw.rebuild();}};
    control.contexts.push(context);return context;
  }};
});
import {build} from './helpers/named-build';

const roots:string[]=[];
afterEach(async()=>{
  control.release?.();await Promise.all(control.contexts.splice(0).map(context=>context.dispose()));
  control.armed=false;control.entered=undefined;control.release=undefined;control.gate=undefined;control.ends=[];control.rebuilds=0;
  for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});
});
const prefix="import {h} from '@getforma/core';import type {Props} from './props';export function Badge(p:Props){return h('b',null,p.value);}";
const live=prefix+"export function Page(){return h('main',null,Badge({value:'LIVE_NATIVE'}));}";
const staticPage=prefix+"export function Page(){return h('main',null,'RECOVERED_NATIVE');}";
const refused=live.replace("Badge({value:'LIVE_NATIVE'})",'unknownRuntime()');
const captured=live.replace('LIVE_NATIVE','CAPTURED_NATIVE');
const app="import {mount,activateIslands} from '@getforma/core';import {Page,Badge} from './page';activateIslands({Badge});mount(()=>Page(),'#app');";
const initialProps='export interface Props {value:string}';
const changedProps='export interface Props {value:string;note?:string}';

for(const codeSplitting of [false,true])for(const state of ['native-refusal','successful-snapshot','browser-refusal','type-file','type-resolution'] as const){
  it(`recovers ${state} source drift after capture without another edit (split=${codeSplitting})`,async()=>{
    const root=mkdtempSync(join(tmpdir(),'forma-watch-source-'));roots.push(root);
    const src=join(root,'src'),dist=join(root,'dist'),core=join(root,'node_modules/@getforma/core');
    mkdirSync(src);mkdirSync(core,{recursive:true});mkdirSync(join(src,'props'));
    writeFileSync(join(root,'package.json'),'{"type":"module"}');
    writeFileSync(join(core,'package.json'),'{"name":"@getforma/core","version":"3.0.0-dev","type":"module","exports":"./index.js"}');
    writeFileSync(join(core,'index.js'),'export const h=(...x)=>x;export const mount=f=>f();export const activateIslands=x=>x;export const __islandRegistration=(f,m)=>f;');
    const page=join(src,'page.ts'),entry=join(src,'app.ts'),types=join(src,'props/index.ts');
    writeFileSync(page,live);writeFileSync(entry,app);writeFileSync(types,initialProps);
    writeFileSync(join(src,'other.ts'),"globalThis.other='unrelated-browser-entry';");
    await build({entryPoints:[{entry,outfile:'app.js'},{entry:join(src,'other.ts'),outfile:'other.js',ssr:false}],
      routes:{'/':{js:['app'],css:[]},'/other':{js:['other'],css:[]}},outputDir:dist,ssr:true,watch:true,codeSplitting});
    const manifest=()=>JSON.parse(readFileSync(join(dist,'manifest.json'),'utf8'));
    const accepted=readFileSync(join(dist,'manifest.json')),before=manifest();
    const held=[...before.routes['/'].js,before.routes['/'].ir].map(file=>({file,bytes:readFileSync(join(dist,file))}));
    const entered=new Promise<void>(resolve=>{control.entered=resolve;});control.armed=true;
    writeFileSync(page,state==='native-refusal'?refused:captured);
    if(state==='browser-refusal')writeFileSync(entry,app+"export const load=()=>import('./missing-browser-only');");
    const attempt=control.contexts[0].rebuild();void attempt.catch(()=>{});
    try{
      await entered;expect(readFileSync(join(dist,'manifest.json'))).toEqual(accepted);
      if(state==='type-file')writeFileSync(types,changedProps);
      else if(state==='type-resolution')writeFileSync(join(src,'props.ts'),changedProps);
      else {writeFileSync(page,staticPage);writeFileSync(entry,app);}
      control.release!();
      // A caller's rebuild() can join the preceding initial generation. The
      // oracle is the exact context/cycle held by the loader barrier.
      await vi.waitFor(()=>{
        const ended=control.ends.find(end=>end.id===control.gate!.id&&end.cycle===control.gate!.cycle);
        expect(ended).toBeDefined();
        expect(ended!.result.errors.map(error=>error.text).join('\n')).toMatch(
          state==='native-refusal'?/unknownRuntime/:state==='browser-refusal'?/missing-browser-only/:/sources changed/);
      },{timeout:10000});
      await vi.waitFor(()=>{
        const current=manifest(),product=generateRealIr(entry)!;
        expect(current.routes['/'].ir).not.toBe(before.routes['/'].ir);
        expect(readFileSync(join(dist,current.routes['/'].ir))).toEqual(Buffer.from(product.binary));
        if(state==='type-file'||state==='type-resolution'){
          expect(current.routes['/'].js).toHaveLength(1);
          expect(readFileSync(join(dist,current.routes['/'].js[0]),'utf8')).toContain(product.islands[0].contract!.digest);
        }else expect(current.routes['/'].js).toEqual([]);
      },{timeout:10000});
      for(const old of held)expect(readFileSync(join(dist,old.file))).toEqual(old.bytes);
      if(state==='native-refusal'){
        writeFileSync(page,refused);
        await expect(control.contexts[0].rebuild()).rejects.toThrow(/unknownRuntime/);
        const count=control.rebuilds;
        await new Promise(resolve=>setTimeout(resolve,250));
        expect(control.rebuilds,'unchanged invalid native source does not schedule recovery').toBe(count);
        expect(manifest().routes['/'].js).toEqual([]);
      }
    }finally{control.release?.();await attempt.catch(()=>{});}
  },20000);
}
