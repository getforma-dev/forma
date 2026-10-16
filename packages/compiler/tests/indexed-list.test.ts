import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync }  from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve }  from 'node:path';
import { generateRealIr } from '../src/esbuild-ssr-plugin';
import { collectDiagnostics } from '../src/diagnostics';
import { readFmirContainer } from '../src/fmir';
import { getSlots, getStrings, parseOpcodeList } from './helpers/fmir';
import { analyzeIslandBindings } from '../src/island-bindings';
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
const page=(seed='p.rows',row="item=>h('li',null,()=>item().label)",setup='')=>imports+`type Row={id:string;label:string};\nfunction Page(p:{rows:Row[]}){const rows=createKeyedRows(${seed},item=>item.id);${setup}return h('ul',null,createList(rows,${row}));}\nmount(()=>Page(),'#app');`;
function expectList(binary: Uint8Array) {
  expect(parseOpcodeList(binary).some(op=>op.startsWith('LIST '))).toBe(true);
  const section=readFmirContainer(binary).sections.find(section=>section.id===6)!;
  expect(section?.flags).toBe(1);
  const view=new DataView(section.bytes.buffer,section.bytes.byteOffset,section.bytes.byteLength),strings=getStrings(binary);
  expect(view.getUint32(0,true)).toBe(1); expect(section.bytes[8]).toBe(1); expect(strings[view.getUint32(9,true)]).toBe('id');
  expect(getSlots(binary).filter(slot=>slot.source===0&&/^(text:\d|attr:)/.test(slot.name))).toEqual([]);
}
describe('indexed LIST original source and ordinary native lowering',()=>{
  it.each(['p.rows',"[{id:'a',label:'A'},{id:'b',label:'B'}]"])('emits existing LIST/PROP/section6 for %s with getter holes',seed=>{
    const result=emit(page(seed)); expect(result.failure).toBeUndefined(); expect(result.diagnostics).toEqual([]); expectList(result.result!.binary);
  });
  it('retains original factory/list import aliases and immutable handle aliases',()=>{
    const source=page().replace('createList,createKeyedRows,','createList as list,createKeyedRows as make,').replace('=createKeyedRows(', '=make(').replace("return h('ul',null,createList(rows,", "const alias=rows;return h('ul',null,list(alias,");
    const result=emit(source);expect(result.failure).toBeUndefined();expectList(result.result!.binary);
  });
  it.each(["item=>h('li',null,()=>item.label)","item=>h('li',null,()=>item(1).label)"])("refuses a non-getter row read: %s",row=>{
    const result=emit(page('p.rows',row));expect(result.result).toBeNull();expect(result.failure).toBeDefined();
  });
  it.each([
    page().replace('item=>item.id','item=>item.id+"!"'),
    page().replace('const rows=createKeyedRows','let rows=createKeyedRows').replace("return h('ul'", "rows=createKeyedRows(p.rows,item=>item.id);return h('ul'"),
    page().replace('createList,createKeyedRows,','createList,').replace('function Page', 'function createKeyedRows(a:any,b:any){return a;}\nfunction Page'),
    page().replace('createList(rows,',"createList({set(){},replace(){}},"),
    page('p.rows.filter(item=>item.label)'),
  ])('refuses an unproved indexed shape without native fallback',source=>{
    const result=emit(source);expect(result.result).toBeNull();expect(result.failure).toBeDefined();
  });
});

it('canonicalizes a registered row getter without inventing a signal capture or writeback site',()=>{
  const source=imports+`export function Rows(p:{rows:{id:string;label:string}[]}){const rows=createKeyedRows(p.rows,item=>item.id);return h('ul',null,createList(rows,item=>h('li',null,h('input',{value:()=>item().label}),h('span',null,()=>item().label))));}`;
  const result=analyzeIslandBindings(source,'/indexed.ts','Rows',{props:['rows']});
  expect(result.locals).toEqual([]);expect(result.captures).toEqual([]);expect(result.adoption?.tuples).toEqual([]);expect(result.adoption?.reads).toEqual([]);
  expect(result.bindings).toEqual([{kind:'list',value:{kind:'prop',path:['rows']},key:['id'],body:[{kind:'attribute',name:'value',value:{kind:'row',id:0,path:['label']}},{kind:'text',value:{kind:'row',id:0,path:['label']}}]}]);
});

const indexedIsland=(body:string)=>imports+`function Rows(p:{rows:{id:string;label:string}[];visible:boolean}){${body}}function Page(p:{rows:{id:string;label:string}[];visible:boolean}){return Rows(p);}activateIslands({Rows});mount(()=>Page(),'#app');`;
const factory="const rows=createKeyedRows(p.rows,item=>item.id);";
const list="createList(rows,item=>h('li',null,()=>item().label))";
it.each([
  factory+"return h('ul',null,()=>p.visible?"+list+":null);",
  factory+"return h('ul',null,p.visible?"+list+":null);",
  factory+"return h('ul',null,'unused');",
  factory.replace('item=>item.id',"item=>{const ignored=mutate();return item.id;}")+"return h('ul',null,"+list+");",
])('BUILD-622 refuses eager factory validation hidden from the native return: %s',body=>{
 const result=emit(indexedIsland(body));expect(result.result).toBeNull();expect(result.failure).toMatchObject({code:'BUILD-622'});
});
it('refuses optional initial arrays instead of interpreting absent rows as an empty eager factory',()=>{
 const result=emit(page().replace('p:{rows:Row[]}', 'p:{rows?:Row[]}'));expect(result.failure).toMatchObject({code:'BUILD-622'});expect(result.result).toBeNull();
});
it('admits two unconditional views of the same handle without invented writable captures',()=>{
 const result=emit(indexedIsland(factory+"return h('section',null,h('ul',null,"+list+"),h('ol',null,"+list+"));"));
 expect(result.failure).toBeUndefined();expect(parseOpcodeList(result.result!.binary).filter(op=>op.startsWith('LIST '))).toHaveLength(2);
});
it('keeps an unsupported declared computation refused through a pure alias',()=>{
 const result=emit(page().replace(factory,'const derived=p.rows.filter(item=>item.label);const alias=derived;').replace("createList(rows,",'createList(()=>alias,item=>item.id,'));
 expect(result.result).toBeNull();expect(result.failure).toBeDefined();
});

it.each([
 factory.replace('item=>item.id','async item=>item.id')+"return h('ul',null,"+list+");",
 factory+"return h('ul',null,"+list.replace('rows,item=>','rows,async item=>')+");",
])('BUILD-622 refuses asynchronous indexed factory or row work',body=>{
 expect(emit(indexedIsland(body)).failure).toMatchObject({code:'BUILD-622'});
});
it('preserves all fourteen existing native corpus modules byte for byte',()=>{
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 const corpus=resolve(__dirname,'fixtures/ir-corpus'), native=resolve(__dirname,'../../../crates/forma-ir/tests/fixtures/js-emitter');
 const names=readdirSync(corpus,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name);
 expect(names).toHaveLength(14);
 for(const name of names){const app=readdirSync(join(corpus,name)).find(file=>/^app\.tsx?$/.test(file))!;expect(Buffer.from(generateRealIr(join(corpus,name,app))!.binary),name).toEqual(readFileSync(join(native,name+'.ir')));}
});

it.each([
 page().replace("return h('ul',null,createList(rows,item=>h('li',null,()=>item().label)));", "return h('main',null,'unused');"),
 imports+"function Page(){const rows=createKeyedRows([{id:'a'}],item=>item.id);const alias=rows;return h('main',null,'unused');}mount(Page,'#app');",
 imports+"mount(()=>{const rows=createKeyedRows([{id:'a'}],item=>item.id);return h('main',null,'unused');},'#app');",
 imports+"function Child(){const rows=createKeyedRows([{id:'a'}],item=>item.id);return h('main',null,'unused');}function Page(){return Child();}mount(Page,'#app');",
])('BUILD-622 applies to unused eager factories outside registration',source=>{
 expect(emit(source).failure).toMatchObject({code:'BUILD-622'});
});
it('admits an inline original factory in an unregistered root return',()=>{
 const source=page().replace(factory,'').replace('createList(rows,','createList(createKeyedRows(p.rows,item=>item.id),');
 expect(emit(source).failure).toBeUndefined();
});

// The helper must itself return an Element: an async/generator helper returns
// a Promise/iterator even when its authored return expression is an Element.
it.each(['async function', 'function*'])('refuses %s row helpers on both indexed and legacy lists', prefix => {
 for (const indexed of [true, false]) {
  const source = imports.replace('activateIslands', 'createSignal,activateIslands')
   + `${prefix} Row(){return h('li',null,'row');} function Page(){`
   + (indexed ? "const rows=createKeyedRows([{id:'a'}],item=>item.id);" : "const [rows]=createSignal([{id:'a'}]);")
   + "return h('ul',null,createList(rows," + (indexed ? '' : 'item=>item.id,') + "item=>Row()));}mount(Page,'#app');";
  expect(emit(source).failure).toMatchObject({code:'BUILD-613'});
 }
});
it('retains a synchronous indexed row helper', () => {
 const source=page().replace('function Page', "function Row(){return h('li',null,'row');}function Page").replace("item=>h('li',null,()=>item().label)", 'item=>Row()');
 expect(emit(source).failure).toBeUndefined();
});
