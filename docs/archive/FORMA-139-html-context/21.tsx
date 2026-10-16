import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('select',null,h('option',{value:'a'},'A'),h('optgroup',{label:'G'},h('option',{value:'b'},'B')));}
mount(()=>Page(),'#app');
