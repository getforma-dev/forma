import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attributeMobileTasks} from './release-performance-attribution.mjs';

// A reduced actual native trace, not a new measurement or acceptance record.
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/parser-resource-trace.json',import.meta.url),'utf8'));
const kinds=({lhr,trace})=>attributeMobileTasks(lhr,trace).tasks.map(e=>e.kind);
const named=(events,name)=>events.find(e=>e.name===name);
const image=events=>events.find(e=>e.name==='ResourceSendRequest' && e.args.data.resourceType==='Image');
const stylesheet=events=>events.find(e=>e.name==='ResourceSendRequest' && e.args.data.resourceType==='Stylesheet');
const addWork=(events,name,task)=>events.push({...structuredClone(task),name,ts:task.ts+1,dur:1});

test('native stylesheet and isolated SVG ancestry prove only the three retained pre-script tasks',()=>{
 assert.deepEqual(kinds(fixture()),['pre-application-parser-stylesheet','pre-application-svg-image','pre-application-browser-layout']);
 const value=fixture(),raw=JSON.stringify(value);
 attributeMobileTasks(value.lhr,value.trace);
 assert.equal(JSON.stringify(value),raw,'classification must not rewrite raw costs or evidence');
});

test('stylesheet exclusion requires complete parser resource identity and ordering',()=>{
 const changes=[
  es=>{stylesheet(es).args.data.initiator.type='script';},
  es=>{stylesheet(es).args.data.initiator.url='http://other.invalid/';},
  es=>{stylesheet(es).args.data.frame='foreign';},
  es=>{stylesheet(es).args.data.requestMethod='POST';},
  es=>{stylesheet(es).args.data.resourceType='Script';},
  es=>{stylesheet(es).args.data.url+='changed';},
  es=>es.push(structuredClone(stylesheet(es))),
  es=>{named(es,'ResourceReceiveResponse').args.data.requestId='other';},
  es=>{named(es,'ResourceReceiveResponse').args.data.fromServiceWorker=true;},
  es=>{named(es,'ResourceReceiveResponse').args.data.mimeType='unknown';},
  es=>{named(es,'ResourceReceivedData').args.data.frame='foreign';},
  es=>{named(es,'ResourceFinish').args.data.didFail=true;},
  es=>{named(es,'ResourceFinish').ts=named(es,'ParseAuthorStyleSheet').ts;},
  es=>{named(es,'ParseAuthorStyleSheet').args.data.styleSheetUrl='http://other.invalid/app.css';},
  es=>{named(es,'ParseAuthorStyleSheet').cat='unknown';},
  es=>{named(es,'ParseAuthorStyleSheet').dur=1000000;},
  es=>es.splice(es.indexOf(named(es,'ResourceReceivedData')),1),
  ...['FunctionCall','EvaluateScript','RunMicrotasks','UnknownBrowserWork'].map(name=>es=>addWork(es,name,named(es,'RunTask'))),
 ];
 for(const [i,change] of changes.entries()){
  const value=fixture();change(value.trace.traceEvents);
  assert.equal(kinds(value)[0],'application-or-unattributed',`stylesheet refusal ${i}`);
 }
});

test('SVG resource proof requires its unique blank frame, causal flows and later exact paint bridge',()=>{
 const changes=[
  es=>{image(es).args.data.initiator.type='script';},
  es=>{image(es).args.data.frame='foreign';},
  es=>{image(es).args.data.url+='changed';},
  es=>es.push(structuredClone(image(es))),
  es=>{es.filter(e=>e.name==='ResourceFinish')[1].args.data.requestId='other';},
  es=>{named(es,'FrameLoader:state_snapshot').args.snapshot.documentLoaderURL='http://other.invalid/';},
  es=>{named(es,'FrameLoader:state_snapshot').args.snapshot.frame.id_ref='foreign';},
  es=>{named(es,'DocumentLoader::InitializeWindow').ts--;},
  es=>{named(es,'DecodedDataDocumentParser::AppendBytes').ts=named(es,'DocumentLoader::CommitNavigation').ts;},
  es=>{named(es,'EventDispatch').args.data.type='click';},
  es=>{const flow=es.find(e=>e.ph==='f');flow.id++;},
  es=>{const flow=es.find(e=>e.ph==='f');flow.ts++;},
  es=>es.splice(es.findIndex(e=>e.ph==='s'),1),
  es=>es.push({...structuredClone(named(es,'FrameCommittedInBrowser')),args:{data:{frame:named(es,'FrameLoader:state_snapshot').args.snapshot.frame.id_ref}}}),
  es=>es.splice(es.indexOf(named(es,'PaintImage')),1),
  es=>es.push(structuredClone(named(es,'PaintImage'))),
  es=>{named(es,'PaintImage').args.data.url+='changed';},
  es=>{named(es,'PaintImage').args.data.frame='foreign';},
  es=>{named(es,'PaintImage').args.data.isCSS=true;},
  es=>{named(es,'PaintImage').args.data.nodeId=0;},
  es=>{named(es,'PaintImage').args.data.width++;},
  es=>{named(es,'PaintImage').dur=1;},
  es=>{es.find(e=>e.name==='DOMStats' && e.args.data.maxDepth.nodeName==='svg').args.data.maxDepth.nodeName='html';},
  es=>{es.find(e=>e.name==='PrePaint' && e.args.data.frame!==named(es,'PaintImage').args.data.frame).cat='unknown';},
  ...['FunctionCall','EvaluateScript','RunMicrotasks','UnknownBrowserWork'].flatMap(name=>[
   es=>addWork(es,name,es.filter(e=>e.name==='RunTask')[1]),
   es=>addWork(es,name,es.filter(e=>e.name==='RunTask')[2]),
  ]),
 ];
 for(const [i,change] of changes.entries()){
  const value=fixture();change(value.trace.traceEvents);
  assert.deepEqual(kinds(value).slice(1),['application-or-unattributed','application-or-unattributed'],`SVG refusal ${i}`);
 }
});

test('native resource categories cannot bypass application boundary or navigation proof',()=>{
 for(const change of [
  es=>{named(es,'v8.compileModule').ts=named(es,'RunTask').ts-1;},
  es=>es.splice(es.indexOf(named(es,'v8.compileModule')),1),
  es=>es.push({...structuredClone(named(es,'navigationStart')),ts:named(es,'RunTask').ts-1}),
  es=>{named(es,'FrameCommittedInBrowser').ts=es.find(e=>e.name==='PaintImage').ts+1000000;},
 ]){
  const value=fixture();change(value.trace.traceEvents);
  assert.deepEqual(kinds(value),Array(3).fill('application-or-unattributed'));
 }
});
