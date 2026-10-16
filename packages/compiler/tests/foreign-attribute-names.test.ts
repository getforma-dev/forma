import {afterEach,describe,expect,it} from 'vitest';
import {cleanup,emitDeclaredPage} from './helpers/value-rules';
import {renderDefaults} from './helpers/render';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
const roots:string[]=[];
afterEach(()=>{cleanup();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function entry(source:string){const root=mkdtempSync(join(tmpdir(),'forma-foreign-names-'));roots.push(root);const file=join(root,'app.tsx');writeFileSync(file,source);return generateRealIr(file);}
const head=`import {h,createSignal,createShow,createList,activateIslands} from '@getforma/core';`;
const compile=(element:string,setup='')=>emitDeclaredPage(`${head} export function Page(){${setup}return ${element};}`);
const svgNames='attributeName attributeType baseFrequency baseProfile calcMode clipPathUnits diffuseConstant edgeMode filterUnits glyphRef gradientTransform gradientUnits kernelMatrix kernelUnitLength keyPoints keySplines keyTimes lengthAdjust limitingConeAngle markerHeight markerUnits markerWidth maskContentUnits maskUnits numOctaves pathLength patternContentUnits patternTransform patternUnits pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio primitiveUnits refX refY repeatCount repeatDur requiredExtensions requiredFeatures specularConstant specularExponent spreadMethod startOffset stdDeviation stitchTiles surfaceScale systemLanguage tableValues targetX targetY textLength viewBox viewTarget xChannelSelector yChannelSelector zoomAndPan'.split(' ');
const xlinkNames='actuate arcrole href role show title type'.split(' ');
describe('native foreign attribute spelling and namespace proof',()=>{
  for(const name of ['TabIndex','data-Foo','aria-Label','viewbox','VIEWBOX','preserveaspectratio'])it(`refuses original SVG spelling ${name}`,()=>{
    for(const value of ["'1'",'value'])expect(()=>compile(`h('svg',{${JSON.stringify(name)}:${value}})`,`const[value]=createSignal('1');`)).toThrow(/BUILD-610.*attribute/s);
  });
  for(const name of svgNames)it(`admits exactly the adjusted SVG spelling ${name}`,()=>{
    const {binary}=compile(`h('svg',{${name}:'1'})`);
    expect(renderDefaults(binary,{stripMarkers:true})).toContain(` ${name}="1"`);
    expect(()=>compile(`h('svg',{${name.toLowerCase()}:'1'})`)).toThrow(/BUILD-610.*attribute/s);
  });
  it('keeps the exact aliases and ordinary lowercase foreign attributes',()=>{
    expect(()=>compile(`h('svg',{className:'x',htmlFor:'field',tabIndex:1,'data-foo':'a','aria-label':'b'})`)).not.toThrow();
  });
  it('admits MathML definitionURL and refuses its unadjusted spelling',()=>{
    expect(()=>compile(`h('math',{definitionURL:'x'})`)).not.toThrow();
    expect(()=>compile(`h('math',{definitionurl:'x'})`)).toThrow(/BUILD-610.*attribute/s);
    expect(()=>compile(`h('svg',{definitionURL:'x'})`)).toThrow(/BUILD-610.*attribute/s);
    expect(()=>compile(`h('math',{viewBox:'x'})`)).toThrow(/BUILD-610.*attribute/s);
  });
  for(const name of xlinkNames)it(`admits standard foreign xlink:${name} only with exact namespace spelling`,()=>{
    for(const tag of ['svg','math'])expect(()=>compile(`h('${tag}',{'xlink:${name}':'#x'})`)).not.toThrow();
    expect(()=>compile(`h('svg',{'XLINK:${name}':'#x'})`)).toThrow(/BUILD-610.*attribute/s);
    expect(()=>compile(`h('div',{'xlink:${name}':'#x'})`)).toThrow(/BUILD-610.*attribute/s);
  });
  for(const name of ['xlink:custom','xlink:Href','xml:lang','xml:space','xmlns','xmlns:xlink'])it(`refuses foreign namespace mismatch ${name}`,()=>{
    for(const tag of ['svg','math'])expect(()=>compile(`h('${tag}',{${JSON.stringify(name)}:'x'})`)).toThrow(/BUILD-610.*attribute/s);
  });
  it('preserves ordinary HTML mixed case, XML null namespace, and unrelated colon names',()=>{
    expect(()=>compile(`h('div',{TabIndex:1,'data-Foo':'x','aria-Label':'y','xml:lang':'en',xmlns:'x'})`)).not.toThrow();
    expect(()=>compile(`h('svg',{'xml:custom':'x','other:custom':'y'})`)).not.toThrow();
  });
  for(const wrapper of [
    (child:string)=>`h('svg',null,h('foreignObject',null,${child}))`,
    (child:string)=>`h('svg',null,h('desc',null,${child}))`,
    (child:string)=>`h('math',null,h('mtext',null,${child}))`,
    (child:string)=>`h('math',null,h('annotation-xml',{encoding:'text/html'},${child}))`,
  ])it('uses the HTML namespace below an integration point and foreign again at svg',()=>{
    expect(()=>compile(wrapper(`h('div',{TabIndex:1,'data-Foo':'x'})`))).not.toThrow();
    expect(()=>compile(wrapper(`h('svg',{TabIndex:1})`))).toThrow(/BUILD-610.*attribute/s);
  });
  it('checks the integration element itself in its foreign namespace',()=>{
    expect(()=>compile(`h('svg',null,h('foreignObject',{TabIndex:1},h('div',null,'x')))`)).toThrow(/BUILD-610.*attribute/s);
    expect(()=>compile(`h('math',null,h('mtext',{TabIndex:1},'x'))`)).toThrow(/BUILD-610.*attribute/s);
  });
  it('retains MathML for mglyph under a text integration point',()=>{
    expect(()=>compile(`h('math',null,h('mtext',null,h('mglyph',{definitionURL:'x'})))`)).not.toThrow();
    expect(()=>compile(`h('math',null,h('mtext',null,h('mglyph',{TabIndex:1})))`)).toThrow(/BUILD-610.*attribute/s);
  });
  for(const child of ["h('g',{TabIndex:1})","Child()","createShow(visible,()=>h('g',{TabIndex:1}))","createList(rows,item=>item.id,item=>h('g',{TabIndex:1}))","h('mtext',null,h('mglyph',{TabIndex:1}))"])it(`preserves unknown annotation encoding through ${child}`,()=>{
    const source=`${head} function Child(){return h('g',{TabIndex:1});} export function Page(p:{encoding:string}){const[visible]=createSignal(true);const[rows]=createSignal([{id:'a'}]);return h('math',null,h('annotation-xml',{encoding:()=>p.encoding},${child}));}`;
    expect(()=>emitDeclaredPage(source)).toThrow(/BUILD-610.*attribute/s);
  });
  it('permits a spelling proved in both possible annotation namespaces',()=>{
    expect(()=>emitDeclaredPage(`${head} export function Page(p:{encoding:string}){return h('math',null,h('annotation-xml',{encoding:()=>p.encoding},h('g',{'data-safe':'x'})));}`)).not.toThrow();
  });
  for(const props of ["null","{encoding:'application/xml'}","{encoding:()=>p.encoding}"]){
    const page=(attributes:string)=>`${head} export function Page(p:{encoding:string}){return h('math',null,h('annotation-xml',${props},h('svg',{${attributes}})));}`;
    it(`direct svg in MathML annotation-xml admits viewBox with ${props}`,()=>expect(()=>emitDeclaredPage(page("viewBox:'0 0 1 1'"))).not.toThrow());
    it(`direct svg in MathML annotation-xml refuses definitionURL with ${props}`,()=>expect(()=>emitDeclaredPage(page("definitionURL:'x'"))).toThrow(/BUILD-610.*attribute/s));
  }
  it('checks original registered reactive roots',()=>{
    expect(()=>entry(`${head} import {mount} from '@getforma/core'; function Bad(p:{value:string}){const[value]=createSignal(p.value);return h('svg',{TabIndex:value});} function Page(){return Bad({value:'1'});} activateIslands({Bad});mount(Page,'#app');`)).toThrow(/BUILD-610.*attribute/s);
  });
  it('keeps browserOnly bodies outside native attribute proof',()=>{
    expect(()=>entry(`${head} import {mount,browserOnly} from '@getforma/core'; const Browser=browserOnly(()=>h('svg',{TabIndex:1,'data-Foo':'x'})); function Page(){return h('main',null,Browser());} activateIslands({Browser});mount(Page,'#app');`)).not.toThrow();
  });
  it('checks list/helper context without changing component prop names',()=>{
    expect(()=>compile(`h('svg',null,createList(rows,item=>item.id,item=>h('g',{TabIndex:1})))`,`const[rows]=createSignal([{id:'a'}]);`)).toThrow(/BUILD-610.*attribute/s);
    expect(()=>emitDeclaredPage(`${head} function Child(p:{TabIndex:string}){return h('svg',{'data-safe':p.TabIndex});} export function Page(){return Child({TabIndex:'x'});}`)).not.toThrow();
  });
  it('does not Unicode-fold names or widen downstream ASCII name admission',()=>{
    // This exercises lexical compilation only. Native name validation remains
    // a separate refusal boundary; these are not admitted native attributes.
    expect(()=>compile(`h('svg',{'data-Ä':'x','data-ä':'y'})`)).not.toThrow();
  });
});
