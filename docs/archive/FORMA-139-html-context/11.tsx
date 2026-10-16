import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('button',null,h('input',{type:'text'}));}
mount(()=>Page(),'#app');
