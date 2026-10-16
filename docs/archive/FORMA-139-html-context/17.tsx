import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('div',null,h('a',{href:'/a'},'A'),h('a',{href:'/b'},'B'));}
mount(()=>Page(),'#app');
