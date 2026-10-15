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

it.each(['toString','constructor','__proto__'])('refuses inherited %s on a closed object',key=>{
  expect(()=>compile(`export function Page(){const [data]=createSignal({});return h("main",null,Badge({label:data().${key}}));}`)).toThrow(/BUILD-610.*inherited/);
});
it('refuses an absent intermediate while retaining an absent optional final field',()=>{
  expect(()=>compile('export function Page(){const [data]=createSignal({});return h("main",null,Badge({label:data().missing.name}));}')).toThrow(/BUILD-610/);
  expect(compile('export function Page(){const [data]=createSignal({});return h("main",null,Badge({label:data().missing}));}')?.islands).toHaveLength(1);
});
it('retains explicit own data that shadows an inherited name',()=>{
  expect(compile('export function Page(){const [data]=createSignal({toString:"own"});return h("main",null,Badge({label:data().toString}));}')?.islands).toHaveLength(1);
});
it('refuses prototype-setting literal syntax without changing the closed wire codec',()=>{
  expect(()=>compile('export function Page(){const [data]=createSignal({__proto__:{label:"inherited"}});return h("main",null,Badge({label:data().label}));}')).toThrow(/BUILD-610.*prototype-setting/);
});
it('refuses a bare aggregate getter as the object of a plain member read',()=>{
  expect(()=>compile('export function Page(){const [data]=createSignal({user:{name:"one"}});return h("main",null,Badge({label:data.user.name}));}')).toThrow(/BUILD-610.*getter must be called/);
  expect(()=>compile('export function Page(){const [data]=createSignal({user:{name:"one"}});return h("main",null,Badge({label:(data as any).user.name}));}')).toThrow(/BUILD-610.*getter must be called/);
  expect(compile('export function Page(){const [data]=createSignal({user:{name:"one"}});return h("main",null,Badge({label:data().user.name}));}')?.islands).toHaveLength(1);
});
it('refuses unknown optional intermediate props but preserves a required object path',()=>{
  expect(()=>compile('export function Page(p:{data?:{name:string}}){return h("main",null,Badge({label:p.data.name}));}')).toThrow(/BUILD-610.*optional declared/);
  expect(compile('export function Page(p:{data:{name:string}}){return h("main",null,Badge({label:p.data.name}));}')?.islands).toHaveLength(1);
  expect(()=>compile('export function Page(p:{data?:{flag:boolean}}){return h("main",null,p.data.flag);}')).toThrow(/BUILD-610.*optional declared/);
});
it('refuses a prop-seeded getter as a member object and requires nullable aliases to be checked',()=>{
  expect(()=>compile('export function Page(p:{data:{name:string}}){const [data]=createSignal(p.data);return h("main",null,Badge({label:data.name}));}')).toThrow(/BUILD-610.*getter must be called/);
  expect(()=>compile('export function Page(p:{data?:{name:string}}){const data=p.data;return h("main",null,Badge({label:data.name}));}')).toThrow(/BUILD-610.*optional declared/);
  expect(compile('export function Page(p:{data:{name:string}}){const [data]=createSignal(p.data);return h("main",null,Badge({label:data().name}));}')?.islands).toHaveLength(1);
});
