import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateComparison,validateMobile,validatePerformanceRecord} from './release-performance-contract.mjs';

test('only historical baseline validation can admit the original input-control protocol',()=>{
 const historical=performanceRecord();delete historical.inputProtocol;
 delete historical.controlObservations.slowInput;delete historical.controls.longInputRefused;
 assert.throws(()=>validatePerformanceRecord(historical),/current input protocol required/);
 validatePerformanceRecord(historical,{allowLegacyInputProtocol:true});
 for(const protocol of ['separate-input-tasks-v1','batched-input-v0','unknown']){
  const claimed={...historical,inputProtocol:protocol};
  assert.throws(()=>validatePerformanceRecord(claimed,{allowLegacyInputProtocol:true}));
 }
 const current=performanceRecord();delete current.controlObservations.slowInput;
 assert.throws(()=>validatePerformanceRecord(current,{allowLegacyInputProtocol:true}));
});
import {validateBaselineRecord} from './release-performance-baseline.mjs';
import {comparison,mobile,performanceRecord} from './release-performance-test-fixtures.mjs';
const context={tag:'v3.0.0-beta.1',currentTag:'v3.0.0-rc.1',publishedAt:'2026-10-16T00:00:00Z',before:'2026-10-17T00:00:00Z',digest:'a'.repeat(64)};
function baseline(){const commit='b'.repeat(40);return {schema:1,dryRun:false,tag:context.tag,commit,contracts:{performance:'measured-v1'},packages:[...['forma-ir','forma-ir-derive','forma-server'].map(name=>({registry:'crates',name})),...['core','compiler','build','create-app'].map(name=>({registry:'npm',name:`@getforma/${name}`}))].map(p=>({...p,version:context.tag.slice(1),sha256:'a'.repeat(64)})),measurements:{commit,passed:true,measurements:{performance:performanceRecord()}}};}
test('complete restored comparison samples pass; missing, nonfinite and forged values refuse',()=>{
 validateComparison(comparison());
 for(const edit of [r=>r.browsers.chromium.runtime.forma.mount_1={},r=>r.browsers.chromium.runtime.forma.mount_1.samples.pop(),r=>r.browsers.chromium.runtime.forma.mount_1.samples[0].script_ms=NaN,r=>r.browsers.chromium.runtime.forma.mount_1.script_ms.median=5,r=>r.browsers.chromium.server_state.forma_shared.samples[0].browser_requests=undefined,r=>r.browsers.chromium.runtime.forma.memory_500={},r=>r.browsers.firefox.runtime.forma.update_one_of_500.samples[0].repetitions=1]){const r=comparison();edit(r);assert.throws(()=>validateComparison(r));}
});
test('comparison records detached HEAD truthfully while retaining required Git metadata',()=>{
 const detached=comparison();detached.environment.git_branch='';validateComparison(detached);
 for(const branch of [undefined,null,42,[],{}]){
  const invalid=comparison();invalid.environment.git_branch=branch;
  assert.throws(()=>validateComparison(invalid),/missing git_branch/);
 }
 const missing=comparison();delete missing.environment.git_branch;
 assert.throws(()=>validateComparison(missing),/missing git_branch/);
 for(const commit of [undefined,'','HEAD','g'.repeat(40),'b'.repeat(39),'b'.repeat(41)]){
  const invalid=structuredClone(detached);invalid.environment.git_commit=commit;
  assert.throws(()=>validateComparison(invalid));
 }
 const invalidSample=structuredClone(detached);invalidSample.browsers.webkit.runtime.forma.mount_1.samples.pop();
 assert.throws(()=>validateComparison(invalidSample));
});
test('raw Lighthouse bytes and actual profile agree with every extracted figure',()=>{
 validateMobile(mobile());
 for(const edit of [r=>r[0].runs[0].lighthouse.rawLhr='{}',r=>r[0].runs[0].lighthouse.sha256='a'.repeat(64),r=>r[0].runs[0].lighthouse.lcpMs=0,r=>r[0].profile={throttlingMethod:'simulate'},r=>r[0].runs[0].lighthouse.longTasks=[{duration:0,startTime:0}],r=>r[0].runs[0].run=2,r=>r[0].pilot=true]){const r=mobile();edit(r);assert.throws(()=>validateMobile(r));}
});
test('a comparable DS12 must contain the same complete evidence required of the new release',()=>{
 assert.equal(validateBaselineRecord(baseline(),context).status,'comparable');
 for(const edit of [p=>delete p.n1[0].samplesNanoseconds,p=>p.n5.points[0]={rows:100},p=>p.mobile[0].runs[0].lighthouse.rawLhr='{}',p=>p.client.browsers.chromium.runtime.forma.mount_1={}]){const r=baseline();edit(r.measurements.measurements.performance);assert.throws(()=>validateBaselineRecord(r,context));}
});
test('release metadata checks import without any optional browser tooling installed',async()=>{
 const {execFileSync}=await import('node:child_process');
 const loader=`export async function resolve(specifier,context,next){if(/^(?:lighthouse|chrome-launcher|@playwright\\/test)(?:\\/|$)/.test(specifier))throw Object.assign(new Error('Browser tooling unavailable: '+specifier),{code:'ERR_MODULE_NOT_FOUND'});return next(specifier,context);}`;
 const imports=['release-performance-baseline.mjs','release-performance-contract.mjs','verify-release-set.mjs'].map(file=>`await import(${JSON.stringify(new URL(file,import.meta.url).href)});`).join('\n');
 execFileSync(process.execPath,['--no-warnings','--experimental-loader',`data:text/javascript,${encodeURIComponent(loader)}`,'--input-type=module','-e',imports],{stdio:'pipe'});
});

test('new and previous DS12 require all public decoder observations and enforce the raw p95',()=>{
 validatePerformanceRecord(performanceRecord());
 for(const edit of [p=>delete p.decoder,p=>{const row=p.decoder.cases[1];for(const sample of row.samples.slice(37))sample.elapsedMs=30.0001;row.summary={minMs:12,medianMs:12,p95Ms:30.0001,maxMs:30.0001};},p=>p.decoder.cases[0].samples.pop(),p=>delete p.decoder.compiler]){
  const current=performanceRecord();edit(current);assert.throws(()=>validatePerformanceRecord(current));
  const prior=baseline();edit(prior.measurements.measurements.performance);assert.throws(()=>validateBaselineRecord(prior,context));
 }
});

test('paired mobile controls require the injected task itself and durable raw observations',()=>{
 validatePerformanceRecord(performanceRecord());
 for(const edit of [
  p=>delete p.controlObservations,
  p=>delete p.controlObservations.slow.injectedTask,
  p=>p.controlObservations.slow.longTasks=[{startTime:500,duration:100}],
  p=>p.controlObservations.slow.injectedTask.endTime=151,
  p=>p.controlObservations.dead.responded=1,
  p=>p.controlObservations.dead.hosts=0,
  p=>p.controlObservations.slow.responded=99,
 ]){
  const current=performanceRecord();edit(current);assert.throws(()=>validatePerformanceRecord(current));
  const prior=baseline();edit(prior.measurements.measurements.performance);assert.throws(()=>validateBaselineRecord(prior,context));
 }
});
