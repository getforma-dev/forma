import {h,mount,activateIslands,createSignal,createShow,Fragment} from '@getforma/core';
export function Page(){return h('section',null,h('title',null,'Page'));} // expect: BUILD-619
mount(()=>Page(),'#app');
