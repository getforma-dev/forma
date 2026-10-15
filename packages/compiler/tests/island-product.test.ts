import {afterEach,describe,expect,it} from 'vitest';
import {build,type Plugin} from 'esbuild';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {runInNewContext} from 'node:vm';
import {formaSsrPlugin,generateRealIr} from '../src/esbuild-ssr-plugin';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const stub:Plugin={name:'core-fixture',setup(b){b.onResolve({filter:/^@getforma\/core$/},()=>({path:'core',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export function h(){return {}};export function mount(){};export function createSignal(v){return [()=>v,()=>{}]};export function __adoptionSignal(_site,pair){return pair};export function activateIslands(registry){globalThis.registry=registry};export function __islandRegistration(component,metadata){const wrapper=p=>component(p);wrapper.metadata=metadata;return wrapper}`,loader:'js'}));}};
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'forma-island-product-'));roots.push(root);
  const island=join(root,'badge.ts'),entry=join(root,'app.ts');
  writeFileSync(island,'import {h,createSignal} from "@getforma/core";export function Badge(p:{title:string;count?:number}){const [n]=createSignal(p.count??7);return h("p",null,p.title,n);}');
  writeFileSync(join(root,'page.ts'),'import {h} from "@getforma/core";import {Badge} from "./badge";export function Page(p:{title:string;count?:number}){return h("main",null,Badge({title:p.title,count:p.count}));}');
  writeFileSync(entry,'import {mount,activateIslands} from "@getforma/core";import {Page} from "./page";import {Badge} from "./badge";activateIslands({Badge});mount(()=>Page(),"#app");');
  return {root,entry,island};
}
async function compile(f:ReturnType<typeof fixture>,server=f.entry,before:Plugin[]=[],after:Plugin[]=[]){
  return build({entryPoints:[f.entry],outdir:join(f.root,'dist'),write:false,bundle:true,format:'iife',logLevel:'silent',plugins:[stub,...before,formaSsrPlugin({page:'app',outDir:join(f.root,'dist'),entryPoint:server,clientEntryPoint:f.entry}),...after]});
}
describe('one browser/native compilation product',()=>{
  it('injects the exact emitted contract into a unary runtime registration and returns both outputs',async()=>{
    const f=fixture(),expected=generateRealIr(f.entry)!,result=await compile(f);
    const js=result.outputFiles!.find(file=>file.path.endsWith('.js'))!;
    const native=result.outputFiles!.find(file=>file.path.endsWith('.ir'))!;
    expect(native.contents).toEqual(expected.binary);
    const globalThis:{registry?:any}={};runInNewContext(js.text,{globalThis});
    const contract=expected.islands[0]!.contract!;
    expect(globalThis.registry.Badge.metadata).toEqual({h:contract.digest,schema:contract.schema,mode:0});
    expect(existsSync(join(f.root,'dist'))).toBe(false);
  });
  it('pairs aliases of the same declaration across distinct entries',async()=>{
    const f=fixture(),server=join(f.root,'server.ts');
    writeFileSync(server,readFileSync(f.entry,'utf8'));
    writeFileSync(f.entry,readFileSync(f.entry,'utf8').replace('import {Badge} from','import {Badge as Renamed} from').replace('activateIslands({Badge})','activateIslands({Badge:Renamed})'));
    expect((await compile(f,server)).outputFiles?.map(file=>basename(file.path)).sort()).toEqual(['app.ir','app.js']);
  });
  it('refuses same-spelled but different resolved SSR/browser declarations even if their bodies match',async()=>{
    const f=fixture(),server=join(f.root,'server.ts');
    writeFileSync(join(f.root,'other.ts'),readFileSync(f.island));
    writeFileSync(server,readFileSync(f.entry,'utf8').replace('"./badge"','"./other"'));
    await expect(compile(f,server)).rejects.toThrow(/different SSR and browser declarations/);
    expect(existsSync(join(f.root,'dist'))).toBe(false);
  });
  it('refuses a source edit during the build and succeeds on the next complete product',async()=>{
    const f=fixture();let edited=false;
    const mutate:Plugin={name:'concurrent-source-edit',setup(b){b.onLoad({filter:/badge\.ts$/},()=>{
      if(!edited){edited=true;writeFileSync(f.island,readFileSync(f.island,'utf8').replace('??7','??8'));}return undefined;
    });}};
    await expect(compile(f,f.entry,[mutate])).rejects.toThrow(/sources changed while compiling/);
    expect(existsSync(join(f.root,'dist'))).toBe(false);
    const result=await compile(f);expect(result.outputFiles!.find(file=>file.path.endsWith('.ir'))!.contents).toEqual(generateRealIr(f.entry)!.binary);
  });
  it('never publishes before a later build error and rejects esbuild write:true',async()=>{
    const f=fixture();
    await expect(compile(f,f.entry,[],[{name:'final-failure',setup(b){b.onEnd(()=>({errors:[{text:'final validation refused'}]}));}}])).rejects.toThrow(/final validation refused/);
    expect(existsSync(join(f.root,'dist'))).toBe(false);
    await expect(build({entryPoints:[f.entry],outdir:join(f.root,'dist'),plugins:[formaSsrPlugin({page:'app',outDir:join(f.root,'dist'),entryPoint:f.entry})],logLevel:'silent'})).rejects.toThrow(/requires esbuild write:false/);
  });
});
