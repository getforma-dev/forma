import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync }  from 'node:fs';
import { tmpdir } from 'node:os';
import { join }  from 'node:path';
import { generateRealIr } from '../src/esbuild-ssr-plugin';
import { collectDiagnostics } from '../src/diagnostics';
const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); vi.restoreAllMocks(); });
const imports = "import {h,mount,createList,createKeyedRows,activateIslands} from '@getforma/core';\n";
function emit(source: string) {
  const dir=mkdtempSync(join(tmpdir(),'forma-indexed-list-')); dirs.push(dir);
  const file=join(dir,'app.ts'); writeFileSync(file,source);
  vi.spyOn(console,'warn').mockImplementation(()=>{});
  let failure: unknown;
  const {result,diagnostics}=collectDiagnostics(()=>{try{return generateRealIr(file);}catch(error){failure=error;return null;}});
  return {result,diagnostics,failure,file};
}

const list="createList(rows,item=>h('li',null,()=>item().label))";
function component(setup:string, props='null', registered=false) {
 const source=imports+`function Rows(){const rows=createKeyedRows([{id:'a',label:'Original'}],item=>item.id);${setup}return h('ul',${props},${list});}function Page(){return Rows();}`;
 return source+(registered?"activateIslands({Rows});":"")+"mount(Page,'#app');";
}
for(const registered of [false,true])describe(registered?'registered island':'ordinary component',()=>{
 it.each([
  "const changed=rows.set('a',{id:'a',label:'Changed'});",
  "const changed=rows.replace([{id:'a',label:'Changed'}]);",
  "const changed=(()=>rows.set('a',{id:'a',label:'Changed'}))();",
  "function take(value:any){return value;}const escaped=take(rows);",
  "const escaped={rows};",
  "const escaped=[rows];",
  "const setter=rows.set;",
  "const alias=rows;const changed=alias.set('a',{id:'a',label:'Changed'});",
  "const later=()=>rows.set('a',{id:'a',label:'Changed'});const changed=later();",
  "const later=()=>rows.set('a',{id:'a',label:'Changed'});const changed=(()=>later())();",
 ])('refuses eager mutation or unproved handle escape: %s',setup=>{
  const result=emit(component(setup,'null',registered));
  expect(result.failure).toMatchObject({code:'BUILD-622'});expect(result.result).toBeNull();
 });
 it('refuses a handler that is also invoked during construction',()=>{
  expect(emit(component("const later=()=>rows.set('a',{id:'a',label:'Changed'});const changed=later();",'{onClick:later}',registered)).failure).toMatchObject({code:'BUILD-622'});
 });
 it('refuses an event property getter, which executes during props reading',()=>{
  expect(emit(component('',"{get onClick(){rows.set('a',{id:'a',label:'Eager'});return ()=>{};}}",registered)).failure).toMatchObject({code:'BUILD-622'});
 });
 it('retains the existing native attribute boundary for event method syntax',()=>{
  const result=emit(component('',"{onClick(){rows.set('a',{id:'a',label:'Later'});}}",registered));
  if(registered)expect(result.failure).toMatchObject({code:'BUILD-610'});else expect(result.failure).toBeUndefined();
 });
 it.each([
  ['',"{onClick:()=>rows.set('a',{id:'a',label:'Later'})}"],
  ["const later=()=>rows.set('a',{id:'a',label:'Later'});",'{onClick:later}'],
  ["function later(){rows.set('a',{id:'a',label:'Later'});}",'{onClick:later}'],
  ["const later=()=>rows.set('a',{id:'a',label:'Later'});const alias=later;",'{onClick:alias}'],
  ['',"{onClick:()=>{const now=()=>rows.set('a',{id:'a',label:'Later'});now();}}"],
  ["const unused=()=>rows.set('a',{id:'a',label:'Never'});",'null'],
 ])('retains ordinary deferred closures: %s %s',(setup,props)=>{
  const result=emit(component(setup,props,registered));expect(result.failure).toBeUndefined();expect(result.result!.binary.length).toBeGreaterThan(0);
 });
});
it('does not treat a custom component onClick prop as an intrinsic event',()=>{
 const source=component('',"{onClick:()=>rows.set('a',{id:'a',label:'Eager'})}")
  .replace("return h('ul',{onClick",'return h(Invoke,{onClick')
  .replace("function Rows()", "function Invoke(p:any){p.onClick();return h('ul',null,p.children);}function Rows()");
 expect(emit(source).failure).toMatchObject({code:'BUILD-622'});
});
