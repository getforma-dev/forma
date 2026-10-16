import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('svg',null,h('title',null,'Chart'),h('circle',{r:2}));}
mount(()=>Page(),'#app');
