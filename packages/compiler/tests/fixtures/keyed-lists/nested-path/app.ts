import {h,mount,activateIslands,createSignal,createList} from '@getforma/core';
type Row={id:string,label:string,user:{id:string,name:string},children:{id:string,label:string}[]};
export function Counter(p:{rows:Row[]}){return h('ul',null,createList(()=>p.rows,r=>r.user.id,r=>h('li',null,r.user.name)));}
function Page(p:{rows:Row[]}){return h('main',null,Counter({rows:p.rows}));}
mount(()=>Page({rows:[]}), '#app');
activateIslands({Counter});
