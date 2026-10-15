import { describe, it, expect, vi } from 'vitest';
import { prepareAdoption } from '../adoption.js';
import { h, fragment } from '../element.js';
import { createShow } from '../show.js';
import { createList } from '../list.js';
import { __adoptionConditional } from '../adoption-description.js';
import { createSignal } from '../../reactive/signal.js';
import { createEffect } from '../../reactive/effect.js';
import { registerDisposer } from '../../reactive/root.js';
function fixture(){const doc=document.implementation.createHTMLDocument();doc.body.innerHTML='<section><!--f:s0--><!--/f:s0--></section>';return doc.body.firstElementChild!;}
describe('strict adoption postcommit descriptor construction',()=>{
 it('constructs nested fresh list ranges with multi-node and empty rows, indices and owned ordinary callbacks',()=>{
  const host=fixture(),[visible,setVisible]=createSignal(false),[items,setItems]=createSignal([0,1,2]),[tick,setTick]=createSignal(0),effects=vi.fn(),cleaned:number[]=[],callbackNodes:Node[]=[];
  const plan=prepareAdoption(host,()=>h('section',null,createShow(visible,()=>h('div',null,createList(items,item=>item,(item,index)=>{
   registerDisposer(()=>cleaned.push(item));createEffect(()=>{tick();effects();callbackNodes.push(h('button'));});
   return (item===0?null:fragment(h('b',null,item),h('i',null,index))) as unknown as HTMLElement;
  })))));plan.commit();setVisible(true);
  const original=[...host.querySelectorAll('b')];expect(host.textContent).toBe('1122');expect(effects).toHaveBeenCalledTimes(3);expect(callbackNodes.every(node=>node instanceof HTMLButtonElement)).toBe(true);
  setItems([2,0,1,3]);expect(host.textContent).toBe('201233');expect(host.querySelectorAll('b')[0]).toBe(original[1]);expect(host.querySelectorAll('b')[1]).toBe(original[0]);expect(cleaned).toEqual([]);
  setItems([3]);expect(host.textContent).toBe('30');expect(cleaned.sort()).toEqual([0,1,2]);setTick(1);expect(effects).toHaveBeenCalledTimes(5);plan.dispose();setTick(2);expect(effects).toHaveBeenCalledTimes(5);expect(cleaned.sort()).toEqual([0,1,2,3]);
 });
 it('keeps movable template readers and nested compiler conditional values live after insertion',()=>{
  const host=fixture(),[visible,setVisible]=createSignal(false),[value,setValue]=createSignal(1),reads=vi.fn(value),refs=vi.fn();
  const plan=prepareAdoption(host,()=>h('section',null,createShow(visible,()=>h('template',{ref:refs},()=>__adoptionConditional(()=>true,()=>h('b',null,reads()),()=>null)))));plan.commit();setVisible(true);
  const template=host.querySelector('template')!;expect(template.childNodes).toHaveLength(0);expect(template.content.querySelector('b')!.textContent).toBe('1');expect(reads).toHaveBeenCalledOnce();expect(refs).toHaveBeenCalledOnce();
  setValue(2);expect(template.content.querySelector('b')!.textContent).toBe('2');expect(reads).toHaveBeenCalledTimes(2);plan.dispose();setValue(3);expect(template.content.querySelector('b')!.textContent).toBe('2');
 });
 it('retains an existing nested explicit Show branch when its next candidate throws',()=>{
  const host=fixture(),[visible,setVisible]=createSignal(false),[inner,setInner]=createSignal(true),failure=vi.fn(),cleanup=vi.fn();
  const plan=prepareAdoption(host,()=>h('section',null,createShow(visible,()=>h('div',null,createShow(inner,()=>h('b',null,'old'),()=>{registerDisposer(cleanup);throw new Error('nested candidate');})))),{failure});plan.commit();setVisible(true);const original=host.querySelector('b');setInner(false);
  expect(plan.phase).toBe('aborted');expect(failure).toHaveBeenCalledOnce();expect(cleanup).toHaveBeenCalledOnce();expect(host.querySelector('b')).toBe(original);expect(host.textContent).toBe('old');
 });
});
