import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';
function Helper(){return createShow(()=>true,()=>h('b',null,'one'),()=>h('i',null,'two'));}
export function Island(){return Helper();}
export function Page(){return h('main',null,Island());}
activateIslands({Island});mount(()=>Page(),'#app');
