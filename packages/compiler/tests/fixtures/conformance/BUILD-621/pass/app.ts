import {h,mount,activateIslands,createSignal,createShow,Fragment} from '@getforma/core';
export function Panel(){return h(Fragment,null,h('section',null,createShow(()=>true,()=>h('b',null,'yes'),()=>h('i',null,'no'))));}
export function Page(){return h('main',null,Panel());}
activateIslands({Panel});mount(()=>Page(),'#app');
