import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Island(){return <><b>one</b><i>two</i></>;}
export function Page(){return h('main',null,Island());}
activateIslands({Island});mount(()=>Page(),'#app');
