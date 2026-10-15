import { describe, expect, it, vi } from 'vitest';
import { prepareAdoption } from '../adoption.js';
import { h } from '../element.js';
import { createShow } from '../show.js';
import { createSignal } from '../../reactive/signal.js';
import { createEffect, internalEffect } from '../../reactive/effect.js';
import { createRoot, registerDisposer } from '../../reactive/root.js';
function fixture(html='<button>run</button>'){const doc=document.implementation.createHTMLDocument();doc.body.innerHTML=html;return doc.body.firstElementChild as HTMLElement;}
describe('prepared event listener boundaries',()=>{
 it('preserves function this, class handler identity and dynamic handleEvent lookup',()=>{
  const host=fixture('<div><button>one</button><button>two</button></div>'),[one,two]=Array.from(host.children),calls:unknown[]=[];
  class Handler{handleEvent(event:Event){calls.push(this,event.currentTarget);}}
  const object=new Handler(),plan=prepareAdoption(host,()=>h('div',null,h('button',{onClick:function(this:unknown){calls.push(this);}},'one'),h('button',{onClick:object},'two')));
  one!.dispatchEvent(new Event('click'));two!.dispatchEvent(new Event('click'));expect(calls).toEqual([]);plan.commit();one!.dispatchEvent(new Event('click'));two!.dispatchEvent(new Event('click'));expect(calls).toEqual([one,object,two]);
  object.handleEvent=function(){calls.push('replaced',this);};two!.dispatchEvent(new Event('click'));expect(calls.slice(-2)).toEqual(['replaced',object]);plan.dispose();two!.dispatchEvent(new Event('click'));expect(calls).toHaveLength(5);
 });
 it('keeps accessor callback lookup dormant until commit and reports its exception once',()=>{
  const host=fixture(),failure=vi.fn(),cause=new Error('lookup'),lookup=vi.fn(()=>{throw cause;});
  const object=Object.defineProperty({},'handleEvent',{get:lookup});
  const plan=prepareAdoption(host,()=>h('button',{onClick:object},'run'),{failure});expect(lookup).not.toHaveBeenCalled();plan.commit();expect(lookup).not.toHaveBeenCalled();
  host.dispatchEvent(new Event('click'));host.dispatchEvent(new Event('click'));expect(lookup).toHaveBeenCalledOnce();expect(failure).toHaveBeenCalledExactlyOnceWith(cause,'FORMA_E_HYDRATE_EFFECT');expect(plan.phase).toBe('aborted');
 });
 it('contains a handler failure, owns nested roots and preserves a live neighboring island',()=>{
  const bad=fixture(),good=fixture(),[value,setValue]=createSignal(0),runs=vi.fn(),cleanup=vi.fn(),failure=vi.fn(),neighbor=vi.fn();
  const goodPlan=prepareAdoption(good,()=>h('button',{onClick:neighbor},'run'));goodPlan.commit();
  const badPlan=prepareAdoption(bad,()=>h('button',{onClick:()=>{createRoot(()=>{registerDisposer(cleanup);createEffect(()=>{value();runs();});});throw new Error('handler');}},'run'),{failure});badPlan.commit();bad.click();
  expect(badPlan.phase).toBe('aborted');expect(failure).toHaveBeenCalledOnce();expect(cleanup).toHaveBeenCalledOnce();setValue(1);expect(runs).toHaveBeenCalledOnce();good.click();expect(neighbor).toHaveBeenCalledOnce();expect(goodPlan.phase).toBe('live');goodPlan.dispose();
 });
 it('ties handler-created resources to their conditional region, including cached fresh branches',()=>{
  const host=fixture('<div><!--f:s0--><button>run</button><!--/f:s0--></div>'),[visible,setVisible]=createSignal(true),[value,setValue]=createSignal(0),runs=vi.fn();
  const plan=prepareAdoption(host,()=>h('div',null,createShow(visible,()=>h('button',{onClick:()=>{createEffect(()=>{value();runs();});}},'run'),()=>h('i',null,'off'))));plan.commit();
  const first=host.querySelector('button')!;first.click();expect(runs).toHaveBeenCalledOnce();setVisible(false);setValue(1);expect(runs).toHaveBeenCalledOnce();first.click();expect(runs).toHaveBeenCalledOnce();
  setVisible(true);const fresh=host.querySelector('button')!;fresh.click();expect(runs).toHaveBeenCalledTimes(2);plan.dispose();setValue(2);expect(runs).toHaveBeenCalledTimes(2);
 });
 it('owns listeners created by deferred effects and refs on their later generations',()=>{
  for(const fromRef of [false,true]){
   const host=fixture(),[generation,setGeneration]=createSignal(0),[value,setValue]=createSignal(0),runs=vi.fn();let next!:HTMLButtonElement;
   const start=()=>createEffect(()=>{generation();next=h('button',{onClick:()=>{createEffect(()=>{value();runs();});}},'child') as HTMLButtonElement;});
   const plan=prepareAdoption(host,()=>{if(!fromRef)start();return h('button',fromRef?{ref:start}:null,'run');});plan.commit();
   const old=next;old.click();expect(runs).toHaveBeenCalledOnce();setGeneration(1);setValue(1);expect(runs).toHaveBeenCalledOnce();old.click();expect(runs).toHaveBeenCalledOnce();
   next.click();expect(runs).toHaveBeenCalledTimes(2);plan.dispose();setValue(2);expect(runs).toHaveBeenCalledTimes(2);
  }
 });
 it('captures listener ownership for a later internal binding run without leaking it to ordinary CSR',()=>{
  const host=fixture(),[generation,setGeneration]=createSignal(0),[value,setValue]=createSignal(0),runs=vi.fn(),outside=vi.fn();let next!:HTMLButtonElement;
  const plan=prepareAdoption(host,()=>h('button',{onClick:()=>{internalEffect(()=>{generation();next=h('button',{onClick:()=>{createEffect(()=>{value();runs();});}},'child') as HTMLButtonElement;});}},'run'));plan.commit();host.click();setGeneration(1);next.click();expect(runs).toHaveBeenCalledOnce();
  let stop:()=>void=()=>{};const ordinary=h('button',{onClick:()=>{stop=createEffect(()=>{value();outside();});}},'ordinary') as HTMLButtonElement;ordinary.click();plan.dispose();setValue(1);expect(runs).toHaveBeenCalledOnce();expect(outside).toHaveBeenCalledTimes(2);stop();
 });

 it('propagates initial adopted h reader failure and disposes its partial callback work',()=>{
  const host=fixture(),[value,setValue]=createSignal(0),runs=vi.fn(),after=vi.fn(),failure=vi.fn(),cause=Error('initial reader');
  const plan=prepareAdoption(host,()=>h('button',{onClick(){h('p',null,()=>{createEffect(()=>{value();runs();});throw cause;});after();}},'run'),{failure});
  plan.commit();host.click();expect(after).not.toHaveBeenCalled();expect(failure).toHaveBeenCalledExactlyOnceWith(cause,'FORMA_E_HYDRATE_EFFECT');expect(plan.phase).toBe('aborted');
  setValue(1);expect(runs).toHaveBeenCalledOnce();plan.dispose();
 });
 it('drains later public h reader work created after reentrant adoption disposal',()=>{
  const host=fixture(),[generation,setGeneration]=createSignal(0),[value,setValue]=createSignal(0),runs=vi.fn(),failure=vi.fn();
  const plan=prepareAdoption(host,()=>h('button',{onClick(){h('p',null,()=>{if(generation()){plan.dispose();createEffect(()=>{value();runs();});}return 'kept';});}},'run'),{failure});
  plan.commit();host.click();setGeneration(1);expect(plan.phase).toBe('aborted');expect(runs).toHaveBeenCalledOnce();setValue(1);expect(runs).toHaveBeenCalledOnce();expect(failure).not.toHaveBeenCalled();
 });

});
