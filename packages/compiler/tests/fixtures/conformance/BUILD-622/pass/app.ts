import {h,mount,activateIslands,createList,createKeyedRows} from '@getforma/core';
function Rows(p:{rows:{id:string;label:string}[];visible:boolean}){
  const rows=createKeyedRows(p.rows,item=>item.id); 
  return h('ul',null,createList(rows,item=>h('li',null,()=>item().label)));
}
function Page(p:{rows:{id:string;label:string}[];visible:boolean}){return Rows(p);}
activateIslands({Rows});mount(()=>Page(),'#app');
