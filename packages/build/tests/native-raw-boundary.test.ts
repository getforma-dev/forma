import {afterEach,expect,it,vi} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from './helpers/named-build';
import {watching} from './helpers/watch';
const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});});
const safe="h('main',null,h('style',null,'p{color:navy}'),h('iframe',{srcdoc:null,title:'safe'}))";
function fixture(tree=safe) {
 const root=mkdtempSync(join(tmpdir(),'forma-raw-build-'));roots.push(root);
 const core=join(root,'node_modules/@getforma/core');mkdirSync(core,{recursive:true});
 writeFileSync(join(root,'package.json'),'{"type":"module"}');writeFileSync(join(core,'package.json'),'{"name":"@getforma/core","type":"module","exports":"./index.js"}');
 writeFileSync(join(core,'index.js'),'export const h=(...x)=>x;export const mount=f=>f();');
 const entry=join(root,'app.ts'),dist=join(root,'dist');
 const set=(body:string)=>writeFileSync(entry,`import {h,mount} from '@getforma/core'; export function Page(p:{markup:string}){return ${body};} mount(()=>Page({markup:'raw'}),'#app');`);set(tree);
 return{dist,set,config:{outputDir:dist,ssr:true,codeSplitting:false,entryPoints:[{entry,outfile:'home.js'}],routes:{'/':{js:['home'],css:[]}}}};
}
it.each([
 ["h('script',null,'void 0;')",'BUILD-623'],
 ["h('svg',null,h('script',null,'void 0;'))",'BUILD-623'],
 ["h('iframe',{srcdoc:'<p>raw</p>'})",'BUILD-624'],
 ["h('iframe',{srcdoc:p.markup})",'BUILD-624'],
])('normal build refuses %s before publication',async(tree,code)=>{
 const f=fixture(tree);await expect(build(f.config)).rejects.toThrow(code);expect(existsSync(join(f.dist,'manifest.json'))).toBe(false);
});
it('watch preserves accepted output through both raw refusals and recovers',async()=>{
 const f=fixture();await watching(f.config,async watcher=>{
  await watcher.ready();const accepted=readFileSync(join(f.dist,'manifest.json'));const original=watcher.manifest();
  const bytes=readFileSync(join(f.dist,original.routes['/'].ir!));
  for(const[tree,code]of [["h('script',null,'void 0;')",'BUILD-623'],["h('iframe',{srcdoc:p.markup})",'BUILD-624']]){
   await watcher.change(()=>f.set(tree));await vi.waitFor(()=>expect(watcher.output()).toContain(code),{timeout:10_000});
   expect(readFileSync(join(f.dist,'manifest.json'))).toEqual(accepted);expect(readFileSync(join(f.dist,original.routes['/'].ir!))).toEqual(bytes);
  }
  await watcher.change(()=>f.set(safe.replace("'safe'","'recovered'")));
  await vi.waitFor(()=>{const manifest=watcher.manifest();expect(readFileSync(join(f.dist,manifest.routes['/'].ir!)).toString(),watcher.output()).toContain('recovered');},{timeout:10_000});
 });
},30_000);
