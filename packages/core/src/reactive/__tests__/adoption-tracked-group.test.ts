import {describe,it,expect,vi} from 'vitest';
import {getActiveSub} from 'alien-signals';
import {AdoptionLifecycle} from '../adoption-lifecycle.js';
import {createEffect} from '../effect.js';
import {createSignal} from '../signal.js';

describe('tracked preparation groups',()=>{
 it('restores the surrounding subscriber on construction failure and preserves its later dependencies',()=>{
  const [value,setValue]=createSignal(0),runs=vi.fn();
  const stop=createEffect(()=>{
   const outer=getActiveSub(),scope=new AdoptionLifecycle();
   expect(()=>scope.run(()=>scope.observe(()=>{
    const reader=getActiveSub();
    return scope.trackedGroup(()=>{expect(getActiveSub()).toBe(reader);throw new Error('selected');});
   },()=>{}))).toThrow('selected');
   expect(getActiveSub()).toBe(outer);value();runs();
  });
  expect(runs).toHaveBeenCalledOnce();setValue(1);expect(runs).toHaveBeenCalledTimes(2);stop();
 });
 it('restores the subscriber after reentrant abort without constructing later work',()=>{
  const [value,setValue]=createSignal(0),runs=vi.fn();
  const stop=createEffect(()=>{
   const outer=getActiveSub(),scope=new AdoptionLifecycle();
   expect(()=>scope.run(()=>scope.observe(()=>scope.trackedGroup(()=>scope.abort()),()=>{}))).toThrow('FORMA_E_HYDRATE_STRUCTURE');
   expect(getActiveSub()).toBe(outer);value();runs();
  });
  expect(runs).toHaveBeenCalledOnce();setValue(1);expect(runs).toHaveBeenCalledTimes(2);stop();
 });
});
