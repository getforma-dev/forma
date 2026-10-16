import {h,createSignal,createShow,createList} from '@getforma/core';
export function Panel(){
 const [open,setOpen]=createSignal(true);
 const [rows,setRows]=createSignal([{id:'a',label:'A'},{id:'b',label:'B'}]);
 return <section id="mixed-panel">
  <button id="mixed-toggle" onClick={()=>setOpen(!open())}>toggle</button>
  <button id="mixed-reorder" onClick={()=>setRows([...rows()].reverse())}>reorder</button>
  {createShow(open,()=> <strong id="mixed-open">open</strong>,()=> <em id="mixed-closed">closed</em>)}
  <ul id="mixed-rows">{createList(rows,row=>row.id,row=> <li>{row.label}</li>)}</ul>
 </section>;
}
