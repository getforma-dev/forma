import {expect,it,vi} from 'vitest';
import {materializeAdoption} from '../adoption-materialize.js';
import {liveRanges} from '../adoption-live-ranges.js';
import {withAdoptionDescription} from '../adoption-description.js';
import {prepareAdoption} from '../adoption.js';
import {h} from '../element.js';
import {createSignal} from '../../reactive/signal.js';
import {registerDisposer} from '../../reactive/root.js';
import {AdoptionLifecycle} from '../../reactive/adoption-lifecycle.js';
it.each([false,true])('keeps real-element reader work in its candidate generation (failure=%s)',fail=>{
 const doc=document.implementation.createHTMLDocument();doc.body.innerHTML='<section></section>';const host=doc.body.firstElementChild!;
 let scope!:AdoptionLifecycle;const failure=vi.fn(),plan=prepareAdoption(host,()=>h('section'),{scope:options=>(scope=new AdoptionLifecycle(options)),failure});plan.commit();
 const [value,setValue]=createSignal(1),order:string[]=[],sentinel=new Error('candidate');const ranges=liveRanges(scope,doc,()=>{});
 const candidate=scope.group(()=>materializeAdoption(withAdoptionDescription(()=>h('div',null,()=>{
  const n=value();order.push('read '+n);registerDisposer(()=>order.push('cleanup '+n));
  return h('b',{ref:()=>{order.push('build '+n);if(fail&&n===2)throw sentinel;}},n);
 })),null,ranges));host.append(candidate.value!);const original=host.querySelector('b'),before=host.innerHTML;
 const observer=new MutationObserver(()=>{});observer.observe(host,{childList:true,subtree:true,characterData:true,attributes:true});
 order.length=0;setValue(2);
 if(fail){expect(plan.phase).toBe('aborted');expect(failure.mock.calls[0]![0]).toBe(sentinel);expect(host.querySelector('b')).toBe(original);expect(host.innerHTML).toBe(before);expect(observer.takeRecords()).toEqual([]);}
 else{expect(host.textContent).toBe('2');expect(failure).not.toHaveBeenCalled();}
 expect(order.slice(0,2)).toEqual(['read 2','build 2']);expect(order.indexOf('cleanup 1')).toBeGreaterThan(order.indexOf('build 2'));
 observer.disconnect();plan.dispose();
});
