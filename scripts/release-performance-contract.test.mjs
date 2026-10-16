import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateNative,validateActivation,validateComparison,percentile} from './release-performance-contract.mjs';
import {performanceTarget} from './release-performance.mjs';
import {verify} from './verify-release-set.mjs';
const hash='a'.repeat(64),bootstrap={status:'bootstrap'};
function native(){return {schema:1,pilot:false,profile:'cargo build --release --locked',n1:[300,1500,10000,15000,20000].map(n=>{const time=n===300?200000:n*500;return {nominalNodes:n,nodes:n,walks:20000,samplesNanoseconds:Array(20000).fill(time),p50Nanoseconds:time,p99Nanoseconds:time,p50NodesPerSecond:n*1e9/time,p99NodesPerSecond:n*1e9/time,moduleSha256:hash,inputSha256:hash,outputSha256:hash}}),n5:{points:[100,200,400,800,1600,3200].map(rows=>({rows,allocations:rows*12,allocatedBytes:rows*400,samplesNanoseconds:Array(41).fill(rows*500),medianNanoseconds:rows*500,moduleSha256:hash,inputSha256:hash})),pairedRounds:41,pairedTimeRatios:Array(41).fill(32),medianTimeRatio:32},boundaries:{exactPass:true,partialHtmlReturned:false,exactIterations:400,exactBytes:50000,onePastIteration:{code:'RENDER-302',limit:399},onePastOutput:{code:'RENDER-301',limit:49999}}};}
test('N1 exactfloor passes; belowfloor and equality at half previous fail',()=>{
 const report=native();validateNative(report,bootstrap);
 const previous={status:'comparable',n1:report.n1.map(r=>({nominalNodes:r.nominalNodes,p99NodesPerSecond:r.p99NodesPerSecond*2}))};
 assert.throws(()=>validateNative(report,previous),/at or below half/);
 previous.n1=previous.n1.map(r=>({...r,p99NodesPerSecond:r.p99NodesPerSecond-1}));validateNative(report,previous);
 const row=report.n1[0];row.samplesNanoseconds.fill(200001);row.p50Nanoseconds=row.p99Nanoseconds=200001;row.p50NodesPerSecond=row.p99NodesPerSecond=row.nodes*1e9/200001;assert.throws(()=>validateNative(report,bootstrap),/below1,500,000/);
});
test('pilot, dropped samples, invented rate, quadratic allocation, and swallowed budgets refuse',()=>{
 for(const edit of [r=>r.pilot=true,r=>r.n1[0].samplesNanoseconds.pop(),r=>r.n1[0].p99NodesPerSecond=1e99,r=>r.n5.points[2].allocations*=4,r=>r.n5.pairedTimeRatios.fill(100),r=>r.boundaries.onePastOutput.code='OK',r=>r.boundaries.partialHtmlReturned=true]){const report=native();edit(report);assert.throws(()=>validateNative(report,bootstrap));}
});
test('actual response and every long task matter independently of TBT',()=>{
 const probe={expected:100,active:100,responded:100,firstPaintMs:100,lastResponseMs:600,longTasks:[{startTime:110,duration:100}],errors:[]};assert.equal(validateActivation(probe,{islands:100}),500);
 for(const edit of [p=>p.responded=99,p=>p.active=0,p=>p.lastResponseMs=600.01,p=>p.longTasks[0].duration=100.01,p=>p.errors.push('RENDER-503')]){const p=structuredClone(probe);edit(p);assert.throws(()=>validateActivation(p,{islands:100}));}
 assert.equal(percentile([...Array(19).fill(0),201],.95),0);assert.equal(percentile([...Array(18).fill(0),200,201],.95),200);
});
test('missing comparison engines are failures, not an empty timing pass',()=>{
 assert.throws(()=>validateComparison({schema_version:2,browsers:{chromium:{}}}),/missing or duplicate/);
});
test('rehearsals require explicit target; live target is immutable',()=>{
 const set={dryRun:true,tag:'v3-development-dry-run',contracts:{version:'3.0.0',performance:'measured-v1',fixtureApps:'declared-v1'}};
 assert.throws(()=>performanceTarget(set,{}),/requires FORMA_PERFORMANCE_TARGET_TAG/);
 assert.deepEqual(performanceTarget(set,{FORMA_PERFORMANCE_TARGET_TAG:'v3.0.0-beta.1'}),{tag:'v3.0.0-beta.1',rehearsal:true});
 const live={...set,dryRun:false,tag:'v3.0.0-rc.1'};assert.throws(()=>performanceTarget(live,{FORMA_PERFORMANCE_TARGET_TAG:'v3.0.0-beta.1'}),/differs from actual/);
 assert.deepEqual(performanceTarget(live,{}),{tag:live.tag,rehearsal:false});
});
test('actual P17 refuses unknown performance contracts before package access; legacy remains readable',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forma-performance-contract-'));
 try{
  for(const performance of ['measured-v2','',false,0,{}]){
   writeFileSync(join(dir,'release-set.json'),JSON.stringify({contracts:{props:null,performance},packages:[{file:'missing.tgz',sha256:hash}]}));
   await assert.rejects(verify(dir,join(dir,'report.json')),/no verifier for the recorded performance contract/);
  }
  for(const performance of [undefined,null]){
   writeFileSync(join(dir,'release-set.json'),JSON.stringify({contracts:{props:null,performance},packages:[{file:'missing.tgz',sha256:hash}]}));
   await assert.rejects(verify(dir,join(dir,'report.json')),e=>e.code==='ENOENT'&&e.path===join(dir,'missing.tgz'));
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
