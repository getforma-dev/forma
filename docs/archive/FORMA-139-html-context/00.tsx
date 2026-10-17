import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('p',null,h('div',null,'block'));}
mount(()=>Page(),'#app');
