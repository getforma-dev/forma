import { expect, it } from 'vitest';
import { analyzeIslandBindings } from '../src/island-bindings';
const head = `import {h,createSignal,createShow,createList} from '@getforma/core';\n`;
const analyze = (body: string, props: string[] = []) => analyzeIslandBindings(head + body, '/review.tsx', 'Counter', { props });
it('rejects a non-callable lexical alias of a computed value used as a getter', () => {
  expect(()=>analyze(`export function Counter(p){const alias=p.count;return h('b',null,()=>alias());}`,['count'])).toThrow(/BUILD-610/);
});
it('gives each helper invocation its own local signal identity and leaves captures shared', () => {
  const out=analyze(`const [outer,setOuter]=createSignal(9);function Label(p){const [n,setN]=createSignal(p.count);return h('b',null,n,outer);}export function Counter(p){return h('div',null,Label({count:p.first}),Label({count:p.second}));}`,['first','second']);
  expect(out.locals.map(x=>x.ordinal)).toEqual([0,1]);expect(out.captures).toHaveLength(1);
  expect(out.bindings.filter(x=>x.kind==='signal').map((x:any)=>x.value.path)).toEqual([['first'],['second']]);
});
it('keeps same-spelling closures from two modules distinct',()=>{
  const source=head+`import {left} from './one';import {right} from './two';export function Counter(){return h('b',null,left,right);}`;
  const out=analyzeIslandBindings(source,'/review.tsx','Counter',{props:[],loadModule:(_f,p)=>({path:p+'.ts',source:head+`const [n,setN]=createSignal(1);export {n as ${p==='./one'?'left':'right'}};`})});
  expect(out.captures).toHaveLength(2);expect(out.bindings.map(x=>x.kind)).toEqual(['capture','capture','text','text']);
});
