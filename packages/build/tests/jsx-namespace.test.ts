import {afterEach, expect, it} from 'vitest';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {build} from './helpers/named-build';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const runtime=`let current='html';
export function svg(fn){const prior=current;current='svg';try{return fn()}finally{current=prior}}
export const Fragment=Symbol();
export function h(tag,props,...children){if(typeof tag==='function')return tag({...props,children});return {tag,ns:tag==='svg'||['foreignObject','desc','path'].includes(tag)?'svg':tag==='math'||['mtext','mi','annotation-xml'].includes(tag)?'math':current,props,children}}
`;
async function execute(body:string, prefix='') {
  const root=mkdtempSync(join(tmpdir(),'forma-jsx-namespace-'));roots.push(root);
  const src=join(root,'src'),dist=join(root,'dist'),core=join(root,'node_modules/@getforma/core');mkdirSync(src);mkdirSync(core,{recursive:true});
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  writeFileSync(join(core,'package.json'),'{"name":"@getforma/core","version":"3.0.0-dev","type":"module","exports":"./index.js"}');
  writeFileSync(join(core,'index.js'),runtime);
  const entry=join(src,'app.tsx');writeFileSync(entry,`${prefix}\nimport {h,svg,Fragment} from '@getforma/core';\n${body}\nconsole.log(JSON.stringify(globalThis.result));`);
  const result=await build({entryPoints:[{entry,outfile:'app.js',ssr:false}],routes:{'/':{js:['app'],css:[]}},outputDir:dist});
  const output=join(dist,result.manifest.aliases['app.js']);
  const got=spawnSync(process.execPath,[output],{encoding:'utf8'});expect(got.status,got.stderr).toBe(0);
  return {value:JSON.parse(got.stdout),code:readFileSync(output,'utf8')};
}
function namespaces(tree:any):string[]{return typeof tree==='object'&&tree!==null?[`${tree.tag}:${tree.ns}`,...(tree.children??[]).flatMap(namespaces)]:[];}
it('creates lexical SVG dual-use JSX elements after their already evaluated arguments',async()=>{
  const {value}=await execute(`const events=[];const mark=x=>(events.push(x),x);globalThis.result={tree:<svg><a {...{href:mark('prop')}}><title>{mark('child')}</title></a></svg>,events};`);
  expect(namespaces(value.tree)).toEqual(['svg:svg','a:svg','title:svg']);expect(value.events).toEqual(['prop','child']);
});
it('keeps foreignObject, desc and title content HTML and admits nested SVG again',async()=>{
  const {value}=await execute(`globalThis.result=<svg><foreignObject><a>html</a><svg><title>nested</title></svg></foreignObject><desc><a>html</a></desc><title><a>html</a></title></svg>;`);
  expect(namespaces(value)).toEqual(['svg:svg','foreignObject:svg','a:html','svg:svg','title:svg','desc:svg','a:html','title:svg','a:html']);
});
it('preserves the MathML token integration control',async()=>{
  const {value}=await execute(`globalThis.result=<math><mtext><a>html</a><svg><title>nested</title></svg></mtext></math>;`);
  expect(namespaces(value)).toEqual(['math:math','mtext:math','a:html','svg:svg','title:svg']);
});
it('leaves a separately declared component body at its existing default namespace',async()=>{
  const {value}=await execute(`function Link(){return <a>component</a>}globalThis.result=<svg><Link/><a>lexical</a></svg>;`);
  expect(namespaces(value)).toEqual(['svg:svg','a:html','a:svg']);
});
it('preserves an authored custom JSX factory',async()=>{
  const {value}=await execute(`function custom(tag,props,...children){return {tag,ns:'custom',children}}globalThis.result=<svg><a><title>icon</title></a></svg>;`,'/** @jsx custom */');
  expect(namespaces(value)).toEqual(['svg:custom','a:custom','title:custom']);
});
it('handles closed conditions and marker-name collisions without changing handwritten h',async()=>{
  const {value}=await execute(`const __formaJsx=1,__formaSvg=2,__formaSvgTags=3;const enabled=true;globalThis.result={tree:<svg>{enabled?<a/>:<title/>}</svg>,hand:h('a'),names:[__formaJsx,__formaSvg,__formaSvgTags]};`);
  expect(namespaces(value.tree)).toEqual(['svg:svg','a:svg']);expect(value.hand.ns).toBe('html');expect(value.names).toEqual([1,2,3]);
});
it('composes an explicit default JSX pragma and preserves the directive prologue',async()=>{
  const {value}=await execute(`globalThis.result=<svg><a/></svg>;`,"/** @jsx h */\n'use client';");
  expect(namespaces(value)).toEqual(['svg:svg','a:svg']);
});
it('preserves JSX files with a custom h binding in an inner scope',async()=>{
  const {value}=await execute(`function local(h){return <a/>}globalThis.result=local(tag=>({tag,ns:'custom',children:[]}));`);
  expect(namespaces(value)).toEqual(['a:custom']);
});
