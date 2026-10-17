import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('label',null,h('input',{id:'x'}),h('input',{id:'y'}));}
mount(()=>Page(),'#app');
