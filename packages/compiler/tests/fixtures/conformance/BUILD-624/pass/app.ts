import {h,mount} from '@getforma/core';
export function Page(p:{markup:string}){return h('iframe',{srcdoc:null,title:p.markup});}
mount(()=>Page({markup:'ordinary data'}),'#app');
