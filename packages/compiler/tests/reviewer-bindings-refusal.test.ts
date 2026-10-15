import { expect, it } from 'vitest';
import { analyzeIslandBindings } from '../src/island-bindings';
const head=`import {h,createSignal} from '@getforma/core';\n`;
it('refuses a pre-return setter call that changes the rendered seed',()=>{
 expect(()=>analyzeIslandBindings(head+`export function Counter(){const [n,setN]=createSignal(1);setN(2);return h('b',null,n);}`, '/review.ts','Counter',{props:[]})).toThrow(/BUILD-610/);
});
it('does not identify a shadowing helper by a registered component spelling',()=>{
 const source=head+`function Badge(){const [n]=createSignal(3);return h('b',null,n);}export function Counter(){function Badge(){return h('i',null,'local');}return Badge();}`;
 const out=analyzeIslandBindings(source,'/review.ts','Counter',{props:[],islands:new Set(['Badge']),childFields:()=>[]});
 expect(out.bindings.some(x=>x.kind==='child')).toBe(false);
});
it('refuses a setter call hidden in an unused pre-return initializer',()=>{
 expect(()=>analyzeIslandBindings(head+`export function Counter(){const [n,setN]=createSignal(1);const ignored=setN(2);return h('b',null,n);}`, '/review.ts','Counter',{props:[]})).toThrow(/BUILD-610/);
});
it('refuses an immediate effect that calls a helper which changes the rendered seed',()=>{
 const source=head+`import {createEffect} from '@getforma/core';export function Counter(){const [n,setN]=createSignal(1);function bump(){setN(2);}createEffect(()=>bump());return h('b',null,n);}`;
 expect(()=>analyzeIslandBindings(source,'/review.ts','Counter',{props:[]})).toThrow(/BUILD-610/);
});
