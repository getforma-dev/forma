import {h,mount} from '@getforma/core';
export function Page(p:{markup:string}){return h('main',null,h('script',null,'void 0;'));} // expect: BUILD-623
mount(()=>Page({markup:'ordinary data'}),'#app');
