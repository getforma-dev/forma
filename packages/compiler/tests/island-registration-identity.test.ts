import {afterEach, describe, expect, it} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIslandRegistry} from '../src/island-registry';
const dirs:string[]=[];
function fixture(files:Record<string,string>) {
  const dir=mkdtempSync(join(tmpdir(),'forma-island-identity-')); dirs.push(dir);
  for(const [name,source] of Object.entries(files)) writeFileSync(join(dir,name),source);
  return {registry:()=>createIslandRegistry(join(dir,'app.ts')),file:(name:string)=>join(dir,name)};
}
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const head='import {h,activateIslands,createSignal,browserOnly} from "@getforma/core";';
describe('declared activation registration identity',()=>{
  it('resolves import aliases and barrels to one declaration and registration name',()=>{
    const f=fixture({'app.ts':head+'import {Badge as Local} from "./barrel";activateIslands({Status:Local});',
      'barrel.ts':'export {Badge} from "./badge";',
      'badge.ts':head+'export const Badge=(p:{title:string})=>h("b",null,p.title);',
      'page.ts':'import {Badge as Other} from "./badge";',
      'unrelated.ts':head+'export function Badge(){return h("i",null,"unrelated");}'});
    const registry=f.registry(), item=registry.resolve('Other',f.file('page.ts'))!;
    expect(item.name).toBe('Status'); expect(item).toBe(registry.resolve('Local',f.file('app.ts')));
    expect(item.declared.schema[0]!.map(x=>x.name)).toEqual(['title']);
    expect(item.analyze().bindings).toEqual([{kind:'text',value:{kind:'prop',path:['title']}}]);
    expect(registry.resolve('Badge',f.file('unrelated.ts'))).toBeUndefined();
  });
  it('keeps same-file function expressions and defaults tied to the selected declaration',()=>{
    const f=fixture({'app.ts':head+'const Local=function(p:{count:number}){const [n,s]=createSignal(p.count);return h("p",null,n);};activateIslands({Counter:Local});'});
    expect(f.registry().resolve('Local',f.file('app.ts'))!.analyze().bindings.map(x=>x.kind)).toEqual(['signal','text']);
  });
  it('records nested registered children through their own import alias',()=>{
    const f=fixture({'app.ts':head+'import {Outer} from "./outer";import {Badge} from "./badge";activateIslands({Outer,Chip:Badge});',
      'outer.ts':head+'import {Badge as Child} from "./badge";export function Outer(p:{title:string}){return h("div",null,Child({label:p.title}));}',
      'badge.ts':head+'export function Badge(p:{label:string}){return h("b",null,p.label);}'});
    expect(f.registry().resolve('Outer',f.file('app.ts'))!.analyze().bindings).toEqual([{kind:'child',name:'Chip',fields:[{name:'label',value:{kind:'prop',path:['title']}}]}]);
  });
  it('hashes browserOnly schema and mode without reading arbitrary implementation expressions',()=>{
    const f=fixture({'app.ts':head+'const Browser=browserOnly((p:{title:string})=>window.renderAnything(p));activateIslands({Browser});'});
    const item=f.registry().resolve('Browser',f.file('app.ts'))!;
    expect(item.mode).toBe('browserOnly');expect(item.declared.schema[0]![0]!.name).toBe('title');expect(item.analyze().bindings).toEqual([]);
  });
  it('follows browserOnly imported implementations while preserving wrapper identity',()=>{
    const f=fixture({'app.ts':head+'import {Impl} from "./impl";const Browser=browserOnly(Impl);activateIslands({Browser});',
      'impl.ts':'export function Impl(p:{items:string[]}){return external(p);}'});
    const registry=f.registry(), item=registry.resolve('Browser',f.file('app.ts'))!;
    expect(item.declared.schema[0]![0]!.type.kind).toBe('array');expect(registry.resolve('Impl',f.file('app.ts'))).toBeUndefined();
  });
  it('refuses untyped props, reserved declared keys and ambiguous duplicate registrations',()=>{
    for(const source of [
      'function Badge(p){return h("b",null,p.title);}activateIslands({Badge});',
      'function Badge(p:{constructor:string}){return h("b",null,p.constructor);}activateIslands({Badge});',
      'function Badge(){return h("b",null,"ok");}activateIslands({A:Badge,B:Badge});',
    ]) {const f=fixture({'app.ts':head+source});expect(f.registry).toThrow(/BUILD-610/);}
  });
  it('does not collect a lexically shadowed activateIslands call',()=>{
    const f=fixture({'app.ts':head+'function Badge(){return h("b",null,"ok");}function helper(activateIslands){activateIslands({Badge});}'});
    expect(f.registry().resolve('Badge',f.file('app.ts'))).toBeUndefined();
  });
});
