import {h,mount,activateIslands,createSignal,createList} from '@getforma/core';
type Row={id:string,label:string,user:{id:string,name:string},children:{id:string,label:string}[]};
function Badge(p:{label:string}){return h('b',null,p.label);} export function Counter(p:{rows:Row[]}){return h('ul',null,createList(()=>p.rows,r=>r.id,r=>h('li',null,Badge({label:r.label}))));}
function Page(p:{rows:Row[]}){return h('main',null,Counter({rows:p.rows}));}
mount(()=>Page({rows:[]}), '#app');
activateIslands({Counter,Badge});
