import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('label',{htmlFor:'x'},h('input',{id:'x'}));}
mount(()=>Page(),'#app');
