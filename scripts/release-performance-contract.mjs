import assert from 'node:assert/strict';
import {N1_SHAPES,PERFORMANCE_CONTRACT} from './release-performance-baseline.mjs';
export const finite = (n,label) => {assert(Number.isFinite(n)&&n>=0,`${label}: missing finite nonnegative figure`);return n;};
export function percentile(samples,fraction) {assert(samples.length>0);const sorted=[...samples].sort((a,b)=>a-b);return sorted[Math.ceil(sorted.length*fraction)-1];}
const exactKeys=(rows,expected,label)=>assert.deepEqual([...rows].sort(),[...expected].sort(),`${label}: missing or duplicate figure`);
const sha=value=>assert(/^[a-f0-9]{64}$/.test(value),'performance: missing SHA256 provenance');
export function validateNative(report,baseline) {
 assert.equal(report.schema,1);assert.equal(report.pilot,false,'N1: pilot cannot qualify a release');
 assert(report.profile?.includes('cargo build --release --locked'),'N1: application release profile missing');
 exactKeys(report.n1?.map(row=>row.nominalNodes)??[],N1_SHAPES,'N1 shapes');
 for(const row of report.n1){
  assert.equal(row.walks,20000,'N1: require 20,000 walks per shape');assert.equal(row.samplesNanoseconds?.length,20000);
  for(const time of row.samplesNanoseconds)assert(Number.isSafeInteger(time)&&time>0,'N1: invalid raw walk duration');
  assert.equal(row.p50Nanoseconds,percentile(row.samplesNanoseconds,.5));assert.equal(row.p99Nanoseconds,percentile(row.samplesNanoseconds,.99));
  assert(Number.isSafeInteger(row.nodes)&&Math.abs(row.nodes-row.nominalNodes)<=row.nominalNodes*.03,'N1: consumer shape differs');
  for(const hash of [row.moduleSha256,row.inputSha256,row.outputSha256])sha(hash);
  for(const [quantile,time] of [['p50',row.p50Nanoseconds],['p99',row.p99Nanoseconds]]){
   const derived=row.nodes*1e9/time;assert(Math.abs(row[`${quantile}NodesPerSecond`]-derived)<=derived*1e-12,'N1: claimed rate differs from raw durations');
  }
  assert(row.p99NodesPerSecond>=1500000,`N1 ${row.nominalNodes}: p99 rate below1,500,000 nodes/s`);
  if(baseline.status==='comparable'){
   const previous=baseline.n1.find(p=>p.nominalNodes===row.nominalNodes);assert(previous,'N1: previous shape missing');
   assert(row.p99NodesPerSecond>previous.p99NodesPerSecond/2,`N1 ${row.nominalNodes}: rate at or below half previous release`);
  }else assert.equal(baseline.status,'bootstrap','N1: no authenticated baseline');
 }
 const n5=report.n5;exactKeys(n5?.points?.map(p=>p.rows)??[],[100,200,400,800,1600,3200],'N5 rows');
 const base=n5.points.find(p=>p.rows===100);
 for(const p of n5.points){
  assert(Number.isSafeInteger(p.allocations)&&p.allocations>0);assert(Number.isSafeInteger(p.allocatedBytes)&&p.allocatedBytes>0);
  assert.equal(p.samplesNanoseconds?.length,41);for(const n of p.samplesNanoseconds)assert(finite(n,'N5 time')>0);
  assert.equal(p.medianNanoseconds,percentile(p.samplesNanoseconds,.5));sha(p.moduleSha256);sha(p.inputSha256);
  if(p.rows>100){const factor=p.rows/100;assert(p.allocations/base.allocations<factor*1.5,'N5: allocation growth beyond1.5x linear');assert(p.allocatedBytes/base.allocatedBytes<factor*1.5,'N5: byte growth beyond1.5x linear');}
 }
 assert.equal(n5.pairedRounds,41);assert.equal(n5.pairedTimeRatios?.length,41);n5.pairedTimeRatios.forEach(n=>finite(n,'N5 paired time'));
 assert.equal(n5.medianTimeRatio,percentile(n5.pairedTimeRatios,.5));assert(n5.medianTimeRatio<64,'N5: time growth at or beyond2x linear');
 const b=report.boundaries;assert.equal(b?.exactPass,true);assert.equal(b.partialHtmlReturned,false);
 assert.equal(b.onePastIteration?.code,'RENDER-302');assert.equal(b.onePastOutput?.code,'RENDER-301');
 assert(Number.isSafeInteger(b.exactIterations)&&b.exactIterations>0);assert(Number.isSafeInteger(b.exactBytes)&&b.exactBytes>0);
 assert.equal(b.onePastIteration.limit,b.exactIterations-1);assert.equal(b.onePastOutput.limit,b.exactBytes-1);
 return report;
}
export function validateActivation(probe,{islands}) {
 assert.equal(probe.expected,islands);assert.equal(probe.active,islands,'N3: islands did not activate');assert.equal(probe.responded,islands,'N3: islands did not respond to real events');
 finite(probe.firstPaintMs,'N3 first paint');finite(probe.lastResponseMs,'N3 last response');
 const afterPaint=Math.max(0,probe.lastResponseMs-probe.firstPaintMs);assert(afterPaint<=500,'N3: islands respond later than500ms after first paint');
 assert(Array.isArray(probe.longTasks),'N3: no long-task observation');assert(probe.longTasks.every(t=>finite(t.duration,'N3 long task')<=50),'N3: task over50ms');
 assert.deepEqual(probe.errors,[],'N3: browser errors');return afterPaint;
}
export function validateMobile(rows) {
 exactKeys(rows?.map(row=>row.id)??[],['tenant-login','islands-100'],'N3 routes');
 for(const row of rows){assert.equal(row.runs?.length,20,'N3: require20 cold runs');
  for(const run of row.runs){
   assert.equal(run.lighthouse.version,'13.5.0');assert.equal(run.lighthouse.throttlingMethod,'devtools');assert(run.lighthouse.benchmarkIndex>0,'N3: Lighthouse benchmarkIndex missing');
   sha(run.lighthouse.sha256);finite(run.lighthouse.tbtMs,'N3 TBT');finite(run.lighthouse.lcpMs,'N3 LCP');
   assert(Array.isArray(run.lighthouse.longTasks));assert(run.lighthouse.longTasks.every(t=>finite(t.duration,'Lighthouse long task')<=50),'N3: Lighthouse task over50ms');
   validateActivation(run.activation,{islands:row.id==='islands-100'?100:2});
  }
  const tbt=percentile(row.runs.map(run=>run.lighthouse.tbtMs),.95);assert(tbt<200,'N3: p95 TBT at or above200ms');assert.equal(row.p95TbtMs,tbt);
 }
 return rows;
}
export function validateComparison(report){
 assert.equal(report.schema_version,2);exactKeys(Object.keys(report.browsers??{}),['chromium','firefox','webkit'],'client comparison engines');
 assert.equal(report.methodology?.react_compiler_verified,true);assert.equal(report.methodology.production_builds,true);assert.equal(report.methodology.runs,12);assert.equal(report.methodology.warmups,3);
 for(const engine of Object.values(report.browsers)){
  assert(engine.version);for(const framework of ['forma','react_compiler']){
   const metrics=engine.runtime?.[framework];for(const key of ['mount_1','mount_50','mount_100','mount_500','update_one_of_500','update_all_500','reverse_1000'])assert(metrics?.[key],`client comparison missing ${key}`);
  }for(const key of ['forma_isolated','forma_shared','react_query'])assert(engine.server_state?.[key],`client comparison missing ${key}`);
 }
 return report;
}
export function completePerformance({native,mobile,client,baseline,machine,controls}){
 assert(machine?.profile&&machine?.node&&machine?.cpuModel,'performance: machine/profile missing');
 assert.deepEqual(controls,{deadActivationRefused:true,longTaskRefused:true},'N3: paired controls did not refuse');
 validateNative(native,baseline);validateMobile(mobile);validateComparison(client);
 return {contract:PERFORMANCE_CONTRACT,passed:true,machine,baseline,controls,nativeProfile:native.profile,n1:native.n1,n5:native.n5,boundaries:native.boundaries,mobile,client};
}
