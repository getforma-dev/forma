import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {attributeMobileTasks,encodeMobileTrace,decodeMobileTrace,summarizeMobileStartup,MOBILE_TRACE_MAX_BYTES} from './release-performance-attribution.mjs';
import {validateMobile,validateMobileControls} from './release-performance-contract.mjs';
import {mobile,controlObservations} from './release-performance-test-fixtures.mjs';
import {traceFixture,traceMeasurement} from './release-performance-trace-fixtures.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const kind=(lhr,trace)=>attributeMobileTasks(lhr,trace).tasks[0].kind;
const pptrSource='//# sourceURL=pptr:internal';
// Actual pinned Lighthouse13.5.0 wrapper from the retained cc0 run17 trace.
const idleCheckSource=readFileSync(new URL('./fixtures/lighthouse-idle-check.txt',import.meta.url),'utf8');
const lighthouseSource=['(() => {','      const Promise = globalThis.__nativePromise || globalThis.Promise;','const URL = globalThis.__nativeURL || globalThis.URL;','const performance = globalThis.__nativePerformance || globalThis.performance;','const fetch = globalThis.__nativeFetch || globalThis.fetch;','      ','      ;','      (() => {','      window.__nativePromise = window.Promise;','      window.__nativeURL = window.URL;','      window.__nativePerformance = window.performance;','      window.__nativeFetch = window.fetch;','      window.__ElementMatches = window.Element.prototype.matches;','      window.__HTMLElementBoundingClientRect = window.HTMLElement.prototype.getBoundingClientRect;','    })();','    })()','    //# sourceURL=_lighthouse-eval.js'].join('\n');
function navigationFixture(){
 const origin=1000000,frame='test-frame',url='http://fixture.invalid/',navigationId='document-request';
 const event=(name,offset,{ph='I',dur,cat='loading',args={}}={})=>({name,ph,pid:10,tid:20,ts:origin+offset*1000,...dur===undefined?{}:{dur:dur*1000},cat,args});
 const rundown=(sourceUrl,scriptId,executionContextId,sourceText)=>[
  event('ScriptCatchup',125+scriptId,{ph:'X',dur:.1,cat:'disabled-by-default-devtools.v8-source-rundown',args:{data:{executionContextId,hasSourceUrl:true,isModule:false,isolate:'test-isolate',scriptId,sourceUrl,url:''}}}),
  event('ScriptCatchup',126+scriptId,{ph:'X',dur:.1,cat:'disabled-by-default-devtools.v8-source-rundown-sources',args:{data:{isolate:'test-isolate',length:sourceText.length,scriptId,sourceText}}}),
 ];
 const trace={traceEvents:[
  event('navigationStart',0,{ph:'R',args:{frame,data:{documentLoaderURL:url,isOutermostMainFrame:true,navigationId}}}),
  {...event('FrameCommittedInBrowser',99,{args:{data:{frame,isOutermostMainFrame:true,processId:10,url}}}),pid:1,tid:2},
  event('RunTask',100,{ph:'X',dur:150,cat:'disabled-by-default-devtools.timeline'}),
  event('FrameStartedLoading',101,{cat:'devtools.timeline',args:{frame}}),
  event('EventDispatch',101.1,{ph:'X',dur:.1,cat:'devtools.timeline',args:{data:{sampleTraceId:1,type:'pagehide'}}}),
  event('unloadEventStart',101.3,{ph:'R',cat:'blink.user_timing',args:{frame}}),
  event('unloadEventEnd',101.4,{ph:'R',cat:'blink.user_timing',args:{frame}}),
  event('markAsMainFrame',101.5,{args:{frame}}),
  event('ResourceSendRequest',102,{cat:'devtools.timeline',args:{data:{frame,requestId:navigationId,requestMethod:'GET',resourceType:'Document',url}}}),
  event('ResourceReceiveResponse',103,{cat:'devtools.timeline',args:{data:{frame,fromCache:false,fromServiceWorker:false,mimeType:'text/html',requestId:navigationId,statusCode:200}}}),
  event('FrameLoader:state_snapshot',103.5,{args:{snapshot:{documentLoaderURL:url,frame:{id_ref:frame},isLoadingMainFrame:true,isOutermostMainFrame:true}}}),
  event('DocumentLoader::CommitNavigation',104,{ph:'X',dur:70}),
  event('DocumentLoader::CommitNavigation',104,{ph:'s'}),
  event('DocumentLoader::CommitNavigation',104.1,{ph:'f'}),
  event('CommitLoad',106,{ph:'X',dur:.1,cat:'devtools.timeline',args:{data:{frame,isMainFrame:true,isOutermostMainFrame:true,page:frame,url}}}),
  event('DocumentLoader::CreateParserPostCommit',110,{ph:'X',dur:60}),
  event('LocalWindowProxy::Initialize',112,{ph:'X',dur:25,cat:'v8',args:{IsMainFrame:true,IsOutermostMainFrame:true}}),
  ...rundown('pptr:internal',3,2,pptrSource),
  ...rundown('_lighthouse-eval.js',4,1,lighthouseSource),
  event('v8.newInstance',135,{ph:'X',dur:.01,cat:'v8'}),
  event('NavigationBodyLoader::StartLoadingBody',140,{ph:'X',dur:25,args:{url}}),
  event('NavigationBodyLoader::OnReadable',140.1,{ph:'X',dur:24.8,args:{url}}),
  event('NavigationBodyLoader::ReadFromDataPipe',140.2,{ph:'X',dur:24.7,args:{url}}),
  event('DocumentLoader::BodyDataReceivedImpl',140.3,{ph:'X',dur:24.5}),
  event('ResourceReceivedData',141,{cat:'devtools.timeline',args:{data:{encodedDataLength:3398,frame,requestId:navigationId}}}),
  event('DocumentLoader::HandleData',141.5,{ph:'X',dur:23}),
  event('DocumentLoader::CommitData',141.6,{ph:'X',dur:22.8}),
  event('DecodedDataDocumentParser::AppendBytes',142,{ph:'X',dur:20}),
  event('HTMLDocumentParser::MaybeFetchQueuedPreloads',145,{ph:'X',dur:10,cat:'blink,devtools.timeline'}),
  event('ResourceSendRequest',150,{cat:'devtools.timeline',args:{data:{frame,initiator:{type:'parser',url},isLinkPreload:true,requestId:'script-request',requestMethod:'GET',resourceType:'Script',url:`${url}app.js`}}}),
  event('ResourceSendRequest',151,{cat:'devtools.timeline',args:{data:{frame,initiator:{type:'parser',url},isLinkPreload:false,requestId:'style-request',requestMethod:'GET',resourceType:'Stylesheet',url:`${url}app.css`}}}),
  event('PreloadRenderBlockingStatusChange',152,{cat:'devtools.timeline',args:{data:{requestId:'script-request',url:`${url}app.js`}}}),
  event('MetaCharsetCheck',153,{cat:'devtools.timeline'}),
  event('v8.compileModule',300,{ph:'X',dur:1,cat:'v8,devtools.timeline',args:{data:{url:`${url}app.js`},fileName:`${url}app.js`}}),
 ]};
 const lhr={requestedUrl:url,audits:{metrics:{details:{items:[{observedTimeOriginTs:origin}]}},'long-tasks':{details:{items:[{duration:150,startTime:100}]}}}};
 return {lhr,trace};
}

function idleCheckFixture(){
 const {lhr,trace}=navigationFixture(),events=trace.traceEvents;
 const origin=events[0].ts,frame=events[0].args.frame,url=lhr.requestedUrl,start=origin+7000000;
 const compile=events.find(e=>e.name==='v8.compileModule');compile.args.data.scriptId=5;
 const event=(name,offset,dur,cat,args,ph='X')=>({name,ph,pid:10,tid:20,ts:start+offset,...dur===undefined?{}:{dur},cat,args});
 events.push({...event('ScriptCatchup',-6699000,4,'disabled-by-default-devtools.v8-source-rundown',{data:{executionContextId:1,hasSourceUrl:false,isModule:true,isolate:'test-isolate',scriptId:5,url:`${url}app.js`}})});
 events.push(
  event('RunTask',0,90745,'disabled-by-default-devtools.timeline',{}),
  event('EvaluateScript',6469,82442,'disabled-by-default-devtools.timeline',{}),
  event('ScriptCatchup',57892,718,'disabled-by-default-devtools.v8-source-rundown',{data:{executionContextId:4,hasSourceUrl:true,isModule:false,isolate:'test-isolate',scriptId:10,sourceUrl:'_lighthouse-eval.js',url:''}}),
  event('ScriptCatchup',58661,212,'disabled-by-default-devtools.v8-source-rundown-sources',{data:{isolate:'test-isolate',length:2573,scriptId:10,sourceText:idleCheckSource}}),
  event('RunMicrotasks',73929,12791,'v8.execute',{microtask_count:2}),
  {...event('TimerInstall',79234,undefined,'devtools.timeline',{data:{frame,sampleTraceId:1,singleShot:true,timeout:150,timerId:4,stackTrace:[['',26,5],['checkTimeSinceLastLongTaskInPage',22,10],['',40,3],['',41,7]].map(([functionName,lineNumber,columnNumber])=>({functionName,lineNumber,columnNumber,scriptId:'10',url:'_lighthouse-eval.js'}))}},'I'),s:'t'},
 );
 lhr.audits['long-tasks'].details.items=[{startTime:7000,duration:90.745}];
 const defaults=traceFixture().lhr;
 Object.assign(lhr,{lighthouseVersion:defaults.lighthouseVersion,configSettings:defaults.configSettings,environment:defaults.environment});
 lhr.audits['total-blocking-time']=defaults.audits['total-blocking-time'];
 lhr.audits['largest-contentful-paint']=defaults.audits['largest-contentful-paint'];
 lhr.audits['long-tasks'].details.type='table';
 return {lhr,trace};
}

test('only exact isolated pinned Lighthouse idle checks are excluded, independently of time',()=>{
 const exact=idleCheckFixture();assert.equal(kind(exact.lhr,exact.trace),'isolated-lighthouse-idle-check');
 const mainSource=exact.trace.traceEvents.find(e=>e.args?.data?.sourceText===lighthouseSource);
 mainSource.ph='I';mainSource.s='t';delete mainSource.dur;
 assert.equal(kind(exact.lhr,exact.trace),'isolated-lighthouse-idle-check');
 mainSource.s='g';assert.equal(kind(exact.lhr,exact.trace),'application-or-unattributed');
 const named=(events,name)=>events.find(e=>e.name===name);
 const idleMeta=events=>events.find(e=>e.name==='ScriptCatchup' && e.cat.endsWith('v8-source-rundown') && e.args.data.scriptId===10);
 const idleSource=events=>events.find(e=>e.name==='ScriptCatchup' && e.cat.endsWith('v8-source-rundown-sources') && e.args.data.scriptId===10);
 const module=events=>events.find(e=>e.name==='ScriptCatchup' && e.args?.data?.isModule===true);
 for(const change of [
  events=>events.push({...structuredClone(named(events,'TimerInstall')),name:'FunctionCall'}),
  events=>events.push({...structuredClone(named(events,'TimerInstall')),name:'UnknownAuditWork'}),
  events=>events.push(structuredClone(named(events,'RunMicrotasks'))),
  events=>events.splice(events.indexOf(named(events,'RunMicrotasks')),1),
  events=>{named(events,'RunMicrotasks').args.microtask_count=3;},
  events=>{named(events,'RunMicrotasks').ts=named(events,'EvaluateScript').ts-1;},
  events=>{named(events,'EvaluateScript').args.data={url:'http://fixture.invalid/app.js'};},
  events=>{named(events,'TimerInstall').args.data.frame='foreign-frame';},
  events=>{named(events,'TimerInstall').args.data.timeout=151;},
  events=>{named(events,'TimerInstall').args.data.singleShot=false;},
  events=>{named(events,'TimerInstall').args.data.sampleTraceId=0;},
  events=>{named(events,'TimerInstall').args.data.timerId=0;},
  events=>{named(events,'TimerInstall').ts=named(events,'RunMicrotasks').ts-1;},
  events=>{named(events,'TimerInstall').args.data.stackTrace[0].scriptId='11';},
  events=>{named(events,'TimerInstall').args.data.stackTrace[1].functionName='applicationCallback';},
  events=>{named(events,'TimerInstall').args.data.stackTrace[1].lineNumber++;},
  events=>{named(events,'TimerInstall').args.data.stackTrace[0].url='http://fixture.invalid/app.js';},
  events=>{named(events,'TimerInstall').args.data.stackTrace.pop();},
  events=>{idleMeta(events).args.data.executionContextId=1;},
  events=>{idleMeta(events).args.data.executionContextId=0;},
  events=>{idleMeta(events).args.data.sourceUrl='another-audit.js';},
  events=>{idleMeta(events).args.data.isolate='unbound-isolate';},
  events=>{idleSource(events).args.data.scriptId=11;},
  events=>{idleSource(events).args.data.sourceText=idleCheckSource.replace('firstAttemptTs','otherAttemptTs');},
  events=>{idleSource(events).args.data.length++;},
  events=>{idleSource(events).ts=idleMeta(events).ts;},
  events=>events.push({...structuredClone(idleMeta(events)),ts:idleMeta(events).ts-200000}),
  events=>{module(events).args.data.executionContextId=4;},
  events=>{module(events).args.data.frame='foreign-frame';},
  events=>events.splice(events.indexOf(module(events)),1),
  events=>events.push(structuredClone(named(events,'v8.compileModule'))),
  events=>{named(events,'v8.compileModule').args.data.scriptId=99;},
  events=>{const main=events.find(e=>e.name==='ScriptCatchup' && e.args?.data?.sourceText===lighthouseSource);main.args.data.sourceText+=' ';main.args.data.length++;},
  events=>events.push({...structuredClone(events[0]),ts:named(events,'EvaluateScript').ts-1}),
 ]){
  const {lhr,trace}=idleCheckFixture();change(trace.traceEvents);assert.equal(kind(lhr,trace),'application-or-unattributed');
 }
});

test('proven audit exclusion retains all raw costs and the independent57ms refusal',()=>{
 const rows=mobile();
 for(const row of rows){
  for(const run of row.runs){const {lhr,trace}=idleCheckFixture();run.lighthouse=traceMeasurement(lhr,trace);}
  row.startup=summarizeMobileStartup(row.runs);
 }
 validateMobile(rows);
 assert.equal(rows[0].startup.maxTaskMs,0);
 assert.equal(rows[0].startup.wholePageTargetMiss,true);
 assert.equal(rows[0].runs[0].lighthouse.longTasks[0].duration,90.745);
 rows[0].runs[0].activation.longTasks=[{startTime:100,duration:57}];
 rows[0].startup=summarizeMobileStartup(rows[0].runs);
 assert.equal(rows[0].startup.maxTaskMs,57);
 assert.throws(()=>validateMobile(rows),/over50ms/);
});

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
 // A late task without exact audit source/context proof still counts in full.
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
  {kind:'application-or-unattributed',reason:'not-proven-pre-application-browser-work',matched:true},
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
test('only exact pre-application document commit and pinned audit bootstrap are excluded',()=>{
 const fixture=()=>navigationFixture();
 assert.equal(kind(fixture().lhr,fixture().trace),'pre-application-navigation-audit-bootstrap');
 const named=(events,name)=>events.find(event=>event.name===name);
 const edit=change=>{const {lhr,trace}=fixture();change(trace.traceEvents);return kind(lhr,trace);};
 for(const change of [
  events=>events.push({...structuredClone(named(events,'CommitLoad')),name:'FunctionCall'}),
  events=>events.push({...structuredClone(named(events,'CommitLoad')),name:'UnknownNavigationWork'}),
  events=>{named(events,'EventDispatch').args.data.type='click';},
  events=>{named(events,'EventDispatch').dur=1001;},
  events=>{delete named(events,'EventDispatch').args.data.sampleTraceId;},
  events=>{named(events,'ResourceSendRequest').args.data.frame='other-frame';},
  events=>events.push(structuredClone(named(events,'ResourceSendRequest'))),
  events=>{named(events,'ResourceReceiveResponse').args.data.requestId='other-request';},
  events=>{named(events,'ResourceReceiveResponse').args.data.fromCache=true;},
  events=>{named(events,'ResourceReceiveResponse').ts=named(events,'ResourceSendRequest').ts-1;},
  events=>{named(events,'DocumentLoader::CommitNavigation').ts=named(events,'ResourceReceiveResponse').ts-1;},
  events=>{named(events,'ResourceReceivedData').args.data.encodedDataLength=0;},
  events=>{named(events,'ResourceReceivedData').ts=named(events,'DocumentLoader::BodyDataReceivedImpl').ts+named(events,'DocumentLoader::BodyDataReceivedImpl').dur+1;},
  events=>{events.find(event=>event.name==='ResourceSendRequest' && event.args.data.resourceType==='Script').args.data.initiator.url='http://other.invalid/';},
  events=>{events.find(event=>event.name==='ResourceSendRequest' && event.args.data.resourceType==='Script').args.data.url='http://other.invalid/app.js';},
  events=>{events.find(event=>event.name==='ResourceSendRequest' && event.args.data.resourceType==='Script').args.data.isLinkPreload=false;},
  events=>{named(events,'PreloadRenderBlockingStatusChange').args.data.requestId='other-request';},
  events=>{named(events,'CommitLoad').args.data.url='http://other.invalid/';},
  events=>{named(events,'CommitLoad').ts=named(events,'DocumentLoader::CommitNavigation').ts-1;},
  events=>events.splice(events.indexOf(named(events,'CommitLoad')),1),
  events=>events.push(structuredClone(named(events,'CommitLoad'))),
  events=>events.splice(events.indexOf(named(events,'DocumentLoader::CreateParserPostCommit')),1),
  events=>{named(events,'DocumentLoader::CreateParserPostCommit').ts=named(events,'DocumentLoader::CommitNavigation').ts+named(events,'DocumentLoader::CommitNavigation').dur;},
  events=>events.splice(events.indexOf(named(events,'DocumentLoader::BodyDataReceivedImpl')),1),
  events=>{named(events,'NavigationBodyLoader::StartLoadingBody').ts=named(events,'DocumentLoader::CreateParserPostCommit').ts+named(events,'DocumentLoader::CreateParserPostCommit').dur;},
  events=>events.splice(events.indexOf(named(events,'DecodedDataDocumentParser::AppendBytes')),1),
  events=>{named(events,'DecodedDataDocumentParser::AppendBytes').ts=named(events,'DocumentLoader::BodyDataReceivedImpl').ts+named(events,'DocumentLoader::BodyDataReceivedImpl').dur-1;},
  events=>{named(events,'LocalWindowProxy::Initialize').args.IsMainFrame=false;},
  events=>{named(events,'LocalWindowProxy::Initialize').ts=named(events,'DocumentLoader::CreateParserPostCommit').ts+named(events,'DocumentLoader::CreateParserPostCommit').dur;},
  events=>{named(events,'NavigationBodyLoader::StartLoadingBody').args.url='http://other.invalid/';},
  events=>{named(events,'FrameLoader:state_snapshot').args.snapshot.frame.id_ref='other-frame';},
  events=>{const event=events.find(item=>item.name==='ScriptCatchup' && item.cat.endsWith('v8-source-rundown'));event.args.data.sourceUrl='unknown.js';},
  events=>{const event=events.find(item=>item.name==='ScriptCatchup' && item.cat.endsWith('v8-source-rundown'));event.args.data.scriptId=0;},
  events=>{const event=events.find(item=>item.name==='ScriptCatchup' && item.cat.endsWith('v8-source-rundown'));event.args.data.executionContextId=0;},
  events=>{const event=events.find(item=>item.name==='ScriptCatchup' && item.cat.endsWith('v8-source-rundown-sources'));event.args.data.scriptId=0;},
  events=>{const event=events.find(item=>item.name==='ScriptCatchup');event.ts=named(events,'LocalWindowProxy::Initialize').ts+named(events,'LocalWindowProxy::Initialize').dur+1;},
  events=>{const event=events.find(item=>item.name==='ScriptCatchup' && item.cat.endsWith('v8-source-rundown-sources'));event.args.data.sourceText+=' ';event.args.data.length++;},
  events=>{const event=events.find(item=>item.name==='ScriptCatchup');event.ph='I';delete event.dur;},
  events=>{named(events,'DocumentLoader::CommitNavigation').dur=200000;},
  events=>{events.find(event=>event.name==='ResourceSendRequest' && event.args.data.resourceType==='Script').ts=named(events,'DecodedDataDocumentParser::AppendBytes').ts+named(events,'DecodedDataDocumentParser::AppendBytes').dur+1;},
  events=>{named(events,'v8.compileModule').ts=events.find(event=>event.name==='RunTask').ts+1000;},
  events=>events.push({...structuredClone(events[0]),ts:events.find(event=>event.name==='RunTask').ts+1000}),
 ])assert.equal(edit(change),'application-or-unattributed');
});
test('native BeginMainThreadFrame sequence is not mistaken for a document frame',()=>{
 const fixture=()=>traceFixture({duration:60,scriptAt:200,mainThreadFrame:true});
 const exact=fixture();
 assert.equal(kind(exact.lhr,exact.trace),'pre-application-browser-layout');
 const edit=change=>{const {lhr,trace}=fixture();change(trace.traceEvents.find(event=>event.name==='BeginMainThreadFrame'),trace.traceEvents);return kind(lhr,trace);};
 for(const change of [
  event=>{delete event.args.data.frameId;},
  event=>{event.args.data.frameId=-1;},
  event=>{event.args.data.frameId=.5;},
  event=>{event.args.data.frameId='0';},
  event=>{event.args.data.frameId=Number.MAX_SAFE_INTEGER+1;},
  event=>{delete event.args.layerTreeId;},
  event=>{event.args.layerTreeId=0;},
  event=>{event.args.layerTreeId='1';},
  event=>{event.cat='devtools.timeline';},
  event=>{event.ph='X';},
  event=>{event.dur=0;},
  event=>{event.args.data.frame='other-frame';},
  (_event,events)=>events.push({...structuredClone(events.find(event=>event.name==='Layout')),name:'FunctionCall'}),
 ])assert.equal(edit(change),'application-or-unattributed');
 const postScript=traceFixture({duration:60,scriptAt:50,mainThreadFrame:true});
 assert.equal(kind(postScript.lhr,postScript.trace),'application-or-unattributed');
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
 assert.equal(rows[0].startup.policy.id,'N3-startup-strict50-v3');
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
 const v2=withDurations(Array(20).fill(50));
 for(const row of v2){row.startup.policy.id='N3-startup-strict50-v2';for(const run of row.runs)run.lighthouse.attribution.policy='N3-startup-strict50-v2';}
 assert.throws(()=>validateMobile(v2),/attribution differs/);
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
