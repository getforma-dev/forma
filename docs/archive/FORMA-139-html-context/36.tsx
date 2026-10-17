import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';
const [rows]=createSignal([{id:'a',label:'A'},{id:'b',label:'B'}]);
export function Island(){return createList(rows,r=>r.id,r=>h('b',null,r.label));}
export function Page(){return h('main',null,Island());}
activateIslands({Island});mount(()=>Page(),'#app');
