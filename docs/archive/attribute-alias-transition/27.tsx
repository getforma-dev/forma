import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('div',null,h('label',{htmlFor:'x'},'Name'),h('input',{id:'x'}));}
mount(()=>Page(),'#app');
