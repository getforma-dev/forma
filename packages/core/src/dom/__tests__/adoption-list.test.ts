import { describe, expect, it, vi } from 'vitest';
import { prepareAdoption } from '../adoption.js';
import { h } from '../element.js';
import { createList } from '../list.js';
import { createSignal } from '../../reactive/signal.js';
import { createEffect } from '../../reactive/effect.js';
import { createRoot, registerDisposer } from '../../reactive/root.js';

function fixture(body:string,tag='ul'){
  const doc=document.implementation.createHTMLDocument();doc.body.innerHTML=`<${tag}><!--f:l0-->${body}<!--/f:l0--></${tag}>`;
  const host=doc.body.firstElementChild!,records:MutationRecord[]=[];
  const native=new MutationObserver(batch=>records.push(...batch));native.observe(host,{attributes:true,childList:true,characterData:true,subtree:true});
  return {host,records:()=>records.splice(0).concat(native.takeRecords()),disconnect:()=>native.disconnect()};
}
const row=(key:number)=>`<li data-forma-key="${key}"><!--f:t1-->${key}<!--/f:t1-->:<!--f:t2-->${key-1}<!--/f:t2--></li>`;

describe('private prepared element list rows',()=>{
  it('retains all initial nodes and reads once, then inserts/reorders/removes with live index owners',async()=>{
    const f=fixture([1,2,3].map(row).join('')),original=[...f.host.children];
    const [items,setItems]=createSignal([1,2,3]),read=vi.fn(items),cleaned:number[]=[],render=vi.fn((item:number,index:()=>number)=>{
      registerDisposer(()=>cleaned.push(item));return h('li',{'data-forma-key':item},()=>item,':',index);
    });
    const plan=prepareAdoption(f.host,()=>h('ul',null,createList(read,item=>item,render)));
    expect(read).toHaveBeenCalledOnce();expect(render).toHaveBeenCalledTimes(3);plan.commit();await new Promise(resolve=>setTimeout(resolve,0));
    expect(f.records()).toEqual([]);expect([...f.host.children]).toEqual(original);
    setItems([3,1,4]);expect([...f.host.children].map(node=>node.textContent)).toEqual(['3:0','1:1','4:2']);
    expect(f.host.children[0]).toBe(original[2]);expect(f.host.children[1]).toBe(original[0]);expect(cleaned).toEqual([2]);
    const fourth=f.host.children[2]!;setItems([4,3,1]);expect(f.host.children[0]).toBe(fourth);expect(render).toHaveBeenCalledTimes(4);
    setItems([1,4]);expect([...f.host.children].map(node=>node.textContent)).toEqual(['1:0','4:1']);expect(cleaned).toEqual([2,3]);
    plan.dispose();setItems([]);expect(f.host.children).toHaveLength(2);expect(cleaned.sort()).toEqual([1,2,3,4]);f.disconnect();
  });
  it('uses one minimal move for a forty-row rotation and never rebuilds retained rows',()=>{
    const initial=Array.from({length:40},(_,i)=>i+1),f=fixture(initial.map(item=>`<li>${item}</li>`).join(''));
    const [items,setItems]=createSignal(initial),render=vi.fn((item:number)=>h('li',null,item));
    const plan=prepareAdoption(f.host,()=>h('ul',null,createList(items,item=>item,render)));plan.commit();
    const original=[...f.host.children],insert=vi.spyOn(f.host,'insertBefore');setItems([...initial.slice(1),1]);
    expect(insert).toHaveBeenCalledOnce();expect([...f.host.children]).toEqual([...original.slice(1),original[0]]);expect(render).toHaveBeenCalledTimes(40);plan.dispose();f.disconnect();
  });
  it('supports an empty list and repeated updates without synthesizing initial rows',()=>{
    const f=fixture(''),[items,setItems]=createSignal<number[]>([]),render=vi.fn((item:number)=>h('li',null,item));
    const plan=prepareAdoption(f.host,()=>h('ul',null,createList(items,item=>item,render)));plan.commit();expect(render).not.toHaveBeenCalled();expect(f.records()).toEqual([]);
    setItems([1,2]);expect(f.host.textContent).toBe('12');setItems([]);expect(f.host.children).toHaveLength(0);setItems([3]);expect(f.host.textContent).toBe('3');plan.dispose();f.disconnect();
  });
  it('retains default same-key rows and supports explicit changed-item rerender with disposal',()=>{
    for(const rerender of [false,true]){
      const f=fixture('<li>old</li>'),[items,setItems]=createSignal([{id:1,text:'old'}]),cleanup=vi.fn();
      const render=vi.fn((item:{id:number;text:string})=>{registerDisposer(cleanup);return h('li',null,item.text);});
      const plan=prepareAdoption(f.host,()=>h('ul',null,createList(items,item=>item.id,render,{updateOnItemChange:rerender?'rerender':'none'})));plan.commit();const original=f.host.firstElementChild;
      setItems([{id:1,text:'new'}]);expect(f.host.textContent).toBe(rerender?'new':'old');expect(f.host.firstElementChild===original).toBe(!rerender);expect(cleanup).toHaveBeenCalledTimes(rerender?1:0);plan.dispose();f.disconnect();
    }
  });
  it('refuses count mismatch and duplicate or mixed keys before any row callback',()=>{
    const cases:[string,number[]][]=[['<li>1</li>',[1,2]],['<li>1</li><li>1</li>',[1,1]],['<li data-forma-key="1">1</li><li>2</li>',[1,2]],['<li data-forma-key="1">1</li><li data-forma-key="1">2</li>',[1,2]]];
    for(const [html,values]of cases){
      const f=fixture(html),render=vi.fn((item:number)=>h('li',null,item)),before=f.host.outerHTML;
      expect(()=>prepareAdoption(f.host,()=>h('ul',null,createList(()=>values,item=>item,render)))).toThrow();expect(render).not.toHaveBeenCalled();expect(f.host.outerHTML).toBe(before);expect(f.records()).toEqual([]);f.disconnect();
    }
  });
  it('retains the explicit pre181 key-order limitation without moving mismatched rows',()=>{
    const f=fixture('<li data-forma-key="2">2</li><li data-forma-key="1">1</li>'),before=[...f.host.childNodes],render=vi.fn((item:number)=>h('li',null,item));
    expect(()=>prepareAdoption(f.host,()=>h('ul',null,createList(()=>[1,2],item=>item,render)))).toThrow('FORMA_E_HYDRATE_STRUCTURE');expect(render).not.toHaveBeenCalled();expect([...f.host.childNodes]).toEqual(before);expect(f.records()).toEqual([]);f.disconnect();
  });
  it('tears down all partial row observations and leaves callbacks dormant after a late row mismatch',()=>{
    const f=fixture('<li><!--f:t0-->1<!--/f:t0--></li><li>wrong</li>'),[n,setN]=createSignal(1),read=vi.fn(n),effect=vi.fn(),cleanup=vi.fn();
    expect(()=>prepareAdoption(f.host,()=>h('ul',null,createList(()=>[1,2],item=>item,item=>{
      registerDisposer(cleanup);createEffect(effect);return h('li',null,item===1?read:'expected');
    })))).toThrow('FORMA_E_HYDRATE_VALUE');setN(3);expect(read).toHaveBeenCalledOnce();expect(effect).not.toHaveBeenCalled();expect(cleanup).toHaveBeenCalledTimes(2);expect(f.records()).toEqual([]);f.disconnect();
  });
  it('constructs no replacement or removal when a later new row factory fails',()=>{
    const f=fixture('<li>1</li>'),[items,setItems]=createSignal([1]),[n,setN]=createSignal(0),runs=vi.fn(),cleanup=vi.fn(),failure=vi.fn();
    const plan=prepareAdoption(f.host,()=>h('ul',null,createList(items,item=>item,item=>{
      if(item===3)throw new Error('third row');if(item===2){registerDisposer(cleanup);createEffect(()=>{n();runs();});}return h('li',null,item);
    })),{failure});plan.commit();const before=f.host.outerHTML;setItems([2,3]);expect(plan.phase).toBe('aborted');expect(failure).toHaveBeenCalledOnce();expect(cleanup).toHaveBeenCalledOnce();setN(1);expect(runs).toHaveBeenCalledOnce();expect(f.host.outerHTML).toBe(before);expect(f.records()).toEqual([]);f.disconnect();
  });
  it('stops before moves if a row factory or disposer aborts the owner',()=>{
    for(const fromCleanup of [false,true]){
      const f=fixture('<li>1</li>'),[items,setItems]=createSignal([1]);let plan:ReturnType<typeof prepareAdoption>;
      plan=prepareAdoption(f.host,()=>h('ul',null,createList(items,item=>item,item=>{
        if(item===1&&fromCleanup)registerDisposer(()=>plan.dispose());if(item===2&&!fromCleanup)plan.dispose();return h('li',null,item);
      })));plan.commit();const before=f.host.outerHTML;setItems([2]);expect(plan.phase).toBe('aborted');expect(f.host.outerHTML).toBe(before);expect(f.records()).toEqual([]);f.disconnect();
    }
  });
  it('stabilizes self-written item arrays without leaking discarded row owners',()=>{
    const f=fixture('<li>1</li>'),[items,setItems]=createSignal([1]),cleaned:number[]=[];
    const plan=prepareAdoption(f.host,()=>h('ul',null,createList(items,item=>item,item=>{registerDisposer(()=>cleaned.push(item));if(item===2)setItems([3]);return h('li',null,item);})));plan.commit();setItems([2]);
    expect(f.host.textContent).toBe('3');expect(cleaned).toEqual([1,2]);expect(plan.phase).toBe('live');plan.dispose();expect(cleaned).toEqual([1,2,3]);f.disconnect();
  });
  it('refuses edited marker topology before creating later rows',()=>{
    const f=fixture('<li>1</li>'),[items,setItems]=createSignal([1]),render=vi.fn((item:number)=>h('li',null,item)),failure=vi.fn();
    const plan=prepareAdoption(f.host,()=>h('ul',null,createList(items,item=>item,render)),{failure});plan.commit();f.host.lastChild!.remove();f.records();setItems([2]);expect(render).toHaveBeenCalledOnce();expect(plan.phase).toBe('aborted');expect(f.records()).toEqual([]);f.disconnect();
  });
  it('owns keyFn-created roots/effects across each live extraction and final disposal',()=>{
    const f=fixture('<li>1</li>'),[items,setItems]=createSignal([1]),[n,setN]=createSignal(0),runs:number[]=[],cleaned:number[]=[];
    const plan=prepareAdoption(f.host,()=>h('ul',null,createList(items,item=>{
      createRoot(()=>{registerDisposer(()=>cleaned.push(item));createEffect(()=>{n();runs.push(item);});});return item;
    },item=>h('li',null,item))));
    expect(runs).toEqual([]);plan.commit();expect(runs).toEqual([1]);setItems([2]);expect(cleaned).toEqual([1]);expect(runs).toEqual([1,2]);
    setN(1);expect(runs).toEqual([1,2,2]);plan.dispose();expect(cleaned).toEqual([1,2]);setN(2);expect(runs).toEqual([1,2,2]);f.disconnect();
  });
  it('disposes partial keyFn construction on failure before any list write',()=>{
    const f=fixture('<li>1</li>'),[items,setItems]=createSignal([1]),[n,setN]=createSignal(0),runs=vi.fn(),cleanup=vi.fn(),failure=vi.fn();
    const plan=prepareAdoption(f.host,()=>h('ul',null,createList(items,item=>{
      if(item===2){createRoot(()=>{registerDisposer(cleanup);createEffect(()=>{n();runs();});});throw new Error('key callback');}return item;
    },item=>h('li',null,item))),{failure});plan.commit();const before=f.host.outerHTML;setItems([2]);
    expect(plan.phase).toBe('aborted');expect(failure).toHaveBeenCalledOnce();expect(cleanup).toHaveBeenCalledOnce();expect(runs).toHaveBeenCalledOnce();setN(1);expect(runs).toHaveBeenCalledOnce();expect(f.host.outerHTML).toBe(before);expect(f.records()).toEqual([]);f.disconnect();
  });
  it('stops or stabilizes when keyFn aborts or changes its own item source',()=>{
    for(const abort of [false,true]){
      const f=fixture('<li>1</li>'),[items,setItems]=createSignal([1]);let plan:ReturnType<typeof prepareAdoption>;
      plan=prepareAdoption(f.host,()=>h('ul',null,createList(items,item=>{if(item===2){if(abort)plan.dispose();else setItems([3]);}return item;},item=>h('li',null,item))));
      plan.commit();setItems([2]);expect(plan.phase).toBe(abort?'aborted':'live');expect(f.host.textContent).toBe(abort?'1':'3');if(abort)expect(f.records()).toEqual([]);plan.dispose();f.disconnect();
    }
  });
  it('builds later rows in the original SVG namespace',()=>{
    const f=fixture('<circle r="1"></circle>','svg'),[items,setItems]=createSignal([1]);
    const plan=prepareAdoption(f.host,()=>h('svg',null,createList(items,item=>item,item=>h('circle',{r:item}))));plan.commit();expect(f.records()).toEqual([]);setItems([1,2]);expect([...f.host.children].map(node=>node.namespaceURI)).toEqual(['http://www.w3.org/2000/svg','http://www.w3.org/2000/svg']);plan.dispose();f.disconnect();
  });
});
