import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';
function Helper(){return <><b>one</b><i>two</i></>;}
export function Island(){return Helper();}
export function Page(){return h('main',null,Island());}
activateIslands({Island});mount(()=>Page(),'#app');
