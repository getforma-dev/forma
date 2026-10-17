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
const taskChildren = (thread,task) => thread.filter(e=>e.index!==task.index && (e.ts>=task.ts && e.ts<task.ts+task.dur || e.dur>0 && e.ts<task.ts && e.ts+e.dur>task.ts));
const only = (events,predicate) => {const found=events.filter(predicate);return found.length===1?found[0]:null;};
const instant = (e,cat) => e?.cat===cat && e.ph==='I' && e.dur===undefined;
const complete = (e,cat) => e?.cat===cat && e.ph==='X' && nonnegative(e.dur);
const positiveInteger = n => Number.isSafeInteger(n) && n>0;
const frameRefs = e => [...refs(e),e.args?.snapshot?.frame?.id_ref].filter(x=>x!==undefined);

// Native parser subresources need a complete identity chain. A URL, event name
// or position before script execution alone never proves the work's origin.
const parserResource = ({children,thread,origin,frame,url,type,mime}) => {
  const response=only(children,e=>e.name==='ResourceReceiveResponse');
  const data=only(children,e=>e.name==='ResourceReceivedData');
  const finish=only(children,e=>e.name==='ResourceFinish');
  const id=response?.args?.data?.requestId;
  if(typeof id!=='string' || !id || !instant(response,'devtools.timeline') || !instant(data,'devtools.timeline') || !instant(finish,'devtools.timeline'))return null;
  const send=only(thread,e=>e.name==='ResourceSendRequest' && e.args?.data?.requestId===id);
  if(!instant(send,'devtools.timeline') || send.ts<origin || !(send.ts<response.ts && response.ts<data.ts && data.ts<finish.ts))return null;
  const request=send.args.data,received=response.args.data,bytes=data.args?.data,ended=finish.args?.data;
  if(request.frame!==frame || request.requestMethod!=='GET' || request.resourceType!==type || request.initiator?.type!=='parser' || request.initiator.url!==url || !sameOrigin(request.url,url))return null;
  if(received.frame!==frame || received.mimeType!==mime || received.statusCode!==200 || received.fromCache!==false || received.fromServiceWorker!==false)return null;
  if(bytes?.frame!==frame || bytes.requestId!==id || !positiveInteger(bytes.encodedDataLength) || ended?.requestId!==id || ended.didFail!==false || !positiveInteger(ended.decodedBodyLength) || !positiveInteger(ended.encodedDataLength))return null;
  // Duplicate delivery identities anywhere in the navigation are ambiguous.
  if(['ResourceReceiveResponse','ResourceReceivedData','ResourceFinish'].some(name=>thread.filter(e=>e.name===name && e.args?.data?.requestId===id).length!==1))return null;
  return {send,response,data,finish,url:request.url};
};
const exactParserStylesheet = context => {
  const {children,task,end,frame}=context,resource=parserResource({...context,type:'Stylesheet',mime:'text/css'});
  const parse=only(children,e=>e.name==='ParseAuthorStyleSheet');
  return !!resource && children.length===4 && children.every(e=>eventInside(e,task,end) && frameRefs(e).every(ref=>ref===frame)) && complete(parse,'blink,devtools.timeline') && parse.args?.data?.styleSheetUrl===resource.url && resource.data.ts<parse.ts && parse.ts+parse.dur<resource.finish.ts;
};

// Chromium156 SVGImage::DataChanged creates a script-disabled, nonordinary
// document with a blank URL. Admit it only when a later PaintImage for the same
// parser resource contains that exact internal frame's lifecycle. The bridge
// is mandatory; an arbitrary blank frame is not an image-document exemption.
const svgComplete = new Map([
  ['DocumentLoader::DocumentLoader','loading'],['DocumentLoader::CommitNavigation','loading'],
  ['DocumentLoader::InitializeWindow','loading'],['DocumentLoader::RecordUseCountersForCommit','loading'],
  ['DocumentLoader::DidInstallNewDocument','loading'],['DocumentLoader::DidCommitNavigation','loading'],
  ['DocumentLoader::StartLoadingResponse','loading'],['DocumentLoader::FinishedLoading','loading'],
  ['DecodedDataDocumentParser::AppendBytes','loading'],['EventDispatch','devtools.timeline'],
  ['UpdateLayoutTree','blink,devtools.timeline'],['Layout','devtools.timeline'],
]);
const svgInstant = new Map([
  ['ResourceReceiveResponse','devtools.timeline'],['ResourceReceivedData','devtools.timeline'],['ResourceFinish','devtools.timeline'],
  ['FrameLoader:created','loading'],['FrameLoader:state_snapshot','loading'],
  ['ScheduleStyleRecalculation','disabled-by-default-devtools.timeline'],['InvalidateLayout','disabled-by-default-devtools.timeline'],
  ['MetaCharsetCheck','devtools.timeline'],['MarkDOMContent','devtools.timeline'],['MarkLoad','devtools.timeline'],
]);
const svgMarks = new Map([
  ['navigationStart','blink.user_timing'],['responseEnd','blink.user_timing'],['loadEventStart','blink.user_timing'],['loadEventEnd','blink.user_timing'],
  ...['domLoading','domComplete','domInteractive','domContentLoadedEventStart','domContentLoadedEventEnd'].map(name=>[name,'blink.user_timing,rail']),
]);
const svgFlowTargets = new Map([
  ['FrameLoader:created','FrameLoader:state_snapshot'],['FrameLoader:state_snapshot','FrameLoader:state_snapshot'],
  ['DocumentLoader::DocumentLoader','DocumentLoader::CommitNavigation'],['DocumentLoader::CommitNavigation','DocumentLoader::InitializeWindow'],
  ['DocumentLoader::InitializeWindow','DocumentLoader::RecordUseCountersForCommit'],['DocumentLoader::RecordUseCountersForCommit','DocumentLoader::DidInstallNewDocument'],
  ['DocumentLoader::DidInstallNewDocument','DocumentLoader::StartLoadingResponse'],['DocumentLoader::StartLoadingResponse','DocumentLoader::FinishedLoading'],
]);
const exactSvgLoad = context => {
  const {children,thread,events,task,end,frame}=context,resource=parserResource({...context,type:'Image',mime:'image/svg+xml'});
  const created=only(children,e=>e.name==='FrameLoader:created' && e.ph==='I');
  const snapshots=children.filter(e=>e.name==='FrameLoader:state_snapshot' && e.ph==='I').sort((a,b)=>a.ts-b.ts);
  const internal=snapshots[0]?.args?.snapshot?.frame?.id_ref;
  if(!resource || typeof internal!=='string' || !internal || internal===frame || !created || snapshots.length!==3 || !(resource.data.ts<created.ts && created.ts<snapshots[0].ts))return null;
  if(events.some(e=>e.name==='FrameCommittedInBrowser' && e.args?.data?.frame===internal))return null;
  if(snapshots.some(e=>e.args.snapshot.documentLoaderURL!=='' || e.args.snapshot.frame?.id_ref!==internal || e.args.snapshot.isLoadingMainFrame!==true || e.args.snapshot.isOutermostMainFrame!==true))return null;
  const flow=children.filter(e=>['s','f'].includes(e.ph));
  const primary=children.filter(e=>!['s','f'].includes(e.ph));
  for(const e of primary){
    if(!eventInside(e,task,end) || scriptEvent(e))return null;
    const known=e.ph==='X' ? svgComplete.has(e.name) && complete(e,svgComplete.get(e.name))
      : e.ph==='I' ? svgInstant.has(e.name) && instant(e,svgInstant.get(e.name))
      : e.ph==='R' && svgMarks.has(e.name) && e.cat===svgMarks.get(e.name) && e.dur===undefined;
    if(!known)return null;
    const expected=e.name.startsWith('Resource')?frame:internal;
    if(frameRefs(e).some(ref=>ref!==expected))return null;
    if(e.name==='EventDispatch' && (!['readystatechange','DOMContentLoaded','load','pageshow'].includes(e.args?.data?.type) || !positiveInteger(e.args?.data?.sampleTraceId)))return null;
    if(['MarkDOMContent','MarkLoad'].includes(e.name) && (e.args?.data?.frame!==internal || e.args.data.page!==internal || e.args.data.isMainFrame!==true || e.args.data.isOutermostMainFrame!==true))return null;
  }
  const one=name=>only(primary,e=>e.name===name);
  const nav=one('navigationStart'),loader=one('DocumentLoader::DocumentLoader'),commit=one('DocumentLoader::CommitNavigation'),init=one('DocumentLoader::InitializeWindow');
  const record=one('DocumentLoader::RecordUseCountersForCommit'),install=one('DocumentLoader::DidInstallNewDocument'),didCommit=one('DocumentLoader::DidCommitNavigation'),start=one('DocumentLoader::StartLoadingResponse'),finished=one('DocumentLoader::FinishedLoading');
  const append=one('DecodedDataDocumentParser::AppendBytes'),style=one('UpdateLayoutTree'),layout=one('Layout');
  if(!nav || nav.args?.frame!==internal || nav.args.data?.documentLoaderURL!=='' || nav.args.data.isLoadingMainFrame!==true || nav.args.data.isOutermostMainFrame!==true || typeof nav.args.data.navigationId!=='string' || !nav.args.data.navigationId || !loader || !commit || !init || !record || !install || !didCommit || !start || !finished || !append || !style || !layout)return null;
  if(!(snapshots[0].ts<loader.ts && insideSpan(nav,loader) && loader.ts+loader.dur<snapshots[1].ts && snapshots[1].ts<commit.ts && [init,record,install,didCommit,start].every(e=>insideSpan(e,commit)) && init.ts+init.dur<=record.ts && record.ts+record.dur<=install.ts && install.ts+install.dur<=didCommit.ts && didCommit.ts+didCommit.dur<=start.ts && insideSpan(finished,start) && finished.ts+finished.dur<snapshots[2].ts && snapshots[2].ts<append.ts && append.ts+append.dur<style.ts && style.ts+style.dur<layout.ts && layout.ts+layout.dur<resource.finish.ts))return null;
  if(style.args?.beginData?.frame!==internal || layout.args?.beginData?.frame!==internal)return null;
  const ids=new Set(flow.map(e=>e.id));
  if(flow.length!==18 || ids.size!==9)return null;
  for(const id of ids){
    const pair=flow.filter(e=>e.id===id),from=only(pair,e=>e.ph==='s'),to=only(pair,e=>e.ph==='f');
    if(!Number.isSafeInteger(id) || id<0 || !from || !to || from.name!==to.name || from.cat!=='loading' || to.cat!=='loading' || from.dur!==undefined || to.dur!==undefined || !(from.ts<to.ts) || !eventInside(from,task,end) || !eventInside(to,task,end) || frameRefs(from).length || frameRefs(to).length)return null;
    if(!svgFlowTargets.has(from.name) || !only(primary,e=>e.name===from.name && e.ts===from.ts) || !only(primary,e=>e.name===svgFlowTargets.get(from.name) && e.ts===to.ts))return null;
  }
  return {resource,internal,task};
};
const exactSvgPaint = (proof,thread,firstScriptUs) => {
  const paint=only(thread,e=>e.name==='PaintImage' && e.args?.data?.url===proof.resource.url && e.ts>=proof.task.ts && e.ts<firstScriptUs);
  const data=paint?.args?.data;
  if(!complete(paint,'disabled-by-default-devtools.timeline') || paint.ts<proof.resource.finish.ts || paint.ts+paint.dur>firstScriptUs || data?.frame!==proof.resource.send.args.data.frame || data.isCSS!==false || data.isPicture!==false || !positiveInteger(data.nodeId) || ![data.width,data.height,data.srcWidth,data.srcHeight].every(n=>Number.isFinite(n) && n>0))return null;
  const internal=thread.filter(e=>e.ts>=proof.task.ts+proof.task.dur && e.ts<firstScriptUs && frameRefs(e).includes(proof.internal));
  if(internal.length===0 || internal.some(e=>!eventInside(e,paint,paint.ts+paint.dur)))return null;
  const layout=only(internal,e=>e.name==='Layout'),prepaint=only(internal,e=>e.name==='PrePaint'),viewport=only(internal,e=>e.name==='viewport'),stats=only(internal,e=>e.name==='DOMStats');
  if(!complete(layout,'devtools.timeline') || !complete(prepaint,'devtools.timeline') || !instant(viewport,'loading') || !instant(stats,'disabled-by-default-devtools.timeline') || viewport.args?.data?.width!==data.width || viewport.args.data.height!==data.height || stats.args?.data?.maxDepth?.nodeName!=='svg' || stats.args.data.maxChildren?.nodeName!=='svg' || !positiveInteger(stats.args.data.totalElements))return null;
  return {...proof,paint};
};
const pureLayoutChildren = (children,thread,task,frame,origin,url,svg=null) => children.length>0 && children.every(e=>{
  const mainThreadFrame=e.name==='BeginMainThreadFrame';
  if(mainThreadFrame && !nativeMainThreadFrame(e))return false;
  if(svg && e.index===svg.paint.index)return true;
  const internal=svg && frameRefs(e).includes(svg.internal);
  const expected=internal?svg.internal:frame;
  if(internal && (!eventInside(e,svg.paint,svg.paint.ts+svg.paint.dur) || !['InvalidateLayout','viewport','Layout','SetLayerTreeId','PrePaint','DOMStats'].includes(e.name)))return false;
  if(internal){
    const valid=e.name==='Layout' || e.name==='PrePaint' ? complete(e,'devtools.timeline')
      : instant(e,e.name==='viewport'?'loading':'disabled-by-default-devtools.timeline');
    if(!valid || e.name==='PrePaint' && (e.args?.data?.isMainFrame!==true || e.args.data.isOutermostMainFrame!==true || e.args.data.page!==svg.internal))return false;
  }
  if(!browserEvents.has(e.name) || refs(e,mainThreadFrame).some(f=>f!==expected))return false;
  if(e.dur!==undefined && (e.ph!=='X' || e.ts<task.ts || e.ts+e.dur>task.ts+task.dur))return false;
  if(e.name==='LayoutImageUnsized' && (e.cat!=='devtools.timeline' || e.ph!=='I' || e.args?.data?.frameId!==frame || !Number.isInteger(e.args?.data?.nodeId) || e.args.data.nodeId<=0))return false;
  if(e.name==='ResourceChangePriority'){
    const data=e.args?.data,requestId=data?.requestId;
    if(e.cat!=='devtools.timeline' || e.ph!=='X' || !nonnegative(e.dur) || typeof requestId!=='string' || !requestId || !['VeryLow','Low','Medium','High','VeryHigh'].includes(data.priority))return false;
    const sends=thread.filter(candidate=>candidate.name==='ResourceSendRequest' && candidate.ts>=origin && candidate.ts<=e.ts && candidate.args?.data?.requestId===requestId);
    if(sends.length!==1)return false;
    const send=sends[0];
    if(send.cat!=='devtools.timeline' || send.ph!=='I' || send.dur!==undefined || send.args.data.frame!==frame || send.args.data.resourceType!=='Image' || send.args.data.initiator?.type!=='parser' || send.args.data.initiator.url!==url)return false;
  }
  if(e.name==='EventDispatch' && !['resize','pagereveal'].includes(e.args?.data?.type))return false;
  if(e.name==='WebDXFeatureUsage' && e.args?.scriptId!==-1)return false;
  return true;
});
const exactBootstrapRundown = children => {
  const metadata=children.filter(e=>e.name==='ScriptCatchup' && e.cat==='disabled-by-default-devtools.v8-source-rundown');
  const sources=children.filter(e=>e.name==='ScriptCatchup' && e.cat==='disabled-by-default-devtools.v8-source-rundown-sources');
  if(metadata.length!==auditBootstrapSources.size || sources.length!==auditBootstrapSources.size)return false;
  const seen=new Set();
  for(const event of metadata){
    const data=event.args?.data,expected=auditBootstrapSources.get(data?.sourceUrl);
    if(!expected || event.ph!=='X' || !nonnegative(event.dur) || data.url!=='' || data.hasSourceUrl!==true || data.isModule!==false || typeof data.isolate!=='string' || !data.isolate || !Number.isSafeInteger(data.scriptId) || data.scriptId<=0 || !Number.isSafeInteger(data.executionContextId) || data.executionContextId<=0 || seen.has(data.sourceUrl))return false;
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
    // Duration does not establish lifecycle origin. The complete navigation
    // proof below and absence of execution/unknown children establish it.
    if(event.name==='EventDispatch' && (!['pagehide','visibilitychange','webkitvisibilitychange','unload'].includes(event.args?.data?.type) || !Number.isSafeInteger(event.args.data.sampleTraceId) || event.args.data.sampleTraceId<=0))return false;
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
  const one=name=>{const matches=complete.filter(event=>event.name===name);return matches.length===1?matches[0]:null;};
  const inside=(child,parent)=>child && parent && child.ts>=parent.ts && child.ts+(child.dur??0)<=parent.ts+parent.dur;
  // Chromium's DocumentLoader commit creates the document, parser and window.
  // Require that exact causal nesting; trace flows remain metadata only.
  const commit=one('DocumentLoader::CommitNavigation'),commitLoad=one('CommitLoad'),parser=one('DocumentLoader::CreateParserPostCommit');
  const bodyStart=one('NavigationBodyLoader::StartLoadingBody'),bodyReadable=one('NavigationBodyLoader::OnReadable'),bodyPipe=one('NavigationBodyLoader::ReadFromDataPipe'),body=one('DocumentLoader::BodyDataReceivedImpl'),handle=one('DocumentLoader::HandleData'),commitData=one('DocumentLoader::CommitData'),append=one('DecodedDataDocumentParser::AppendBytes'),preloads=one('HTMLDocumentParser::MaybeFetchQueuedPreloads');
  const contexts=complete.filter(event=>event.cat==='v8'),initializers=contexts.filter(event=>event.name==='LocalWindowProxy::Initialize');
  if(!inside(commitLoad,commit) || !inside(parser,commit) || !contexts.length || !contexts.every(event=>inside(event,commit)) || !initializers.some(event=>inside(event,parser)))return false;
  if(!inside(bodyStart,parser) || !inside(bodyReadable,bodyStart) || !inside(bodyPipe,bodyReadable) || !inside(body,bodyPipe) || !inside(handle,body) || !inside(commitData,handle) || !inside(append,commitData) || !inside(preloads,append))return false;
  const rundown=children.filter(event=>event.name==='ScriptCatchup');
  if(rundown.some(event=>!initializers.some(context=>inside(event,context))) || children.filter(event=>event.name==='FrameStartedLoading').length!==1)return false;
  const sends=children.filter(e=>e.name==='ResourceSendRequest'),ids=sends.map(e=>e.args?.data?.requestId);
  if(ids.some(id=>typeof id!=='string' || !id) || new Set(ids).size!==ids.length)return false;
  const documents=sends.filter(e=>e.args.data.resourceType==='Document');
  if(documents.length!==1 || documents[0].args.data.requestId!==navigationId || documents[0].args.data.url!==url || documents[0].args.data.frame!==frame || documents[0].args.data.requestMethod!=='GET' || documents[0].args.data.initiator!==undefined)return false;
  const responses=children.filter(e=>e.name==='ResourceReceiveResponse');
  if(responses.length!==1 || responses[0].args?.data?.requestId!==navigationId || responses[0].args.data.frame!==frame || responses[0].args.data.statusCode!==200 || responses[0].args.data.mimeType!=='text/html' || responses[0].args.data.fromCache!==false || responses[0].args.data.fromServiceWorker!==false)return false;
  if(!(documents[0].ts<responses[0].ts && responses[0].ts<commit.ts))return false;
  const received=children.filter(e=>e.name==='ResourceReceivedData');
  if(received.length!==1 || received[0].args?.data?.requestId!==navigationId || received[0].args.data.frame!==frame || !Number.isSafeInteger(received[0].args.data.encodedDataLength) || received[0].args.data.encodedDataLength<=0 || !inside(received[0],body))return false;
  const firstScript=thread.filter(e=>e.ts===firstScriptUs && scriptEvent(e));
  const firstScriptUrls=new Set(firstScript.map(e=>e.args?.data?.url ?? e.args?.fileName).filter(Boolean));
  const subresources=sends.filter(e=>e.args.data.resourceType!=='Document');
  if(subresources.length===0 || subresources.some(e=>!inside(e,append) || !['Stylesheet','Script','Image'].includes(e.args.data.resourceType) || e.args.data.frame!==frame || e.args.data.requestMethod!=='GET' || e.args.data.initiator?.type!=='parser' || e.args.data.initiator.url!==url || !sameOrigin(e.args.data.url,url)))return false;
  const scripts=sends.filter(e=>e.args.data.resourceType==='Script');
  if(scripts.length!==1 || scripts[0].args.data.isLinkPreload!==true || !firstScriptUrls.has(scripts[0].args.data.url))return false;
  const preload=children.filter(e=>e.name==='PreloadRenderBlockingStatusChange');
  if(preload.length!==1 || !inside(preload[0],append) || preload[0].args?.data?.requestId!==scripts[0].args.data.requestId || preload[0].args.data.url!==scripts[0].args.data.url)return false;
  return exactBootstrapRundown(children);
};
// Lighthouse13.5.0 wait-for-condition.js evaluates this exact wrapper with
// useIsolation:true. A URL or a late timestamp alone never establishes origin.
const idleSource={length:2573,sha256:'cd46c6127fbe327e1821308af46a058857f7fdb3279ddb3f01dcc461bfe2e3b8'};
const idleStack=[['',26,5],['checkTimeSinceLastLongTaskInPage',22,10],['',40,3],['',41,7]];
const insideSpan=(child,parent)=>child.ts>=parent.ts && child.ts+(child.dur??0)<=parent.ts+parent.dur;
const boundSource=(metadata,thread,expected,frame,instantSource=false)=>{
  const data=metadata?.args?.data;
  if(metadata?.name!=='ScriptCatchup' || metadata.cat!=='disabled-by-default-devtools.v8-source-rundown' || metadata.ph!=='X' || !nonnegative(metadata.dur) || refs(metadata).some(ref=>ref!==frame) || data?.url!=='' || data.sourceUrl!=='_lighthouse-eval.js' || data.hasSourceUrl!==true || data.isModule!==false || typeof data.isolate!=='string' || !data.isolate || !Number.isSafeInteger(data.scriptId) || data.scriptId<=0 || !Number.isSafeInteger(data.executionContextId) || data.executionContextId<=0)return null;
  const matching=thread.filter(e=>e.name==='ScriptCatchup' && e.args?.data?.isolate===data.isolate && e.args.data.scriptId===data.scriptId);
  const sources=matching.filter(e=>e.cat==='disabled-by-default-devtools.v8-source-rundown-sources');
  if(matching.length!==2 || sources.length!==1)return null;
  const source=sources[0],body=source.args.data;
  const sourceShape=source.ph==='X' && nonnegative(source.dur) || instantSource && source.ph==='I' && source.s==='t' && source.dur===undefined;
  if(!sourceShape || refs(source).some(ref=>ref!==frame) || source.ts<metadata.ts+metadata.dur || body.length!==expected.length || typeof body.sourceText!=='string' || Buffer.byteLength(body.sourceText)!==expected.length || hash(Buffer.from(body.sourceText))!==expected.sha256)return null;
  return source;
};
const exactIsolatedIdleCheck=({children,thread,task,end,frame,url,origin})=>{
  if(children.length!==5 || children.some(e=>!eventInside(e,task,end) || refs(e).some(ref=>ref!==frame)))return false;
  const one=(name,cat)=>{const found=children.filter(e=>e.name===name && e.cat===cat);return found.length===1?found[0]:null;};
  const evaluate=one('EvaluateScript','disabled-by-default-devtools.timeline'),microtasks=one('RunMicrotasks','v8.execute'),timer=one('TimerInstall','devtools.timeline');
  const metadata=one('ScriptCatchup','disabled-by-default-devtools.v8-source-rundown'),source=boundSource(metadata,thread,idleSource,frame);
  if(!evaluate || !microtasks || !timer || !source || !children.includes(source))return false;
  if(evaluate.ph!=='X' || !nonnegative(evaluate.dur) || Object.keys(evaluate.args??{}).length!==0 || microtasks.ph!=='X' || !nonnegative(microtasks.dur) || microtasks.args?.microtask_count!==2 || Object.keys(microtasks.args).length!==1)return false;
  if(!insideSpan(metadata,evaluate) || !insideSpan(source,evaluate) || !insideSpan(microtasks,evaluate) || source.ts+source.dur>microtasks.ts || !insideSpan(timer,microtasks))return false;
  const data=metadata.args.data,timing=timer.args?.data;
  if(timer.ph!=='I' || timer.s!=='t' || timer.dur!==undefined || timing?.frame!==frame || timing.timeout!==150 || timing.singleShot!==true || !Number.isSafeInteger(timing.timerId) || timing.timerId<=0 || !Number.isSafeInteger(timing.sampleTraceId) || timing.sampleTraceId<=0)return false;
  if(!Array.isArray(timing.stackTrace) || timing.stackTrace.length!==idleStack.length || !timing.stackTrace.every((entry,i)=>entry.scriptId===String(data.scriptId) && entry.url==='_lighthouse-eval.js' && entry.functionName===idleStack[i][0] && entry.lineNumber===idleStack[i][1] && entry.columnNumber===idleStack[i][2]))return false;
  // Bind the audit context to a different context from the actually compiled
  // application module and exact main-world bootstrap in this same navigation.
  // Do not hardcode Chromium's context/script numbers from a particular run.
  const modules=thread.filter(e=>e.name==='ScriptCatchup' && e.cat==='disabled-by-default-devtools.v8-source-rundown' && e.ph==='X' && nonnegative(e.dur) && e.ts>=origin && e.ts<task.ts && e.args?.data?.isolate===data.isolate && e.args.data.isModule===true);
  const mainContexts=new Set();
  for(const module of modules){
    const main=module.args.data;
    if(refs(module).some(ref=>ref!==frame) || !Number.isSafeInteger(main.executionContextId) || main.executionContextId<=0 || main.executionContextId===data.executionContextId || !Number.isSafeInteger(main.scriptId) || main.scriptId<=0 || !sameOrigin(main.url,url))return false;
    const compiles=thread.filter(e=>e.name==='v8.compileModule' && e.cat==='v8,devtools.timeline' && e.ph==='X' && nonnegative(e.dur) && e.ts>=origin && e.ts<=module.ts && e.args?.data?.scriptId===main.scriptId && e.args.data.url===main.url && e.args.fileName===main.url);
    if(compiles.length!==1 || refs(compiles[0]).some(ref=>ref!==frame))return false;
    mainContexts.add(main.executionContextId);
  }
  if(mainContexts.size!==1)return false;
  const bootstrap=thread.filter(e=>e.ts>=origin && e.ts<task.ts && e.args?.data?.isolate===data.isolate && mainContexts.has(e.args.data.executionContextId) && boundSource(e,thread,auditBootstrapSources.get('_lighthouse-eval.js'),frame,true));
  return bootstrap.length===1;
};
const excludedKinds = new Set(['pre-application-browser-layout','pre-application-navigation-audit-bootstrap','isolated-lighthouse-idle-check','pre-application-parser-stylesheet','pre-application-svg-image']);

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
  const beforeScript=task=>firstScriptUs!==null && task.ts>=origin && task.ts+task.dur<=firstScriptUs && commits.some(e=>e.ts<=task.ts) && !thread.some(e=>e.name==='navigationStart' && e.ts>origin && e.ts<task.ts+task.dur && e.args?.data?.documentLoaderURL!=='');
  const svgProofs=[];
  // Only image-response tasks are candidates; no recursive task classification.
  for(const response of thread.filter(e=>e.name==='ResourceReceiveResponse' && e.args?.data?.mimeType==='image/svg+xml')){
    const task=only(tasks,t=>eventInside(response,t,t.ts+t.dur));
    if(!task || !beforeScript(task))continue;
    const proof=exactSvgLoad({children:taskChildren(thread,task),thread,events,task,end:task.ts+task.dur,origin,frame,url:lhr.requestedUrl});
    if(!proof)continue;
    const painted=exactSvgPaint(proof,thread,firstScriptUs);
    const paintTask=painted && only(tasks,t=>eventInside(painted.paint,t,t.ts+t.dur));
    if(!paintTask || !beforeScript(paintTask))continue;
    const children=taskChildren(thread,paintTask);
    if(!children.some(e=>e.name==='Layout' && e.ph==='X' && e.dur>0 && e.args?.beginData?.frame===frame) || !pureLayoutChildren(children,thread,paintTask,frame,origin,lhr.requestedUrl,painted))continue;
    svgProofs.push({...painted,paintTask});
  }
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
      const children=taskChildren(thread,task);
      const svg=svgProofs.find(proof=>proof.paintTask.index===task.index);
      const pure=pureLayoutChildren(children,thread,task,frame,origin,lhr.requestedUrl,svg);
      const layout=children.some(e=>e.name==='Layout' && e.ph==='X' && e.dur>0 && e.args?.beginData?.frame===frame);
      // Require an observed later script boundary: lack of instrumentation is
      // never proof that no application code ran. Preserve the whole task cost.
      if(firstScriptUs!==null && end<=firstScriptUs && task.ts>=origin && commits.some(e=>e.ts<=task.ts) && !anotherNavigation && pure && layout){kind='pre-application-browser-layout';reason='same-navigation-pure-layout-before-first-script';}
      else if(beforeScript(task) && exactParserStylesheet({children,thread,task,end,origin,frame,url:lhr.requestedUrl})){kind='pre-application-parser-stylesheet';reason='same-navigation-parser-resource-and-stylesheet-before-first-script';}
      else if(svgProofs.some(proof=>proof.task.index===task.index)){kind='pre-application-svg-image';reason='same-navigation-parser-image-and-bound-isolated-document-before-first-script';}
      else if(task.ts>=origin && commits.some(e=>e.ts<=task.ts) && !anotherNavigation && exactNavigationBootstrap({children,thread,task,end,frame,navigationId,url:lhr.requestedUrl,firstScriptUs})){kind='pre-application-navigation-audit-bootstrap';reason='same-navigation-document-commit-before-application-script';}
      else if(task.ts>=origin && commits.some(e=>e.ts<=task.ts) && !anotherNavigation && exactIsolatedIdleCheck({children,thread,task,end,frame,url:lhr.requestedUrl,origin})){kind='isolated-lighthouse-idle-check';reason='same-navigation-pinned-source-isolated-audit-idle-check';}
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
