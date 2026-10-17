import { expect, it } from 'vitest';
import { analyzeIslandBindings } from '../src/island-bindings';
const head = `import {h,createSignal,createEffect} from '@getforma/core';`;
it.each([
  ['named effect callback', 'function bump(){setN(2);}createEffect(bump);'],
  ['optional call in initializer', 'const ignored=setN?.(2);'],
  ['nested immediate effect', 'createEffect(()=>{createEffect(()=>setN(2));});'],
])('refuses seed-changing execution through %s', (_label, statement) => {
  const source = head + `export function Counter(){const [n,setN]=createSignal(1);${statement}return h('b',null,n);}`;
  expect(() => analyzeIslandBindings(source, '/review.ts', 'Counter', {props:[]})).toThrow(/BUILD-610/);
});
it('refuses an immediate constructor that changes a captured getter', () => {
  const source = head + `const [n,setN]=createSignal(1);class Bump{constructor(){setN(2);}}export function Counter(){createEffect(()=>{new Bump();});return h('b',null,n);}`;
  expect(() => analyzeIslandBindings(source, '/review.ts', 'Counter', {props:[]})).toThrow(/BUILD-610/);
});
