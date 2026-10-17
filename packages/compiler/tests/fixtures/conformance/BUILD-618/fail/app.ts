import {h,mount,activateIslands,createSignal,createShow,Fragment} from '@getforma/core';
export function Page(){return h('p',null,h('div',null,'block'));} // expect: BUILD-618
mount(()=>Page(),'#app');
