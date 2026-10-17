// Small invented traces for contract tests only; never release evidence.
import {createHash} from 'node:crypto';
import {MOBILE_PROFILE} from './release-performance-spec.mjs';
import {encodeMobileTrace,attributeMobileTasks} from './release-performance-attribution.mjs';
export function traceFixture({duration=60,scriptAt=200,startTime=100,imageLayout=false,mainThreadFrame=false}={}) {
  const origin=1000000,frame='test-frame',url='http://fixture.invalid/';
  const event=(name,ts,extra={})=>({name,ph:'I',pid:10,tid:20,ts:origin+ts*1000,args:{},...extra});
  const trace={traceEvents:[
    event('navigationStart',0,{ph:'R',args:{frame,data:{documentLoaderURL:url,navigationId:'test-navigation',isOutermostMainFrame:true}}}),
    event('FrameCommittedInBrowser',1,{pid:1,tid:2,args:{data:{frame,processId:10,url,isOutermostMainFrame:true}}}),
    ...imageLayout?[event('ResourceSendRequest',startTime-20,{cat:'devtools.timeline',args:{data:{frame,requestId:'10.4',resourceType:'Image',initiator:{type:'parser',url}}}})]:[],
    event('RunTask',startTime,{ph:'X',dur:duration*1000}),
    ...mainThreadFrame?[event('BeginMainThreadFrame',startTime+.1,{cat:'disabled-by-default-devtools.timeline.frame',args:{layerTreeId:1,data:{frameId:0}}})]:[],
    event('Layout',startTime+1,{ph:'X',dur:(duration-2)*1000,args:{beginData:{frame}}}),
    ...imageLayout?[
      event('LayoutImageUnsized',startTime+2,{cat:'devtools.timeline',s:'t',args:{data:{frameId:frame,nodeId:3}}}),
      event('ResourceChangePriority',startTime+duration-1,{cat:'devtools.timeline',ph:'X',dur:15,args:{data:{priority:'High',requestId:'10.4'}}}),
    ]:[],
    event('v8.evaluateModule',scriptAt,{ph:'X',dur:1000}),
  ]};
  const lhr={requestedUrl:url,lighthouseVersion:'13.5.0',configSettings:MOBILE_PROFILE,environment:{benchmarkIndex:123},audits:{
    metrics:{details:{items:[{observedTimeOriginTs:origin}]}},
    'total-blocking-time':{numericValue:0},'largest-contentful-paint':{numericValue:123},
    'long-tasks':{details:{type:'table',items:[{duration,startTime}]}},
  }};
  return {lhr,trace};
}
export function traceMeasurement(lhr,trace) {
  const rawLhr=JSON.stringify(lhr);
  return {version:'13.5.0',throttlingMethod:'devtools',benchmarkIndex:123,tbtMs:lhr.audits['total-blocking-time'].numericValue,lcpMs:123,
    longTasks:lhr.audits['long-tasks'].details.items.map(({duration,startTime})=>({duration,startTime})),rawLhr,
    sha256:createHash('sha256').update(rawLhr).digest('hex'),trace:encodeMobileTrace(trace),attribution:attributeMobileTasks(lhr,trace)};
}
