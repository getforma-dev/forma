/**
 * BUILD-614: a list source that is not a function (FORMA-183's parity harness, finding F1).
 *
 * Core's `createList(items, key, row)` calls `items()` to read the rows. The native module never
 * evaluates a page list's source (its array is a named slot), so a plain array compiled and then
 * failed in the browser with `items is not a function`. The original key and row proof
 * (`src/list-proof.ts`) now refuses a source it can prove is not a function, on the page path and
 * the island path alike; a function, a getter and anything it cannot see through stay admitted.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {generateRealIr} from '../src/esbuild-ssr-plugin';

const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});vi.restoreAllMocks();});
const head=`import {h,mount,activateIslands,createSignal,createComputed,createList} from '@getforma/core';
type Row={id:string,label:string};
`;
/** Compile `files` (app.tsx first) and return the failure, if any. Line 3 is the first line after `head`. */
function compile(files:Record<string,string>) {
 const dir=mkdtempSync(join(tmpdir(),'forma-list-source-'));dirs.push(dir);
 for(const [name,source] of Object.entries(files))writeFileSync(join(dir,name),source);
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{return {binary:generateRealIr(join(dir,'app.tsx'))?.binary,failure:undefined as any};}catch(error){return {binary:undefined,failure:error as any};}
}
const page=(declarations:string,source:string)=>({'app.tsx':`${head}${declarations}
mount(()=><ul>{createList(${source},(r:Row)=>r.id,(r:Row)=><li>{r.label}</li>)}</ul>,'#app');`});

describe('BUILD-614: a list source core cannot call', () => {
 it.each<[string,string,string]>([
  ['a local const array',`const rows=[{id:'a',label:'A'}];`,'rows'],
  ['an array literal',``,`[{id:'a',label:'A'}]`],
  ['an alias of a const array',`const base=[{id:'a',label:'A'}];const rows=base;`,'rows'],
  ["a signal getter's value",`const [rows]=createSignal<Row[]>([{id:'a',label:'A'}]);`,'rows()'],
  ["a field of a signal getter's value",`const [data]=createSignal({rows:[{id:'a',label:'A'}]});`,'data().rows'],
  ["a computed getter's value",`const rows=createComputed(()=>[{id:'a',label:'A'}]);`,'rows()'],
 ])('refuses %s at the list, and its function near miss compiles', (_label, declarations, source) => {
  const refused=compile(page(declarations,source));
  expect(refused.failure).toMatchObject({code:'BUILD-614',line:4});
  expect(String(refused.failure.message)).toMatch(/LIST source is .*, not a function: core calls it to read the rows/);
  const near=compile(page(`const rows=()=>[{id:'a',label:'A'}];`,'rows'));
  expect(near.failure).toBeUndefined();
  expect(near.binary).toBeInstanceOf(Uint8Array);
 });

 it('refuses an imported const array, and admits an imported function', () => {
  const app=(name:string)=>`${head}import {${name}} from './data';
mount(()=><ul>{createList(${name},(r:Row)=>r.id,(r:Row)=><li>{r.label}</li>)}</ul>,'#app');`;
  const data=`export const rows=[{id:'a',label:'A'}];\nexport const read=()=>rows;\n`;
  expect(compile({'app.tsx':app('rows'),'data.ts':data}).failure).toMatchObject({code:'BUILD-614',line:4});
  expect(compile({'app.tsx':app('read'),'data.ts':data}).failure).toBeUndefined();
 });

 it('refuses a page field its parameter type declares as an array, and admits the getter form', () => {
  const app=(source:string)=>`${head}function Page(p:{rows:Row[]}) {return <ul>{createList(${source},(r:Row)=>r.id,(r:Row)=><li>{r.label}</li>)}</ul>;}
mount(()=>Page({rows:[{id:'a',label:'A'}]}),'#app');`;
  expect(compile({'app.tsx':app('p.rows')}).failure).toMatchObject({code:'BUILD-614',line:3});
  expect(compile({'app.tsx':app('()=>p.rows')}).failure).toBeUndefined();
 });

 it('refuses the same source in a registered island, through the island binding path', () => {
  const app=(source:string)=>`${head}export function Board(p:{rows:Row[]}) {return h('ul',null,createList(${source},(r:Row)=>r.id,(r:Row)=>h('li',null,r.label)));}
activateIslands({Board});
mount(()=>Board({rows:[{id:'a',label:'A'}]}),'#app');`;
  const refused=compile({'app.tsx':app('p.rows')});
  expect(refused.failure?.code ?? String(refused.failure?.message)).toMatch(/BUILD-614/);
  expect(compile({'app.tsx':app('()=>p.rows')}).failure).toBeUndefined();
 });

 it('admits every getter form core can call', () => {
  for (const [declarations, source] of [
   [`const [rows]=createSignal<Row[]>([{id:'a',label:'A'}]);`,'rows'],
   [`const rows=createComputed(()=>[{id:'a',label:'A'}]);`,'rows'],
   [`function rows(){return [{id:'a',label:'A'}];}`,'rows'],
   [``,`()=>[{id:'a',label:'A'}]`],
   [``,`function(){return [{id:'a',label:'A'}];}`],
  ]) expect(compile(page(declarations!,source!)).failure, source).toBeUndefined();
 });
});

/** F1's archive (docs/archive/2026-10-15-pre-list-source): the corpus case's original sources. */
describe('archived pre-F1 list source', () => {
 const ARCHIVE=resolve(__dirname,'../../../docs/archive/2026-10-15-pre-list-source');
 const ROOT=resolve(__dirname,'../../..');
 const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
 it('keeps the originals byte-exact under the manifest, and the live files at the ledger', () => {
  const manifest=JSON.parse(readFileSync(join(ARCHIVE,'manifest.json'),'utf8')) as {sha256:Record<string,{bytes:number;sha256:string}>};
  expect(Object.keys(manifest.sha256).sort()).toEqual(['sources/list-same-source/app.ts','sources/list-same-source/page.ts']);
  for(const [name,entry]of Object.entries(manifest.sha256)){const bytes=readFileSync(join(ARCHIVE,name));expect(bytes.length,name).toBe(entry.bytes);expect(hash(bytes),name).toBe(entry.sha256);}
  const ledger=JSON.parse(readFileSync(join(ARCHIVE,'ledger.json'),'utf8')) as {files:Record<string,{archived?:string;before:{sha256:string};after:{bytes:number;sha256:string}}>};
  const changed=Object.entries(ledger.files).filter(([,entry])=>entry.before.sha256!==entry.after.sha256).map(([path])=>path);
  // Only the source text changed: the function source compiles to the same module, dump, HTML and state.
  expect(changed).toEqual(['packages/compiler/tests/fixtures/ir-corpus/list-same-source/page.ts']);
  for(const [path,entry]of Object.entries(ledger.files)){
   const live=readFileSync(join(ROOT,path));expect(hash(live),path).toBe(entry.after.sha256);expect(live.length,path).toBe(entry.after.bytes);
   if(entry.archived)expect(manifest.sha256[entry.archived]!.sha256,path).toBe(entry.before.sha256);
  }
 });
 it('compiles the archived page to BUILD-614 at its first list', () => {
  vi.spyOn(console,'warn').mockImplementation(()=>{});
  expect(()=>generateRealIr(join(ARCHIVE,'sources/list-same-source/app.ts'))).toThrow(/^BUILD-614 .*page\.ts:14:\d+: LIST source is an array, not a function/);
 });
});
