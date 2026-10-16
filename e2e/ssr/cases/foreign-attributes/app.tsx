import {h,mount,activateIslands,createSignal} from '@getforma/core';
function ForeignAttributes(p:{label:string;definition:string;encoding:string}) {
  const[label,setLabel]=createSignal(p.label),[definition,setDefinition]=createSignal(p.definition);
  return h('section',{id:'foreign-attributes'},
    h('svg',{id:'foreign-svg',viewBox:'0 0 100 100',preserveAspectRatio:'xMidYMid meet',className:label,tabIndex:1},
      h('g',{id:'foreign-xlink','xlink:title':label,'data-label':label},h('text',null,'SVG')),
      h('foreignObject',null,h('div',{id:'svg-html',TabIndex:1,'data-Label':label},'HTML'))),
    h('math',{id:'foreign-math',definitionURL:definition},h('mi',null,'x'),
      h('annotation-xml',{encoding:'text/html'},h('div',{id:'math-html',TabIndex:1,'data-Label':label},'HTML')),
      h('annotation-xml',{encoding:()=>p.encoding},h('svg',{id:'xml-svg',viewBox:'0 0 10 10'},h('text',null,'Nested SVG')))),
    h('button',{id:'update-foreign',onClick:()=>{setLabel('changed');setDefinition('updated');}},'Update'));
}
function Page(){return h('main',null,ForeignAttributes({label:'initial',definition:'original',encoding:'application/xml'}));}
activateIslands({ForeignAttributes});mount(Page,'#app');
