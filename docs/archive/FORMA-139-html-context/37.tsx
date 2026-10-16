import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';

export function Island(){return true?h('b',null,'one'):h('i',null,'two');}
export function Page(){return h('main',null,Island());}
activateIslands({Island});mount(()=>Page(),'#app');
