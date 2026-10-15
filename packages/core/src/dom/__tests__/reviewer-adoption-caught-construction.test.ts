import {it,expect,vi} from 'vitest';
import {prepareAdoption} from '../adoption.js';
import {h} from '../element.js';
import {createSignal} from '../../reactive/signal.js';
import {createEffect} from '../../reactive/effect.js';
import {onCleanup} from '../../reactive/cleanup.js';

it('a caught initial h reader failure unsubscribes its failed binding and preserves its live owner',()=>{
 document.body.innerHTML='<button>start</button>';const host=document.body.firstElementChild as HTMLButtonElement;
 const[value,setValue]=createSignal(0),read=vi.fn(),cleanup=vi.fn(),nested=vi.fn(),failure=vi.fn(),cause=Error('caught construction');let caught:unknown;
 const plan=prepareAdoption(host,()=>h('button',{onClick(){try{h('p',null,()=>{value();read();createEffect(()=>{value();nested();onCleanup(cleanup);});throw cause;});}catch(error){caught=error;}}},'start'),{failure});
 try{
  plan.commit();host.click();expect(caught).toBe(cause);expect(read).toHaveBeenCalledTimes(1);expect(nested).toHaveBeenCalledTimes(1);expect(cleanup).toHaveBeenCalledTimes(1);expect(failure).not.toHaveBeenCalled();expect(plan.phase).toBe('live');
  setValue(1);expect(read).toHaveBeenCalledTimes(1);expect(nested).toHaveBeenCalledTimes(1);expect(cleanup).toHaveBeenCalledTimes(1);expect(failure).not.toHaveBeenCalled();expect(plan.phase).toBe('live');
 }finally{plan.dispose();document.body.replaceChildren();}
});
