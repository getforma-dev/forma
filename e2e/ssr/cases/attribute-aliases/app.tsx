import {h,mount,activateIslands,createSignal} from '@getforma/core';
function AttributeAliases(p:{name:string;target:string;tab:number}) {
  const [name,setName]=createSignal(p.name),[target,setTarget]=createSignal(p.target),[tab,setTab]=createSignal(p.tab);
  return h('section',{id:'aliases'},
    h('label',{id:'static-label',className:'static',htmlFor:'field',tabIndex:2},'Static'),
    h('label',{id:'dynamic-label',className:name,htmlFor:target,tabIndex:tab,'data-className':'unrelated'},'Dynamic'),
    h('input',{id:'field'}),h('input',{id:'other'}),
    h('svg',{id:'alias-svg',className:name,htmlFor:target,tabIndex:tab},h('text',null,'SVG')),
    h('button',{id:'update-aliases',onClick:()=>{setName('changed');setTarget('other');setTab(4);}},'Update'));
}
function Page(){return h('main',null,AttributeAliases({name:'initial',target:'field',tab:1}));}
activateIslands({AttributeAliases});mount(Page,'#app');
