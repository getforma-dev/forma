import { describe, it, expect, vi } from 'vitest';
import { liveRanges } from '../adoption-live-ranges.js';
import { prepareAdoption } from '../adoption.js';
import { h, fragment } from '../element.js';
import { AdoptionLifecycle } from '../../reactive/adoption-lifecycle.js';
import { createSignal } from '../../reactive/signal.js';
import { createEffect } from '../../reactive/effect.js';
import { registerDisposer } from '../../reactive/root.js';
import type { ListDescriptor } from '../adoption-description.js';
function fixture(){const doc=document.implementation.createHTMLDocument();doc.body.innerHTML='<section></section>';const host=doc.body.firstElementChild!,failure=vi.fn();let scope!:AdoptionLifecycle;const plan=prepareAdoption(host,()=>h('section'),{scope:options=>(scope=new AdoptionLifecycle(options)),failure});plan.commit();return{host,plan,scope,failure,ranges:liveRanges(scope,doc,()=>{})};}
function descriptor(items:()=>unknown[]):ListDescriptor{return{type:'list',items,keyFn:item=>item as number,renderFn:()=>{throw new Error('adapter must invoke its supplied renderer');}};}
describe('owned fresh ranges after publication',()=>{
 it('moves a Fragment range into its live parent and reconciles multi-node and empty rows with real indices',()=>{
  const {host,plan,ranges}=fixture(),[items,setItems]=createSignal([0,1,2]),cleaned:number[]=[];
  const rendered=ranges.list(descriptor(items),null,(item,index)=>{registerDisposer(()=>cleaned.push(item as number));return item===0?null:fragment(h('b',null,item),h('i',null,index));});host.append(rendered);
  const original=[...host.children];expect(host.textContent).toBe('1122');setItems([2,0,1,3]);expect(host.textContent).toBe('201233');expect(host.children[0]).toBe(original[2]);expect(host.children[2]).toBe(original[0]);expect(cleaned).toEqual([]);
  setItems([3]);expect(host.textContent).toBe('30');expect(cleaned.sort()).toEqual([0,1,2]);plan.dispose();setItems([]);expect(host.textContent).toBe('30');expect(cleaned.sort()).toEqual([0,1,2,3]);
 });
 it('tracks a dynamic selected value across same-truthiness updates after its Fragment has moved',()=>{
  const {host,plan,ranges}=fixture(),[value,setValue]=createSignal(1),read=vi.fn(value),cleaned:number[]=[];
  const region=ranges.dynamic(read,item=>{registerDisposer(()=>cleaned.push(item as number));return h('b',null,item);});host.append(region);expect(host.textContent).toBe('1');expect(read).toHaveBeenCalledOnce();
  setValue(2);expect(host.textContent).toBe('2');expect(cleaned).toEqual([1]);setValue(3);expect(host.textContent).toBe('3');expect(cleaned).toEqual([1,2]);plan.dispose();setValue(4);expect(host.textContent).toBe('3');expect(cleaned).toEqual([1,2,3]);
 });
 it('keeps old DOM and drains candidate resources when a later dynamic materializer throws',()=>{
  const {host,plan,ranges,failure}=fixture(),[value,setValue]=createSignal(1),[tick,setTick]=createSignal(0),runs=vi.fn(),cleanup=vi.fn();
  host.append(ranges.dynamic(value,item=>{if(item===2){registerDisposer(cleanup);createEffect(()=>{tick();runs();});throw new Error('candidate');}return h('b',null,item);}));const original=host.firstElementChild;setValue(2);
  expect(plan.phase).toBe('aborted');expect(failure).toHaveBeenCalledOnce();expect(host.firstElementChild).toBe(original);expect(host.textContent).toBe('1');expect(cleanup).toHaveBeenCalledOnce();expect(runs).toHaveBeenCalledOnce();setTick(1);expect(runs).toHaveBeenCalledOnce();
 });
 it('rechecks a moved range after departing cleanup before inserting a replacement',()=>{
  const {host,plan,ranges,failure}=fixture(),[value,setValue]=createSignal(1),other=host.ownerDocument.createElement('aside');host.after(other);let end:Node;
  host.append(ranges.dynamic(value,item=>{if(item===1)registerDisposer(()=>other.append(end));return h('b',null,item);}));end=host.lastChild!;const original=host.firstElementChild;setValue(2);
  expect(plan.phase).toBe('aborted');expect(failure).toHaveBeenCalledOnce();expect(host.firstElementChild).toBe(original);expect(host.textContent).toBe('1');expect(other.lastChild).toBe(end);
 });
 it('keeps explicit Show boolean caching while condition and selected-value signals change',()=>{
  const {host,plan,ranges}=fixture(),[condition,setCondition]=createSignal(1),[label,setLabel]=createSignal('a'),built=vi.fn(),cleaned=vi.fn();
  host.append(ranges.show(condition,shown=>{built(shown);registerDisposer(cleaned);return shown?h('b',null,label()):null;}));const original=host.firstElementChild;
  expect(host.textContent).toBe('a');expect(built).toHaveBeenCalledTimes(1);setLabel('b');setCondition(2);expect(host.firstElementChild).toBe(original);expect(host.textContent).toBe('a');expect(built).toHaveBeenCalledTimes(1);expect(cleaned).not.toHaveBeenCalled();
  setCondition(0);expect(host.textContent).toBe('');expect(cleaned).toHaveBeenCalledTimes(1);setCondition(3);expect(host.textContent).toBe('b');expect(built).toHaveBeenCalledTimes(3);expect(cleaned).toHaveBeenCalledTimes(2);plan.dispose();expect(cleaned).toHaveBeenCalledTimes(3);
 });
 it('preserves an old explicit Show range when constructing its alternate throws',()=>{
  const {host,plan,ranges,failure}=fixture(),[shown,setShown]=createSignal(true),cleanup=vi.fn();
  host.append(ranges.show(shown,value=>{if(!value){registerDisposer(cleanup);throw new Error('alternate');}return h('b',null,'old');}));const original=host.firstElementChild;
  setShown(false);expect(plan.phase).toBe('aborted');expect(failure).toHaveBeenCalledOnce();expect(cleanup).toHaveBeenCalledOnce();expect(host.firstElementChild).toBe(original);expect(host.textContent).toBe('old');
 });
 it('tracks selected-only dependencies for expressions and disposes each old generation',()=>{
  const {host,plan,ranges}=fixture(),[label,setLabel]=createSignal('a'),cleanup=vi.fn(),read=vi.fn(()=>true);
  host.append(ranges.dynamic(read,()=>{const value=label();registerDisposer(cleanup);return h('b',null,value);}));expect(host.textContent).toBe('a');setLabel('b');expect(host.textContent).toBe('b');expect(read).toHaveBeenCalledTimes(2);expect(cleanup).toHaveBeenCalledOnce();plan.dispose();expect(cleanup).toHaveBeenCalledTimes(2);
 });
 it('keeps prior rows and drains all candidate resources after a later row factory fails',()=>{
  const {host,plan,ranges,failure}=fixture(),[items,setItems]=createSignal([1]),[tick,setTick]=createSignal(0),runs=vi.fn(),cleanup=vi.fn();
  host.append(ranges.list(descriptor(items),null,item=>{if(item!==1){registerDisposer(cleanup);createEffect(()=>{tick();runs();});}if(item===3)throw new Error('row');return h('b',null,item);}));const original=host.firstElementChild;setItems([2,3]);
  expect(plan.phase).toBe('aborted');expect(host.firstElementChild).toBe(original);expect(host.textContent).toBe('1');expect(failure).toHaveBeenCalledOnce();expect(cleanup).toHaveBeenCalledTimes(2);expect(runs).toHaveBeenCalledTimes(2);setTick(1);expect(runs).toHaveBeenCalledTimes(2);
 });
 it('refuses a live node returned by the converter before it is moved',()=>{
  const {host,plan,ranges,failure}=fixture(),[value,setValue]=createSignal(false),outside=host.ownerDocument.createElement('aside');outside.textContent='outside';host.after(outside);
  host.append(ranges.dynamic(value,external=>external?outside:h('b',null,'old')));const original=host.firstElementChild;setValue(true);expect(plan.phase).toBe('aborted');expect(host.firstElementChild).toBe(original);expect(outside.parentNode).toBe(host.parentNode);expect(outside.textContent).toBe('outside');expect(failure).toHaveBeenCalledOnce();
 });

});
