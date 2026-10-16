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
  t=>{const later={...structuredClone(t.traceEvents[0]),ts:1000002};delete later.args.data.documentLoaderURL;t.traceEvents.push(later);},
 ]){const copy=structuredClone(trace);edit(copy);assert.equal(kind(lhr,copy),'application-or-unattributed');}
 const unmatched=structuredClone(lhr);unmatched.audits['long-tasks'].details.items[0].startTime+=1;
 assert.equal(kind(unmatched,trace),'application-or-unattributed');
 // A late audit task receives no origin exemption, even without an app URL.
 const late=traceFixture({startTime:7000,duration:110,scriptAt:200});
 assert.equal(kind(late.lhr,late.trace),'application-or-unattributed');
});
test('same-frame image layout metadata is excluded only with its exact parser request provenance',()=>{
 const fixture=()=>traceFixture({duration:65.767,startTime:2062.797,scriptAt:2660.165,imageLayout:true});
 const exact=fixture();
 exact.trace.traceEvents.push({...structuredClone(exact.trace.traceEvents[0]),ts:exact.trace.traceEvents[0].ts+1200000,args:{...structuredClone(exact.trace.traceEvents[0].args),data:{...structuredClone(exact.trace.traceEvents[0].args.data),documentLoaderURL:'',navigationId:'renderer-timing-placeholder'}}});
 exact.lhr.audits['long-tasks'].details.items.push({duration:60.473,startTime:2660.165});
 exact.trace.traceEvents.push({...exact.trace.traceEvents.find(event=>event.name==='v8.evaluateModule'),name:'RunTask',ph:'X',dur:60473});
 assert.deepEqual(attributeMobileTasks(exact.lhr,exact.trace).tasks.map(({kind,reason,traceIndex})=>({kind,reason,matched:traceIndex!==null})),[
  {kind:'pre-application-browser-layout',reason:'same-navigation-pure-layout-before-first-script',matched:true},
  {kind:'application-or-unattributed',reason:'not-proven-pre-application-layout',matched:true},
 ]);
 const edit=(change)=>{const {lhr,trace}=fixture();change(trace.traceEvents);return kind(lhr,trace);};
 const named=(events,name)=>events.find(event=>event.name===name);
 for(const change of [
  events=>{named(events,'LayoutImageUnsized').args.data.frameId='other-frame';},
  events=>{delete named(events,'LayoutImageUnsized').args.data.frameId;},
  events=>{delete named(events,'LayoutImageUnsized').args.data.nodeId;},
  events=>{named(events,'LayoutImageUnsized').args.data.nodeId=0;},
  events=>{named(events,'LayoutImageUnsized').cat='unknown';},
  events=>{named(events,'LayoutImageUnsized').ph='X';},
  events=>events.splice(events.indexOf(named(events,'ResourceSendRequest')),1),
  events=>events.push(structuredClone(named(events,'ResourceSendRequest'))),
  events=>{const duplicate=structuredClone(named(events,'ResourceSendRequest'));duplicate.args.data.frame='other-frame';events.push(duplicate);},
  events=>{const duplicate=structuredClone(named(events,'ResourceSendRequest'));duplicate.args.data.resourceType='Script';events.push(duplicate);},
  events=>{named(events,'ResourceSendRequest').cat='unknown';},
  events=>{named(events,'ResourceSendRequest').ph='X';},
  events=>{named(events,'ResourceSendRequest').dur=1;},
  events=>{named(events,'ResourceSendRequest').args.data.frame='other-frame';},
  events=>{named(events,'ResourceSendRequest').args.data.initiator.type='script';},
  events=>{named(events,'ResourceSendRequest').args.data.initiator.url='http://other.invalid/';},
  events=>{named(events,'ResourceSendRequest').args.data.resourceType='Script';},
  events=>{named(events,'ResourceSendRequest').ts=named(events,'ResourceChangePriority').ts+1;},
  events=>{delete named(events,'ResourceChangePriority').args.data.requestId;},
  events=>{delete named(events,'ResourceChangePriority').dur;},
  events=>{named(events,'ResourceChangePriority').args.data.priority='Unknown';},
  events=>{named(events,'ResourceChangePriority').cat='unknown';},
  events=>{named(events,'ResourceChangePriority').ph='I';},
 ])assert.equal(edit(change),'application-or-unattributed');
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
test('strict startup requires twenty runs with every counted task at most50ms',()=>{
 const rows=withDurations(Array(20).fill(50));validateMobile(rows);
 assert.equal(rows[0].startup.policy.id,'N3-startup-strict50-v1');
 assert.equal(rows[0].startup.targetMiss,false);assert.equal(rows[0].startup.p95MaxTaskMs,50);assert.equal(rows[0].startup.maxTaskMs,50);
 for(const edit of [r=>r[0].runs.pop(),r=>r[0].pilot=true,r=>r[0].startup.targetMiss=true,r=>r[0].startup.policy.maxTaskMs=100,r=>r[0].startup.runMaximaMs[0]=0,r=>delete r[0].runs[0].lighthouse.trace,r=>r[0].runs[0].lighthouse.attribution.tasks[0].kind='pre-application-browser-layout']){
  const copy=structuredClone(rows);edit(copy);assert.throws(()=>validateMobile(copy));
 }
});
test('one task above50ms refuses even when the twenty-run p95 is50ms',()=>{
 const values=[...Array(19).fill(50),50.0001];
 for(const options of [{},{layout:true,observer:true}]){
  const rows=withDurations(values,options);
  assert.equal(rows[0].startup.p95MaxTaskMs,50);assert.equal(rows[0].startup.targetMiss,true);
  assert.throws(()=>validateMobile(rows),/over50ms/);
 }
 const oldNinety=withDurations([...Array(19).fill(50),90]);
 assert.equal(oldNinety[0].startup.targetMiss,true);assert.throws(()=>validateMobile(oldNinety),/over50ms/);
});
test('historical L63 policy evidence cannot stand in for a fresh strict campaign',()=>{
 const rows=withDurations(Array(20).fill(50));
 for(const row of rows){
  row.startup.policy={...row.startup.policy,id:'L63-startup-v1',p95MaxTaskMs:75,maxTaskMs:100};
  for(const run of row.runs)run.lighthouse.attribution.policy='L63-startup-v1';
 }
 assert.throws(()=>validateMobile(rows),/attribution differs/);
});
test('pure layout attribution never erases whole-page TBT, independent observations or mixed tasks',()=>{
 const rows=withDurations(Array(20).fill(120),{layout:true});validateMobile(rows);
 assert.equal(rows[0].runs[0].lighthouse.longTasks[0].duration,120);
 assert.equal(rows[0].startup.maxTaskMs,0);assert.equal(rows[0].startup.targetMiss,false);assert.equal(rows[0].startup.wholePageTargetMiss,true);
 assert.throws(()=>validateMobile(withDurations(Array(20).fill(120),{layout:true,observer:true})),/over50ms/);
 for(const run of rows[0].runs){const lhr=JSON.parse(run.lighthouse.rawLhr);lhr.audits['total-blocking-time'].numericValue=200;run.lighthouse=traceMeasurement(lhr,decodeMobileTrace(run.lighthouse.trace));}
 rows[0].p95TbtMs=200;assert.throws(()=>validateMobile(rows),/TBT/);
});
test('the110ms negative control still requires its actual interval, independently of response latency',()=>{
 const good=controlObservations();validateMobileControls(good);
 const old=structuredClone(good);old.slow.injectedTask.endTime=240.2;old.slow.longTasks[0].duration=91;
 assert.throws(()=>validateMobileControls(old),/110 milliseconds/);
 const unrelated=structuredClone(good);unrelated.slow.longTasks=[{startTime:500,duration:200}];assert.throws(()=>validateMobileControls(unrelated),/not observed/);
 const lateOnly=structuredClone(good);lateOnly.slow.longTasks[0].duration=99;lateOnly.slow.lastResponseMs=1000;assert.throws(()=>validateMobileControls(lateOnly),/not observed/);
});
