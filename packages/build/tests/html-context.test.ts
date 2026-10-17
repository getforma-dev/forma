/** Native publication gates, using actual build output and watch recovery. */
import {afterEach,expect,it,vi} from 'vitest';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from './helpers/named-build';
import {watching} from './helpers/watch';
import type {BuildConfig} from '../src/types';
const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true}));});
const failures=[
 ['BUILD-618',"h('p',null,h('div',null,'block'))"],
 ['BUILD-619',"h('title',null,'wrong owner')"],
 ['BUILD-623',"h('script',null,()=> 'void 0;')"],
 ['BUILD-620',"h('style',null,()=> 'p{color:navy}')"],
 ['BUILD-621',"createShow(()=>true,()=>h('b',null,'one'),()=>h('i',null,'two'))"],
] as const;
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'forma-html-publish-'));roots.push(root);
 const entry=join(root,'app.ts'),core=join(root,'node_modules/@getforma/core');mkdirSync(core,{recursive:true});
 writeFileSync(join(core,'package.json'),JSON.stringify({name:'@getforma/core',version:'3.0.0-dev',type:'module',exports:'./index.js'}));
 writeFileSync(join(core,'index.js'),'export const h=()=>{};export const mount=()=>{};export const activateIslands=()=>{};export const createShow=()=>{};export const __islandRegistration=f=>f;');
 const write=(tree="h('section',null,'accepted')")=>writeFileSync(entry,"import {h,mount,activateIslands,createShow} from '@getforma/core';\n"+`export function Panel(){return ${tree};}\nexport function Page(){return h('main',null,Panel());}\nactivateIslands({Panel});mount(()=>Page(),'#app');\n`);write();
 const config:BuildConfig={entryPoints:[{entry,outfile:'app.js'}],routes:{'/':{js:['app'],css:[]}},ssr:true,strict:false,outputDir:join(root,'dist'),diagnosticsJson:join(root,'diagnostics.json')};
 return {config,write};
}
it.each(failures)('%s refuses default publication and keeps the prior complete product',async(code,tree)=>{
 vi.spyOn(console,'log').mockImplementation(()=>{});vi.spyOn(console,'warn').mockImplementation(()=>{});
 const f=fixture();await build(f.config);const previous=readFileSync(join(f.config.outputDir,'manifest.json'),'utf8'),manifest=JSON.parse(previous),ir=readFileSync(join(f.config.outputDir,manifest.aliases['app.ir']));
 f.write(tree);await expect(build(f.config)).rejects.toThrow(code);
 const report=JSON.parse(readFileSync(f.config.diagnosticsJson!,'utf8'));expect(report.strict).toBe(true);expect(report.diagnostics).toEqual([expect.objectContaining({code,severity:'error',line:2,fix:expect.any(String)})]);
 expect(readFileSync(join(f.config.outputDir,'manifest.json'),'utf8')).toBe(previous);expect(readFileSync(join(f.config.outputDir,manifest.aliases['app.ir']))).toEqual(ir);
});
it('watch retains the accepted native module through every refusal then publishes a real repair',async()=>{
 const f=fixture();await watching(f.config,async({ready,change,manifest,output})=>{
  await ready();const previous=manifest(),bytes=readFileSync(join(f.config.outputDir,previous.aliases['app.ir']));
  for(const [code,tree] of failures){await change(()=>f.write(tree));expect(output()).toContain(code);expect(manifest()).toEqual(previous);expect(readFileSync(join(f.config.outputDir,previous.aliases['app.ir']))).toEqual(bytes);}
  await change(()=>f.write("h('section',null,'repaired after all refusals')"));const repaired=manifest();expect(repaired.aliases['app.ir']).not.toBe(previous.aliases['app.ir']);expect(readFileSync(join(f.config.outputDir,repaired.aliases['app.ir'])).includes(Buffer.from('repaired after all refusals'))).toBe(true);
 });
},30_000);
