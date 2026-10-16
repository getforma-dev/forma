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
function source(setup:string){return imports+"function Page(){const initial=[{id:'a',label:'Original'}];"+setup+"const rows=createKeyedRows(initial,item=>item.id);return h('ul',null,"+list+");}mount(Page,'#app');";}
it.each([
 "const changed=initial.push({id:'b',label:'Second'});",
 "const changed=initial[0].label='Changed';",
 "const alias=initial;const changed=alias[0].label='Changed';",
 "function touch(items:any){items[0].label='Changed';}const changed=touch(initial);",
 "const touch=()=>initial.push({id:'b',label:'Second'});const changed=touch();",
])('refuses mutated/escaped initial source: %s',setup=>{
 const result=emit(source(setup));expect(result.result).toBeNull();expect(result.failure).toBeDefined();
});
it('retains the direct closed array near miss',()=>{expect(emit(source('').replace('createKeyedRows(initial,',"createKeyedRows([{id:'a',label:'Original'}],")).failure).toBeUndefined();});
function declared(setup:string, after=false, props='null', registered=false){
 const factory="const rows=createKeyedRows(p.rows,item=>item.id);";
 return imports+"function Rows(p:{rows:{id:string;label:string}[];name:string}){"+(after?factory+setup:setup+factory)+"return h('ul',"+props+","+list+");}function Page(p:{rows:{id:string;label:string}[];name:string}){return Rows(p);}"+(registered?"activateIslands({Rows});":"")+"mount(()=>Page(),'#app');";
}
for(const registered of [false,true])for(const after of [false,true])describe(`${registered?'registered':'ordinary'} ${after?'after':'before'} factory`,()=>{
 it.each([
  "const changed=p.rows.push({id:'b',label:'Second'});",
  "const changed=p.rows[0].label='Changed';",
  "const changed=p.rows.length=0;",
  "const alias=p.rows;const changed=alias.push({id:'b',label:'Second'});",
  "const alias=p;const changed=alias.rows.push({id:'b',label:'Second'});",
  "function touch(items:any){items[0].label='Changed';}const changed=touch(p.rows);",
  "function touch(data:any){data.rows.length=0;}const changed=touch(p);",
  "function touch(item:any){item.label='Changed';}const alias=p.rows[0];const changed=touch(alias);",
  "const escaped={rows:p.rows};",
  "const later=()=>p.rows.push({id:'b',label:'Second'});const changed=later();",
 ])('refuses declared array writes/escapes: %s',setup=>{
  const result=emit(declared(setup,after,'null',registered));// Registered pre-return analysis may refuse before the LIST proof runs.
  expect(result.failure).toMatchObject({code:registered&&!after?'BUILD-610':'BUILD-622'});expect(result.result).toBeNull();
 });
 it.each([
  'const count=p.rows.length;',
  'const alias=p.rows;const count=alias.length;',
  'const label=p.name;',
 ])('retains pure scalar/disjoint reads: %s',setup=>{expect(emit(declared(setup,after,'null',registered)).failure).toBeUndefined();});
 it.each([
  'const same=p.rows===p.rows;',
  "function use(value:string){return value;}const label=use(p.name);",
 ])('preserves existing registered computed-value boundary: %s',setup=>{
  const result=emit(declared(setup,after,'null',registered));
  if(registered)expect(result.failure).toMatchObject({code:'BUILD-610'});
  else expect(result.failure).toBeUndefined();
 });
});
it('retains a declared array alias as the original factory source',()=>{
 const app=declared('const alias=p.rows;').replace('createKeyedRows(p.rows,','createKeyedRows(alias,');
 expect(emit(app).failure).toBeUndefined();
});
it('retains a deferred initial-data mutation in an intrinsic event',()=>{
 const app=declared("const later=()=>p.rows.push({id:'b',label:'Later'});",false,'{onClick:later}',true);
 expect(emit(app).failure).toBeUndefined();
});
it('protects an ancestor alias of a nested required array',()=>{
 const app=imports+"function Page(p:{data:{rows:{id:string;label:string}[]}}){const alias=p.data;const changed=alias.rows.push({id:'b',label:'Later'});const rows=createKeyedRows(p.data.rows,item=>item.id);return h('ul',null,"+list+");}mount(()=>Page(),'#app');";
 expect(emit(app).failure).toMatchObject({code:'BUILD-622'});
});

it('refuses reassigned original props before the factory',()=>{
 const result=emit(declared("const changed=p={rows:[{id:'b',label:'Changed'}],name:'new'};"));
 expect(result.failure).toBeDefined();expect(result.result).toBeNull();
});
it('refuses a mutable alias that escapes the original rows',()=>{
 const result=emit(declared("let alias=p.rows;const changed=alias.push({id:'b',label:'Second'});alias=[];"));
 expect(result.failure).toBeDefined();expect(result.result).toBeNull();
});
