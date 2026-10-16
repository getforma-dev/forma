import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('button',null,h('a',null,'anchor name'));}
mount(()=>Page(),'#app');
