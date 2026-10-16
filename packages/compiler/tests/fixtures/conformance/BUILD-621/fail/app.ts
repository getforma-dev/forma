import {h,mount,activateIslands,createSignal,createShow,Fragment} from '@getforma/core';
export function Panel(){return createShow(()=>true,()=>h('b',null,'yes'),()=>h('i',null,'no'));} // expect: BUILD-621
export function Page(){return h('main',null,Panel());}
activateIslands({Panel});mount(()=>Page(),'#app');
