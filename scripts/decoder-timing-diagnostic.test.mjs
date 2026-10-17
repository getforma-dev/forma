import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeTiming,validateTimingControls} from './decoder-timing-diagnostic.mjs';
const timing=(extra={})=>({startTime:10,returnTime:20,entryTime:74,activationCompleteTime:76,validationStartTime:77,validationEndTime:150,endTime:151,longTasks:[],...extra});
const task=(startTime,duration)=>({entryType:'longtask',startTime,duration,name:'self',attribution:[{name:'unknown',containerType:'window'}]});
test('a64ms public entry can contain10ms public call and54ms waiting without claiming a blocking task',()=>{
 const result=summarizeTiming(timing(),64);assert.equal(result.publicEntryMs,64);assert.equal(result.synchronousReturnMs,10);assert.equal(result.returnToEntryMs,54);assert.deepEqual(result.longTasks,[]);
});
test('original public duration and timestamp ordering cannot be rewritten',()=>{
 assert.throws(()=>summarizeTiming(timing(),30),/original public entry metric/);
 for(const extra of [{returnTime:80},{entryTime:9},{activationCompleteTime:73},{validationStartTime:151},{endTime:149},{entryTime:NaN}])assert.throws(()=>summarizeTiming(timing(extra),64));
});
test('a long task spanning entry and hashing retains whole raw interval with separate overlaps',()=>{
 const raw=task(5,160),result=summarizeTiming(timing({longTasks:[raw]}),64);
 assert.deepEqual(result.longTasks[0].raw,raw);assert.equal(result.longTasks[0].endTime,165);
 assert.deepEqual(result.longTasks[0].overlapMs,{synchronousPublicCall:10,returnToEntry:54,entryToActivationComplete:2,postEntryValidation:73});
});
test('out-of-interval tasks remain raw evidence with zero overlaps; negative controls have no entry',()=>{
 const raw=task(200,60),result=summarizeTiming(timing({longTasks:[raw]}),64);
 assert.deepEqual(result.longTasks[0].raw,raw);assert(Object.values(result.longTasks[0].overlapMs).every(n=>n===0));
 const refused=summarizeTiming(timing({entryTime:null}),null);assert.equal(refused.publicEntryMs,null);assert.equal(refused.returnToEntryMs,null);
 assert.throws(()=>summarizeTiming(timing({entryTime:null}),64));
});
test('live control validator requires an observed busy task and clean timer wait',()=>{
 const busy={mode:'busy',elapsedMs:110,timing:timing({startTime:10,returnTime:120,entryTime:120,activationCompleteTime:120,validationStartTime:120,validationEndTime:120,longTasks:[task(9,112)]})};
 const timer={mode:'timer',elapsedMs:81,timing:timing({startTime:10,returnTime:11,entryTime:91,activationCompleteTime:91,validationStartTime:91,validationEndTime:91})};
 validateTimingControls([busy,timer]);
 const missing=structuredClone(busy);missing.timing.longTasks=[];assert.throws(()=>validateTimingControls([missing,timer]),/not observed/);
 const blocked=structuredClone(timer);blocked.timing.longTasks=[task(20,60)];assert.throws(()=>validateTimingControls([busy,blocked]),/actual long task/);
 const short=structuredClone(timer);short.timing.returnTime=60;assert.throws(()=>validateTimingControls([busy,short]),/isolate waiting/);
});

test('the actual served boot keeps the public64ms value while measuring10ms synchronous and54ms wait',async()=>{
 const {decoderBootSource}=await import('./release-performance-decoder.mjs');
 const {runInNewContext}=await import('node:vm');
 for(const enabled of [false,true]){
  let clock=0,captures=0;
  const window={};
  const context={window,performance:{now:()=>clock},setTimeout,console:{error(){}},TextEncoder,
    crypto:{subtle:{digest:async()=>new Uint8Array([0]).buffer}},
    document:{addEventListener(){},querySelector:()=>({getAttribute:()=> 'pending'}),querySelectorAll:()=>[{}]},
    MutationObserver:class{observe(){}takeRecords(){return [];}disconnect(){}},
    PerformanceObserver:class{constructor(){captures++;}observe(){}takeRecords(){return [];}disconnect(){}},
    __islandRegistration:component=>component,h:()=>({}),
    activateIslands:registry=>{clock+=10;return new Promise(resolve=>setTimeout(()=>{clock+=54;registry.Decoder({value:'x'});resolve();},0));}};
  const boot=decoderBootSource(enabled).replace(/^import [^;]+;/,'');
  runInNewContext(boot,context);
  const value=await window.runDecoder({});
  assert.equal(value.elapsedMs,64);assert.equal(value.calls,1);assert.equal(captures,enabled?1:0);
  if(enabled){
   const summary=summarizeTiming(JSON.parse(JSON.stringify(value.timing)),value.elapsedMs);
   assert.equal(summary.synchronousReturnMs,10);assert.equal(summary.returnToEntryMs,54);
   assert.equal(value.timing.entryTime,64);assert.equal(value.timing.validationStartTime,64);
  }else assert.equal(value.timing,undefined);
 }
});
