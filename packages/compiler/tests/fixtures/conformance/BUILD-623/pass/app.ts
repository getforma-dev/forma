import {h,mount} from '@getforma/core';
export function Page(p:{markup:string}){return h('main',null,h('style',null,'p{color:navy}'));}
mount(()=>Page({markup:'ordinary data'}),'#app');
