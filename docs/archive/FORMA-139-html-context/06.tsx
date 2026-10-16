import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('div',null,h('option',{value:'a'},'A'));}
mount(()=>Page(),'#app');
