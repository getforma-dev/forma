import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import {observeActivation,ACTIVATION_DONE_EXPRESSION} from './release-activation-observer.mjs';

const observation={done:true,expected:2,active:2,responded:2,firstPaintMs:100,lastResponseMs:125,
 longTasks:[{startTime:120,duration:53}],errors:['retained application error']};
class Protocol extends EventEmitter{
 constructor({evaluate,setup}={}){super();this.calls=[];this.evaluate=evaluate;this.setup=setup;this.contextId=1;}
 context(id=this.contextId,frameId='main',isDefault=true){
  this.emit('Runtime.executionContextCreated',{context:{id,uniqueId:`context-${id}`,auxData:{frameId,isDefault}}});
 }
 async send(method,params){
  this.calls.push({method,params,at:performance.now()});
  const override=await this.setup?.(method,params,this);
  if(override!==undefined)return override;
  if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'main',loaderId:'first'}}};
  if(method==='Runtime.enable'){this.context();return {};}
  if(method==='Runtime.evaluate'){
   if(this.evaluate)return this.evaluate(params,this);
   return {result:{type:params.expression===ACTIVATION_DONE_EXPRESSION?'boolean':'object',value:params.expression===ACTIVATION_DONE_EXPRESSION?true:structuredClone(observation)}};
  }
  return {};
 }
}
const evaluateResult=value=>({result:{type:typeof value,value}});
const noListeners=p=>assert.deepEqual(p.eventNames(),[],'all protocol listeners must be removed');

test('passive polling retains truthiness, the complete observation and the 100ms delivery interval',async()=>{
 for(const done of [true,1,'complete',{}]){
  let polls=0;
  const p=new Protocol({evaluate(params){
   if(params.expression===ACTIVATION_DONE_EXPRESSION){polls++;return evaluateResult(runInNewContext(params.expression,{window:{__formaPerformance:{done:polls===1?0:done}}}));}
   return evaluateResult(structuredClone(observation));
  }});
  const actual=await observeActivation(p);
  assert.deepEqual(actual,observation);assert.equal(polls,2);noListeners(p);
  const evals=p.calls.filter(c=>c.method==='Runtime.evaluate');
  assert(evals.at(-1).at-evals.at(-2).at>=99,'read must follow the unchanged observer-delivery interval');
  assert.deepEqual(evals.map(c=>c.params.expression),[ACTIVATION_DONE_EXPRESSION,ACTIVATION_DONE_EXPRESSION,'window.__formaPerformance']);
  for(const {params}of evals){assert.equal(params.uniqueContextId,'context-1');assert.equal(params.returnByValue,true);assert.equal(params.awaitPromise,false);assert.equal(params.userGesture,false);}
 }
});

test('subframe and isolated-world contexts cannot replace the main default context',async()=>{
 const p=new Protocol({setup(method,params,p){if(method==='Runtime.enable'){p.context(4,'child');p.context(7,'main',false);p.context(2);return {};}}});
 await observeActivation(p);assert(p.calls.filter(c=>c.method==='Runtime.evaluate').every(c=>c.params.uniqueContextId==='context-2'));noListeners(p);
});

test('known destroyed-context errors rebind navigation without retrying a stale context',async()=>{
 let polls=0;
 const p=new Protocol({evaluate(params,p){
  if(++polls===1){
   p.emit('Runtime.executionContextsCleared');p.emit('Page.frameNavigated',{frame:{id:'main',loaderId:'second'}});p.context(2);
   throw new Error('cdpSession.send: Protocol error (Runtime.evaluate): uniqueContextId not found');
  }
  return evaluateResult(params.expression===ACTIVATION_DONE_EXPRESSION?true:observation);
 }});
 assert.deepEqual(await observeActivation(p),observation);
 assert.deepEqual(p.calls.filter(c=>c.method==='Runtime.evaluate').map(c=>c.params.uniqueContextId),['context-1','context-2','context-2']);noListeners(p);
});

test('context lifecycle events wait for the new main document without evaluating a destroyed context',async()=>{
 const p=new Protocol({setup(method,params,p){if(method==='Runtime.enable'){
  p.context();p.emit('Runtime.executionContextDestroyed',{executionContextId:1});
  p.emit('Page.frameDetached',{frameId:'main'});
  setTimeout(()=>{p.emit('Page.frameNavigated',{frame:{id:'next-main'}});p.context(2,'next-main');},5);return {};
 }}});
 await observeActivation(p);assert(p.calls.filter(c=>c.method==='Runtime.evaluate').every(c=>c.params.uniqueContextId==='context-2'));noListeners(p);
});

test('JavaScript exceptionDetails and arbitrary protocol errors fail without retries',async()=>{
 for(const mode of ['exception','protocol','lookalike']){
  let calls=0;
  const p=new Protocol({evaluate(){calls++;if(mode==='exception')return {exceptionDetails:{text:'Uncaught',exception:{description:'Error: collector getter failed'}}};
   throw new Error(mode==='protocol'?'Target closed':'Unexpected state: Cannot find context with specified id: application fault');
  }});
  await assert.rejects(observeActivation(p),mode==='exception'?/collector getter failed/:mode==='protocol'?/Target closed/:/application fault/);
  assert.equal(calls,1);noListeners(p);
 }
});

test('malformed or non-boolean protocol completion is not accepted',async()=>{
 for(const result of [undefined,{type:'string',value:'true'},{type:'undefined'},{type:'object',objectId:'remote'}]){
  const p=new Protocol({evaluate:()=>({result})});
  await assert.rejects(observeActivation(p),/result absent|did not return a boolean|not returned by value/);noListeners(p);
 }
});

test('final read exceptions and original raw errors remain distinct',async()=>{
 const p=new Protocol({evaluate:params=>params.expression===ACTIVATION_DONE_EXPRESSION?evaluateResult(true):{exceptionDetails:{text:'final read failed'}}});
 await assert.rejects(observeActivation(p),/final read failed/);noListeners(p);
});

test('one overall deadline covers hanging setup and evaluation protocol sends',async()=>{
 for(const method of ['Page.enable','Runtime.evaluate']){
  const p=new Protocol({setup(name){if(name===method)return new Promise(()=>{});}});
  const start=performance.now();
  await assert.rejects(observeActivation(p,{timeoutMs:30}),/timed out after 30ms/);
  assert(performance.now()-start<1000,'a stuck send must not hang the observer');noListeners(p);
 }
});

test('navigation and context retries do not restart the overall deadline',async()=>{
 let polls=0;
 const p=new Protocol({evaluate(params,p){polls++;p.emit('Runtime.executionContextsCleared');p.emit('Page.frameNavigated',{frame:{id:'main'}});p.context(++p.contextId);throw new Error('Execution context was destroyed.');}});
 await assert.rejects(observeActivation(p,{timeoutMs:50}),/timed out after 50ms/);
 assert(polls>=2);noListeners(p);
});

test('a result arriving after the monotonic deadline is rejected even before the timer callback',async t=>{
 let clock=100;
 t.mock.method(performance,'now',()=>clock);
 const p=new Protocol({evaluate(){clock=12101;return evaluateResult(true);}});
 await assert.rejects(observeActivation(p),/timed out after 12000ms/);noListeners(p);
});

test('successful and failed observations clear every timer and event listener',async t=>{
 const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout,active=new Set();
 t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>{let id;id=realSet(()=>{active.delete(id);fn(...args);},ms);active.add(id);return id;});
 t.mock.method(globalThis,'clearTimeout',id=>{active.delete(id);return realClear(id);});
 const good=new Protocol();await observeActivation(good);noListeners(good);assert.equal(active.size,0);
 const bad=new Protocol({evaluate:()=>evaluateResult(false)});await assert.rejects(observeActivation(bad,{timeoutMs:25}),/timed out/);noListeners(bad);assert.equal(active.size,0);
});

test('the actual producer uses passive observation and closes the browser on observer failure',async()=>{
 const source=readFileSync(new URL('./release-performance-mobile.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('export async function measureActivation'),source.indexOf('export async function audit')).replace('export ','').replaceAll('import(','load(');
 let closes=0,observed=0;const cdp={send:async()=>({})};
 const page={goto:async()=>{},waitForFunction(){throw new Error('heavy Playwright helper initialized');},waitForTimeout(){throw new Error('unexpected browser wait');},evaluate(){throw new Error('unexpected Playwright evaluate');}};
 const context={addInitScript:async()=>{},newPage:async()=>page,newCDPSession:async()=>cdp};
 const load=async()=>({chromium:{launch:async()=>({newContext:async()=>context,close:async()=>{closes++;}})}});
 const profile={screenEmulation:{width:412,height:823,deviceScaleFactor:1.75},throttling:{requestLatencyMs:562.5,downloadThroughputKbps:1474.56,uploadThroughputKbps:675,cpuSlowdownMultiplier:4}};
 const measure=new Function('load','MOBILE_PROFILE','activationInstrumentation','observeActivation',`return (${body.trim()});`)(load,profile,()=>{},async actual=>{assert.equal(actual,cdp);observed++;throw new Error('passive observer failure');});
 await assert.rejects(measure('http://fixture.invalid/','tenant-login'),/passive observer failure/);
 assert.equal(observed,1);assert.equal(closes,1);
});
