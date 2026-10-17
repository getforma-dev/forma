import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('ul',null,h('li',null,'one',h('li',null,'two')));}
mount(()=>Page(),'#app');
