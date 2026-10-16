import {h,mount,activateIslands,createSignal} from '@getforma/core';
function BadTab(p:{value:string}){const[value,setValue]=createSignal(p.value);return h('svg',{id:'bad-tab',TabIndex:value,onClick:()=>setValue('2')},h('text',null,'TabIndex'));}
function BadData(p:{value:string}){const[value,setValue]=createSignal(p.value);return h('svg',{id:'bad-data','data-Foo':value,onClick:()=>setValue('2')},h('text',null,'data-Foo'));}
function Good(p:{value:string}){const[value,setValue]=createSignal(p.value);return h('svg',{id:'good',tabIndex:value,className:'valid',viewBox:'0 0 100 100',onClick:()=>setValue('2')},h('text',null,'Good'));}
function Page(){return h('main',null,BadTab({value:'1'}),BadData({value:'1'}),Good({value:'1'}));}
activateIslands({BadTab,BadData,Good});mount(Page,'#app');
