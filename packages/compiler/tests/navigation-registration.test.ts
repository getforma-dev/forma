import {afterEach, describe, expect, it} from 'vitest';
import {build} from 'esbuild';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {formaSsrPlugin} from '../src/esbuild-ssr-plugin';
import {getSsrEntryProducts} from '../src/ssr-product';

const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function fixture(extra='') {
  const dir=mkdtempSync(join(tmpdir(),'forma-navigation-registration-'));dirs.push(dir);
  const entry=join(dir,'app.ts'),core=join(dir,'core.ts');
  writeFileSync(core,`export function h(){throw Error('rendered during registration')}\nexport function mount(){throw Error('mounted during registration')}\nexport function activateIslands(){throw Error('activated during registration')}\nexport function __islandRegistration(component, metadata){ return {component,metadata}; }\nexport function __adoptionChild(){}; export function __adoptionConditional(){}; export function __adoptionSignal(){}; export function __adoptionWritable(){};`);
  writeFileSync(join(dir,'page.ts'),`import {h} from '@getforma/core'; export function Counter(props:{count:number}){return h('button',null,props.count)} export function Page(props:{count:number}){return h('main',null,Counter({count:props.count}))}`);
  writeFileSync(entry,`import {mount,activateIslands} from '@getforma/core'; import {Page,Counter} from './page'; activateIslands({Counter}); mount(()=>Page({count:0}),'#app'); ${extra}`);
  return {dir,entry,core};
}
async function compile(f:ReturnType<typeof fixture>,registrationOnly=true) {
  return build({stdin:{contents:`export {__formaNavigationRegistry as registry} from ${JSON.stringify(f.entry)}`,loader:'ts',resolveDir:f.dir},
    outfile:join(f.dir,'out.js'),bundle:true,platform:'node',format:'esm',write:false,metafile:true,
    alias:{'@getforma/core':f.core},logLevel:'silent',
    plugins:[formaSsrPlugin({page:'page',outDir:f.dir,entryPoint:f.entry,experimentalRegistrationOnly:registrationOnly})]});
}
describe('experimental compiler-owned navigation registration product',()=>{
  it('exports only checked registrations without executing page mount, activation, or rendering',async()=>{
    const f=fixture(),result=await compile(f);
    const product=getSsrEntryProducts(result)[0];
    expect(product.islands).toEqual([{name:'Counter',mode:'ssr'}]);
    expect(result.outputFiles!.some(file=>file.path.endsWith('page.ir'))).toBe(true);
    const js=result.outputFiles!.find(file=>file.path.endsWith('.js'))!.text;
    const imported=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
    expect(Object.keys(imported.registry)).toEqual(['Counter']);
    expect(Object.isFrozen(imported.registry)).toBe(true);
    expect(imported.registry.Counter.metadata.h).toMatch(/^[0-9a-f]{16}$/);
    expect(imported.registry.Counter.metadata.schema).toEqual([[{name:'count',type:{kind:'number'}}]]);
  });
  it('refuses an entry side effect instead of executing it to discover registration',async()=>{
    await expect(compile(fixture('globalThis.sideEffect = true;'))).rejects.toThrow(/registration-only entry accepts declarations/);
  });
  it('does not transform ordinary activation entries into a group product',async()=>{
    const result=await compile(fixture(),false);
    // A module without exports is diagnosed by esbuild as an undefined import,
    // not a hard linking error. Its original activation still runs.
    expect(result.warnings.some(w=>w.id==='import-is-undefined')).toBe(true);
    const js=result.outputFiles!.find(file=>file.path.endsWith('.js'))!.text;
    await expect(import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)).rejects.toThrow('activated during registration');
  });
  it('refuses a second activation/root argument that would lose authored semantics',async()=>{
    const f=fixture();
    writeFileSync(f.entry,`import {mount,activateIslands} from '@getforma/core';import {Page,Counter} from './page';activateIslands({Counter}, document);mount(()=>Page({count:0}),'#app');`);
    await expect(compile(f)).rejects.toThrow(/registration-only entry requires one standalone/);
  });
});
