import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('button',null,h('button',null,'go'));}
mount(()=>Page(),'#app');
