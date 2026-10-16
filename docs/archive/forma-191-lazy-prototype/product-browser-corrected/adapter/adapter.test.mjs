import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PARTIAL,assertSet,campaignCommand,durable,executePhases,parseOptions} from './adapter.mjs';
import {cleanupOwned} from './run.mjs';

function fixture(overrides={}){
 const calls=[],records=[];let complete;
 const deps={
  baseline:()=>{calls.push('baseline');return {status:'bootstrap'};},
  record:(kind,value)=>{calls.push(`record:${kind}`);records.push({kind,value});},
  stage:()=>calls.push('stage'),build:()=>calls.push('build'),healthy:()=>calls.push('healthy'),
  produce:phase=>{calls.push(`produce:${phase}`);return {phase};},
  validate:phase=>calls.push(`validate:${phase}`),metadata:()=>{calls.push('metadata');return {source:'a'.repeat(40)};},
  complete:value=>{calls.push('complete');complete=value;},failure:value=>{calls.push('failure');records.push({kind:'failure',value});},cleanup:()=>calls.push('cleanup'),...overrides,
 };
 return {deps,calls,records,get complete(){return complete;}};
}

test('dispatches only full native and client phases, finalizes after metadata, preserves partial flags',async()=>{
 const f=fixture();const result=await executePhases(f.deps);
 assert.deepEqual(f.calls,['baseline','record:baseline','stage','build','healthy','produce:native','healthy','validate:native','record:native-validation','healthy','produce:client','healthy','validate:client','record:client-validation','metadata','healthy','complete','cleanup']);
 for(const [key,value]of Object.entries(PARTIAL))assert.deepEqual(result[key],value);
 assert.equal(f.complete,result);assert.equal(result.attemptEnded,true);assert(!('passed'in result));
});
test('real command factory uses full unchanged producer arguments and exact staged runtime',()=>{
 const common={source:'/source',project:'/owned/project',targetDir:'/owned/target',journal:'/evidence/journal',env:{CARGO_BUILD_JOBS:'3'},node:'/pinned/node',platform:'darwin'};
 const native=campaignCommand({...common,phase:'native'}),client=campaignCommand({...common,phase:'client'});
 assert.deepEqual(native.args,['/owned/project/out/bench/dist','/evidence/journal/native-report.json']);assert.equal(native.file,'/owned/target/release/fixture-measure');assert.equal(native.options.timeout,1200000);
 assert.deepEqual(client.args,['/source/e2e/performance/client/run.mjs','--browser','all']);assert.equal(client.file,'/pinned/node');assert.equal(client.options.timeout,600000);assert.equal(client.options.env.FORMA_BENCH_CORE,'/owned/project/node_modules/@getforma/core');
 for(const row of [native,client])assert.equal(row.options.env.FORMA_PERFORMANCE_EVIDENCE,'/evidence/journal');
 assert.throws(()=>campaignCommand({...common,phase:'mobile'}),/only native\/client/);
});
test('completed native validation failure is durable and permits one independent client phase',async()=>{
 const f=fixture({validate:phase=>{if(phase==='native')throw Error('N1 below floor');}});
 const result=await executePhases(f.deps);
 assert.equal(result.outcomes.native.validated,false);assert.equal(result.outcomes.client.validated,true);
 assert(f.calls.indexOf('record:native-validation')<f.calls.indexOf('produce:client'));
 assert.equal(f.calls.filter(x=>x==='produce:client').length,1);assert.equal(f.records[1].value.error,'N1 below floor');
 assert.equal(result.p17Passed,false);assert.equal(result.performanceAccepted,false);
});
test('child failure cannot dispatch another phase or finalize; cleanup still runs',async()=>{
 const f=fixture({produce:()=>{throw Error('native child exit 1');}});
 await assert.rejects(executePhases(f.deps),/native child exit 1/);
 assert(!f.calls.includes('produce:client'));assert(!f.calls.includes('complete'));assert.equal(f.calls.at(-1),'cleanup');
 assert.equal(f.records.at(-1).value.attemptEnded,false);
});
test('malformed/corrupted child journal is fatal before validation and completion',async()=>{
 let checks=0;const f=fixture({healthy:()=>{if(++checks===2)throw Error('record hash differs');}});
 await assert.rejects(executePhases(f.deps),/record hash differs/);
 assert(!f.calls.includes('validate:native'));assert(!f.calls.includes('produce:client'));assert(!f.calls.includes('complete'));assert.equal(f.calls.at(-1),'cleanup');
});
test('metadata failure retains outcomes and cannot write a complete marker',async()=>{
 const f=fixture({metadata:()=>{throw Error('executable digest I/O');}});
 await assert.rejects(executePhases(f.deps),/executable digest I\/O/);
 assert.equal(f.records.at(-1).value.outcomes.client.validated,true);assert(!f.calls.includes('complete'));assert.equal(f.calls.at(-1),'cleanup');
});
test('baseline and staging errors stop both campaigns and retain failure disposition',async()=>{
 for(const phase of ['baseline','stage']){
  const f=fixture({[phase]:()=>{throw Error(`${phase} refused`);}});
  await assert.rejects(executePhases(f.deps),new RegExp(`${phase} refused`));
  assert(!f.calls.some(x=>x.startsWith('produce:')));assert(!f.complete);assert.equal(f.calls.at(-1),'cleanup');
 }
});
test('explicit input identities are required; an identity or artifact mismatch refuses',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'continuation-control-')));
 try{
  for(const name of ['source','packages'])mkdirSync(join(root,name));
  const args=['--source',join(root,'source'),'--expected-source','a'.repeat(40),'--packages',join(root,'packages'),'--expected-ds11','b'.repeat(64),'--target','v3.0.0-beta.1','--output',join(root,'evidence')];
  const opts=parseOptions(args);assert.equal(opts['expected-source'],'a'.repeat(40));assert.equal(opts['expected-ds11'],'b'.repeat(64));
  assert.throws(()=>parseOptions(args.slice(2)),/six explicit/);
  assert.throws(()=>parseOptions([...args.slice(0,-1),join(root,'source/evidence')]),/outside source/);
  const ids=[['crates','forma-ir','crates/forma-ir'],['crates','forma-ir-derive','crates/forma-ir-derive'],['crates','forma-server','crates/forma-server'],['npm','@getforma/core','packages/core'],['npm','@getforma/compiler','packages/compiler'],['npm','@getforma/build','packages/build'],['npm','@getforma/create-app','packages/create-app']];
  const set={schema:1,commit:'a'.repeat(40),contracts:{performance:'measured-v1',fixtureApps:'declared-v1'},packages:ids.map(([registry,name,path],i)=>({registry,name,path,version:'3.0.0-dev',file:`pkg-${i}.tgz`,sha256:'c'.repeat(64)}))};
  assertSet(set,opts,()=>'c'.repeat(64));
  assert.throws(()=>assertSet({...set,commit:'d'.repeat(40)},opts,()=>'c'.repeat(64)));
  assert.throws(()=>assertSet(set,opts,()=>'d'.repeat(64)),/packed bytes differ/);
  assert.throws(()=>assertSet({...set,packages:set.packages.slice(1)},opts,()=>'c'.repeat(64)),/exact seven/);
 }finally{rmSync(root,{recursive:true});}
});
test('exclusive durable file preserves prior bytes; owned cleanup cannot follow outside symlink',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'continuation-cleanup-')));
 try{
  const owned=join(root,'owned'),outside=join(root,'outside');mkdirSync(owned);mkdirSync(outside);writeFileSync(join(outside,'keep'),'preserved');
  const file=join(root,'record.json');durable(file,{first:true});assert.throws(()=>durable(file,{first:false}),/EEXIST/);assert.equal(JSON.parse(readFileSync(file)).first,true);
  symlinkSync(outside,join(owned,'external'));cleanupOwned(owned,root);assert(!existsSync(owned));assert.equal(readFileSync(join(outside,'keep'),'utf8'),'preserved');
  const link=join(root,'bad-root');symlinkSync(outside,link);assert.throws(()=>cleanupOwned(link,root),/non-owned/);assert(existsSync(outside));assert.throws(()=>cleanupOwned(root,root),/non-owned/);
 }finally{rmSync(root,{recursive:true});}
});
test('actual shared journal finalizer refuses same-length corruption and allows only a partial completion',async()=>{
 const source=process.env.FORMA_CONTINUATION_TEST_SOURCE;assert(source,'finite controls require explicit FORMA_CONTINUATION_TEST_SOURCE');
 const j=await import(pathToFileURL(join(source,'scripts/release-performance-journal.mjs')).href);
 const root=realpathSync(mkdtempSync(join(tmpdir(),'continuation-journal-')));
 try{
  const good=j.createPerformanceJournal(root,{...PARTIAL,source:'a'.repeat(40)});
  j.writePerformanceRecord(good,'native-report',{raw:[1,2,3]});j.writePerformanceRecord(good,'client-report',{raw:[4,5,6]});
  j.completePerformanceJournal(good,{...PARTIAL,attemptEnded:true,outcomes:{native:{validated:false},client:{validated:true}}});
  const state=j.readPerformanceJournal(good,j.EVIDENCE_LIMITS,{verifyHashes:true});assert.equal(state.entries.at(-1).kind,'complete');
  const marker=JSON.parse(readFileSync(join(good,'complete.json')));assert.equal(marker.p17Passed,false);assert.equal(marker.performanceAccepted,false);assert.deepEqual(marker.missingRequiredPhases,['decoder','mobile']);
  const bad=j.createPerformanceJournal(root,{...PARTIAL});j.writePerformanceRecord(bad,'native-report',{raw:[1,2,3]});
  const file=join(bad,'native-report.json');writeFileSync(file,readFileSync(file,'utf8').replace('[1,2,3]','[9,2,3]'));
  assert.throws(()=>j.completePerformanceJournal(bad,{...PARTIAL,attemptEnded:true}),/record hash differs/);assert(!existsSync(join(bad,'complete.json')));
 }finally{rmSync(root,{recursive:true});}
});
