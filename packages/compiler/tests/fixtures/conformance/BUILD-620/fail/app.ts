import {h,mount,activateIslands,createSignal,createShow,Fragment} from '@getforma/core';
export function Panel(){const [css]=createSignal('.x{color:red}');return h('section',null,h('style',null,css));} // expect: BUILD-620
export function Page(){return h('main',null,Panel());}
activateIslands({Panel});mount(()=>Page(),'#app');
