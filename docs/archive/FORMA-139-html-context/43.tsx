import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';
function Helper(){return h('section',null,'one');}
export function Island(){return Helper();}
export function Page(){return h('main',null,Island());}
activateIslands({Island});mount(()=>Page(),'#app');
