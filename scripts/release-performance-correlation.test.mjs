import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attributeMobileTasks,decodeMobileTrace} from './release-performance-attribution.mjs';
import {finalizeMobileAttribution,validateMobile,validateMobileControls} from './release-performance-contract.mjs';
import {mobile,controlObservations} from './release-performance-test-fixtures.mjs';
import {traceFixture,traceMeasurement} from './release-performance-trace-fixtures.mjs';

// Synthetic contract input, never measurement evidence. No browser-feature
// name or source hash grants the exemption: context/source identity does.
export function correlationFixture(){
 const {lhr,trace}=traceFixture({duration:99.342,startTime:7000,scriptAt:200});
 const events=trace.traceEvents,origin=events[0].ts,frame=events[0].args.frame,url=lhr.requestedUrl;
 const event=(name,ms,cat,args={},dur=1)=>({name,ts:origin+ms*1000,pid:10,tid:20,ph:'X',dur:dur*1000,cat,args});
 const request=event('ResourceSendRequest',50,'devtools.timeline',{data:{frame,resourceType:'Script',url:`${url}app.js`}});request.ph='I';delete request.dur;
 const source='function isolatedWork() {}';
 events.push(request,
  event('v8.compileModule',200,'v8,devtools.timeline',{data:{scriptId:5,url:`${url}app.js`}}),
  event('ScriptCatchup',202,'disabled-by-default-devtools.v8-source-rundown',{data:{isolate:'isolate',scriptId:5,executionContextId:1,isModule:true,url:`${url}app.js`}}),
  event('EvaluateScript',7001,'devtools.timeline',{data:{frame,scriptId:0,url:''}},85),
  event('v8.compile',7002,'v8,devtools.timeline',{data:{scriptId:12,url:''},fileName:'',worldId:4},10),
  event('ScriptCatchup',7012,'disabled-by-default-devtools.v8-source-rundown',{data:{isolate:'isolate',scriptId:12,executionContextId:8,isModule:false,url:''}},.1),
  event('ScriptCatchup',7012.5,'disabled-by-default-devtools.v8-source-rundown-sources',{data:{isolate:'isolate',scriptId:12,length:source.length,sourceText:source}},.1),
  event('ScriptCompiled',7013,'disabled-by-default-devtools.target-rundown',{data:{isolate:'isolate',scriptId:12,contextType:'isolated',isDefault:false,frameType:'page',frame,url,origin:new URL(url).origin,v8context:'isolated-context'}},70),
  event('v8.run',7014,'v8',{fileName:'',worldId:4},65));
 events.find(e=>e.name==='Layout').name='UnlistedBrowserWork';
 return {lhr,trace};
}
const classify=fixture=>attributeMobileTasks(fixture.lhr,fixture.trace,{correlated:true}).tasks[0];
const named=(f,name)=>f.trace.traceEvents.find(e=>e.name===name);
function campaign(){
 const rows=mobile();
 for(const row of rows)for(const run of row.runs){
  const {lhr,trace}=correlationFixture();run.lighthouse=traceMeasurement(lhr,trace);
  Object.assign(run.activation,{done:true,hosts:run.activation.expected,hostStatuses:Array(run.activation.expected).fill('pending')});
 }
 return rows;
}
test('L66 correlates a source-bound isolated task without a browser-feature allowlist',()=>{
 const f=correlationFixture();
 assert.equal(attributeMobileTasks(f.lhr,f.trace).tasks[0].kind,'application-or-unattributed');
 assert.equal(classify(f).kind,'browser-internal-unattributed');assert.equal(classify(f).duration,99.342);
 const rows=finalizeMobileAttribution(campaign());validateMobile(rows);
 assert(rows.every(row=>row.startup.maxTaskMs===0 && row.startup.wholePageTargetMiss));
 assert.equal(rows[0].runs[0].lighthouse.longTasks[0].duration,99.342);
 const advanced=campaign();for(const row of advanced)for(const run of row.runs)run.activation.hostStatuses=Array(run.activation.expected).fill('active');
 validateMobile(finalizeMobileAttribution(advanced));
 for(const row of advanced)for(const run of row.runs)delete run.activation.hostStatuses;
 validateMobile(finalizeMobileAttribution(advanced));
 const native=correlationFixture();native.trace.traceEvents=native.trace.traceEvents.filter(e=>e.ts<named(native,'EvaluateScript').ts || e.name==='RunTask');
 assert.equal(classify(native).kind,'browser-internal-unattributed','native records need genuine app inventory, not a browser-feature name');
});
test('bundle URLs, inline IDs and nested application stacks always prevent correlation',()=>{
 for(const change of [
  f=>{named(f,'UnlistedBrowserWork').args={stackTrace:[{url:`${f.lhr.requestedUrl}app.js`,functionName:'activate'}]};},
  f=>{named(f,'RunTask').args={stackTrace:[{url:`${f.lhr.requestedUrl}app.js`,functionName:'activate'}]};},
  f=>{named(f,'UnlistedBrowserWork').args={nested:{callFrames:[{scriptId:'5',url:''}]}};},
  f=>{const meta=structuredClone(named(f,'ScriptCatchup'));meta.args.data={isolate:'isolate',scriptId:13,executionContextId:1,isModule:false,url:''};f.trace.traceEvents.push(meta);named(f,'UnlistedBrowserWork').args={stackTrace:[{scriptId:'13',url:''}]};},
  f=>{named(f,'ScriptCompiled').args.data.stackTrace=[{url:`${f.lhr.requestedUrl}app.js`,functionName:'activate'}];},
  f=>{named(f,'v8.compile').args.fileName=f.lhr.requestedUrl;},
 ]){const f=correlationFixture();change(f);assert.equal(classify(f).kind,'application-or-unattributed');}
});
test('missing or ambiguous source coverage and unreadable traces never imply absence',()=>{
 for(const change of [
  f=>f.trace.traceEvents.splice(f.trace.traceEvents.indexOf(named(f,'ResourceSendRequest')),1),
  f=>f.trace.traceEvents.splice(f.trace.traceEvents.indexOf(named(f,'v8.compileModule')),1),
  f=>f.trace.traceEvents.push(structuredClone(named(f,'ScriptCatchup'))),
  f=>{named(f,'ScriptCompiled').args.data.isDefault=true;},
  f=>{named(f,'ScriptCompiled').args.data.frame='foreign';},
  f=>{named(f,'ScriptCompiled').args.data.scriptId=99;},
  f=>{f.trace.traceEvents.find(e=>e.args?.data?.sourceText).args.data.length++;},
  f=>{named(f,'UnlistedBrowserWork').args={stackTrace:[{scriptId:'404',url:''}]};},
  f=>{named(f,'UnlistedBrowserWork').args={stackTrace:[{url:'http://unknown.invalid/code.js',functionName:'unknown'}]};},
  f=>{named(f,'EvaluateScript').args.data.stackTrace=[{scriptId:'404',url:''}];},
  f=>{named(f,'EvaluateScript').args.data.scriptId=-1;},
  f=>{named(f,'EvaluateScript').args.data.url='http://unknown.invalid/code.js';},
  f=>{const event=named(f,'EvaluateScript');event.name='FunctionCall';delete event.args.data.scriptId;event.args.data.url='http://unknown.invalid/code.js';},
  f=>{const e=structuredClone(named(f,'EvaluateScript'));e.ts+=90000;e.dur=100;f.trace.traceEvents.push(e);},
 ]){const f=correlationFixture();change(f);assert.equal(classify(f).kind,'application-or-unattributed');}
 const f=correlationFixture();f.trace.traceEvents=[];assert.throws(()=>classify(f));
});
test('all forty complete correct probes are required; one observed task vetoes the new category',()=>{
 for(const change of [
  rows=>rows.pop(),rows=>rows[1].runs.pop(),rows=>{rows[1].runs[19].run=1;},
  rows=>{rows[1].runs[19].activation.done=false;},
  rows=>{rows[1].runs[19].activation.hosts=99;},
  rows=>{rows[1].runs[19].activation.responded=99;},
  rows=>{rows[1].runs[19].activation.active=99;},
  rows=>{rows[1].runs[19].activation.lastResponseMs=601;},
  rows=>{rows[1].runs[19].activation.errors=['application error'];},
  rows=>{rows[1].runs[19].activation.longTasks=[{startTime:150,duration:1}];},
  rows=>{rows[1].runs[19].activation.longTasks=[{startTime:150,duration:57}];},
  rows=>{rows[1].runs[19].lighthouse.trace.data='broken';},
 ]){const rows=campaign();change(rows);assert.throws(()=>validateMobile(finalizeMobileAttribution(rows)));}
 const forged=finalizeMobileAttribution(campaign());forged[1].runs[19].activation.done=false;
 assert.throws(()=>validateMobile(forged),/attribution differs/);
});
test('a single application task, whole-page TBT and the original paired negative controls remain blocking',()=>{
 const rows=campaign(),run=rows[1].runs[19],trace=decodeMobileTrace(run.lighthouse.trace);
 trace.traceEvents.find(e=>e.name==='UnlistedBrowserWork').args={stackTrace:[{scriptId:'5',url:'http://fixture.invalid/app.js'}]};
 run.lighthouse=traceMeasurement(JSON.parse(run.lighthouse.rawLhr),trace);
 assert.throws(()=>validateMobile(finalizeMobileAttribution(rows)),/over50ms/);
 const slow=campaign();for(const run of slow[0].runs){const lhr=JSON.parse(run.lighthouse.rawLhr);lhr.audits['total-blocking-time'].numericValue=200;run.lighthouse=traceMeasurement(lhr,decodeMobileTrace(run.lighthouse.trace));}slow[0].p95TbtMs=200;
 assert.throws(()=>finalizeMobileAttribution(slow),/TBT/);
 assert.deepEqual(validateMobileControls(controlObservations()),{deadActivationRefused:true,longTaskRefused:true});
});
