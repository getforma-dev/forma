// Attribute only positively proved browser work outside N3's island-activation
// boundary. Full raw traces and Lighthouse tasks remain in DS12. Unknown/mixed
// tasks count.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {MOBILE_STARTUP_POLICY} from './release-performance-spec.mjs';

export const MOBILE_TRACE_MAX_BYTES = 32 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const size = n => Number.isSafeInteger(n) && n > 0 && n <= MOBILE_TRACE_MAX_BYTES;
const nonnegative = n => Number.isFinite(n) && n >= 0;

export function encodeMobileTrace(trace) {
  const bytes = Buffer.from(JSON.stringify(trace));
  assert(size(bytes.length), 'N3: raw trace exceeds byte limit');
  const compressed = gzipSync(bytes);
  assert(size(compressed.length), 'N3: compressed trace exceeds byte limit');
  return {encoding:'gzip-base64',bytes:bytes.length,sha256:hash(bytes),compressedBytes:compressed.length,compressedSha256:hash(compressed),data:compressed.toString('base64')};
}
export function decodeMobileTrace(record) {
  assert.equal(record?.encoding,'gzip-base64','N3: unknown trace encoding');
  assert(size(record.bytes) && size(record.compressedBytes),'N3: trace byte limit');
  assert(typeof record.data === 'string' && record.data.length <= 4*Math.ceil(MOBILE_TRACE_MAX_BYTES/3),'N3: encoded trace byte limit');
  assert(record.data.length%4===0 && !/[^A-Za-z0-9+/=]/.test(record.data),'N3: invalid trace base64');
  const compressed = Buffer.from(record.data,'base64');
  assert.equal(compressed.toString('base64'),record.data,'N3: noncanonical trace base64');
  assert.equal(compressed.length,record.compressedBytes,'N3: compressed trace length differs');
  assert.equal(hash(compressed),record.compressedSha256,'N3: compressed trace digest differs');
  // The synchronous validators retain their API. zlib enforces the bound during
  // decompression, before returning an expanded buffer or parsing JSON.
  const bytes = gunzipSync(compressed,{maxOutputLength:record.bytes});
  assert.equal(bytes.length,record.bytes,'N3: raw trace length differs');
  assert.equal(hash(bytes),record.sha256,'N3: raw trace digest differs');
  return JSON.parse(bytes.toString('utf8'));
}

const browserEvents = new Set([
  'BeginMainThreadFrame','EventDispatch','UpdateLayoutTree','InvalidateLayout',
  'WebDXFeatureUsage','Layout','viewport','SetLayerTreeId','PrePaint','DOMStats',
  'Paint','PaintTimingVisualizer::LayoutObjectPainted','PaintTimingVisualizer::Viewport',
  'Layerize','Layer:created','Commit','UpdateLayer','BeginCommitCompositorFrame',
  'AnimationFrame','AnimationFrame::Render','AnimationFrame::StyleAndLayout',
  'LayoutImageUnsized','ResourceChangePriority',
]);
// ScriptCatchup is retrospective source metadata, not execution. It is still
// unknown inside a candidate layout task and therefore prevents exclusion there.
const scriptEvent = e => !(e.name==='ScriptCatchup' && ['disabled-by-default-devtools.v8-source-rundown','disabled-by-default-devtools.v8-source-rundown-sources'].includes(e.cat)) && /script|compile|evaluate|functioncall|microtask/i.test(e.name);
// BeginMainThreadFrame uses a numeric compositor sequence, not a Page.FrameId.
// Exempt only that exact native shape; every document-frame field still matches.
const nativeMainThreadFrame = e => e.cat==='disabled-by-default-devtools.timeline.frame' && e.ph==='I' && e.dur===undefined && Number.isSafeInteger(e.args?.data?.frameId) && e.args.data.frameId>=0 && Number.isSafeInteger(e.args?.layerTreeId) && e.args.layerTreeId>0;
const refs = (e,ignoreFrameId=false) => [e.args?.frame,e.args?.data?.frame,e.args?.data?.frameID,ignoreFrameId?undefined:e.args?.data?.frameId,e.args?.beginData?.frame,e.args?.data?.page].filter(x=>x!==undefined);

// These are the exact pinned Lighthouse/Puppeteer new-document scripts seen
// while Chromium creates the main-world context. ScriptCatchup serializes
// source metadata after compilation/instantiation; it is not application
// execution. Refuse any other rundown identity or source.
const auditBootstrapSources = new Map([
  ['pptr:internal',{length:27,sha256:'ee9da969a7a2f2f13930e866b09a9fea9529059d805e93b5fd6728463b0b8212'}],
  ['_lighthouse-eval.js',{length:708,sha256:'5d99559fa67d22b55a4200ca6ffb88ac517672457647b82dd902d04efbdeb8ce'}],
]);
const navigationComplete = new Map([
  ['DocumentLoader::DocumentLoader','loading'],
  ['DocumentLoader::CommitNavigation','loading'],
  ['DocumentLoader::InitializeWindow','loading'],
  ['BackForwardCacheBufferLimitTracker::DidRemoveFrameOrWorkerFromBackForwardCache','loading'],
  ['DocumentLoader::RecordUseCountersForCommit','loading'],
  ['DocumentLoader::DidInstallNewDocument','loading'],
  ['DocumentLoader::DidCommitNavigation','loading'],
  ['DocumentLoader::StartLoadingResponse','loading'],
  ['DocumentLoader::CreateParserPostCommit','loading'],
  ['NavigationBodyLoader::StartLoadingBody','loading'],
  ['NavigationBodyLoader::OnReadable','loading'],
  ['NavigationBodyLoader::ReadFromDataPipe','loading'],
  ['DocumentLoader::BodyDataReceivedImpl','loading'],
  ['DocumentLoader::HandleData','loading'],
  ['DocumentLoader::CommitData','loading'],
  ['DecodedDataDocumentParser::AppendBytes','loading'],
  ['HTMLDocumentParser::MaybeFetchQueuedPreloads','blink,devtools.timeline'],
  ['LocalWindowProxy::Initialize','v8'],
  ['LocalWindowProxy::CreateContext','v8'],
  ['V8.DeserializeContext','v8'],
  ['LocalWindowProxy::SetupWindowPrototypeChain','v8'],
  ['LocalWindowProxy::UpdateDocumentProperty','v8'],
  ['ContextCreatedNotification','v8'],
  ['InstallConditionalFeatures','v8'],
  ['v8.newInstance','v8'],
  ['CommitLoad','devtools.timeline'],
  ['EventDispatch','devtools.timeline'],
]);
const navigationInstant = new Map([
  ['FrameStartedLoading','devtools.timeline'],
  ['markAsMainFrame','loading'],
  ['ResourceSendRequest','devtools.timeline'],
  ['ResourceReceiveResponse','devtools.timeline'],
  ['FrameLoader:state_snapshot','loading'],
  ['InvalidateLayout','disabled-by-default-devtools.timeline'],
  ['WebDXFeatureUsage','blink.webdx_feature_usage'],
  ['ResourceReceivedData','devtools.timeline'],
  ['PreloadRenderBlockingStatusChange','devtools.timeline'],
  ['MetaCharsetCheck','devtools.timeline'],
]);
const navigationMarks = new Map([
  ['unloadEventStart','blink.user_timing'],
  ['unloadEventEnd','blink.user_timing'],
  ['commitNavigationEnd','blink.user_timing'],
  ['responseEnd','blink.user_timing'],
  ['domLoading','blink.user_timing,rail'],
]);
const flowNames = new Set([...navigationComplete.keys()].filter(name=>name.startsWith('DocumentLoader::') || name==='HTMLDocumentParser::MaybeFetchQueuedPreloads').concat('FrameLoader:state_snapshot'));
const sameOrigin = (left,right) => {try{return new URL(left).origin===new URL(right).origin;}catch{return false;}};
const eventInside = (event,task,end) => event.ts>=task.ts && event.ts<end && (event.dur===undefined || event.ph==='X' && event.ts+event.dur<=end);
const exactBootstrapRundown = children => {
  const metadata=children.filter(e=>e.name==='ScriptCatchup' && e.cat==='disabled-by-default-devtools.v8-source-rundown');
  const sources=children.filter(e=>e.name==='ScriptCatchup' && e.cat==='disabled-by-default-devtools.v8-source-rundown-sources');
  if(metadata.length!==auditBootstrapSources.size || sources.length!==auditBootstrapSources.size)return false;
  const seen=new Set();
  for(const event of metadata){
    const data=event.args?.data,expected=auditBootstrapSources.get(data?.sourceUrl);
    if(!expected || event.ph!=='X' || !nonnegative(event.dur) || data.url!=='' || data.hasSourceUrl!==true || data.isModule!==false || typeof data.isolate!=='string' || !data.isolate || !Number.isSafeInteger(data.scriptId) || !Number.isSafeInteger(data.executionContextId) || seen.has(data.sourceUrl))return false;
    const matching=sources.filter(source=>source.ph==='X' && nonnegative(source.dur) && source.args?.data?.isolate===data.isolate && source.args?.data?.scriptId===data.scriptId);
    if(matching.length!==1)return false;
    const source=matching[0].args.data;
    if(source.length!==expected.length || typeof source.sourceText!=='string' || Buffer.byteLength(source.sourceText)!==expected.length || hash(Buffer.from(source.sourceText))!==expected.sha256)return false;
    seen.add(data.sourceUrl);
  }
  return seen.size===auditBootstrapSources.size;
};
const exactNavigationBootstrap = ({children,thread,task,end,frame,navigationId,url,firstScriptUs}) => {
  if(firstScriptUs===null || end>firstScriptUs || children.length===0 || children.some(scriptEvent))return false;
  const complete=children.filter(e=>e.ph==='X' && navigationComplete.get(e.name)===e.cat);
  for(const event of children){
    if(!eventInside(event,task,end) || refs(event).some(ref=>ref!==frame))return false;
    if(event.name==='ScriptCatchup')continue;
    if(event.ph==='X'){
      if(navigationComplete.get(event.name)!==event.cat || !nonnegative(event.dur))return false;
    }else if(event.ph==='I'){
      if(navigationInstant.get(event.name)!==event.cat || event.dur!==undefined)return false;
    }else if(event.ph==='R'){
      if(navigationMarks.get(event.name)!==event.cat || event.dur!==undefined)return false;
    }else if(['s','f'].includes(event.ph)){
      // Flow records are causal metadata and may cross task boundaries. They do
      // not need a paired span here; only exact loader/parser names are admitted.
      if(event.cat!=='loading' && event.cat!=='blink,devtools.timeline' || event.dur!==undefined || !flowNames.has(event.name))return false;
    }else return false;
    if(event.name==='EventDispatch' && (!['pagehide','visibilitychange','webkitvisibilitychange','unload'].includes(event.args?.data?.type) || event.dur>1000 || !Number.isSafeInteger(event.args.data.sampleTraceId) || event.args.data.sampleTraceId<=0))return false;
    if(event.name==='WebDXFeatureUsage' && event.args?.scriptId!==-1)return false;
    if(event.name.startsWith('LocalWindowProxy::') || ['ContextCreatedNotification','InstallConditionalFeatures'].includes(event.name)){
      if(event.args?.IsMainFrame!==true || event.args.IsOutermostMainFrame!==undefined && event.args.IsOutermostMainFrame!==true)return false;
    }
    if(event.name.startsWith('NavigationBodyLoader::') && event.args?.url!==url)return false;
    if(event.name==='FrameLoader:state_snapshot' && event.ph==='I'){
      const snapshot=event.args?.snapshot;
      if(snapshot?.documentLoaderURL!==url || snapshot.frame?.id_ref!==frame || snapshot.isLoadingMainFrame!==true || snapshot.isOutermostMainFrame!==true)return false;
    }
    if(event.name==='CommitLoad'){
      const data=event.args?.data;
      if(data?.frame!==frame || data.page!==frame || data.url!==url || data.isMainFrame!==true || data.isOutermostMainFrame!==true)return false;
    }
  }
  for(const name of ['DocumentLoader::CommitNavigation','DocumentLoader::CreateParserPostCommit','DocumentLoader::BodyDataReceivedImpl','DecodedDataDocumentParser::AppendBytes','CommitLoad'])if(complete.filter(event=>event.name===name).length!==1)return false;
  if(!complete.some(event=>event.name==='LocalWindowProxy::Initialize') || children.filter(event=>event.name==='FrameStartedLoading').length!==1)return false;
  const sends=children.filter(e=>e.name==='ResourceSendRequest'),ids=sends.map(e=>e.args?.data?.requestId);
  if(ids.some(id=>typeof id!=='string' || !id) || new Set(ids).size!==ids.length)return false;
  const documents=sends.filter(e=>e.args.data.resourceType==='Document');
  if(documents.length!==1 || documents[0].args.data.requestId!==navigationId || documents[0].args.data.url!==url || documents[0].args.data.frame!==frame || documents[0].args.data.requestMethod!=='GET' || documents[0].args.data.initiator!==undefined)return false;
  const responses=children.filter(e=>e.name==='ResourceReceiveResponse');
  if(responses.length!==1 || responses[0].args?.data?.requestId!==navigationId || responses[0].args.data.frame!==frame || responses[0].args.data.statusCode!==200 || responses[0].args.data.mimeType!=='text/html' || responses[0].args.data.fromCache!==false || responses[0].args.data.fromServiceWorker!==false)return false;
  const received=children.filter(e=>e.name==='ResourceReceivedData');
  if(received.length!==1 || received[0].args?.data?.requestId!==navigationId || received[0].args.data.frame!==frame || !Number.isSafeInteger(received[0].args.data.encodedDataLength) || received[0].args.data.encodedDataLength<=0)return false;
  const firstScript=thread.filter(e=>e.ts===firstScriptUs && scriptEvent(e));
  const firstScriptUrls=new Set(firstScript.map(e=>e.args?.data?.url ?? e.args?.fileName).filter(Boolean));
  const subresources=sends.filter(e=>e.args.data.resourceType!=='Document');
  if(subresources.length===0 || subresources.some(e=>!['Stylesheet','Script','Image'].includes(e.args.data.resourceType) || e.args.data.frame!==frame || e.args.data.requestMethod!=='GET' || e.args.data.initiator?.type!=='parser' || e.args.data.initiator.url!==url || !sameOrigin(e.args.data.url,url)))return false;
  const scripts=sends.filter(e=>e.args.data.resourceType==='Script');
  if(scripts.length!==1 || scripts[0].args.data.isLinkPreload!==true || !firstScriptUrls.has(scripts[0].args.data.url))return false;
  const preload=children.filter(e=>e.name==='PreloadRenderBlockingStatusChange');
  if(preload.length!==1 || preload[0].args?.data?.requestId!==scripts[0].args.data.requestId || preload[0].args.data.url!==scripts[0].args.data.url)return false;
  return exactBootstrapRundown(children);
};
const excludedKinds = new Set(['pre-application-browser-layout','pre-application-navigation-audit-bootstrap']);

export function attributeMobileTasks(lhr,trace) {
  const events = trace?.traceEvents;
  assert(Array.isArray(events) && events.length>0,'N3: complete raw trace absent');
  for(const e of events)assert(e && typeof e.name==='string' && typeof e.ph==='string' && nonnegative(e.ts) && Number.isInteger(e.pid) && Number.isInteger(e.tid) && (e.dur===undefined || nonnegative(e.dur)),'N3: malformed raw trace event');
  const origin = lhr.audits?.metrics?.details?.items?.[0]?.observedTimeOriginTs;
  assert(nonnegative(origin) && typeof lhr.requestedUrl==='string','N3: trace/LHR navigation identity absent');
  const navs = events.filter(e=>e.name==='navigationStart' && e.ts===origin && e.args?.data?.documentLoaderURL===lhr.requestedUrl && e.args?.data?.isOutermostMainFrame===true);
  assert.equal(navs.length,1,'N3: ambiguous trace/LHR navigation identity');
  const nav=navs[0],frame=nav.args?.frame,navigationId=nav.args?.data?.navigationId;
  assert(typeof frame==='string' && frame.length>0 && typeof navigationId==='string' && navigationId.length>0,'N3: navigation frame absent');
  const commits=events.filter(e=>e.name==='FrameCommittedInBrowser' && e.ts>=origin && e.args?.data?.frame===frame && e.args?.data?.processId===nav.pid && e.args?.data?.url===lhr.requestedUrl && e.args?.data?.isOutermostMainFrame===true);
  assert(commits.length>0,'N3: committed renderer identity absent');
  const thread=events.map((e,index)=>({...e,index})).filter(e=>e.pid===nav.pid && e.tid===nav.tid);
  const tasks=thread.filter(e=>e.name==='RunTask' && e.ph==='X' && e.dur>0);
  const scripts=thread.filter(e=>e.ts>=origin && scriptEvent(e));
  const firstScriptUs=scripts.length?Math.min(...scripts.map(e=>e.ts)):null;
  const rows=lhr.audits?.['long-tasks']?.details?.items;
  assert(Array.isArray(rows),'N3: raw Lighthouse tasks absent');
  const classified=rows.map((row,index)=>{
    assert(nonnegative(row.startTime) && nonnegative(row.duration),'N3: malformed Lighthouse task');
    const matches=tasks.filter(t=>Math.abs((t.ts-origin)/1000-row.startTime)<.002 && Math.abs(t.dur/1000-row.duration)<.002);
    let reason='unmatched-or-ambiguous-task',kind='application-or-unattributed',traceIndex=null;
    if(matches.length===1){
      const task=matches[0],end=task.ts+task.dur;traceIndex=task.index;
      reason='not-proven-pre-application-browser-work';
      // No later valid navigation may have reused this renderer before the task ends.
      // Chromium marks empty documentLoaderURL navigationStart events as ignorable.
      const anotherNavigation=thread.some(e=>e.name==='navigationStart' && e.ts>origin && e.ts<end && e.args?.data?.documentLoaderURL!=='');
      const children=thread.filter(e=>e.index!==task.index && (e.ts>=task.ts && e.ts<end || e.dur>0 && e.ts<task.ts && e.ts+e.dur>task.ts));
      const pure=children.length>0 && children.every(e=>{
        const mainThreadFrame=e.name==='BeginMainThreadFrame';
        if(mainThreadFrame && !nativeMainThreadFrame(e))return false;
        if(!browserEvents.has(e.name) || refs(e,mainThreadFrame).some(f=>f!==frame))return false;
        if(e.dur!==undefined && (e.ph!=='X' || e.ts<task.ts || e.ts+e.dur>end))return false;
        if(e.name==='LayoutImageUnsized' && (e.cat!=='devtools.timeline' || e.ph!=='I' || e.args?.data?.frameId!==frame || !Number.isInteger(e.args?.data?.nodeId) || e.args.data.nodeId<=0))return false;
        if(e.name==='ResourceChangePriority'){
          const data=e.args?.data,requestId=data?.requestId;
          if(e.cat!=='devtools.timeline' || e.ph!=='X' || !nonnegative(e.dur) || typeof requestId!=='string' || !requestId || !['VeryLow','Low','Medium','High','VeryHigh'].includes(data.priority))return false;
          const sends=thread.filter(candidate=>candidate.name==='ResourceSendRequest' && candidate.ts>=origin && candidate.ts<=e.ts && candidate.args?.data?.requestId===requestId);
          if(sends.length!==1)return false;
          const send=sends[0];
          if(send.cat!=='devtools.timeline' || send.ph!=='I' || send.dur!==undefined || send.args.data.frame!==frame || send.args.data.resourceType!=='Image' || send.args.data.initiator?.type!=='parser' || send.args.data.initiator.url!==lhr.requestedUrl)return false;
        }
        if(e.name==='EventDispatch' && !['resize','pagereveal'].includes(e.args?.data?.type))return false;
        if(e.name==='WebDXFeatureUsage' && e.args?.scriptId!==-1)return false;
        return true;
      });
      const layout=children.some(e=>e.name==='Layout' && e.ph==='X' && e.dur>0 && e.args?.beginData?.frame===frame);
      // Require an observed later script boundary: lack of instrumentation is
      // never proof that no application code ran. Preserve the whole task cost.
      if(firstScriptUs!==null && end<=firstScriptUs && task.ts>=origin && commits.some(e=>e.ts<=task.ts) && !anotherNavigation && pure && layout){kind='pre-application-browser-layout';reason='same-navigation-pure-layout-before-first-script';}
      else if(task.ts>=origin && commits.some(e=>e.ts<=task.ts) && !anotherNavigation && exactNavigationBootstrap({children,thread,task,end,frame,navigationId,url:lhr.requestedUrl,firstScriptUs})){kind='pre-application-navigation-audit-bootstrap';reason='same-navigation-document-commit-before-application-script';}
    }
    return {index,startTime:row.startTime,duration:row.duration,kind,reason,traceIndex};
  });
  return {policy:MOBILE_STARTUP_POLICY.id,pid:nav.pid,tid:nav.tid,frame,navigationId,originUs:origin,firstScriptUs,tasks:classified};
}

export function summarizeMobileStartup(runs) {
  const runMaximaMs=runs.map(run=>{
    const lhr=JSON.parse(run.lighthouse.rawLhr);
    const attribution=attributeMobileTasks(lhr,decodeMobileTrace(run.lighthouse.trace));
    assert.deepEqual(run.lighthouse.attribution,attribution,'N3: task attribution differs from raw trace');
    const tasks=[...attribution.tasks.filter(t=>!excludedKinds.has(t.kind)),...run.activation.longTasks];
    tasks.forEach(t=>assert(nonnegative(t.duration) && nonnegative(t.startTime),'N3: invalid startup task'));
    return Math.max(0,...tasks.map(t=>t.duration));
  });
  assert(runMaximaMs.length>0);
  const sorted=[...runMaximaMs].sort((a,b)=>a-b);
  return {policy:{...MOBILE_STARTUP_POLICY},runMaximaMs,p95MaxTaskMs:sorted[Math.ceil(sorted.length*.95)-1],maxTaskMs:Math.max(...runMaximaMs),targetMiss:runMaximaMs.some(n=>n>MOBILE_STARTUP_POLICY.targetMs),wholePageTargetMiss:runs.some(run=>[...run.lighthouse.longTasks,...run.activation.longTasks].some(t=>t.duration>MOBILE_STARTUP_POLICY.targetMs))};
}
