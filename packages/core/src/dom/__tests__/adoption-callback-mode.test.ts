import { describe, expect, it, vi } from 'vitest';
import { prepareAdoption } from '../adoption.js';
import { h } from '../element.js';
import { withAdoptionDescription, describingAdoption } from '../adoption-description.js';
import { AdoptionLifecycle } from '../../reactive/adoption-lifecycle.js';
import { getAdoptionCallbacks } from '../../reactive/adoption-hooks.js';
import { createEffect } from '../../reactive/effect.js';
import { createSignal } from '../../reactive/signal.js';
import { onCleanup } from '../../reactive/cleanup.js';
import { registerDisposer } from '../../reactive/root.js';
function fixture(){const doc=document.implementation.createHTMLDocument();doc.body.innerHTML='<section><button>go</button></section>';return doc.body.firstElementChild!;}
describe('owned callbacks remain ordinary during live descriptor construction',()=>{
 it('keeps initial and rerun effects, returned cleanup and onCleanup in ordinary mode',()=>{
  const host=fixture(),[value,setValue]=createSignal(0),nodes:Node[]=[],cleaned:Node[]=[],fail=vi.fn();let scope!:AdoptionLifecycle;
  const plan=prepareAdoption(host,()=>h('section',null,h('button',null,'go')),{scope:options=>(scope=new AdoptionLifecycle(options)),failure:fail});plan.commit();
  const generation=scope.group(()=>withAdoptionDescription(()=>{
   createEffect(()=>{value();nodes.push(h('b',null,'effect'));onCleanup(()=>cleaned.push(h('i',null,'cleanup')));return()=>{cleaned.push(h('u',null,'returned'));};});
   registerDisposer(()=>cleaned.push(h('small',null,'owned cleanup')));return h('span',null,'factory');
  }));
  expect(generation.value).toMatchObject({type:'element',tag:'span'});expect(nodes).toHaveLength(1);expect(nodes[0]).toBeInstanceOf(Element);
  withAdoptionDescription(()=>{setValue(1);expect(describingAdoption).toBe(true);});
  expect(nodes).toHaveLength(2);expect(cleaned).toHaveLength(2);expect([...nodes,...cleaned].every(node=>node instanceof Element)).toBe(true);
  withAdoptionDescription(()=>{generation.dispose();expect(describingAdoption).toBe(true);});
  expect(cleaned).toHaveLength(5);expect(cleaned.every(node=>node instanceof Element)).toBe(true);expect(fail).not.toHaveBeenCalled();plan.dispose();expect(getAdoptionCallbacks()).toBeUndefined();expect(describingAdoption).toBe(false);
 });
 it('runs committed refs and synchronous function or object listeners as ordinary callbacks',()=>{
  for(const object of [false,true]){
   const host=fixture(),nodes:Node[]=[],invoke=()=>{nodes.push(h('i',null,'event'));},listener=object?{handleEvent:invoke}:invoke;
   const plan=prepareAdoption(host,()=>h('section',null,h('button',{ref:()=>nodes.push(h('b',null,'ref')),onClick:listener},'go')));
   withAdoptionDescription(()=>{plan.commit();host.querySelector('button')!.click();expect(describingAdoption).toBe(true);});
   expect(nodes).toHaveLength(2);expect(nodes.every(node=>node instanceof Element)).toBe(true);expect(getAdoptionCallbacks()).toBeUndefined();plan.dispose();
  }
 });
 it('restores factory description after a thrown owned callback and preserves ordinary neighbors',()=>{
  const host=fixture(),failure=vi.fn(),sentinel=new Error('owned callback'),made:Node[]=[];
  const plan=prepareAdoption(host,()=>h('section',null,h('button',{onClick:()=>{made.push(h('b',null,'before'));throw sentinel;}},'go')),{failure});plan.commit();
  withAdoptionDescription(()=>{host.querySelector('button')!.click();expect(h('i',null,'after')).toMatchObject({type:'element'});});
  expect(failure).toHaveBeenCalledExactlyOnceWith(sentinel,'FORMA_E_HYDRATE_EFFECT');expect(made[0]).toBeInstanceOf(Element);expect(plan.phase).toBe('aborted');expect(getAdoptionCallbacks()).toBeUndefined();expect(describingAdoption).toBe(false);
  const [value,setValue]=createSignal(0),ordinary:Node[]=[],stop=createEffect(()=>{value();ordinary.push(h('u',null,'ordinary'));});setValue(1);expect(ordinary).toHaveLength(2);expect(ordinary.every(node=>node instanceof Element)).toBe(true);stop();
 });
 it('isolates a pre-existing ordinary effect synchronously flushed inside a describing factory',()=>{
  const [value,setValue]=createSignal(0),nodes:Node[]=[],stop=createEffect(()=>{value();nodes.push(h('b',null,'ordinary'));});
  const ordinary=h('div',null,()=>h('span',null,value()));
  const host=fixture();let scope!:AdoptionLifecycle;const plan=prepareAdoption(host,()=>h('section',null,h('button',null,'go')),{scope:options=>(scope=new AdoptionLifecycle(options))});plan.commit();
  scope.group(()=>withAdoptionDescription(()=>{setValue(1);expect(describingAdoption).toBe(true);return h('i',null,'factory');}));
  expect(nodes).toHaveLength(2);expect(nodes.every(node=>node instanceof Element)).toBe(true);expect(ordinary.querySelector('span')!.textContent).toBe('1');plan.dispose();setValue(2);expect(nodes).toHaveLength(3);expect(nodes[2]).toBeInstanceOf(Element);stop();expect(getAdoptionCallbacks()).toBeUndefined();
 });
 it('drains a reentrant disposal without leaking mode into the remaining factory',()=>{
  const host=fixture(),nodes:Node[]=[];let scope!:AdoptionLifecycle;
  const plan=prepareAdoption(host,()=>h('section',null,h('button',null,'go')),{scope:options=>(scope=new AdoptionLifecycle(options))});plan.commit();
  expect(()=>scope.group(()=>withAdoptionDescription(()=>{createEffect(()=>{nodes.push(h('b',null,'effect'));plan.dispose();return()=>{nodes.push(h('i',null,'cleanup'));};});expect(describingAdoption).toBe(true);return h('span',null,'discarded');}))).toThrow('FORMA_E_HYDRATE_STRUCTURE');
  expect(nodes).toHaveLength(2);expect(nodes.every(node=>node instanceof Element)).toBe(true);expect(plan.phase).toBe('aborted');expect(getAdoptionCallbacks()).toBeUndefined();expect(describingAdoption).toBe(false);
 });
});
