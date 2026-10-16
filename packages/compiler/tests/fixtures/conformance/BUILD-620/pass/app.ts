import {h,mount,activateIslands,createSignal,createShow,Fragment} from '@getforma/core';
export function Panel(){return h('section',null,h('style',null,'.x{color:red}'));}
export function Page(){return h('main',null,Panel());}
activateIslands({Panel});mount(()=>Page(),'#app');
