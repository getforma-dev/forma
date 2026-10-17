import {describe,it,expect,vi} from 'vitest';
import {prepareAdoption} from '../adoption.js';
import {__adoptionConditional} from '../adoption-description.js';
import {h} from '../element.js';
import {createList} from '../list.js';
import {createSignal} from '../../reactive/signal.js';
import {createEffect} from '../../reactive/effect.js';
function fixture(html:string){const doc=document.implementation.createHTMLDocument();doc.body.innerHTML=html;return doc.body.firstElementChild!;}
describe('prepared compiler conditional descriptions',()=>{
 it('observes outer arrow and condition once, keeps initial nodes and tracks later branches',async()=>{
  const host=fixture('<section><!--f:s0--><b>yes</b><!--/f:s0--></section>'),original=host.querySelector('b'),[on,setOn]=createSignal(true),outer=vi.fn(),condition=vi.fn(on),yes=vi.fn(()=>h('b',null,'yes')),no=vi.fn(()=>h('i',null,'no')),effects=vi.fn();
  const records:MutationRecord[]=[],observer=new MutationObserver(batch=>records.push(...batch));observer.observe(host,{subtree:true,attributes:true,characterData:true,childList:true});
  const plan=prepareAdoption(host,()=>{createEffect(effects);return h('section',null,()=>{outer();return __adoptionConditional(condition,yes,no);});});
  expect(outer).toHaveBeenCalledOnce();expect(condition).toHaveBeenCalledOnce();expect(yes).toHaveBeenCalledOnce();expect(no).not.toHaveBeenCalled();expect(effects).not.toHaveBeenCalled();plan.commit();await new Promise(resolve=>setTimeout(resolve,0));
  expect(host.querySelector('b')).toBe(original);expect(outer).toHaveBeenCalledOnce();expect(condition).toHaveBeenCalledOnce();expect(records.concat(observer.takeRecords())).toEqual([]);
  setOn(false);expect(host.querySelector('i')!.textContent).toBe('no');expect(outer).toHaveBeenCalledTimes(2);expect(condition).toHaveBeenCalledTimes(2);setOn(true);expect(host.querySelector('b')).not.toBe(original);expect(yes).toHaveBeenCalledTimes(2);
  plan.dispose();setOn(false);expect(outer).toHaveBeenCalledTimes(3);expect(host.querySelector('b')).not.toBeNull();observer.disconnect();
 });
 it('consumes direct and arrow conditional ranges inside list rows without re-reading tests',()=>{
  const host=fixture('<section><!--f:l0--><!--f:s2--><b>a</b><!--/f:s2--><!--f:s2--><!--/f:s2--><!--/f:l0--></section>');
  const [rows,setRows]=createSignal([{id:'a',live:true},{id:'b',live:false}]),reads=vi.fn((value:boolean)=>value);
  const plan=prepareAdoption(host,()=>h('section',null,createList(rows,row=>row.id,row=>__adoptionConditional(()=>reads(row.live),()=>h('b',null,row.id),()=>null)!)));
  expect(reads).toHaveBeenCalledTimes(2);plan.commit();expect(host.querySelectorAll('b')).toHaveLength(1);setRows([{id:'b',live:false},{id:'a',live:true}]);expect(host.querySelector('b')!.textContent).toBe('a');plan.dispose();
 });
 it('retains a selected function as a reader and invalidates changed dependencies before commit',()=>{
  const host=fixture('<section><!--f:s0--><!--f:t1-->yes<!--/f:t1--><!--/f:s0--></section>'),[on,setOn]=createSignal(true),read=vi.fn(()=> 'yes');
  const plan=prepareAdoption(host,()=>h('section',null,()=>__adoptionConditional(on,()=>read,()=>()=> 'no')));
  expect(read).toHaveBeenCalledOnce();setOn(false);expect(()=>plan.commit()).toThrow('FORMA_E_HYDRATE_VALUE');expect(read).toHaveBeenCalledOnce();expect(host.textContent).toBe('yes');
 });
 it('refuses a later scalar/conditional shape change without executing an unselected branch',()=>{
  const host=fixture('<section><!--f:s0--><b>yes</b><!--/f:s0--></section>'),[changed,setChanged]=createSignal(false),unused=vi.fn(()=>h('i',null,'no')),failure=vi.fn();
  const plan=prepareAdoption(host,()=>h('section',null,()=>changed()?'scalar':__adoptionConditional(()=>true,()=>h('b',null,'yes'),unused)),{failure});plan.commit();setChanged(true);
  expect(plan.phase).toBe('aborted');expect(failure).toHaveBeenCalledOnce();expect(unused).not.toHaveBeenCalled();expect(host.querySelector('b')!.textContent).toBe('yes');
 });
});
