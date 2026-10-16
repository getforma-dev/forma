import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('dl',null,h('dd',null,'one',h('dt',null,'two')));}
mount(()=>Page(),'#app');
