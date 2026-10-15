import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateRealIr} from '../src/esbuild-ssr-plugin';

const core='import {h,createSignal,createList} from "@getforma/core";';
function compile(page:string){
  const root=mkdtempSync(join(tmpdir(),'forma-review-closed-provenance-'));
  try {
    writeFileSync(join(root,'app.ts'),'import {mount,activateIslands} from "@getforma/core";import {Page} from "./page";import {Badge} from "./badge";activateIslands({Badge});mount(()=>Page(),"#app");');
    writeFileSync(join(root,'badge.ts'),core+'export function Badge(p:{label?:string}){return h("b",null,p.label);}');
    writeFileSync(join(root,'page.ts'),core+'import {Badge} from "./badge";'+page);
    return generateRealIr(join(root,'app.ts'));
  } finally {rmSync(root,{recursive:true,force:true});}
}
it('refuses calling a closed LIST row object as a signal getter while preparing an island input',()=>{
  expect(()=>compile('export function Page(){const [rows]=createSignal([{id:1,user:{name:"one"}}]);return h("main",null,createList(rows,r=>r.id,r=>Badge({label:r().user.name})));}')).toThrow(/BUILD-610/);
});
it('refuses a known null intermediate property access instead of inventing null input',()=>{
  expect(()=>compile('export function Page(){const [data]=createSignal({nested:null});return h("main",null,Badge({label:data().nested.name}));}')).toThrow(/BUILD-610/);
});
it('retains the direct closed LIST row projection as an admitted positive',()=>{
  expect(compile('export function Page(){const [rows]=createSignal([{id:1,user:{name:"one"}}]);return h("main",null,createList(rows,r=>r.id,r=>Badge({label:r.user.name})));}')?.islands).toHaveLength(1);
});
it('refuses a member read from the signal function instead of implicitly calling it',()=>{
  expect(()=>compile('export function Page(){const [data]=createSignal({user:{name:"one"}});return h("main",null,Badge({label:data.user.name}));}')).toThrow(/BUILD-610/);
});
it('refuses a plain projection through an optional handler object',()=>{
  expect(()=>compile('export function Page(p:{data?:{name:string}}){return h("main",null,Badge({label:p.data.name}));}')).toThrow(/BUILD-610/);
});
it('retains getter identity through a local alias before a member read',()=>{
  expect(()=>compile('export function Page(p:{data:{name:string}}){const [get]=createSignal(p.data);const alias=get;return h("main",null,Badge({label:alias.name}));}')).toThrow(/BUILD-610/);
});
it('preserves callable provenance through an unregistered helper prop',()=>{
  expect(()=>compile('function Helper(p){return Badge({label:p.get.name});} export function Page(p:{data:{name:string}}){const [get]=createSignal(p.data);return h("main",null,Helper({get}));}')).toThrow(/BUILD-610/);
});
