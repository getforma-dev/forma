import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attributeMobileTasks} from './release-performance-attribution.mjs';
import {traceFixture} from './release-performance-trace-fixtures.mjs';

// Invented trace records for controls, not measurement evidence. These exact
// pinned bootstrap bodies are already used by the native navigation proof.
const pptrSource='//# sourceURL=pptr:internal';
const lighthouseSource=['(() => {','      const Promise = globalThis.__nativePromise || globalThis.Promise;','const URL = globalThis.__nativeURL || globalThis.URL;','const performance = globalThis.__nativePerformance || globalThis.performance;','const fetch = globalThis.__nativeFetch || globalThis.fetch;','      ','      ;','      (() => {','      window.__nativePromise = window.Promise;','      window.__nativeURL = window.URL;','      window.__nativePerformance = window.performance;','      window.__nativeFetch = window.fetch;','      window.__ElementMatches = window.Element.prototype.matches;','      window.__HTMLElementBoundingClientRect = window.HTMLElement.prototype.getBoundingClientRect;','    })();','    })()','    //# sourceURL=_lighthouse-eval.js'].join('\n');
function fixture({bootstrap=true}={}){
 const {lhr,trace}=traceFixture({duration:60,startTime:100,scriptAt:300});
 const events=trace.traceEvents,origin=events[0].ts,frame=events[0].args.frame,url=lhr.requestedUrl;
 const event=(name,ms,cat,args,ph='X',dur=.1)=>({name,ts:origin+ms*1000,pid:10,tid:20,ph,...ph==='X'?{dur:dur*1000}:{},cat,args});
 events.find(e=>e.name==='Layout').name='NativeWorkWithoutFeatureAllowlist';
 events.push(
  event('ResourceSendRequest',103,'devtools.timeline',{data:{frame,resourceType:'Document',url}},'I'),
  event('CommitLoad',104,'devtools.timeline',{data:{frame,page:frame,url}}),
  event('NavigationBodyLoader::ReadFromDataPipe',105,'loading',{url}),
  event('ResourceSendRequest',150,'devtools.timeline',{data:{frame,resourceType:'Script',url:`${url}app.js`,initiator:{type:'parser',url}}},'I'),
  event('v8.compileModule',300,'v8,devtools.timeline',{data:{scriptId:5,url:`${url}app.js`}}),
  event('ScriptCatchup',302,'disabled-by-default-devtools.v8-source-rundown',{data:{isolate:'isolate',scriptId:5,executionContextId:1,isModule:true,url:`${url}app.js`}}));
 if(bootstrap)for(const [sourceUrl,scriptId,executionContextId,sourceText] of [['pptr:internal',8,2,pptrSource],['_lighthouse-eval.js',9,1,lighthouseSource]])events.push(
  event('ScriptCatchup',110+scriptId,'disabled-by-default-devtools.v8-source-rundown',{data:{isolate:'isolate',scriptId,executionContextId,isModule:false,hasSourceUrl:true,url:'',sourceUrl}}),
  event('ScriptCatchup',111+scriptId,'disabled-by-default-devtools.v8-source-rundown-sources',{data:{isolate:'isolate',scriptId,length:sourceText.length,sourceText}}));
 return {lhr,trace};
}
const classify=f=>attributeMobileTasks(f.lhr,f.trace,{correlated:true}).tasks[0];
const request=f=>f.trace.traceEvents.find(e=>e.args?.data?.resourceType==='Script');
const metadata=(f,id=9)=>f.trace.traceEvents.find(e=>e.name==='ScriptCatchup' && e.args?.data?.scriptId===id && e.args.data.sourceUrl);
const source=(f,id=9)=>f.trace.traceEvents.find(e=>e.args?.data?.scriptId===id && e.args.data.sourceText);
test('document and parser request URLs are metadata, while nested initiator execution remains blocking',()=>{
 const f=fixture({bootstrap:false});
 assert.equal(classify(f).kind,'browser-internal-unattributed');
 request(f).args.data.initiator.stack={callFrames:[{scriptId:'5',url:`${f.lhr.requestedUrl}app.js`}]};
 assert.equal(classify(f).kind,'application-or-unattributed');
});
test('only exact pinned bootstrap rundown pairs avoid inference of application execution',()=>{
 const f=fixture();
 assert.equal(classify(f).kind,'browser-internal-unattributed');
 assert.equal(attributeMobileTasks(f.lhr,f.trace).tasks[0].kind,'application-or-unattributed','campaign corroboration remains required');
 const instant=source(f);instant.ph='I';instant.s='t';delete instant.dur;
 assert.equal(classify(f).kind,'browser-internal-unattributed');
});
test('unknown inline, mismatched bootstrap sources and ambiguous metadata remain blocking',()=>{
 for(const change of [
  f=>{source(f).args.data.sourceText+=' ';},
  f=>{source(f).args.data.length++;},
  f=>{metadata(f).args.data.sourceUrl='unknown-inline.js';},
  f=>{metadata(f).args.data.hasSourceUrl=false;},
  f=>{metadata(f).args.data.isModule=true;},
  f=>{source(f).args.data.scriptId=404;},
  f=>{source(f).ts=metadata(f).ts-1;},
  f=>{const s=source(f);s.ph='I';s.s='g';delete s.dur;},
  f=>{f.trace.traceEvents.push(structuredClone(source(f)));},
  f=>{source(f,8).args.data.sourceText='x'.repeat(pptrSource.length);},
  f=>{metadata(f).args.data.frame='foreign';},
  f=>{metadata(f).args.data.stackTrace=[{scriptId:'5',url:''}];},
  f=>{source(f).args.data.stackTrace=[{scriptId:'404',url:''}];},
  f=>{source(f).args.data.url=`${f.lhr.requestedUrl}app.js`;},
  f=>{source(f).args.data.sourceUrl='unknown-inline.js';},
  f=>{request(f).args.data.initiator.stack={callFrames:[{url:'http://unknown.invalid/code.js',functionName:'unknown'}]};},
  f=>{const e=metadata(f);e.args.data.url='';delete e.args.data.sourceUrl;delete e.args.data.hasSourceUrl;},
 ]){const f=fixture();change(f);assert.equal(classify(f).kind,'application-or-unattributed');}
});
test('pinned bootstrap source identity does not exempt real execution in the task',()=>{
 for(const id of [8,9,404]){
  const f=fixture(),e=structuredClone(metadata(f));
  Object.assign(e,{name:'FunctionCall',cat:'devtools.timeline'});e.args={data:{scriptId:id,url:''}};f.trace.traceEvents.push(e);
  assert.equal(classify(f).kind,'application-or-unattributed');
 }
 const f=fixture(),e=structuredClone(metadata(f));e.name='EvaluateScript';e.args={data:{url:'http://unknown.invalid/code.js'}};f.trace.traceEvents.push(e);
 assert.equal(classify(f).kind,'application-or-unattributed');
});
