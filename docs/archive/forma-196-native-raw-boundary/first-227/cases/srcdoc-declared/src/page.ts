import {h} from '@getforma/core';
export function Page(p:{markup:string}) {return h('main',null,h('iframe',{srcdoc:p.markup}));}
