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
