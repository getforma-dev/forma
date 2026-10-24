// Prospective acceptance only. Never changes the stable task classifier.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {attributeMobileTasks,decodeMobileTrace} from './release-performance-attribution.mjs';
import {MOBILE_STARTUP_ACCEPTANCE} from './release-performance-spec.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const require=createRequire(import.meta.url);
const SOURCE_MAX_BYTES=1024*1024;
const unique=(values,label)=>{assert.equal(values.length,1,'N3 startup proof: '+label);return values[0];};
const inside=(child,parent)=>child.ts>=parent.ts && child.ts+(child.dur??0)<=parent.ts+parent.dur;
const overlaps=(event,task)=>event.ts<task.ts+task.dur && event.ts+(event.dur??0)>=task.ts;
const identifiers=/^[A-Za-z_$][\w$]*$/;
const frames=event=>[event.args?.frame,event.args?.data?.frame,event.args?.data?.frameID,event.args?.data?.frameId,event.args?.beginData?.frame,event.args?.data?.page].filter(value=>value!==undefined);
const point=(source,line,column)=>{
 assert(Number.isSafeInteger(line)&&line>0&&Number.isSafeInteger(column)&&column>0,'N3 startup proof: source position');
 const lines=source.split('\n');assert(line<=lines.length&&column<=lines[line-1].length+1,'N3 startup proof: source position bounds');
 return lines.slice(0,line-1).reduce((n,text)=>n+text.length+1,0)+column-1;
};
// Full emitted declarations, not a name/substring or a guessed nearest frame.
// This is the existing reviewed atomic-adoption scheduler, with only identifier
// renaming admitted. A changed algorithm/emitter must receive a new review.
const drain=/^\((?<deadline>[A-Za-z_$][\w$]*)=performance\.now\(\)\+12\)\{(?<timer>[A-Za-z_$][\w$]*)=void 0,(?<busy>[A-Za-z_$][\w$]*)\+\+;let (?<remaining>[A-Za-z_$][\w$]*)=4;try\{for\(let (?<work>[A-Za-z_$][\w$]*) of (?<pending>[A-Za-z_$][\w$]*)\.values\(\)\)\{if\(!\k<remaining>--\|\|performance\.now\(\)>=\k<deadline>\)break;\k<work>\(\)\}\}finally\{\k<busy>--,(?<schedule>[A-Za-z_$][\w$]*)\(\)\}\}/;
function declarations(source,call,stack,cache){
 const key=digest(source);
 let program=cache.get(key);
 if(!program){
  // Existing pinned build dependency; never load config, transform or evaluate
  // captured source. Historical/no-exception checks do not load the parser.
  assert.equal(require('@babel/core/package.json').version,'7.29.7','N3 startup proof: pinned parser');
  program=require('@babel/core').parseSync(source,{configFile:false,babelrc:false,sourceType:'module'}).program;
  cache.set(key,program);
 }
 assert(identifiers.test(call.functionName),'N3 startup proof: callback identifier');
 const position=point(source,call.lineNumber,call.columnNumber),prefix='function '+call.functionName;
 assert.equal(source.slice(position-prefix.length,position),prefix,'N3 startup proof: callback declaration');
 const match=drain.exec(source.slice(position));assert(match,'N3 startup proof: reviewed drain body');
 const declaration=unique(program.body.filter(node=>node.type==='FunctionDeclaration'&&node.id?.name===call.functionName),'top-level callback declaration');
 assert(declaration.start===position-prefix.length&&declaration.end===position+match[0].length,'N3 startup proof: callback AST range');
 const g=match.groups;
 assert.equal(new Set([g.deadline,g.timer,g.busy,g.remaining,g.work,g.pending,g.schedule,call.functionName]).size,8,'N3 startup proof: distinct scheduler bindings');
 const scheduler='function '+g.schedule+'(){!'+g.busy+'&&'+g.pending+'.size&&'+g.timer+'===void 0&&('+g.timer+'=setTimeout('+call.functionName+',0))}';
 const start=source.indexOf(scheduler);assert(start>=0&&source.indexOf(scheduler,start+1)===-1,'N3 startup proof: unique scheduler declaration');
 const scheduleDeclaration=unique(program.body.filter(node=>node.type==='FunctionDeclaration'&&node.id?.name===g.schedule),'top-level scheduler declaration');
 assert(scheduleDeclaration.start===start&&scheduleDeclaration.end===start+scheduler.length,'N3 startup proof: scheduler AST range');
 assert.equal(stack.functionName,g.schedule,'N3 startup proof: scheduling frame');
 const stackPoint=point(source,stack.lineNumber,stack.columnNumber);
 assert(stackPoint>=start&&stackPoint<start+scheduler.length,'N3 startup proof: scheduler location');
 return {callback:{start:position-prefix.length,end:position+match[0].length},scheduler:{start,end:start+scheduler.length},declarationSha256:digest(prefix+match[0]+'\n'+scheduler)};
}
const lifecycle=new Set(['readystatechange','pagehide','visibilitychange','webkitvisibilitychange','unload','freeze','pagereveal','resize','DOMContentLoaded','load','pageshow']);
const completeEvents=new Map([
 ['TimerFire','devtools.timeline'],['FunctionCall','devtools.timeline'],
 ['RunMicrotasks','v8.execute'],['v8.callFunction','v8'],['v8.newInstance','v8'],
 ['V8.BytecodeBudgetInterrupt','v8.execute'],['V8.BytecodeBudgetInterruptWithStackCheck','v8.execute'],
 ['V8.HandleInterrupts','v8.execute'],['V8.StackGuard','v8.execute'],
]);
const instantEvents=new Map([['TimerInstall','devtools.timeline'],['UpdateCounters','disabled-by-default-devtools.timeline'],['WebDXFeatureUsage','blink.webdx_feature_usage']]);
function asyncPair(thread,event){
 let open=null,answer=null;
 const peers=thread.filter(e=>e.name===event.name&&e.id2?.local===event.id2.local&&e.cat===event.cat&&['b','e'].includes(e.ph)).sort((a,b)=>a.ts-b.ts||a.index-b.index);
 for(const peer of peers){
  if(peer.ph==='b'){assert(!open,'N3 startup proof: overlapping async spans');open=peer;}
  else{
   if(open&&(peer.index===event.index||open.index===event.index))answer={start:open,end:peer};
   else if(!open&&peer.index===event.index)assert.fail('N3 startup proof: unmatched async end');
   open=null;
  }
 }
 assert(answer,'N3 startup proof: animation pair');return answer;
}

function prove(lhr,trace,taskRecord,attribution,cache){
 const events=trace.traceEvents,origin=attribution.originUs,frame=attribution.frame;
 const thread=events.map((event,index)=>({...event,index})).filter(e=>e.pid===attribution.pid&&e.tid===attribution.tid);
 const nav=unique(thread.filter(e=>e.name==='navigationStart'&&e.ts===origin&&e.args?.frame===frame&&e.args?.data?.documentLoaderURL===lhr.requestedUrl),'navigation');
 assert.equal(nav.args?.data?.navigationId,attribution.navigationId,'N3 startup proof: navigation identity');
 const task=unique(thread.filter(e=>e.name==='RunTask'&&e.ph==='X'&&Math.abs((e.ts-origin)/1000-taskRecord.startTime)<.002&&Math.abs(e.dur/1000-taskRecord.duration)<.002),'RunTask');
 assert.equal(task.index,taskRecord.traceIndex,'N3 startup proof: task index');
 assert.equal(task.dur/1000,taskRecord.duration,'N3 startup proof: full task duration');
 assert(!thread.some(e=>e.name==='navigationStart'&&e.ts>origin&&e.ts<task.ts+task.dur&&e.args?.data?.documentLoaderURL!==''),'N3 startup proof: later navigation');
 const children=thread.filter(e=>e.index!==task.index&&overlaps(e,task));
 assert(children.every(e=>inside(e,task)&&frames(e).every(ref=>ref===frame)),'N3 startup proof: overlapping/foreign event');
 const fire=unique(children.filter(e=>e.name==='TimerFire'&&e.ph==='X'),'timer fire');
 assert.equal(fire.args?.data?.frame,frame,'N3 startup proof: timer frame');
 const callEvent=unique(children.filter(e=>e.name==='FunctionCall'&&e.ph==='X'),'application callback'),call=callEvent.args?.data;
 assert(inside(callEvent,fire)&&call?.frame===frame&&typeof call.isolate==='string'&&call.isolate&&typeof call.url==='string','N3 startup proof: callback containment');
 const wrapper=unique(children.filter(e=>e.name==='v8.callFunction'&&e.ph==='X'),'native callback wrapper');
 assert(inside(wrapper,fire)&&inside(callEvent,wrapper),'N3 startup proof: callback wrapper ancestry');
 const metadata=unique(thread.filter(e=>e.name==='ScriptCatchup'&&e.cat==='disabled-by-default-devtools.v8-source-rundown'&&e.args?.data?.isolate===call.isolate&&String(e.args?.data?.scriptId)===String(call.scriptId)),'script metadata');
 const meta=metadata.args.data;
 assert.equal(thread.filter(e=>e.name==='ScriptCatchup'&&e.cat==='disabled-by-default-devtools.v8-source-rundown'&&e.args?.data?.isModule===true&&e.args.data.url===call.url).length,1,'N3 startup proof: unique module context');
 assert(metadata.ph==='X'&&Number.isFinite(metadata.dur)&&frames(metadata).every(ref=>ref===frame)&&meta.isModule===true&&meta.hasSourceUrl===false&&meta.url===call.url&&Number.isSafeInteger(meta.executionContextId)&&meta.executionContextId>0,'N3 startup proof: module context');
 const sourceEvent=unique(thread.filter(e=>e.name==='ScriptCatchup'&&e.cat==='disabled-by-default-devtools.v8-source-rundown-sources'&&e.args?.data?.isolate===call.isolate&&String(e.args?.data?.scriptId)===String(call.scriptId)),'script source');
 const source=sourceEvent.args.data.sourceText;
 assert(sourceEvent.ph==='X'&&Number.isFinite(sourceEvent.dur)&&frames(sourceEvent).every(ref=>ref===frame)&&typeof source==='string'&&Buffer.byteLength(source)===sourceEvent.args.data.length&&source.length>0&&sourceEvent.args.data.length<=SOURCE_MAX_BYTES,'N3 startup proof: complete bounded source');
 assert(metadata.ts>=origin&&sourceEvent.ts>=origin&&metadata.ts<task.ts&&sourceEvent.ts<task.ts,'N3 startup proof: source chronology');
 const requests=thread.filter(e=>e.ts>=origin&&e.name==='ResourceSendRequest'&&e.args?.data?.resourceType==='Script'&&e.args.data.frame===frame);
 const request=unique(requests,'initial application module request');
 assert(request.args.data.url===call.url&&request.args.data.requestMethod==='GET'&&request.args.data.initiator?.type==='parser'&&request.args.data.initiator.url===lhr.requestedUrl&&new URL(call.url).origin===new URL(lhr.requestedUrl).origin,'N3 startup proof: parser module resource');
 const compile=unique(thread.filter(e=>e.name==='v8.compileModule'&&e.ts>=origin&&e.ts<task.ts&&String(e.args?.data?.scriptId)===String(call.scriptId)&&e.args.data.url===call.url),'module compilation');
 assert(compile.ph==='X'&&compile.cat==='v8,devtools.timeline'&&compile.ts<metadata.ts&&compile.args.fileName===call.url&&frames(compile).every(ref=>ref===frame),'N3 startup proof: module compilation order');
 const modules=thread.filter(e=>e.name==='v8.evaluateModule'&&e.ts>=origin&&e.ts<task.ts);
 const module=unique(modules,'initial module evaluation');
 assert(module.ph==='X'&&module.cat==='v8,devtools.timeline'&&module.args?.worldId===0&&frames(module).every(ref=>ref===frame)&&(module.args.fileName===undefined||module.args.fileName===call.url)&&sourceEvent.ts+sourceEvent.dur<=module.ts&&module.ts+module.dur<=task.ts,'N3 startup proof: main-world initial module');
 const timerId=fire.args?.data?.timerId;assert(Number.isSafeInteger(timerId)&&timerId>0,'N3 startup proof: timer ID');
 const installations=thread.filter(e=>e.name==='TimerInstall'&&e.ts>=origin&&e.ts<task.ts+task.dur&&e.args?.data?.timerId===timerId);
 const install=unique(installations,'timer installation');
 assert(inside(install,module)&&install.ph==='I'&&install.cat==='devtools.timeline'&&install.s==='t'&&install.args.data.frame===frame&&install.args.data.singleShot===true&&install.args.data.timeout===0,'N3 startup proof: startup timer installation');
 assert(!thread.some(e=>e.name==='TimerRemove'&&e.ts>=install.ts&&e.ts<=fire.ts&&e.args?.data?.timerId===timerId),'N3 startup proof: cancelled timer');
 assert.equal(thread.filter(e=>e.name==='TimerFire'&&e.ts>=install.ts&&e.ts<=fire.ts&&e.args?.data?.timerId===timerId).length,1,'N3 startup proof: reused timer');
 const stack=install.args.data.stackTrace;
 assert(Array.isArray(stack)&&stack.length>0,'N3 startup proof: scheduling stack');
 for(const frame of stack)assert(String(frame.scriptId)===String(call.scriptId)&&frame.url===call.url,'N3 startup proof: scheduling source');
 const declaration=declarations(source,call,stack[0],cache);
 // The no-input boundary is causal, not a duration cutoff. Unknown event types
 // are not assumed to be navigation lifecycle events.
 for(const event of thread.filter(e=>e.ts>=origin&&e.ts<task.ts+task.dur)){
  assert(event.name!=='EventTiming'&&event.name!=='EventLatency'&&!event.name.startsWith('InputLatency::'),'N3 startup proof: input timing');
  if(event.name==='EventDispatch')assert(lifecycle.has(event.args?.data?.type)&&!overlaps(event,task),'N3 startup proof: input/mixed event dispatch');
 }
 const inspect=(value,key='')=>{
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach(child=>inspect(child,key));return;}
  if('scriptId' in value)assert(String(value.scriptId)===String(call.scriptId),'N3 startup proof: unknown script');
  if('isolate' in value)assert(value.isolate===call.isolate,'N3 startup proof: foreign isolate');
  if('executionContextId' in value)assert(value.executionContextId===meta.executionContextId,'N3 startup proof: foreign context');
  for(const field of ['frame','frameId','frameID','page'])if(field in value)assert(value[field]===frame,'N3 startup proof: foreign nested frame');
  for(const field of ['url','sourceUrl','fileName','scriptURL'])if(value[field])assert(value[field]===call.url,'N3 startup proof: unknown script URL');
  for(const [field,child] of Object.entries(value))if(field!=='sourceText')inspect(child,field);
 };
 for(const event of [metadata,sourceEvent,compile,module,install])inspect(event.args);
 // The parser initiator URL is the navigation document (checked above), not
 // executable script source. Its remaining context bindings still must agree.
 const {initiator,...requestData}=request.args.data;
 inspect({...request.args,data:requestData});
 const {url:documentUrl,...initiatorBindings}=initiator;inspect(initiatorBindings);
 for(const event of children){
  inspect(event.args);
  if(event.ph==='X'){
   assert(completeEvents.get(event.name)===event.cat,'N3 startup proof: unknown executable event');
   if(event.name==='RunMicrotasks')assert(inside(event,wrapper),'N3 startup proof: microtasks outside callback wrapper');
   else if(!['TimerFire','FunctionCall','v8.callFunction'].includes(event.name))assert(inside(event,callEvent),'N3 startup proof: engine work outside known callback');
  }
  else if(event.ph==='I')assert(instantEvents.get(event.name)===event.cat&&event.dur===undefined,'N3 startup proof: unknown instant event');
  else if(event.name==='InteractiveTime')assert(event.ph==='R'&&event.cat==='loading,rail'&&event.dur===undefined,'N3 startup proof: timing mark');
  else if(event.name==='AnimationFrame'||event.name==='AnimationFrame::Script::Execute'){
   assert(['b','e'].includes(event.ph)&&event.cat==='devtools.timeline'&&event.dur===undefined&&Object.keys(event.id2??{}).length===1&&typeof event.id2.local==='string'&&/^0x[a-f0-9]+$/.test(event.id2.local),'N3 startup proof: animation metadata');
   const {start,end}=asyncPair(thread,event);
   // A paired metadata endpoint may begin just before this task; its bindings
   // still participate in the proof and must identify the same source/frame.
   inspect(start.args);inspect(end.args);
   if(event.name==='AnimationFrame::Script::Execute'){
    assert(start.ts<=callEvent.ts&&end.ts>=callEvent.ts+callEvent.dur&&start.ts>=task.ts&&end.ts<=task.ts+task.dur,'N3 startup proof: known animation script span');
    const timing=start.args?.animation_frame_script_timing_info;
    assert(timing?.invoker_type==='USER_CALLBACK'&&timing.property_like_name==='TimerHandler:setTimeout'&&timing.class_like_name===''&&timing.source_location_function_name===call.functionName&&timing.source_location_url===call.url&&timing.source_location_char_position===point(source,call.lineNumber,call.columnNumber),'N3 startup proof: animation callback source');
   }else assert(start.ts<=callEvent.ts&&end.ts>=callEvent.ts+callEvent.dur,'N3 startup proof: known animation frame span');
  }else assert.fail('N3 startup proof: unknown event');
 }
 return {qualified:true,kind:'initial-module-background-drain',navigationId:attribution.navigationId,frame,pid:attribution.pid,tid:attribution.tid,traceIndex:task.index,fullTaskMs:task.dur/1000,timerId,installTraceIndex:install.index,moduleTraceIndex:module.index,scriptId:String(call.scriptId),isolate:call.isolate,executionContextId:meta.executionContextId,sourceUrl:call.url,sourceSha256:digest(source),sourceBytes:Buffer.byteLength(source),declarationSha256:declaration.declarationSha256};
}

export function proveColdStartupTask(lhr,trace,task,attribution,cache=new Map()){
 try{return prove(lhr,trace,task,attribution,cache);}
 catch(error){if(!['ERR_ASSERTION','MODULE_NOT_FOUND'].includes(error?.code)&&!(error instanceof TypeError)&&!(error instanceof SyntaxError))throw error;return {qualified:false,reason:error.message.split('\n')[0]};}
}
export function summarizeStartupAcceptance(runs,{correlated=false}={}){
 const exceptions=[],cache=new Map();
 for(const run of runs){
  const lhr=JSON.parse(run.lighthouse.rawLhr),trace=decodeMobileTrace(run.lighthouse.trace);
  const attribution=attributeMobileTasks(lhr,trace,{correlated});
  assert.deepEqual(run.lighthouse.attribution,attribution,'N3: task attribution differs from raw trace');
  for(const task of attribution.tasks.filter(t=>t.kind==='application-or-unattributed'&&t.duration>MOBILE_STARTUP_ACCEPTANCE.targetMs)){
   exceptions.push({visit:run.run,index:task.index,startTime:task.startTime,duration:task.duration,excessMs:task.duration-MOBILE_STARTUP_ACCEPTANCE.targetMs,proof:proveColdStartupTask(lhr,trace,task,attribution,cache)});
  }
 }
 return {policy:{...MOBILE_STARTUP_ACCEPTANCE},runs:runs.length,exceptionalTaskCount:exceptions.length,affectedVisits:[...new Set(exceptions.map(task=>task.visit))],totalExcessMs:exceptions.reduce((sum,task)=>sum+task.excessMs,0),maxExceptionalTaskMs:Math.max(0,...exceptions.map(task=>task.duration)),exceptions};
}
export function validateStartupAcceptance(summary){
 assert.deepEqual(summary.policy,MOBILE_STARTUP_ACCEPTANCE,'N3: current startup policy differs');
 assert.equal(summary.runs,MOBILE_STARTUP_ACCEPTANCE.runsPerRoute,'N3: startup acceptance requires20 visits');
 assert(summary.exceptions.every(task=>task.proof.qualified),'N3: application/unattributed task over50ms lacks positive cold-start proof');
 assert(summary.maxExceptionalTaskMs<=MOBILE_STARTUP_ACCEPTANCE.maxExceptionalTaskMs,'N3: exceptional startup task over55ms');
 assert(summary.exceptionalTaskCount<=MOBILE_STARTUP_ACCEPTANCE.maxExceptionalTasks,'N3: more than2 exceptional startup tasks');
 assert(summary.affectedVisits.length<=MOBILE_STARTUP_ACCEPTANCE.maxAffectedVisits,'N3: more than2 affected startup visits');
 assert(summary.totalExcessMs<=MOBILE_STARTUP_ACCEPTANCE.maxExcessMs,'N3: startup excess above10ms');
 return summary;
}
