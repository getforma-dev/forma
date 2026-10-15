import {it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {watching} from './helpers/watch';

it('recovers an unresolved type-only directory import when its index is created',async()=>{
  const root=mkdtempSync(join(tmpdir(),'forma-review-type-directory-'));
  const src=join(root,'src'),dist=join(root,'dist');mkdirSync(src);mkdirSync(join(src,'defs'));
  const core=join(root,'node_modules','@getforma','core');mkdirSync(core,{recursive:true});
  writeFileSync(join(core,'package.json'),JSON.stringify({name:'@getforma/core',version:'3.0.0-dev',type:'module',exports:'./index.js'}));
  writeFileSync(join(core,'index.js'),'export const h=()=>{};export const mount=()=>{};export const activateIslands=()=>{};export const __islandRegistration=c=>c;');
  writeFileSync(join(src,'types.ts'),'export interface Props { title:string }');
  const badge=(from:string)=>'import {h} from "@getforma/core";import type {Props} from "'+from+'";export function Badge(p:Props){return h("b",null,p.title);}';
  writeFileSync(join(src,'badge.ts'),badge('./types'));
  writeFileSync(join(src,'page.ts'),'import {h} from "@getforma/core";import {Badge} from "./badge";export function Page(p:{title:string}){return h("main",null,Badge({title:p.title}));}');
  writeFileSync(join(src,'app.ts'),'import {mount,activateIslands} from "@getforma/core";import {Page} from "./page";import {Badge} from "./badge";activateIslands({Badge});mount(()=>Page(),"#app");');
  try {
    await watching({entryPoints:[{entry:join(src,'app.ts'),outfile:'app.js'}],routes:{'/':{js:['app'],css:[]}},outputDir:dist,ssr:true},async({ready,change,manifest,output})=>{
      await ready();const before=readFileSync(join(dist,'manifest.json'));
      await change(()=>writeFileSync(join(src,'badge.ts'),badge('./defs')));
      expect(output()).toContain('BUILD-610');
      expect(readFileSync(join(dist,'manifest.json'))).toEqual(before);
      await change(()=>writeFileSync(join(src,'defs','index.ts'),'export interface Props { title:string; note?:string }'));
      await vi.waitFor(()=>expect(readFileSync(join(dist,'manifest.json'))).not.toEqual(before),{timeout:5000});
      expect(manifest().routes['/'].ir).toMatch(/\.ir$/);
    });
  } finally {rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
},20000);
