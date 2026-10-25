/** Source inputs for the real compiler pass, never handwritten compiled output. */
export const boardSource = `
import {h,createRoot,createSignal,createList,hydrateIsland,onError,cleanup} from '@getforma/core';
export let lastBoard;
export function makeBoard(target,adopt=false,failInitial=false){
 const records=new Map(),calls={select:0,remove:0},errors=[],errorInfos=[];
 const [selected,setSelected]=createSignal(null);
 const make=(id,label)=>{
  const [value,setValue]=createSignal(label);
  const item={id,value,setValue,reads:{label:0,selected:0},fail:false,error:new Error('row reader '+id)};
  records.set(id,item);return item;
 };
 const initial=[make(1,'one'),make(2,'two')];
 if(failInitial)initial[1].fail=true;
 const [items,setItems]=createSignal(initial);
 const state={target,records,calls,errors,errorInfos,items,setItems,selected,setSelected,make,cleanup,dispose:()=>{}};
 const stopErrors=onError((error,info)=>{errors.push(error);errorInfos.push(info);});
 lastBoard=state;
 try{
  createRoot(dispose=>{
   state.dispose=()=>{dispose();stopErrors();};
   const Board=()=><section class="board"><ul>{createList(items,item=>item.id,item=><li data-row={item.id} class={()=>{item.reads.selected++;return selected()===item.id?'chosen':'';}}>
    <button class="label" onClick={()=>{calls.select++;setSelected(item.id);}}>{()=>{item.reads.label++;const value=item.value();if(item.fail)throw item.error;return value;}}</button>
    <button class="remove" onClick={()=>{calls.remove++;setItems(items().filter(candidate=>candidate.id!==item.id));}}>remove</button>
   </li>)}</ul></section>;
   if(adopt)hydrateIsland(Board,target);else target.append(Board());
  });
 }catch(error){stopErrors();throw error;}
 return state;
}
export function makeHostileBoard(target){
 const [items,setItems]=createSignal([1]);let calls=0,dispose;
 createRoot(stop=>{dispose=stop;target.append(<ul>{createList(items,id=>id,id=><li title={'" onmouseover="globalThis.__compilerXss=1'}><span>{"<img src=x onerror=globalThis.__compilerXss=1> & quoted"}</span><button onClick={()=>calls++}>go</button></li>)}</ul>);});
 return{add:()=>setItems([1,2]),calls:()=>calls,dispose};
}
export function makeInterleaved(target){
 const trace=[];let seen=0,dispose;
 const [value,setValue]=createSignal('first');
 createRoot(stop=>{dispose=stop;target.append(<ul>{createList(()=>[1],id=>id,id=><li title={(trace.push('parent-expression'),'parent')}><span>{()=>{seen++;trace.push('effect:'+value());return value();}}</span><button title={(trace.push('later-expression:'+seen),String(seen))} onClick={()=>{}}>go</button></li>)}</ul>);});
 return{trace,setValue,dispose};
}
export function makeDisposing(target,compiled){
 let reads=0,calls=0,dispose;const [value,setValue]=createSignal('first');
 const ordinaryRow=id=><li><span>{()=>{reads++;const v=value();dispose();return v;}}</span><button onClick={()=>calls++}>go</button></li>;
 createRoot(stop=>{dispose=stop;const rows=compiled
  ?createList(()=>[1],id=>id,id=><li><span>{()=>{reads++;const v=value();dispose();return v;}}</span><button onClick={()=>calls++}>go</button></li>)
  :createList(()=>[1],id=>id,ordinaryRow);
  target.append(<ul>{rows}</ul>);
 });
 return{setValue,dispose,reads:()=>reads,calls:()=>calls};
}
export function makeDisposingThrow(compiled){
 let firstReads=0,laterReads=0,dispose,thrown;const expected=new Error('later expression');
 const [value,setValue]=createSignal('first');
 const fail=()=>{throw expected;};
 const ordinaryRow=id=><li><span>{()=>{firstReads++;const v=value();dispose();return v;}}</span><span>{()=>{laterReads++;return value();}}</span><button title={fail()} onClick={()=>{}}>go</button></li>;
 try{createRoot(stop=>{dispose=stop;return compiled
  ?createList(()=>[1],id=>id,id=><li><span>{()=>{firstReads++;const v=value();dispose();return v;}}</span><span>{()=>{laterReads++;return value();}}</span><button title={fail()} onClick={()=>{}}>go</button></li>)
  :createList(()=>[1],id=>id,ordinaryRow);
 });}catch(error){thrown=error;}
 return{setValue,expected,thrown,reads:()=>[firstReads,laterReads]};
}
`;

export const servedBoard = '<section class="board"><ul><!--f:l0-->' +
  [1, 2].map(id => `<li data-forma-key="${id}" data-row="${id}" class=""><button class="label"><!--f:t1-->${id === 1 ? 'one' : 'two'}<!--/f:t1--></button><button class="remove">remove</button></li>`).join('') +
  '<!--/f:l0--></ul></section>';

export const nativeIslandSource = `
import {h,createSignal} from '@getforma/core';
export function Counter(props:{text:string}){
 const [value,setValue]=createSignal(props.text);
 return <section><input value={value}/><button onClick={()=>setValue(value()+'!')}><span>append</span></button></section>;
}
`;
export const nativePageSource = `
import {h} from '@getforma/core';
import {Counter} from './island';
export function Page(props:{text:string}){return <main>{Counter({text:props.text})}</main>;}
`;
export const nativeEntrySource = `
import {h,mount,activateIslands} from '@getforma/core';
import {Counter} from './island';
import {Page} from './page';
await activateIslands({Counter});
mount(()=>Page(),'#app');
`;

export const nativeListSource = `
import {h,mount,activateIslands,createSignal,createList} from '@getforma/core';
function Rows(props:{rows:{id:number;name:string}[]}){
 const [rows,setRows]=createSignal(props.rows);
 return <section><button class="add" onClick={()=>setRows([...rows(),{id:rows().length+1,name:'fresh'}])}>add</button><ul>{createList(rows,row=>row.id,row=><li data-row={row.id}><span>{row.name}</span><button class="remove" onClick={()=>setRows(rows().filter(item=>item.id!==row.id))}>remove</button></li>)}</ul></section>;
}
function Page(props:{rows:{id:number;name:string}[]}){return <main><Rows rows={props.rows}/></main>;}
await activateIslands({Rows});
mount(()=>Page({rows:[]}), '#app');
`;
