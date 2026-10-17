import {h,Fragment,createSignal,createList,activateIslands,mount} from '@getforma/core';
export function Counter(p:{rows:{id:string;live:boolean;name:string}[]}){return createList(()=>p.rows,r=>r.id,r=>r.live?h('li',null,r.name):null);}
export function register(){activateIslands({Counter})};
