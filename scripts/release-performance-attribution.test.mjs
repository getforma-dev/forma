import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {attributeMobileTasks,encodeMobileTrace,decodeMobileTrace,summarizeMobileStartup,MOBILE_TRACE_MAX_BYTES} from './release-performance-attribution.mjs';
import {validateMobile,validateMobileControls} from './release-performance-contract.mjs';
import {mobile,controlObservations} from './release-performance-test-fixtures.mjs';
import {traceFixture,traceMeasurement} from './release-performance-trace-fixtures.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const kind=(lhr,trace)=>attributeMobileTasks(lhr,trace).tasks[0].kind;

test('only complete same-navigation browser layout before observed script is excluded',()=>{
 const {lhr,trace}=traceFixture({duration:120,scriptAt:300});
 assert.equal(kind(lhr,trace),'pre-application-browser-layout');
 const metadata=structuredClone(trace);metadata.traceEvents.push({...trace.traceEvents[4],name:'ScriptCatchup',cat:'disabled-by-default-devtools.v8-source-rundown',ts:1001000,ph:'I',dur:undefined});
 assert.equal(kind(lhr,metadata),'pre-application-browser-layout');
 metadata.traceEvents.at(-1).cat='unknown';assert.equal(kind(lhr,metadata),'application-or-unattributed');
 assert.deepEqual(decodeMobileTrace(encodeMobileTrace(trace)),trace);
 for(const edit of [
  t=>t.traceEvents.push({...t.traceEvents[3],name:'FunctionCall'}),
  t=>t.traceEvents.push({...t.traceEvents[3],name:'UnknownBrowserWork'}),
  t=>t.traceEvents.push({...t.traceEvents[3],name:'ScriptCatchup'}),
  t=>t.traceEvents.push({...t.traceEvents[3],name:'RunMicrotasks'}),
  t=>t.traceEvents[4].ts=1000001,
  t=>t.traceEvents.pop(),
  t=>t.traceEvents[1].ts=1500000,
  t=>t.traceEvents[3].args.beginData.frame='other-frame',
  t=>t.traceEvents[3].name='PrePaint',
  t=>t.traceEvents.push(structuredClone(t.traceEvents[2])),
  t=>t.traceEvents[3].ts-=10000,
  t=>t.traceEvents[3].dur+=10000,
  t=>t.traceEvents.push({...t.traceEvents[3],name:'EventDispatch',args:{data:{type:'click'}}}),
  t=>t.traceEvents.push({...t.traceEvents[3],name:'WebDXFeatureUsage',args:{scriptId:42}}),
  t=>t.traceEvents.push({...t.traceEvents[0],ts:1000002}),
 ]){const copy=structuredClone(trace);edit(copy);assert.equal(kind(lhr,copy),'application-or-unattributed');}
 const unmatched=structuredClone(lhr);unmatched.audits['long-tasks'].details.items[0].startTime+=1;
 assert.equal(kind(unmatched,trace),'application-or-unattributed');
 // A late audit task receives no origin exemption, even without an app URL.
 const late=traceFixture({startTime:7000,duration:110,scriptAt:200});
 assert.equal(kind(late.lhr,late.trace),'application-or-unattributed');
});
test('missing, malformed or ambiguous trace identity refuses instead of inventing attribution',()=>{
 const {lhr,trace}=traceFixture();
 for(const edit of [t=>t.traceEvents=[],t=>t.traceEvents[0].args.frame='',t=>t.traceEvents[0].args.data.documentLoaderURL='http://another.invalid/',t=>t.traceEvents.splice(1,1),t=>t.traceEvents.push(structuredClone(t.traceEvents[0])),t=>t.traceEvents[3].dur=-1]){
  const copy=structuredClone(trace);edit(copy);assert.throws(()=>attributeMobileTasks(lhr,copy));
 }
 const other=structuredClone(lhr);delete other.audits.metrics;assert.throws(()=>attributeMobileTasks(other,trace));
});
test('authenticated trace decoding rejects corruption, hostile expansion and oversized metadata',()=>{
 const {trace}=traceFixture(),encoded=encodeMobileTrace(trace);
 for(const edit of [r=>r.encoding='plain',r=>r.data+='AAAA',r=>r.compressedSha256='0'.repeat(64),r=>r.sha256='0'.repeat(64),r=>r.bytes++,r=>r.compressedBytes++,r=>r.bytes=MOBILE_TRACE_MAX_BYTES+1,r=>r.compressedBytes=MOBILE_TRACE_MAX_BYTES+1]){
  const copy=structuredClone(encoded);edit(copy);assert.throws(()=>decodeMobileTrace(copy));
 }
 // A tiny compressed body must not be allowed to expand past the bound even
 // when its compressed digest is authentic and declared raw size is in range.
 const compressed=gzipSync(Buffer.alloc(MOBILE_TRACE_MAX_BYTES+1,32));
 assert.throws(()=>decodeMobileTrace({encoding:'gzip-base64',bytes:MOBILE_TRACE_MAX_BYTES,sha256:'0'.repeat(64),compressedBytes:compressed.length,compressedSha256:sha(compressed),data:compressed.toString('base64')}),/larger than|Buffer|output|size/i);
});
function withDurations(values,{observer=false,layout=false}={}){
 const rows=mobile();
 for(const row of rows){
  for(const [i,run] of row.runs.entries()){
   const duration=values[i],{lhr,trace}=traceFixture({duration,scriptAt:layout?500:1});
   run.lighthouse=traceMeasurement(lhr,trace);
   if(observer)run.activation.longTasks=[{startTime:100,duration}];
  }
  row.startup=summarizeMobileStartup(row.runs);
 }
 return rows;
}
test('L63 uses twenty per-run maxima, preserves 50ms misses, and enforces inclusive75/100 boundaries',()=>{
 const values=[...Array(19).fill(75),100],rows=withDurations(values);
 validateMobile(rows);assert.equal(rows[0].startup.targetMiss,true);assert.equal(rows[0].startup.p95MaxTaskMs,75);assert.equal(rows[0].startup.maxTaskMs,100);
 assert.throws(()=>validateMobile(withDurations([...Array(18).fill(75),75.0001,100])),/over75ms/);
 assert.throws(()=>validateMobile(withDurations([...Array(19).fill(50),100.0001])),/over100ms/);
 assert.throws(()=>validateMobile(withDurations([...Array(19).fill(50),100.0001],{observer:true})),/over100ms/);
 const exact=withDurations(Array(20).fill(50));validateMobile(exact);assert.equal(exact[0].startup.targetMiss,false);
 const oldNinety=withDurations([...Array(19).fill(50),90]);validateMobile(oldNinety);assert.equal(oldNinety[0].startup.targetMiss,true);
 for(const edit of [r=>r[0].runs.pop(),r=>r[0].pilot=true,r=>r[0].startup.targetMiss=false,r=>r[0].startup.policy.maxTaskMs=101,r=>r[0].startup.runMaximaMs[0]=0,r=>delete r[0].runs[0].lighthouse.trace,r=>r[0].runs[0].lighthouse.attribution.tasks[0].kind='pre-application-browser-layout']){
  const copy=structuredClone(rows);edit(copy);assert.throws(()=>validateMobile(copy));
 }
});
test('pure layout attribution never erases whole-page TBT, independent observations or mixed tasks',()=>{
 const rows=withDurations(Array(20).fill(120),{layout:true});validateMobile(rows);
 assert.equal(rows[0].runs[0].lighthouse.longTasks[0].duration,120);
 assert.equal(rows[0].startup.maxTaskMs,0);assert.equal(rows[0].startup.targetMiss,false);assert.equal(rows[0].startup.wholePageTargetMiss,true);
 assert.throws(()=>validateMobile(withDurations(Array(20).fill(120),{layout:true,observer:true})),/over100ms/);
 for(const run of rows[0].runs){const lhr=JSON.parse(run.lighthouse.rawLhr);lhr.audits['total-blocking-time'].numericValue=200;run.lighthouse=traceMeasurement(lhr,decodeMobileTrace(run.lighthouse.trace));}
 rows[0].p95TbtMs=200;assert.throws(()=>validateMobile(rows),/TBT/);
});
test('over100ms control requires its actual interval; old90ms remains preserved but is not the new negative',()=>{
 const good=controlObservations();validateMobileControls(good);
 const old=structuredClone(good);old.slow.injectedTask.endTime=240.2;old.slow.longTasks[0].duration=91;
 assert.throws(()=>validateMobileControls(old),/110 milliseconds/);
 const unrelated=structuredClone(good);unrelated.slow.longTasks=[{startTime:500,duration:200}];assert.throws(()=>validateMobileControls(unrelated),/not observed/);
 const lateOnly=structuredClone(good);lateOnly.slow.longTasks[0].duration=99;lateOnly.slow.lastResponseMs=1000;assert.throws(()=>validateMobileControls(lateOnly),/not observed/);
});
