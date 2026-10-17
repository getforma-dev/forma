/** FORMA-139: actual compiler/native products and real strict activation. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepare,check,type CorpusEntry} from '../src/suite.mts';
import {launch,type Engine} from '../src/browser.mts';
import {renderStates,REPO} from '../src/server.mts';

// R17 provisions Chromium; the blocking release matrix invokes this exact
// suite once with each selected engine. Invalid selection fails, never skips.
const selected=process.env.FORMA_PARITY_BROWSER??'chromium';
assert.ok(['chromium','firefox','webkit'].includes(selected), 'FORMA_PARITY_BROWSER must name chromium, firefox or webkit');
const engines=[selected as Engine];

const cases=[
 ['jsx-fragment',"<><section><button onClick={()=>setShown(!shown())}>toggle</button>{createShow(shown,()=>h('b',null,'shown'),()=>h('i',null,'hidden'))}{createList(rows,r=>r.id,r=>h('span',null,r.label))}</section></>"],
 ['h-fragment',"h(Fragment,null,h('section',null,h('button',{onClick:()=>setShown(!shown())},'toggle'),createShow(shown,()=>h('b',null,'shown'),()=>h('i',null,'hidden')),createList(rows,r=>r.id,r=>h('span',null,r.label))))"],
 ['named-fragment',"<Fragment><section><button onClick={()=>setShown(!shown())}>toggle</button>{createShow(shown,()=>h('b',null,'shown'),()=>h('i',null,'hidden'))}{createList(rows,r=>r.id,r=>h('span',null,r.label))}</section></Fragment>"],
 ['helper',"Host()"],
] as const;
for(const engine of engines)test(`139 admitted owned roots activate from real typed native products in ${engine}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'forma-139-parity-')),plans=[];
 try{
  for(const [name,tree] of cases){
   const island=join(root,name+'-island.tsx'),page=join(root,name+'-page.ts'),entry=join(root,name+'-app.ts');
   writeFileSync(island,"import {h,Fragment,createSignal,createShow,createList} from '@getforma/core';\nfunction Host(){return h('section',null,'resolved helper');}\n"+`export function Panel(){const [shown,setShown]=createSignal(true);const [rows]=createSignal([{id:'a',label:'A'},{id:'b',label:'B'}]);return ${tree};}\n`);
   writeFileSync(page,`import {h} from '@getforma/core';import {Panel} from './${name}-island';export function Page(){return h('main',null,Panel(),h('p',null,'benign sibling'));}`);
   writeFileSync(entry,`import {mount,activateIslands} from '@getforma/core';import {Panel} from './${name}-island';import {Page} from './${name}-page';activateIslands({Panel});mount(()=>Page(),'#app');`);
   const item:CorpusEntry={name:'html-context-'+name,entry,page:{file:page,exportName:'Page',props:'none'},kind:'islands',step:2};
   const plan=await prepare(item,{seed:'forma139',states:1});assert.equal(plan.failure,undefined,plan.failure);assert.equal(plan.diagnostics.length,0);plans.push(plan);
  }
  const browser=await launch(engine);try{
   const reports=await check(plans,{seed:'forma139',states:1,browser},{prepare:0,launch:0,server:0,browser:0});
   const checks=reports.filter(report=>report.check==='P1'||report.check==='P2');assert.equal(checks.length,cases.length*2);
   for(const report of checks){assert.equal(report.serverPath,'typed');assert.equal(report.verdict,'equal',JSON.stringify(report));if(report.check==='P2')assert.deepEqual(report.activation,{hosts:1,activated:1});}
  }finally{await browser.close();}
 }finally{rmSync(root,{recursive:true,force:true});}
});

for(const engine of engines)test(`139 archived parser repair remains observable in ${engine}`,async()=>{
 const archive=join(REPO,'docs/archive/FORMA-139-html-context'),manifest=JSON.parse(readFileSync(join(archive,'manifest.json'),'utf8'));
 const browser=await launch(engine);const page=await browser.newPage();try{
  // These are the original native products, not hand-written invalid HTML.
  for(const name of ['block in p','nested anchor','nested form','li closing ancestor','dt closing dd','dd closing dt','option closes option','optgroup closes option','optgroup closes optgroup']){
   const original=manifest.cases.find((item:any)=>item.name===name);assert.ok(original.sha256,name);
   const [rendered]=renderStates(join(archive,original.stem+'.ir'),[{}]);assert.ok(rendered&&'html'in rendered,JSON.stringify(rendered));
   const body=(rendered as {html:string}).html;
   const result=await page.evaluate(html=>{const fragment=document.createElement('template');fragment.innerHTML=html;return {serialized:fragment.innerHTML,p:!!fragment.content.querySelector('p > div'),nestedA:!!fragment.content.querySelector('a a'),nestedForm:!!fragment.content.querySelector('form form'),nestedLi:!!fragment.content.querySelector('li li'),nestedDefinition:!!fragment.content.querySelector('dd dt,dt dd'),nestedOption:!!fragment.content.querySelector('option option,option optgroup,optgroup optgroup')};},body);
   assert.notEqual(result.serialized,body,name+': parser must repair the actual former native output');
   assert.equal(result.p||result.nestedA||result.nestedForm||result.nestedLi||result.nestedDefinition||result.nestedOption,false,name);
  }
 }finally{await page.close();await browser.close();}
});
