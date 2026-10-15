import {h,Fragment,createSignal,createList,activateIslands,mount} from '@getforma/core';
export function Counter(p:{show:boolean;rows:{id:string;live:boolean;name:string}[]}){return h('main',null,p.show?h('b',null,'direct'):null,()=>p.show?h('b',null,'reader'):null,<aside>{p.show?<b>jsx</b>:null}</aside>,createList(()=>p.rows,r=>r.id,r=>r.live?h('li',null,r.name):null));}
export function register(){activateIslands({Counter})};
