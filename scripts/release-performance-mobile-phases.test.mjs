import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {MOBILE_PROFILE} from './release-performance-spec.mjs';
import {createPerformanceJournal,readPerformanceJournal,writePerformanceRecord} from './release-performance-journal.mjs';

// Evaluate the actual producer body with deterministic browser dependencies.
// This control also runs against the archived, unmodified pre-fix source.
const source=readFileSync(new URL('./release-performance-mobile.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('export async function measureMobileRoute'),source.indexOf('export async function mobileControls')).replace('export ','');
const auditBody=source.slice(source.indexOf('export async function audit'),source.indexOf('export async function measureMobileRoute')).replace('export ','').replaceAll('import(', 'load(');

test('a Lighthouse capture error preserves its original report and trace, refuses, and closes Chrome',async()=>{
 const lhr={lighthouseVersion:'13.5.0',runtimeError:{code:'NO_NAVSTART',message:'fixture missing navigation start'}},rawTrace={traceEvents:[{name:'RunTask',ts:7}]};
 const parent=mkdtempSync(join(tmpdir(),'forma-mobile-failure-'));
 const directory=createPerformanceJournal(parent,{fixture:'capture failure'});
 let launches=0,kills=0,activations=0,samples=0,requestedUrl,flags,launchOptions;
 const load=async name=>{
  if(name==='lighthouse')return {default:async(url,options)=>{requestedUrl=url;flags=options;return {lhr,artifacts:{Trace:rawTrace}};}};
  if(name==='chrome-launcher')return {launch:async options=>{launchOptions=options;launches++;return {port:1,kill:async()=>{kills++;}};}};
  if(name==='@playwright/test')return {chromium:{executablePath:()=>'/fixture/chrome'}};
  if(name==='lighthouse/core/config/constants.js')return {defaultSettings:MOBILE_PROFILE};
  throw new Error(`unexpected dependency ${name}`);
 };
 const audit=new Function('assert','MOBILE_PROFILE','load',`return (${auditBody.trim()});`)(assert,MOBILE_PROFILE,load);
 const route=new Function('assert','audit','measureActivation','percentile','encodeMobileTrace','attributeMobileTasks',`return (${body.trim()});`)(assert,audit,async()=>{activations++;},()=>0,()=>{throw new Error('must not encode a failed capture');},()=>{throw new Error('must not attribute a failed capture');});
 try{
  await assert.rejects(route({url:'http://fixture.invalid/',id:'tenant-login',runs:1,onPhase:({id,run,phase,observation})=>writePerformanceRecord(directory,`mobile-${phase}-${id}-${run}`,observation),onSample:()=>{samples++;}}),/Lighthouse did not complete.*NO_NAVSTART/);
  const journal=readPerformanceJournal(directory);
  assert.deepEqual(journal.entries.map(entry=>entry.kind),['attempt','mobile-lighthouse-error-tenant-login-1','mobile-lighthouse-error-trace-tenant-login-1']);
  assert.equal(JSON.parse(readFileSync(join(directory,journal.entries[1].file),'utf8')).rawLhr,JSON.stringify(lhr));
  assert.deepEqual(JSON.parse(readFileSync(join(directory,journal.entries[2].file),'utf8')),rawTrace);
  assert.equal(launches,1);assert.equal(kills,1);assert.equal(activations,0);assert.equal(samples,0);
  assert.deepEqual(launchOptions,{chromePath:'/fixture/chrome',chromeFlags:['--headless','--no-sandbox','--enable-automation'],logLevel:'error'});
  assert.equal(requestedUrl,'http://fixture.invalid/');
  assert.deepEqual(flags,{port:1,logLevel:'error',output:'json',onlyCategories:['performance'],...MOBILE_PROFILE,blankPage:'http://fixture.invalid/__forma_performance_blank'});
 }finally{rmSync(parent,{recursive:true,force:true});}
});
test('a complete Lighthouse result is delivered before a failing activation loses the pair',async()=>{
 const lighthouse={rawLhr:'{"actual":"completed fixture"}',sha256:'fixture-hash'},rawTrace={traceEvents:[]},seen=[];
 const route=new Function('assert','audit','measureActivation','percentile','encodeMobileTrace','attributeMobileTasks',`return (${body.trim()});`)(assert,async()=>({...lighthouse,rawTrace}),async()=>{throw new Error('activation failed');},()=>0,()=>({fixture:'compressed'}),()=>({fixture:'attribution'}));
 await assert.rejects(route({url:'http://fixture.invalid/',id:'islands-100',runs:1,onPhase:event=>seen.push(event)}),/activation failed/);
 assert.deepEqual(seen.map(({phase})=>phase),['lighthouse','lighthouse-trace']);
 assert.equal(seen[0].observation.rawLhr,lighthouse.rawLhr);assert.equal(seen[1].observation,rawTrace);
});

test('a failing trace proof still leaves completed raw Lighthouse and trace checkpoints',async()=>{
 const rawTrace={traceEvents:[]},seen=[];
 const route=new Function('assert','audit','measureActivation','percentile','encodeMobileTrace','attributeMobileTasks',`return (${body.trim()});`)(assert,async()=>({rawLhr:'{}',rawTrace}),async()=>{throw new Error('must not start activation');},()=>0,()=>({}),()=>{throw new Error('ambiguous trace identity');});
 await assert.rejects(route({url:'http://fixture.invalid/',id:'islands-100',runs:1,onPhase:event=>seen.push(structuredClone(event))}),/ambiguous trace identity/);
 assert.deepEqual(seen.map(({phase})=>phase),['lighthouse','lighthouse-trace']);assert.deepEqual(seen[1].observation,rawTrace);
});
