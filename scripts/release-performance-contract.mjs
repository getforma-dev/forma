import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {N1_SHAPES,PERFORMANCE_CONTRACT,MOBILE_PROFILE} from './release-performance-spec.mjs';
export const finite = (n,label) => {assert(Number.isFinite(n)&&n>=0,`${label}: missing finite nonnegative figure`);return n;};
export function percentile(samples,fraction) {assert(samples.length>0);const sorted=[...samples].sort((a,b)=>a-b);return sorted[Math.ceil(sorted.length*fraction)-1];}
const exactKeys=(rows,expected,label)=>assert.deepEqual([...rows].sort(),[...expected].sort(),`${label}: missing or duplicate figure`);
const sha=value=>assert(/^[a-f0-9]{64}$/.test(value),'performance: missing SHA256 provenance');
export function validateNative(report,baseline=null) {
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
  if(baseline?.status==='comparable'){
   const previous=baseline.n1.find(p=>p.nominalNodes===row.nominalNodes);assert(previous,'N1: previous shape missing');
   assert(row.p99NodesPerSecond>previous.p99NodesPerSecond/2,`N1 ${row.nominalNodes}: rate at or below half previous release`);
  }else if(baseline!==null)assert.equal(baseline.status,'bootstrap','N1: no authenticated baseline');
 }
 const n5=report.n5;exactKeys(n5?.points?.map(p=>p.rows)??[],[100,200,400,800,1600,3200],'N5 rows');
 const base=n5.points.find(p=>p.rows===100);
 for(const p of n5.points){
  assert(Number.isSafeInteger(p.allocations)&&p.allocations>0);assert(Number.isSafeInteger(p.allocatedBytes)&&p.allocatedBytes>0);
  assert.equal(p.samplesNanoseconds?.length,41);for(const n of p.samplesNanoseconds)assert(finite(n,'N5 time')>0);
  assert.equal(p.medianNanoseconds,percentile(p.samplesNanoseconds,.5));sha(p.moduleSha256);sha(p.inputSha256);
  if(p.rows>100){const factor=p.rows/100;assert(p.allocations/base.allocations<factor*1.5,'N5: allocation growth beyond1.5x linear');assert(p.allocatedBytes/base.allocatedBytes<factor*1.5,'N5: byte growth beyond1.5x linear');}
 }
 assert.equal(n5.pairedRounds,41);assert.equal(n5.pairedTimeRatios?.length,41);n5.pairedTimeRatios.forEach(n=>assert(finite(n,'N5 paired time')>0));
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
 for(const row of rows){assert.equal(row.pilot,false,'N3: pilot cannot qualify a release');assert.deepEqual(row.profile,MOBILE_PROFILE,'N3: actual mobile profile differs');assert.equal(row.runs?.length,20,'N3: require20 cold runs');
  for(const [index,run] of row.runs.entries()){
   assert.equal(run.run,index+1,'N3: missing or duplicate cold run');
   const measured=run.lighthouse;assert(typeof measured?.rawLhr==='string','N3: raw Lighthouse report absent');
   assert.equal(createHash('sha256').update(measured.rawLhr).digest('hex'),measured.sha256,'N3: raw Lighthouse digest differs');
   const lhr=JSON.parse(measured.rawLhr);assert(!lhr.runtimeError,'N3: Lighthouse runtime error');
   assert.equal(lhr.lighthouseVersion,measured.version);
   for(const [key,value] of Object.entries(MOBILE_PROFILE))assert.deepEqual(lhr.configSettings?.[key],value,`N3: raw Lighthouse ${key} differs`);
   assert.equal(lhr.environment?.benchmarkIndex,measured.benchmarkIndex);
   assert.equal(lhr.audits?.['total-blocking-time']?.numericValue,measured.tbtMs);
   assert.equal(lhr.audits?.['largest-contentful-paint']?.numericValue,measured.lcpMs);
   const tasks=lhr.audits?.['long-tasks']?.details;assert.equal(tasks?.type,'table');assert(Array.isArray(tasks.items));
   assert.deepEqual(tasks.items.map(({duration,startTime})=>({duration,startTime})),measured.longTasks,'N3: raw Lighthouse tasks differ');
   assert.equal(run.lighthouse.version,'13.5.0');assert.equal(run.lighthouse.throttlingMethod,'devtools');assert(run.lighthouse.benchmarkIndex>0,'N3: Lighthouse benchmarkIndex missing');
   sha(run.lighthouse.sha256);finite(run.lighthouse.tbtMs,'N3 TBT');finite(run.lighthouse.lcpMs,'N3 LCP');
   assert(Array.isArray(run.lighthouse.longTasks));assert(run.lighthouse.longTasks.every(t=>finite(t.duration,'Lighthouse long task')<=50),'N3: Lighthouse task over50ms');
   validateActivation(run.activation,{islands:row.id==='islands-100'?100:2});
  }
  const tbt=percentile(row.runs.map(run=>run.lighthouse.tbtMs),.95);assert(tbt<200,'N3: p95 TBT at or above200ms');assert.equal(row.p95TbtMs,tbt);
 }
 return rows;
}
// Recompute the historical benchmark's own summaries, retaining every raw run.
function validateSampleMetric(metric,{server=false,repetitions=1}={}){
 assert.equal(metric?.samples?.length,12,'client comparison: require12 raw samples');
 const selectors={script_ms:s=>s.script_ms,settled_ms:s=>s.settled_ms,dom_nodes:s=>s.dom_nodes};
 for(const key of ['attributes','character_data','added_nodes','removed_nodes'])selectors[`mutations.${key}`]=s=>s.mutations?.[key];
 if(server)for(const key of ['browser_requests','provider_executions'])selectors[key]=s=>s[key];
 for(const sample of metric.samples){
  assert.equal(sample.repetitions??1,repetitions,'client comparison: repetition normalization differs');
  for(const [key,select] of Object.entries(selectors))finite(select(sample),`client comparison ${key}`);
  assert(Number.isSafeInteger(sample.dom_nodes)&&sample.dom_nodes>0,'client comparison: DOM count absent');
  if(server)for(const key of ['browser_requests','provider_executions'])assert(Number.isSafeInteger(sample[key])&&sample[key]>0,`client comparison ${key}: missing actual requests`);
 }
 for(const [key,select] of Object.entries(selectors)){
  const values=metric.samples.map(select),min=Math.min(...values),max=Math.max(...values);
  const expected={median:percentile(values,.5),p95:percentile(values,.95),min,max,spread_percent:min===0?0:(max-min)/min*100};
  const actual=key.split('.').reduce((value,part)=>value?.[part],metric);
  assert.deepEqual(actual,expected,`client comparison ${key}: summary differs from raw samples`);
 }
}
export function validateComparison(report){
 assert.equal(report.schema_version,2);exactKeys(Object.keys(report.browsers??{}),['chromium','firefox','webkit'],'client comparison engines');
 assert(Number.isFinite(Date.parse(report.recorded_at)),'client comparison: recording date missing');
 const m=report.methodology;assert.equal(m?.react_compiler_verified,true);assert.equal(m.production_builds,true);assert.equal(m.cross_origin_isolated,true);assert.equal(m.runs,12);assert.equal(m.warmups,3);
 exactKeys(m.browsers??[],['chromium','firefox','webkit'],'client methodology engines');assert.deepEqual(m.mount_counts,[1,50,100,500]);assert.equal(m.update_count,500);assert.equal(m.list_count,1000);assert.equal(m.server_state_count,50);
 for(const key of ['node','platform','release','architecture','cpu','git_branch'])assert(typeof report.environment?.[key]==='string'&&report.environment[key].length>0,`client comparison: missing ${key}`);
 assert(/^[a-f0-9]{40}$/.test(report.environment.git_commit));assert.equal(typeof report.environment.git_dirty,'boolean');
 for(const key of ['logical_cpus','memory_bytes'])assert(Number.isSafeInteger(report.environment[key])&&report.environment[key]>0);
 for(const key of ['forma','react','react_dom','tanstack_query','react_compiler'])assert(typeof report.versions?.[key]==='string'&&report.versions[key].length>0,`client comparison: ${key} version absent`);
 exactKeys(Object.keys(report.bundles??{}),['forma.js','forma-query.js','react.js','react-query.js'],'client comparison bundles');
 for(const bundle of Object.values(report.bundles))for(const key of ['raw_bytes','gzip_bytes','brotli_bytes'])assert(Number.isSafeInteger(bundle[key])&&bundle[key]>0,'client comparison: bundle size absent');
 for(const [name,engine] of Object.entries(report.browsers)){
  assert(typeof engine.version==='string'&&engine.version.length>0);
  for(const framework of ['forma','react_compiler']){
   const metrics=engine.runtime?.[framework];
   for(const key of ['mount_1','mount_50','mount_100','mount_500','update_one_of_500','update_all_500','reverse_1000']){
    assert(metrics?.[key],`client comparison missing ${key}`);
    validateSampleMetric(metrics[key],{repetitions:key.startsWith('update_one')?5000:key.startsWith('update_all')?20:key.startsWith('reverse')?10:1});
   }
   if(name==='chromium'){
    const memory=metrics.memory_500;for(const key of ['baseline_used_bytes','mounted_used_bytes','retained_delta_bytes','dom_nodes'])assert(Number.isSafeInteger(memory?.[key])&&memory[key]>=0,`client comparison: ${key} absent`);
    assert(memory.dom_nodes>0);assert.equal(memory.retained_delta_bytes,Math.max(0,memory.mounted_used_bytes-memory.baseline_used_bytes));
   }
  }
  for(const key of ['forma_isolated','forma_shared','react_query'])validateSampleMetric(engine.server_state?.[key],{server:true});
 }
 return report;
}
export function validatePerformanceRecord(performance,{baseline=null}={}){
 assert.equal(performance?.contract,PERFORMANCE_CONTRACT,'performance: contract absent');assert.equal(performance.passed,true,'performance: failed measurements');
 const {machine,controls}=performance;
 assert(machine?.profile&&machine?.node&&machine?.cpuModel,'performance: machine/profile missing');
 assert.deepEqual(controls,{deadActivationRefused:true,longTaskRefused:true},'N3: paired controls did not refuse');
 validateNative({schema:1,pilot:false,profile:performance.nativeProfile,n1:performance.n1,n5:performance.n5,boundaries:performance.boundaries},baseline);
 validateMobile(performance.mobile);validateComparison(performance.client);return performance;
}
export function completePerformance({native,mobile,client,baseline,machine,controls}){
 assert(['bootstrap','comparable'].includes(baseline?.status),'performance: no authenticated baseline');
 validateNative(native,baseline);
 return validatePerformanceRecord({contract:PERFORMANCE_CONTRACT,passed:true,machine,baseline,controls,nativeProfile:native.profile,n1:native.n1,n5:native.n5,boundaries:native.boundaries,mobile,client},{baseline});
}
