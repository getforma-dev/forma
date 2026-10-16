import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('section',null,h('style',null,'.x{color:red}'));}
mount(()=>Page(),'#app');
