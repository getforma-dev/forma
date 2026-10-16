import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('a',null,h('span',null,h('a',{href:'/x'},'link')));}
mount(()=>Page(),'#app');
