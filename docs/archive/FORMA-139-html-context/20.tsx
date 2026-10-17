import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('dl',null,h('dt',null,'A'),h('dd',null,'B'));}
mount(()=>Page(),'#app');
