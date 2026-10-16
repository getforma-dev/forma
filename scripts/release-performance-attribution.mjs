// Preserve the L63 same-audit layout proof under strict startup qualification.
// Full raw traces and Lighthouse tasks remain in DS12. Unknown/mixed tasks count.
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
]);
// ScriptCatchup is retrospective source metadata, not execution. It is still
// unknown inside a candidate layout task and therefore prevents exclusion there.
const scriptEvent = e => !(e.name==='ScriptCatchup' && ['disabled-by-default-devtools.v8-source-rundown','disabled-by-default-devtools.v8-source-rundown-sources'].includes(e.cat)) && /script|compile|evaluate|functioncall|microtask/i.test(e.name);
const refs = e => [e.args?.frame,e.args?.data?.frame,e.args?.data?.frameID,e.args?.beginData?.frame,e.args?.data?.page].filter(x=>x!==undefined);

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
      reason='not-proven-pre-application-layout';
      // No later navigation may have reused this renderer before the task ends.
      const anotherNavigation=thread.some(e=>e.name==='navigationStart' && e.ts>origin && e.ts<end);
      const children=thread.filter(e=>e.index!==task.index && (e.ts>=task.ts && e.ts<end || e.dur>0 && e.ts<task.ts && e.ts+e.dur>task.ts));
      const pure=children.length>0 && children.every(e=>{
        if(!browserEvents.has(e.name) || refs(e).some(f=>f!==frame))return false;
        if(e.dur!==undefined && (e.ph!=='X' || e.ts<task.ts || e.ts+e.dur>end))return false;
        if(e.name==='EventDispatch' && !['resize','pagereveal'].includes(e.args?.data?.type))return false;
        if(e.name==='WebDXFeatureUsage' && e.args?.scriptId!==-1)return false;
        return true;
      });
      const layout=children.some(e=>e.name==='Layout' && e.ph==='X' && e.dur>0 && e.args?.beginData?.frame===frame);
      // Require an observed later script boundary: lack of instrumentation is
      // never proof that no application code ran. Preserve the whole task cost.
      if(firstScriptUs!==null && end<=firstScriptUs && task.ts>=origin && commits.some(e=>e.ts<=task.ts) && !anotherNavigation && pure && layout){kind='pre-application-browser-layout';reason='same-navigation-pure-layout-before-first-script';}
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
    const tasks=[...attribution.tasks.filter(t=>t.kind!=='pre-application-browser-layout'),...run.activation.longTasks];
    tasks.forEach(t=>assert(nonnegative(t.duration) && nonnegative(t.startTime),'N3: invalid startup task'));
    return Math.max(0,...tasks.map(t=>t.duration));
  });
  assert(runMaximaMs.length>0);
  const sorted=[...runMaximaMs].sort((a,b)=>a-b);
  return {policy:{...MOBILE_STARTUP_POLICY},runMaximaMs,p95MaxTaskMs:sorted[Math.ceil(sorted.length*.95)-1],maxTaskMs:Math.max(...runMaximaMs),targetMiss:runMaximaMs.some(n=>n>MOBILE_STARTUP_POLICY.targetMs),wholePageTargetMiss:runs.some(run=>[...run.lighthouse.longTasks,...run.activation.longTasks].some(t=>t.duration>MOBILE_STARTUP_POLICY.targetMs))};
}
