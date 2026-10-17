import {h,mount,activateIslands,createSignal,createList} from '@getforma/core';
type Row={id:string,label:string,user:{id:string,name:string},children:{id:string,label:string}[]};
function Rows(p:{rows:Row[]}){return createList(()=>p.rows,r=>r.id,r=>h('li',null,r.label));} export function Counter(p:{rows:Row[]}){return h('ul',null,Rows({rows:p.rows}),Rows({rows:p.rows}));}
function Page(p:{rows:Row[]}){return h('main',null,Counter({rows:p.rows}));}
mount(()=>Page({rows:[]}), '#app');
activateIslands({Counter});
