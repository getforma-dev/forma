import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
const folders:string[]=[];
afterEach(()=>{for(const dir of folders.splice(0))rmSync(dir,{recursive:true,force:true});});
function compile(page:string,extra:Record<string,string>={}) {
  const dir=mkdtempSync(join(tmpdir(),'forma-island-refusal-'));folders.push(dir);
  for(const [file,text]of Object.entries({
    'app.ts':'import {mount} from "@getforma/core";import {Page} from "./page";mount(()=>Page(),"#app");',
    'page.ts':'import {h,createShow,createList,browserOnly} from "@getforma/core";'+page,...extra,
  }))writeFileSync(join(dir,file),text);
  return ()=>generateRealIr(join(dir,'app.ts'));
}
describe('unsupported native island refusal',()=>{
  it('preserves the original admitted static imported-table expansion',()=>{
    const entry=resolve(__dirname,'fixtures/ir-corpus/imported-const-table/app.ts');
    expect(generateRealIr(entry)?.islands.map(island=>island.name)).toEqual(['KeyPicker']);
  });
  it('keeps the archived undeclared nested-island source as explicit refusal evidence',()=>{
    const entry=resolve(__dirname,'../../../docs/archive/2026-10-15-pre-state-contract-corpus/packages/compiler/tests/fixtures/ir-corpus/nested-islands/app.ts');
    expect(()=>generateRealIr(entry)).toThrow(/BUILD-610.*panelClass/);
  });
  it.each([
    'export function Page(){return h("main",null,Missing());}',
    'export function Page(){return h(window.tag,null,"lost");}',
    'export function Page(){return h("main",null,createList(rows,key,map));}',
    'export function Page(){return h("main",null,...rows);}',
    'const Only=browserOnly(()=>window.arbitrary());export function Page(){return h("main",null,Only());}',
  ])('never replaces an unsupported subtree with an empty unregistered host',source=>{
    expect(compile(source)).toThrow(/BUILD-610 .*page\.ts:1:\d+:/);
  });
  it('refuses an unresolved imported component with the original use location',()=>{
    expect(compile('import {Missing} from "./missing";export function Page(){return h("main",null,Missing());}')).toThrow(/BUILD-610.*Missing/);
  });
});
