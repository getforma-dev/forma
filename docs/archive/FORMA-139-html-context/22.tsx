import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('a',{href:'/x'},h('span',null,'go'));}
mount(()=>Page(),'#app');
