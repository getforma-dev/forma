import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('p',null,'text',h('span',null,'inline'));}
mount(()=>Page(),'#app');
