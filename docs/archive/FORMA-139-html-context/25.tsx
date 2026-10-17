import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('label',null,h('span',null,'Name'),h('input',{id:'x'}));}
mount(()=>Page(),'#app');
