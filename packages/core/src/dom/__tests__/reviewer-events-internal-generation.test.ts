import {it,expect,vi} from 'vitest';
import {prepareAdoption} from '../adoption.js';
import {h} from '../element.js';
import {createSignal} from '../../reactive/signal.js';
import {createEffect} from '../../reactive/effect.js';

it('revokes removed public h function-child listeners and their callback resources on each generation',()=>{
 document.body.innerHTML='<button>start</button><section></section>';
 const host=document.body.firstElementChild as HTMLButtonElement,output=document.body.lastElementChild!;
 const[generation,setGeneration]=createSignal(0),[value,setValue]=createSignal(0),runs=vi.fn();let cleanup:(()=>void)|undefined;
 const plan=prepareAdoption(host,()=>h('button',{onClick(){output.append(h('div',null,()=>{generation();return h('button',{onClick(){cleanup=createEffect(()=>{value();runs()});}},'child');}));}},'start'));
 try{
  plan.commit();host.click();const old=output.querySelector('button')!;old.click();expect(runs).toHaveBeenCalledTimes(1);
  setGeneration(1);expect(output.querySelector('button')).not.toBe(old);expect(old.isConnected).toBe(false);
  setValue(1);expect(runs).toHaveBeenCalledTimes(1);old.click();expect(runs).toHaveBeenCalledTimes(1);
  output.querySelector('button')!.click();expect(runs).toHaveBeenCalledTimes(2);plan.dispose();setValue(2);expect(runs).toHaveBeenCalledTimes(2);
 }finally{plan.dispose();cleanup?.();document.body.replaceChildren();}
});

it('routes a later public h reader failure to its adopted owner once while leaving its neighbor live',()=>{
 document.body.innerHTML='<button>start</button><button>neighbor</button><section></section>';
 const[host,neighbor,output]=Array.from(document.body.children) as HTMLElement[];
 const[value,setValue]=createSignal(0),failure=vi.fn(),neighborCalls=vi.fn(),cause=Error('late binding');
 const good=prepareAdoption(neighbor!,()=>h('button',{onClick:neighborCalls},'neighbor'));
 const plan=prepareAdoption(host!,()=>h('button',{onClick(){output!.append(h('p',null,()=>{if(value())throw cause;return 'kept'}));}},'start'),{failure});
 try{
  good.commit();plan.commit();host!.click();expect(output!.textContent).toBe('kept');
  setValue(1);expect(failure).toHaveBeenCalledExactlyOnceWith(cause,'FORMA_E_HYDRATE_EFFECT');expect(plan.phase).toBe('aborted');
  setValue(2);expect(failure).toHaveBeenCalledTimes(1);neighbor!.click();expect(neighborCalls).toHaveBeenCalledTimes(1);expect(good.phase).toBe('live');
 }finally{plan.dispose();good.dispose();document.body.replaceChildren();}
});
