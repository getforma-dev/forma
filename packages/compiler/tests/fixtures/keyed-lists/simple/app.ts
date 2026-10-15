import {h,mount,activateIslands,createSignal,createList} from '@getforma/core';
type Row={id:string,label:string,user:{id:string,name:string},children:{id:string,label:string}[]};
export function Counter(p:{rows:Row[]}){const [rows]=createSignal(p.rows);return h('ul',null,createList(rows,r=>r.id,r=>h('li',null,r.label)));}
function Page(p:{rows:Row[]}){return h('main',null,Counter({rows:p.rows}));}
mount(()=>Page({rows:[]}), '#app');
activateIslands({Counter});
