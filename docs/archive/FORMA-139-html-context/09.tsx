import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Page(){return h('select',null,h('optgroup',{label:'A'},h('optgroup',{label:'B'},h('option',null,'B'))));}
mount(()=>Page(),'#app');
