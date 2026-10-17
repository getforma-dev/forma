import {h,mount,activateIslands,createSignal,createList} from '@getforma/core';
type Row={id:string,label:string,user:{id:string,name:string},children:{id:string,label:string}[]};
export function Counter(p:{rows:Row[]}){return h('ul',null,createList(()=>p.rows,r=>r.id,r=>h('li',null,r.label,createList(()=>r.children,c=>c.id,c=>h('b',null,c.label)))));}
function Page(p:{rows:Row[]}){return h('main',null,Counter({rows:p.rows}));}
mount(()=>Page({rows:[]}), '#app');
activateIslands({Counter});
