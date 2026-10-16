import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('ul',null,h('li',null,'A',h('ul',null,h('li',null,'B'))));}
mount(()=>Page(),'#app');
