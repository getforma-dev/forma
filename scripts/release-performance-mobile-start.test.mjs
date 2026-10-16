import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {activationInstrumentation} from './release-performance-mobile.mjs';
import {validateMobileControls} from './release-performance-contract.mjs';

// Execute the actual init-script function. No browser, elapsed timing or
// invented performance result from this fixture is release evidence.
function probe({readyState='loading',responsive=true,longTask=false}={}) {
 const events=new Map(),frames=[],timeouts=[];
 let scans=0,clicks=0,clock=0,clockStep=0,observer;
 const observed=[];
 const hosts=Array.from({length:100},()=>{
  const output={textContent:'0'};
  const button={click(){clicks++;if(responsive)output.textContent=String(Number(output.textContent)+1);}};
  return {getAttribute:()=> 'pending',querySelector:selector=>selector==='.tile-more'?button:output};
 });
 const context={window:{},document:{readyState,querySelectorAll(){scans++;return hosts;}},
  PerformanceObserver:class{constructor(callback){observer=callback;}observe(options){observed.push(options);}},
  addEventListener(name,callback,options){const list=events.get(name)??[];list.push({callback,once:options?.once});events.set(name,list);},
  requestAnimationFrame(callback){frames.push(callback);},setTimeout(callback,delay){timeouts.push({callback,delay});},
  performance:{getEntriesByName:name=>name==='first-paint'?[{startTime:25}]:[],now(){const value=clock;clock+=clockStep;return value;}}};
 runInNewContext(`(${activationInstrumentation.toString()})({kind:'islands-100',longTask:${longTask}})`,context);
 return {
  get result(){return structuredClone(context.window.__formaPerformance);},
  get scans(){return scans;},get clicks(){return clicks;},frames,timeouts,observed,
  setClock(value,step=0){clock=value;clockStep=step;},
  dispatch(name,event={}){for(const entry of [...(events.get(name)??[])]){if(entry.once)events.set(name,events.get(name).filter(item=>item!==entry));entry.callback(event);}},
  frame(){assert(frames.length,'response frame was not scheduled');frames.shift()();},
  longTasks(entries){observer({getEntries:()=>entries});},
 };
}

test('loading documents do not poll or click before their one DOMContentLoaded start',()=>{
 const page=probe();
 assert.equal(page.frames.length,0,'polling must not join initial document layout');
 assert.equal(page.scans,0);assert.equal(page.clicks,0);
 assert.deepEqual(page.timeouts.map(timer=>timer.delay),[8000]);
 page.dispatch('DOMContentLoaded');assert.equal(page.frames.length,1);
 page.dispatch('DOMContentLoaded');assert.equal(page.frames.length,1);
 page.frame();assert.equal(page.scans,1);assert.equal(page.clicks,10);
 assert.equal(page.timeouts.length,1,'DOMContentLoaded must not reset the absolute timeout');
});

test('interactive and complete documents start immediately without a later duplicate',()=>{
 for(const readyState of ['interactive','complete']){
  const page=probe({readyState});assert.equal(page.frames.length,1);
  page.dispatch('DOMContentLoaded');assert.equal(page.frames.length,1);
  page.frame();assert.equal(page.clicks,10);
 }
});

test('the absolute timeout is terminal if DOMContentLoaded arrives later',()=>{
 const page=probe();page.timeouts[0].callback();assert.equal(page.result.done,true);
 page.dispatch('DOMContentLoaded');
 assert.equal(page.frames.length,0);assert.equal(page.scans,0);assert.equal(page.clicks,0);
 assert.equal(page.result.responded,0);assert.equal(page.result.lastResponseMs,null);
 assert.equal(page.result.done,true);
});

test('an already queued response frame does no work after the absolute timeout',()=>{
 const page=probe();page.dispatch('DOMContentLoaded');assert.equal(page.frames.length,1);
 page.timeouts[0].callback();page.frame();
 assert.equal(page.frames.length,0);assert.equal(page.scans,0);assert.equal(page.clicks,0);
 assert.equal(page.result.responded,0);assert.equal(page.result.lastResponseMs,null);
 assert.equal(page.result.done,true);
});

test('early long tasks and errors remain observed before response polling starts',()=>{
 const page=probe();assert.deepEqual(structuredClone(page.observed),[{type:'longtask',buffered:true}]);
 page.longTasks([{startTime:1,duration:57}]);
 page.dispatch('error',{message:'early page error'});
 page.dispatch('unhandledrejection',{reason:'early rejection'});
 page.dispatch('forma:error',{detail:{code:'EARLY_REFUSAL'}});
 assert.deepEqual(page.result.longTasks,[{startTime:1,duration:57}]);
 assert.deepEqual(page.result.errors,['early page error','early rejection','EARLY_REFUSAL']);
});

test('response latency keeps the original first-paint and absolute response timestamps',()=>{
 const page=probe();page.setClock(100);page.dispatch('DOMContentLoaded');
 for(let frame=0;frame<10;frame++){page.setClock(120+frame*10);page.frame();}
 assert.equal(page.result.responded,100);assert.equal(page.result.active,100);assert.equal(page.clicks,100);
 assert.equal(page.result.firstPaintMs,25);assert.equal(page.result.lastResponseMs,210);
 assert.equal(page.result.lastResponseMs-page.result.firstPaintMs,185);
 assert.equal(page.result.done,true);assert.equal(page.frames.length,0);
});

test('dead responses and the original DOMContentLoaded slow-task controls remain effective',()=>{
 const dead=probe({responsive:false});dead.dispatch('DOMContentLoaded');dead.frame();dead.timeouts[0].callback();
 assert.equal(dead.result.responded,0);assert.equal(dead.result.lastResponseMs,null);
 const slow=probe({longTask:true});slow.setClock(0,1);slow.dispatch('DOMContentLoaded');
 const interval=slow.result.injectedTask;assert(interval.endTime-interval.startTime>=110);
 assert.equal(slow.clicks,0,'the existing slow injection must precede the first response frame');
 slow.longTasks([{startTime:interval.startTime,duration:Math.floor(interval.endTime-interval.startTime)}]);
 for(let frame=0;frame<10;frame++)slow.frame();
 assert.deepEqual(validateMobileControls({dead:dead.result,slow:slow.result}),{deadActivationRefused:true,longTaskRefused:true});
});
