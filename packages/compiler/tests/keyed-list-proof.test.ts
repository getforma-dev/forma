import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
import {readFmirContainer} from '../src/fmir';
import {getStrings} from './helpers/fmir';

const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});vi.restoreAllMocks();});
function emit(key='r=>r.id', row="r=><li>{r.label}</li>") {
 const dir=mkdtempSync(join(tmpdir(),'forma-keyed-list-'));dirs.push(dir);
 const file=join(dir,'app.tsx');
 writeFileSync(file,`import {h,mount,createList} from '@getforma/core';
 type Row={id:string,label:string};
 function Page(p:{rows:Row[]}) {return <ul>{createList(()=>p.rows,${key},${row})}</ul>;}
 mount(()=>Page({rows:[{id:'a',label:'A'},{id:'b',label:'B'}]}),'#app');`);
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 return generateRealIr(file)!.binary;
}
function keys(binary:Uint8Array) {
 const container=readFmirContainer(binary), section=container.sections.find(x=>x.id===6);
 expect(section?.flags).toBe(1);
 const bytes=section!.bytes,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),strings=getStrings(binary);
 let at=4;const result:{offset:number,path:string[]}[]=[];
 for(let i=0;i<view.getUint32(0,true);i++) {const offset=view.getUint32(at,true);at+=4;const count=bytes[at++]!;const path:string[]=[];for(let j=0;j<count;j++){path.push(strings[view.getUint32(at,true)]!);at+=4;}result.push({offset,path});}
 expect(at).toBe(bytes.length);
 for(const item of result)expect(container.sections.find(x=>x.id===1)!.bytes[item.offset]).toBe(10);
 return result;
}
function emitSource(source:string) {
 const dir=mkdtempSync(join(tmpdir(),'forma-keyed-list-'));dirs.push(dir);
 const file=join(dir,'app.tsx');writeFileSync(file,source);
 const lines:string[]=[];vi.spyOn(console,'warn').mockImplementation((...args:unknown[])=>{lines.push(args.map(String).join(' '));});
 let failure:any,binary:Uint8Array|undefined;try{binary=generateRealIr(file)?.binary;}catch(error){failure=error;}
 return {binary,failure,codes:lines.map(line=>/IR: (BUILD-\d{3})/.exec(line)?.[1]).filter((code):code is string=>!!code)};
}
describe('original identity and legacy precedence',()=>{
 it('keeps BUILD-107 then BUILD-610 for a call missing its row callback, with no key or row proof',()=>{
  const result=emitSource(`import {h,mount,createList} from '@getforma/core';
 const rows=()=>[{id:'a'}];
 mount(()=><ul>{createList(rows,(r:any)=>r.id)}</ul>,'#app');`);
  expect(result.failure).toMatchObject({code:'BUILD-610',line:3});
  expect(result.codes).toContain('BUILD-107');
  expect(result.codes.filter(code=>code==='BUILD-612'||code==='BUILD-613')).toEqual([]);
 });
 it('keeps BUILD-107 then BUILD-610 for a row callback that is not an inline function',()=>{
  const result=emitSource(`import {h,mount,createList} from '@getforma/core';
 const rows=()=>[{id:'a'}],row=(r:any)=><li>{r.id}</li>;
 mount(()=><ul>{createList(rows,(r:any)=>r,row)}</ul>,'#app');`);
  expect(result.failure).toMatchObject({code:'BUILD-610',line:3});
  expect(result.codes).toContain('BUILD-107');
  expect(result.codes.filter(code=>code==='BUILD-612'||code==='BUILD-613')).toEqual([]);
 });
 it('refuses a local function named createList as having no original core identity',()=>{
  const result=emitSource(`import {h,mount} from '@getforma/core';
 function createList(a:any,b:any,c:any){return null;}
 mount(()=><ul>{createList(()=>[],(r:any)=>r.id,(r:any)=><li>{r.id}</li>)}</ul>,'#app');`);
  expect(result.failure).toMatchObject({code:'BUILD-612',line:3});
  expect(String(result.failure.message)).toContain('no exact original core identity');
 });
 it('proves an imported core alias through JSX lowering',()=>{
  const result=emitSource(`import {h,mount,createList as list} from '@getforma/core';
 const rows=()=>[{id:'a',label:'A'}];
 mount(()=><ul>{list(rows,(r:any)=>r.id,(r:any)=><li>{r.label}</li>)}</ul>,'#app');`);
  expect(result.failure).toBeUndefined();
  expect(keys(result.binary!).map(x=>x.path)).toEqual([['id']]);
 });
});
describe('proved keyed LIST production',()=>{
 it('emits required section6 for the actual original row path and LIST offset',()=>{expect(keys(emit()).map(x=>x.path)).toEqual([['id']]);});
 it.each(['r=>r','(r,index)=>index','r=>r.id+"!"','r=>String(r.id)','r=>r[0]'])('refuses unsupported key %s at its source, with a passing path near miss',key=>{
  let failure:any;try{emit(key);}catch(error){failure=error;}
  expect(failure).toMatchObject({code:'BUILD-612',line:3});
  expect(keys(emit()).map(x=>x.path)).toEqual([['id']]);
 });
 it.each(["r=>'text'",'r=>null','r=><><b>{r.label}</b><i>tail</i></>','r=>true?<li>{r.label}</li>:null',"r=><li data-forma-key='authored'>{r.label}</li>"])(
  'refuses nonstable row %s with a passing single-root near miss',row=>{
   let failure:any;try{emit('r=>r.id',row);}catch(error){failure=error;}
   expect(failure).toMatchObject({code:'BUILD-613',line:3});
   expect(keys(emit('r=>r.id','r=><><li>{r.label}</li></>')).map(x=>x.path)).toEqual([['id']]);
  });
});
