import {afterEach,describe,expect,it} from 'vitest';
import {cleanup,emitDeclaredPage,readVectors} from './helpers/value-rules';
import {renderDefaults} from './helpers/render';
import {analyzeIslandBindings} from '../src/island-bindings';
import {encodeBindings} from '../src/fmir-contracts';
const table=readVectors<{aliases:{prop:string;attribute:string}[];unchanged:string[]}>('attribute-aliases.json');
afterEach(cleanup);
const head=`import {h,createSignal} from '@getforma/core';`;
function markup(props:string,setup='') {
  return renderDefaults(emitDeclaredPage(`${head} export function Page(){${setup} return h('label',{${props}},'label');}`).binary,{stripMarkers:true});
}
function bindings(props:string) {
  const result=analyzeIslandBindings(`${head} export function Counter(p){return h('label',{${props}},'label');}`,'/aliases.ts','Counter',{props:['value']});
  return Buffer.from(encodeBindings('ssr',result.bindings)).toString('hex');
}
describe('canonical attribute names in native emission and identity',()=>{
  for(const {prop,attribute} of table.aliases) {
    it(`${prop}: static and reactive emission uses ${attribute}`,()=>{
      expect(markup(`${prop}:'initial'`)).toBe(`<label ${attribute}="initial">label</label>`);
      expect(markup(`${prop}:()=>value()`,`const [value]=createSignal('initial');`)).toBe(`<label ${attribute}="initial">label</label>`);
      expect(markup(`${prop}:false`)).toBe('<label>label</label>');
      expect(markup(`${prop}:null`)).toBe('<label>label</label>');
    });
    it(`${prop}: binding identity equals its canonical spelling`,()=>{
      expect(bindings(`${prop}:()=>p.value`)).toBe(bindings(`${attribute}:()=>p.value`));
    });
    it(`${prop}: ambiguous canonical/alias pairs refuse in both orders`,()=>{
      for(const props of [`${prop}:'a',${attribute}:'b'`,`${attribute}:'a',${prop}:'b'`]) {
        expect(()=>markup(props)).toThrow(/BUILD-610.*attribute/s);
        expect(()=>bindings(props.replace(/'a'|'b'/g,'()=>p.value'))).toThrow(/BUILD-610.*attribute/s);
      }
    });
  }
  for(const key of table.unchanged)it(`keeps exact unrelated spelling ${key}`,()=>{
    expect(markup(`${JSON.stringify(key)}:'initial'`)).toBe(`<label ${key}="initial">label</label>`);
  });
  it('scopes duplicate detection to one element',()=>{
    const {binary}=emitDeclaredPage(`${head} export function Page(){return h('main',null,h('p',{className:'a'}),h('p',{class:'b'}));}`);
    expect(renderDefaults(binary,{stripMarkers:true})).toBe('<main><p class="a"></p><p class="b"></p></main>');
  });
});

// These sources serialize through the HTML tokenizer, including foreign
// elements. Duplicate token names are discarded before SVG/MathML adjustment.
describe('HTML serialization attribute collisions across namespaces',()=>{
  const containers=[
    ['HTML',(props:string)=>`h('div',{${props}})`],
    ['SVG',(props:string)=>`h('svg',null,h('g',{${props}}))`],
    ['MathML',(props:string)=>`h('math',null,h('mi',{${props}},'x'))`],
    ['SVG foreignObject HTML child',(props:string)=>`h('svg',null,h('foreignObject',null,h('div',{${props}})))`],
    ['MathML annotation HTML child',(props:string)=>`h('math',null,h('annotation-xml',{encoding:'text/html'},h('div',{${props}})))`],
  ] as const;
  for(const [name,element] of containers) {
    for(const pair of [['tabIndex','TabIndex'],['DATA-A','data-a']] as const) {
      it(`${name}: refuses ${pair.join('/')} in either source order`,()=>{
        for(const [first,last] of [pair,[pair[1],pair[0]]]) {
          const props=`${JSON.stringify(first)}:'first',${JSON.stringify(last)}:'last'`;
          expect(()=>emitDeclaredPage(`${head} export function Page(){return ${element(props)};}`)).toThrow(/BUILD-610.*attribute/s);
        }
      });
    }
  }
  it('refuses a parser-adjusted SVG viewBox/viewbox collision',()=>{
    for(const props of [`viewBox:'0 0 1 1',viewbox:'0 0 2 2'`,`viewbox:'0 0 2 2',viewBox:'0 0 1 1'`]) {
      expect(()=>emitDeclaredPage(`${head} export function Page(){return h('svg',{${props}});}`)).toThrow(/BUILD-610.*attribute/s);
    }
  });
  it('refuses a registered island reactive case collision',()=>{
    expect(()=>emitDeclaredPage(`${head} import {activateIslands} from '@getforma/core';
      function Aliases(p:{value:string}) {return h('div',{tabIndex:()=>p.value,TabIndex:()=>p.value});}
      export function Page(){return Aliases({value:'1'});} activateIslands({Aliases});`)).toThrow(/BUILD-610.*attribute/s);
  });
  it('does not fold Unicode letters or conflate distinct attributes',()=>{
    expect(markup(`'data-Ä':'upper','data-ä':'lower',tabIndex:1,title:'different'`))
      .toBe('<label data-Ä="upper" data-ä="lower" tabindex="1" title="different">label</label>');
  });
  it('does not rewrite or collide user component prop names',()=>{
    const {binary}=emitDeclaredPage(`${head}
      function Child(p:{className:string;class:string}){return h('div',{id:p.className,title:p.class});}
      export function Page(){return Child({className:'first',class:'second'});}`);
    expect(renderDefaults(binary,{stripMarkers:true})).toBe('<div id="first" title="second"></div>');
  });
  it('keeps a single SVG viewBox spelling intact',()=>{
    const {binary}=emitDeclaredPage(`${head} export function Page(){return h('svg',{viewBox:'0 0 10 10'});}`);
    expect(renderDefaults(binary,{stripMarkers:true})).toBe('<svg viewBox="0 0 10 10"></svg>');
  });
});
