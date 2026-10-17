import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('form',null,h('section',null,h('form',null,'nested')));}
mount(()=>Page(),'#app');
