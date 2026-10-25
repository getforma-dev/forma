/** Real source compiled both with ordinary JSX and the product list compiler. */
export const listKeyOwnershipSource = `
import {h,createRoot,createList,createSignal,createEffect,onCleanup} from '@getforma/core';
export function makeList(target,count,nan,rerender=false,duplicate=false){
 const ledger=[];
 const make=(token,version=0)=>({token,version,key:token===0||(duplicate&&token===1)?(nan?NaN:0):token});
 const [items,setItems]=createSignal(Array.from({length:count},(_,i)=>make(i)));
 const [pulse,setPulse]=createSignal(0);let stop;
 function record(item,index){
  const entry={item,index,node:null,effectRuns:0,effectCleanups:0,bindingReads:0,calls:0};
  ledger.push(entry);
  createEffect(()=>{pulse();entry.effectRuns++;onCleanup(()=>entry.effectCleanups++);});
  return entry;
 }
 function bind(entry){entry.bindingReads++;return entry.item.token+':'+entry.item.version+':'+pulse()+':'+entry.index();}
 function capture(entry,node){
  entry.node=node;
  const input=document.createElement('input');input.value='owned-'+entry.item.token;node.appendChild(input);
  return node;
 }
 createRoot(dispose=>{
  stop=dispose;
  target.appendChild(createList(items,item=>item.key,(item,index)=>{
   const entry=record(item,index);
   return capture(entry,<div data-token={item.token}><span>{()=>bind(entry)}</span><button onClick={()=>entry.calls++}>ping</button></div>);
  },{updateOnItemChange:rerender?'rerender':'none'}));
 });
 function snapshot(){return ledger.map((entry,generation)=>({generation,token:entry.item.token,version:entry.item.version,effectRuns:entry.effectRuns,effectCleanups:entry.effectCleanups,bindingReads:entry.bindingReads,calls:entry.calls,live:target.contains(entry.node),index:entry.index()}));}
 function tick(){const before=snapshot();setPulse(pulse()+1);const after=snapshot();return after.map((row,i)=>({...row,effectDelta:row.effectRuns-before[i].effectRuns,bindingDelta:row.bindingReads-before[i].bindingReads}));}
 return {target,ledger,items,setItems,make,snapshot,tick,dispose:()=>stop()};
}
`;
