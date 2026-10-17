import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('dl',null,h('dt',null,'one',h('dd',null,'two')));}
mount(()=>Page(),'#app');
