import {h,mount} from '@getforma/core';
export function Page(p:{markup:string}){return h('iframe',{srcdoc:p.markup});} // expect: BUILD-624
mount(()=>Page({markup:'ordinary data'}),'#app');
