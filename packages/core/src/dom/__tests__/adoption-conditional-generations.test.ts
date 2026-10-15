import {describe,it,expect,vi} from 'vitest';
import {prepareAdoption} from '../adoption.js';
import {__adoptionConditional} from '../adoption-description.js';
import {h} from '../element.js';
import {createShow} from '../show.js';
import {createSignal} from '../../reactive/signal.js';
import {createEffect} from '../../reactive/effect.js';
import {registerDisposer} from '../../reactive/root.js';
function fixture(html:string){const doc=document.implementation.createHTMLDocument();doc.body.innerHTML=html;return doc.body.firstElementChild!;}
describe('compiler ternary generations',()=>{
 it('tracks a selected-only signal with a constant condition, reads initially once and writes nothing until change',async()=>{
  const host=fixture('<section><!--f:s0--><b><!--f:t0-->one<!--/f:t0--></b><!--/f:s0--></section>'),original=host.querySelector('b'),[value,setValue]=createSignal('one'),condition=vi.fn(()=>true),selected=vi.fn(()=>h('b',null,value())),outer=vi.fn(),records:MutationRecord[]=[];
  const observer=new MutationObserver(batch=>records.push(...batch));observer.observe(host,{subtree:true,attributes:true,childList:true,characterData:true});
  const plan=prepareAdoption(host,()=>h('section',null,()=>{outer();return __adoptionConditional(condition,selected,()=>null);}));plan.commit();await new Promise(resolve=>setTimeout(resolve,0));
  expect(condition).toHaveBeenCalledOnce();expect(selected).toHaveBeenCalledOnce();expect(outer).toHaveBeenCalledOnce();expect(host.querySelector('b')).toBe(original);expect(records.concat(observer.takeRecords())).toEqual([]);
  setValue('two');expect(host.querySelector('b')!.textContent).toBe('two');expect(selected).toHaveBeenCalledTimes(2);expect(condition).toHaveBeenCalledTimes(2);expect(outer).toHaveBeenCalledTimes(2);
  plan.dispose();setValue('three');expect(selected).toHaveBeenCalledTimes(2);observer.disconnect();
 });
 it('keeps explicit Show boolean caching and excludes its untracked eager branch reads',()=>{
  const host=fixture('<section><!--f:s0--><b>one</b><!--/f:s0--></section>'),[value,setValue]=createSignal('one'),[condition,setCondition]=createSignal(1),selected=vi.fn(()=>h('b',null,value()));
  const plan=prepareAdoption(host,()=>h('section',null,createShow(condition,selected)));plan.commit();setValue('two');setCondition(2);
  expect(selected).toHaveBeenCalledOnce();expect(host.querySelector('b')!.textContent).toBe('one');plan.dispose();
 });
 it('disposes each previous generation, revokes its retained listeners and owns the new live callbacks',()=>{
  const host=fixture('<section><!--f:s0--><button>one</button><!--/f:s0--></section>'),[value,setValue]=createSignal('one'),[tick,setTick]=createSignal(0),cleaned=vi.fn(),effect=vi.fn(),clicked=vi.fn(),ref=vi.fn();
  const branch=()=>{registerDisposer(cleaned);createEffect(()=>{tick();effect();});return h('button',{ref,onClick:()=>{clicked();createEffect(()=>{tick();clicked();});}},value());};
  const plan=prepareAdoption(host,()=>h('section',null,()=>__adoptionConditional(()=>true,branch,()=>null)));
  expect(effect).not.toHaveBeenCalled();expect(ref).not.toHaveBeenCalled();plan.commit();const first=host.querySelector('button')!;expect(effect).toHaveBeenCalledOnce();expect(ref).toHaveBeenCalledOnce();
  setValue('two');expect(cleaned).toHaveBeenCalledOnce();expect(effect).toHaveBeenCalledTimes(2);expect(ref).toHaveBeenCalledTimes(2);first.dispatchEvent(new Event('click'));expect(clicked).not.toHaveBeenCalled();
  host.querySelector('button')!.dispatchEvent(new Event('click'));expect(clicked).toHaveBeenCalledTimes(2);plan.dispose();expect(cleaned).toHaveBeenCalledTimes(2);setTick(1);expect(effect).toHaveBeenCalledTimes(2);expect(clicked).toHaveBeenCalledTimes(2);
 });
 it('leaves old DOM on a failed candidate, drains its work and restores unrelated observer tracking',()=>{
  const host=fixture('<section><!--f:s0--><b>one</b><!--/f:s0--></section>'),[value,setValue]=createSignal('one'),[tick,setTick]=createSignal(0),effect=vi.fn(),cleaned=vi.fn(),failure=vi.fn(),neighbor=vi.fn();
  const stop=createEffect(()=>{tick();neighbor();});
  const plan=prepareAdoption(host,()=>h('section',null,()=>__adoptionConditional(()=>true,()=>{
   const current=value();if(current==='bad'){registerDisposer(cleaned);createEffect(()=>{tick();effect();});throw new Error('candidate');}return h('b',null,current);
  },()=>null)),{failure});plan.commit();const before=host.innerHTML;setValue('bad');
  expect(host.innerHTML).toBe(before);expect(plan.phase).toBe('aborted');expect(failure).toHaveBeenCalledOnce();expect(cleaned).toHaveBeenCalledOnce();expect(effect).toHaveBeenCalledOnce();setTick(1);expect(effect).toHaveBeenCalledOnce();expect(neighbor).toHaveBeenCalledTimes(2);stop();
 });
 it('does not replace the range when a later branch disposes the plan or its predecessor moves the range',()=>{
  for(const move of [false,true]){
   const host=fixture('<section><!--f:s0--><b>one</b><!--/f:s0--></section>'),[value,setValue]=createSignal('one');let plan:ReturnType<typeof prepareAdoption>;
   plan=prepareAdoption(host,()=>h('section',null,()=>__adoptionConditional(()=>true,()=>{
    const current=value();if(current==='one'&&move)registerDisposer(()=>host.parentNode!.appendChild(host.firstChild!));
    if(current==='two'&&!move)plan.dispose();return h('b',null,current);
   },()=>null)));plan.commit();setValue('two');expect(plan.phase).toBe('aborted');expect(host.querySelector('b')!.textContent).toBe('one');expect(host.querySelectorAll('b')).toHaveLength(1);
  }
 });
});
