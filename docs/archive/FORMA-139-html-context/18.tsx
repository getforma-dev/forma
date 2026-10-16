import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('div',null,h('form',null,'A'),h('form',null,'B'));}
mount(()=>Page(),'#app');
