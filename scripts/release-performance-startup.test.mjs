import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {MOBILE_PROFILE,MOBILE_STARTUP_ACCEPTANCE} from './release-performance-spec.mjs';
import {attributeMobileTasks} from './release-performance-attribution.mjs';
import {proveColdStartupTask,validateStartupAcceptance} from './release-performance-startup.mjs';
import {validateActivation,validateCurrentMobile,validateMobile,finalizeMobileAttribution,validatePerformanceRecord,validateHistorical30BaselinePerformance} from './release-performance-contract.mjs';
import {mobile,performanceRecord} from './release-performance-test-fixtures.mjs';
import {traceMeasurement} from './release-performance-trace-fixtures.mjs';
import {validateBaselineRecord} from './release-performance-baseline.mjs';

// Invented minimal traces for refusal controls, never release measurements.
const SOURCE='function D(d=performance.now()+12){t=void 0,b++;let n=4;try{for(let w of p.values()){if(!n--||performance.now()>=d)break;w()}}finally{b--,S()}}function S(){!b&&p.size&&t===void 0&&(t=setTimeout(D,0))}';
function fixture(duration=55){
 const origin=1000000,frame='frame',url='http://fixture.invalid/',asset=url+'app.js',isolate='isolate',scriptId=10;
 const event=(name,ms,extra={})=>({name,ph:'I',pid:10,tid:20,ts:origin+ms*1000,args:{},...extra});
 const frameData={frame},script={scriptId,isolate};
 const metadata={executionContextId:5,hasSourceUrl:false,isModule:true,...script,url:asset};
 const trace={traceEvents:[
  event('navigationStart',0,{ph:'R',args:{frame,data:{documentLoaderURL:url,navigationId:'navigation',isOutermostMainFrame:true}}}),
  event('FrameCommittedInBrowser',.5,{pid:1,tid:2,args:{data:{frame,processId:10,url,isOutermostMainFrame:true}}}),
  event('ResourceSendRequest',1,{cat:'devtools.timeline',args:{data:{...frameData,resourceType:'Script',url:asset,requestMethod:'GET',initiator:{type:'parser',url}}}}),
  event('v8.compileModule',2,{cat:'v8,devtools.timeline',ph:'X',dur:100,args:{fileName:asset,data:{scriptId,url:asset}}}),
  event('ScriptCatchup',3,{cat:'disabled-by-default-devtools.v8-source-rundown',ph:'X',dur:100,args:{data:metadata}}),
  event('ScriptCatchup',4,{cat:'disabled-by-default-devtools.v8-source-rundown-sources',ph:'X',dur:100,args:{data:{...script,length:SOURCE.length,sourceText:SOURCE}}}),
  event('v8.evaluateModule',5,{cat:'v8,devtools.timeline',ph:'X',dur:10000,args:{worldId:0}}),
  event('TimerInstall',10,{cat:'devtools.timeline',s:'t',args:{data:{...frameData,timerId:1,singleShot:true,timeout:0,stackTrace:[{scriptId:String(scriptId),url:asset,functionName:'S',lineNumber:1,columnNumber:SOURCE.indexOf('setTimeout')+1}]}}}),
  event('RunTask',100,{ph:'X',dur:duration*1000}),
  event('TimerFire',100.1,{cat:'devtools.timeline',ph:'X',dur:(duration-.2)*1000,args:{data:{...frameData,timerId:1}}}),
  event('v8.callFunction',100.15,{cat:'v8',ph:'X',dur:(duration-.3)*1000}),
  event('FunctionCall',100.2,{cat:'devtools.timeline',ph:'X',dur:(duration-.4)*1000,args:{data:{...frameData,...script,scriptId:String(scriptId),url:asset,functionName:'D',lineNumber:1,columnNumber:SOURCE.indexOf('(d=')+1}}}),
 ]};
 const lhr={requestedUrl:url,lighthouseVersion:'13.5.0',configSettings:MOBILE_PROFILE,environment:{benchmarkIndex:123},audits:{metrics:{details:{items:[{observedTimeOriginTs:origin}]}},'total-blocking-time':{numericValue:Math.max(0,duration-50)},'largest-contentful-paint':{numericValue:123},'long-tasks':{details:{type:'table',items:[{duration,startTime:100}]}}}};
 return {trace,lhr};
}
const find=(f,name)=>f.trace.traceEvents.find(e=>e.name===name);
const metadata=f=>f.trace.traceEvents.find(e=>e.cat==='disabled-by-default-devtools.v8-source-rundown');
const source=f=>f.trace.traceEvents.find(e=>e.cat==='disabled-by-default-devtools.v8-source-rundown-sources');
function proof(f){const a=attributeMobileTasks(f.lhr,f.trace);return proveColdStartupTask(f.lhr,f.trace,a.tasks[0],a);}
function campaign(durations){
 const rows=mobile();
 for(const [index,duration] of durations.entries()){const f=fixture(duration);rows[0].runs[index].lighthouse=traceMeasurement(f.lhr,f.trace);}
 for(const row of rows)row.p95TbtMs=[...row.runs.map(r=>r.lighthouse.tbtMs)].sort((a,b)=>a-b)[18];
 return finalizeMobileAttribution(rows);
}
test('known initial module timer proves full task, preserving strict target miss',()=>{
 assert.equal(proof(fixture()).qualified,true);
 const rows=campaign([55,55]);validateCurrentMobile(rows);
 assert.equal(rows[0].startup.targetMiss,true);assert.equal(rows[0].startup.wholePageTargetMiss,true);
 assert.equal(rows[0].startup.maxTaskMs,55);assert.equal(rows[0].startupAcceptance.totalExcessMs,10);
 assert.deepEqual(rows[0].startupAcceptance.affectedVisits,[1,2]);
 assert.throws(()=>validateMobile(rows),/over50ms/);
});
test('each route owns an independent twenty-visit budget',()=>{
 const rows=campaign([55,55]);
 for(let i=0;i<2;i++){const f=fixture(55);rows[1].runs[i].lighthouse=traceMeasurement(f.lhr,f.trace);}
 rows[1].p95TbtMs=5;finalizeMobileAttribution(rows);validateCurrentMobile(rows);
 assert(rows.every(row=>row.startupAcceptance.exceptionalTaskCount===2&&row.startupAcceptance.totalExcessMs===10));
});
test('new policy never changes strict observer/input ceiling',()=>{
 for(const duration of [50.00000000000001,51,55,110]){
  const probe={expected:2,active:2,responded:2,firstPaintMs:100,lastResponseMs:100,longTasks:[{startTime:120,duration}],errors:[]};
  assert.throws(()=>validateActivation(probe,{islands:2}),/over50ms/);
 }
});
test('precise exceptional maximum, task count and aggregate are bounded without rounding',()=>{
 for(const durations of [[55.00000000000001],[51,51,51]])assert.throws(()=>validateCurrentMobile(campaign(durations)),/over55ms|more than2/);
 const rows=campaign([51,51]);
 const sameVisit=structuredClone(rows[0].startupAcceptance);
 sameVisit.exceptions.push({...sameVisit.exceptions[0],index:1});
 sameVisit.exceptionalTaskCount=3;sameVisit.affectedVisits=[1,2];sameVisit.totalExcessMs=3;
 assert.throws(()=>validateStartupAcceptance(sameVisit),/more than2/);
 const excess=structuredClone(rows[0].startupAcceptance);excess.totalExcessMs=10.000000000000002;
 assert.throws(()=>validateStartupAcceptance(excess),/excess/);
 for(const mutate of [r=>r[0].runs.pop(),r=>r[0].runs[1].run=1,r=>r[0].startupAcceptance.policy.maxExceptionalTaskMs=56,r=>r[0].startupAcceptance.totalExcessMs=0,r=>r[0].startup.targetMiss=false]){
  const copy=structuredClone(rows);mutate(copy);assert.throws(()=>validateCurrentMobile(copy));
 }
});
test('every task counts even when multiple exceptions share one visit',()=>{
 for(const count of [2,3]){
  const f=fixture(51),original=structuredClone(f.trace.traceEvents);
  for(let i=1;i<count;i++){
   const install=structuredClone(original.find(e=>e.name==='TimerInstall'));install.ts+=i;install.args.data.timerId=i+1;f.trace.traceEvents.push(install);
   for(const name of ['RunTask','TimerFire','v8.callFunction','FunctionCall']){
    const event=structuredClone(original.find(e=>e.name===name));event.ts+=i*100000;
    if(name==='TimerFire')event.args.data.timerId=i+1;f.trace.traceEvents.push(event);
   }
   f.lhr.audits['long-tasks'].details.items.push({duration:51,startTime:100+i*100});
  }
  f.lhr.audits['total-blocking-time'].numericValue=count;
  const rows=mobile();rows[0].runs[0].lighthouse=traceMeasurement(f.lhr,f.trace);finalizeMobileAttribution(rows);
  assert.deepEqual(rows[0].startupAcceptance.affectedVisits,[1]);assert.equal(rows[0].startupAcceptance.exceptionalTaskCount,count);
  if(count===2)validateCurrentMobile(rows);else assert.throws(()=>validateCurrentMobile(rows),/more than2/);
 }
});
const mutations={
 'unknown function body':f=>{source(f).args.data.sourceText=SOURCE.replace('+12','+13');},
 'changed four-work bound':f=>{source(f).args.data.sourceText=SOURCE.replace('n=4','n=5');},
 'wrong callback coordinate':f=>{find(f,'FunctionCall').args.data.columnNumber++;},
 'wrong scheduling coordinate':f=>{find(f,'TimerInstall').args.data.stackTrace[0].columnNumber=1;},
 'delayed timer':f=>{find(f,'TimerInstall').args.data.timeout=1;},
 'repeating timer':f=>{find(f,'TimerInstall').args.data.singleShot=false;},
 'timer cancelled':f=>{f.trace.traceEvents.push({...find(f,'TimerInstall'),name:'TimerRemove',ts:1020000});},
 'duplicate timer installation':f=>{f.trace.traceEvents.push(structuredClone(find(f,'TimerInstall')));},
 'duplicate task':f=>{f.trace.traceEvents.push(structuredClone(find(f,'RunTask')));},
 'wrong scheduling source':f=>{find(f,'TimerInstall').args.data.stackTrace[0].url+='other';},
 'unbound module world':f=>{find(f,'v8.evaluateModule').args.worldId=1;},
 'foreign module frame':f=>{find(f,'v8.evaluateModule').args.data={frame:'other'};},
 'foreign module filename':f=>{find(f,'v8.evaluateModule').args.fileName='http://other/';},
 'foreign module script':f=>{find(f,'v8.evaluateModule').args.data={scriptId:99};},
 'foreign timer installation context':f=>{find(f,'TimerInstall').args.data.executionContextId=99;},
 'foreign timer installation isolate':f=>{find(f,'TimerInstall').args.data.isolate='other';},
 'foreign nested timer installation frame':f=>{find(f,'TimerInstall').args.data.stackTrace[0].frame='other';},
 'foreign request context':f=>{find(f,'ResourceSendRequest').args.data.executionContextId=99;},
 'foreign request isolate':f=>{find(f,'ResourceSendRequest').args.data.isolate='other';},
 'foreign nested request frame':f=>{find(f,'ResourceSendRequest').args.data.initiator.stack={frame:'other'};},
 'foreign compilation frame':f=>{find(f,'v8.compileModule').args.data.frame='other';},
 'foreign compilation filename':f=>{find(f,'v8.compileModule').args.fileName='http://other/';},
 'foreign metadata frame':f=>{metadata(f).args.data.frame='other';},
 'foreign source frame':f=>{source(f).args.data.frame='other';},
 'incorrect metadata phase':f=>{metadata(f).ph='I';delete metadata(f).dur;},
 'incorrect source phase':f=>{source(f).ph='I';delete source(f).dur;},
 'source length mismatch':f=>{source(f).args.data.length++;},
 'oversized source':f=>{source(f).args.data.sourceText=SOURCE+' '.repeat(1024*1024);source(f).args.data.length=source(f).args.data.sourceText.length;},
 'source missing':f=>{f.trace.traceEvents=f.trace.traceEvents.filter(e=>e!==source(f));},
 'source duplicated':f=>{f.trace.traceEvents.push(structuredClone(source(f)));},
 'ambiguous module context':f=>{const extra=structuredClone(metadata(f));extra.args.data.isolate='other';f.trace.traceEvents.push(extra);},
 'foreign execution context':f=>{find(f,'FunctionCall').args.data.executionContextId=77;},
 'foreign isolate':f=>{find(f,'FunctionCall').args.data.isolate='other';},
 'foreign timer frame':f=>{find(f,'TimerFire').args.data.frame='other';},
 'callback crossing task':f=>{find(f,'FunctionCall').dur+=1000;},
 'callback begins before task':f=>{find(f,'FunctionCall').ts-=1000;find(f,'FunctionCall').dur+=1000;},
 'second callback':f=>{f.trace.traceEvents.push({...structuredClone(find(f,'FunctionCall')),ts:1101000,dur:1});},
 'mixed click':f=>{f.trace.traceEvents.push({name:'EventDispatch',ph:'X',pid:10,tid:20,ts:1101000,dur:1,args:{data:{type:'click'}}});},
 'input before startup':f=>{f.trace.traceEvents.push({name:'EventDispatch',ph:'X',pid:10,tid:20,ts:1090000,dur:1,args:{data:{type:'keydown'}}});},
 'input timing':f=>{f.trace.traceEvents.push({name:'EventTiming',ph:'I',pid:10,tid:20,ts:1090000,args:{}});},
 'unknown executable':f=>{f.trace.traceEvents.push({name:'UnresolvedScriptWork',cat:'v8',ph:'X',pid:10,tid:20,ts:1101000,dur:1,args:{}});},
 'later navigation':f=>{const n=structuredClone(find(f,'navigationStart'));n.ts=1090000;f.trace.traceEvents.push(n);},
 'not initial evaluation':f=>{find(f,'TimerInstall').ts=1020000;},
};
for(const [label,mutate] of Object.entries(mutations))test('positive startup proof refuses '+label,()=>{
 const f=fixture();mutate(f);
 let refused=false;try{refused=proof(f).qualified===false;}catch{refused=true;}assert(refused,label);
});
test('known engine ancestry permits callback engine work and its native microtask tail',()=>{
 const f=fixture(),call=find(f,'FunctionCall'),wrapper=find(f,'v8.callFunction');
 f.trace.traceEvents.push(
  {name:'v8.newInstance',cat:'v8',ph:'X',pid:10,tid:20,ts:call.ts+10,dur:1,args:{}},
  {name:'V8.HandleInterrupts',cat:'v8.execute',ph:'X',pid:10,tid:20,ts:call.ts+20,dur:1,args:{}},
  {name:'RunMicrotasks',cat:'v8.execute',ph:'X',pid:10,tid:20,ts:call.ts+call.dur+1,dur:1,args:{}},
 );
 assert(insideForTest(find(f,'RunMicrotasks'),wrapper));assert.equal(proof(f).qualified,true);
});
const insideForTest=(child,parent)=>child.ts>=parent.ts&&child.ts+child.dur<=parent.ts+parent.dur;
for(const [name,cat] of [['RunMicrotasks','v8.execute'],['v8.callFunction','v8'],['v8.newInstance','v8'],['V8.HandleInterrupts','v8.execute']])test('source-less executable sibling refuses '+name,()=>{
 const f=fixture(),task=find(f,'RunTask');
 f.trace.traceEvents.push({name,cat,ph:'X',pid:10,tid:20,ts:task.ts+task.dur-2,dur:1,args:{}});
 assert.equal(proof(f).qualified,false);
});
test('wrapper and engine containment refuse missing, duplicate and crossing spans',()=>{
 for(const mutate of [
  f=>{f.trace.traceEvents=f.trace.traceEvents.filter(e=>e.name!=='v8.callFunction');},
  f=>{f.trace.traceEvents.push(structuredClone(find(f,'v8.callFunction')));},
  f=>{find(f,'v8.callFunction').ts=find(f,'TimerFire').ts-1;},
  f=>{find(f,'v8.callFunction').dur=1;},
  f=>{const c=find(f,'FunctionCall');f.trace.traceEvents.push({name:'v8.newInstance',cat:'v8',ph:'X',pid:10,tid:20,ts:c.ts+c.dur-1,dur:2,args:{}});},
  f=>{const w=find(f,'v8.callFunction');f.trace.traceEvents.push({name:'RunMicrotasks',cat:'v8.execute',ph:'X',pid:10,tid:20,ts:w.ts+w.dur-1,dur:2,args:{}});},
 ]){const f=fixture();mutate(f);assert.equal(proof(f).qualified,false);}
});
for(const key of ['frame','frameId','frameID','page'])test('nested executable frame binding refuses foreign '+key,()=>{
 const f=fixture(),call=find(f,'FunctionCall');call.args.data.stackTrace=[{scriptId:call.args.data.scriptId,url:call.args.data.url,[key]:'frame'}];
 assert.equal(proof(f).qualified,true);call.args.data.stackTrace[0][key]='foreign';assert.equal(proof(f).qualified,false);
});
function animationFixture(){
 const f=fixture(),call=find(f,'FunctionCall'),origin=1000000;
 const event=(name,ph,ms,args={})=>({name,ph,pid:10,tid:20,ts:origin+ms*1000,cat:'devtools.timeline',id2:{local:'0x1'},args});
 f.trace.traceEvents.push(
  event('AnimationFrame','b',99.999),event('AnimationFrame','e',154.99),
  event('AnimationFrame::Script::Execute','b',100.15,{animation_frame_script_timing_info:{invoker_type:'USER_CALLBACK',property_like_name:'TimerHandler:setTimeout',class_like_name:'',source_location_function_name:'D',source_location_url:call.args.data.url,source_location_char_position:SOURCE.indexOf('(d=')}}),
  event('AnimationFrame::Script::Execute','e',154.85),
 );return f;
}
test('async script markers bind to the known timer callback, including reused IDs',()=>{
 const f=animationFixture();assert.equal(proof(f).qualified,true);
 const prior=f.trace.traceEvents.filter(e=>e.name.startsWith('AnimationFrame')).map(e=>({...structuredClone(e),ts:e.ts-60000}));
 f.trace.traceEvents.push(...prior);assert.equal(proof(f).qualified,true);
 for(const mutate of [
  x=>{x.trace.traceEvents=x.trace.traceEvents.filter(e=>!(e.name==='AnimationFrame::Script::Execute'&&e.ph==='e'));},
  x=>{find(x,'AnimationFrame::Script::Execute').args.animation_frame_script_timing_info.source_location_url+='foreign';},
  x=>{x.trace.traceEvents.find(e=>e.name==='AnimationFrame::Script::Execute'&&e.ph==='e').ts+=10000;},
  x=>{x.trace.traceEvents.push(structuredClone(find(x,'AnimationFrame::Script::Execute')));},
 ]){
  const changed=animationFixture();mutate(changed);assert.equal(proof(changed).qualified,false);
 }
});
test('paired animation endpoints outside the task retain recursive source and frame binding',()=>{
 for(const fields of [{frame:'other'},{frameId:'other'},{frameID:'other'},{page:'other'},{scriptId:99},{isolate:'other'},{executionContextId:99},{url:'http://other/'}]){
  const f=animationFixture();find(f,'AnimationFrame').args={nested:fields};assert.equal(proof(f).qualified,false);
 }
});
for(const [label,wrap] of [
 ['comment',text=>'/*'+text+'*/'],
 ['string',text=>JSON.stringify(text)+';'],
 ['template',text=>String.fromCharCode(96)+text+String.fromCharCode(96)+';'],
 ['nested declaration',text=>'function Outer(){'+text+'}'],
 ['duplicate declaration',text=>text+text],
])test('source AST refuses '+label+' lookalike',()=>{
 const f=fixture(),text=wrap(SOURCE),offset=text.indexOf('function D');
 source(f).args.data.sourceText=text;source(f).args.data.length=Buffer.byteLength(text);
 find(f,'FunctionCall').args.data.columnNumber=offset+SOURCE.indexOf('(d=')+1;
 find(f,'TimerInstall').args.data.stackTrace[0].columnNumber=offset+SOURCE.indexOf('setTimeout')+1;
 assert.equal(proof(f).qualified,false);
});
test('current records require explicit policy while authenticated3.0 history remains strict',()=>{
 const current=performanceRecord();validatePerformanceRecord(current);
 for(const edit of [p=>delete p.startupPolicy,p=>p.startupPolicy='N3-startup-correlated-v1',p=>p.startupPolicy='future',p=>delete p.mobile[0].startupAcceptance]){
  const p=structuredClone(current);edit(p);assert.throws(()=>validatePerformanceRecord(p));
 }
 const historical=performanceRecord({historical:true});
 for(const input of [historical,(()=>{const p=structuredClone(current);delete p.startupPolicy;for(const row of p.mobile)delete row.startupAcceptance;return p;})()]){
  for(const options of [{historicalBaselineTag:'v3.0.0'},{allowLegacyInputProtocol:true}])assert.throws(()=>validatePerformanceRecord(input,options),/unknown validation option/);
  assert.throws(()=>validatePerformanceRecord(input),/current startup policy required/);
 }
 validateHistorical30BaselinePerformance(historical,'v3.0.0');
 for(const tag of ['v3.1.0-rc.1','v3.1.0','v4.0.0'])assert.throws(()=>validateHistorical30BaselinePerformance(historical,tag));
 assert.throws(()=>validatePerformanceRecord(historical,{allowLegacyInputProtocol:true}));
 assert.throws(()=>validateHistorical30BaselinePerformance(current,'v3.0.0'));
 historical.mobile=campaign([51]);for(const row of historical.mobile)delete row.startupAcceptance;
 assert.throws(()=>validateHistorical30BaselinePerformance(historical,'v3.0.0'),/over50ms/);
});
test('published3.1 predecessor cannot use missing historical acceptance',()=>{
 const tag='v3.1.0-rc.1',commit='a'.repeat(40),ctx={tag,currentTag:'v3.1.0',publishedAt:'2026-10-24T00:00:00Z',before:'2026-10-25T00:00:00Z',digest:'b'.repeat(64)};
 const record={schema:1,dryRun:false,tag,commit,contracts:{performance:'measured-v1'},packages:[...['forma-ir','forma-ir-derive','forma-server'].map(name=>({registry:'crates',name})),...['core','compiler','build','create-app'].map(name=>({registry:'npm',name:'@getforma/'+name}))].map(p=>({...p,version:tag.slice(1),sha256:'c'.repeat(64)})),measurements:{commit,passed:true,measurements:{performance:performanceRecord()}}};
 assert.equal(validateBaselineRecord(record,ctx).status,'comparable');
 record.measurements.measurements.performance=performanceRecord({historical:true});
 assert.throws(()=>validateBaselineRecord(record,ctx),/current startup policy required/);
 record.measurements.passed=false;assert.throws(()=>validateBaselineRecord(record,ctx),/P17 did not pass/);
});
test('collector, observer and classification are not edited by this policy',()=>{
 const mobileSource=readFileSync(new URL('./release-performance-mobile.mjs',import.meta.url),'utf8');
 assert(!mobileSource.includes('MOBILE_STARTUP_ACCEPTANCE'));
 assert(!mobileSource.includes('proveColdStartupTask'));
 assert.equal(MOBILE_STARTUP_ACCEPTANCE.targetMs,50);
});
test('missing parser refuses exceptions while no-exception imports stay independent',()=>{
 const f=fixture(),a=attributeMobileTasks(f.lhr,f.trace);
 const code=[
  "import Module from 'node:module';import assert from 'node:assert/strict';",
  "const load=Module._load;Module._load=function(id,...rest){if(id.startsWith('@babel/core'))throw Object.assign(new Error('parser unavailable'),{code:'MODULE_NOT_FOUND'});return load.call(this,id,...rest)};",
  'const {validatePerformanceRecord}=await import('+JSON.stringify(new URL('./release-performance-contract.mjs',import.meta.url).href)+');',
  'const {performanceRecord}=await import('+JSON.stringify(new URL('./release-performance-test-fixtures.mjs',import.meta.url).href)+');validatePerformanceRecord(performanceRecord());',
  'const {proveColdStartupTask}=await import('+JSON.stringify(new URL('./release-performance-startup.mjs',import.meta.url).href)+');',
  'const f='+JSON.stringify(f)+',a='+JSON.stringify(a)+';assert.equal(proveColdStartupTask(f.lhr,f.trace,a.tasks[0],a).qualified,false);',
 ].join('\n');
 execFileSync(process.execPath,['--input-type=module','-e',code],{stdio:'pipe'});
});
