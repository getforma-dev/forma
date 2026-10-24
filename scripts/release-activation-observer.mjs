// Observe the existing activation collector without installing a browser helper.
// Input dispatch and performance timestamps belong exclusively to that collector.
import assert from 'node:assert/strict';

export const ACTIVATION_DONE_EXPRESSION='Boolean(window.__formaPerformance?.done)';
const OBSERVATION_EXPRESSION='window.__formaPerformance';

// Chromium can destroy a context between its lifecycle event and evaluation.
// Do not turn arbitrary protocol failures into retries or extend the deadline.
function destroyedContext(error){
 return /(?:^|: )(?:Execution context was destroyed(?:, most likely because of a navigation)?\.?|Cannot find context with specified id|Cannot find context with specified unique id|uniqueContextId not found)\s*$/.test(String(error?.message??error));
}

export async function observeActivation(cdp,{timeoutMs=12000}={}){
 assert(Number.isFinite(timeoutMs)&&timeoutMs>0,'positive activation timeout required');
 const deadline=performance.now()+timeoutMs;
 const timeoutError=new Error(`Activation observation timed out after ${timeoutMs}ms`);
 let deadlineTimer,delayTimer,mainFrame,frameGeneration=0;
 const contexts=new Map();
 const listeners={
  'Runtime.executionContextCreated':({context})=>{
   if(context.auxData?.isDefault)contexts.set(context.auxData.frameId,context);
  },
  'Runtime.executionContextDestroyed':({executionContextId,executionContextUniqueId})=>{
   for(const [frame,context]of contexts)if(context.id===executionContextId||context.uniqueId===executionContextUniqueId)contexts.delete(frame);
  },
  'Runtime.executionContextsCleared':()=>contexts.clear(),
  'Page.frameNavigated':({frame})=>{if(!frame.parentId){mainFrame=frame;frameGeneration++;contexts.clear();}},
  'Page.frameDetached':({frameId})=>{contexts.delete(frameId);if(mainFrame?.id===frameId)mainFrame=undefined;},
 };
 for(const [event,listener]of Object.entries(listeners))cdp.on(event,listener);
 const expired=new Promise((_,reject)=>{deadlineTimer=setTimeout(()=>reject(timeoutError),timeoutMs);});
 const bounded=async operation=>{
  if(performance.now()>=deadline)throw timeoutError;
  const value=await Promise.race([operation(),expired]);
  if(performance.now()>=deadline)throw timeoutError;
  return value;
 };
 const pause=async ms=>{
  try{await bounded(()=>new Promise(resolve=>{delayTimer=setTimeout(resolve,ms);}));}
  finally{clearTimeout(delayTimer);delayTimer=undefined;}
 };
 const evaluate=async expression=>{
  while(true){
   const context=mainFrame&&contexts.get(mainFrame.id);
   if(!context){await pause(16);continue;}
   assert(typeof context.uniqueId==='string'&&context.uniqueId.length,'CDP default context lacks unique identity');
   let response;
   try{
    response=await bounded(()=>cdp.send('Runtime.evaluate',{expression,uniqueContextId:context.uniqueId,
     returnByValue:true,awaitPromise:false,userGesture:false,timeout:Math.max(1,Math.floor(deadline-performance.now()))}));
   }catch(error){
    if(!destroyedContext(error))throw error;
    if(contexts.get(mainFrame?.id)===context)contexts.delete(mainFrame.id);
    await pause(16);continue;
   }
   if(response.exceptionDetails)throw new Error(`Activation evaluation failed: ${response.exceptionDetails.exception?.description??response.exceptionDetails.text??'JavaScript exception'}`);
   assert(response.result&&typeof response.result.type==='string','CDP evaluation result absent');
   if(response.result.type==='undefined')return undefined;
   assert(Object.hasOwn(response.result,'value'),'CDP evaluation result was not returned by value');
   return response.result.value;
  }
 };
 try{
  await bounded(()=>cdp.send('Page.enable'));
  const generation=frameGeneration;
  const {frameTree}=await bounded(()=>cdp.send('Page.getFrameTree'));
  assert(frameTree?.frame?.id,'CDP main frame absent');
  if(generation===frameGeneration)mainFrame=frameTree.frame;
  await bounded(()=>cdp.send('Runtime.enable'));
  while(true){
   const done=await evaluate(ACTIVATION_DONE_EXPRESSION);
   assert(typeof done==='boolean','CDP completion predicate did not return a boolean');
   if(done)break;
   await pause(16);
  }
  // Preserve the original delivery interval and return the complete raw record.
  await pause(100);
  return await evaluate(OBSERVATION_EXPRESSION);
 }finally{
  clearTimeout(deadlineTimer);clearTimeout(delayTimer);
  for(const [event,listener]of Object.entries(listeners))cdp.off(event,listener);
 }
}
