import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('select',null,h('option',null,'A',h('option',null,'B')));}
mount(()=>Page(),'#app');
