import{describe,it,expect,vi}from'vitest';
import{prepareAdoption}from'../adoption.js';
import{h}from'../element.js';
import{createSignal}from'../../reactive/signal.js';
function fixture(value:string){const doc=document.implementation.createHTMLDocument();doc.body.innerHTML='<section><title id="tt"></title></section>';doc.querySelector('title')!.textContent=value;return doc.body.firstElementChild!;}
describe('read-only HTML title preparation',()=>{
 it('adopts exact marker-free composed title text once with no writes, then updates and disposes',async()=>{
  const host=fixture('Docs: Page'),title=host.querySelector('title')!,original=title.firstChild,[value,setValue]=createSignal('Page'),read=vi.fn(value),records:MutationRecord[]=[];
  const observer=new MutationObserver(batch=>records.push(...batch));observer.observe(host,{subtree:true,attributes:true,childList:true,characterData:true});
  const plan=prepareAdoption(host,()=>h('section',null,h('title',{id:'tt'},'Docs: ',read)));plan.commit();await new Promise(resolve=>setTimeout(resolve,0));expect(read).toHaveBeenCalledOnce();expect(title.firstChild).toBe(original);expect(records.concat(observer.takeRecords())).toEqual([]);
  setValue('Next');expect(title.textContent).toBe('Docs: Next');plan.dispose();setValue('Later');expect(title.textContent).toBe('Docs: Next');observer.disconnect();
 });
 it('accepts an exact empty title and refuses wrong or serialized marker text without repair',()=>{
  const host=fixture(''),[value,setValue]=createSignal(''),plan=prepareAdoption(host,()=>h('section',null,h('title',{id:'tt'},value)));plan.commit();expect(host.querySelector('title')!.childNodes).toHaveLength(0);setValue('Now');expect(host.textContent).toBe('Now');plan.dispose();
  for(const text of ['wrong','<!--f:t0-->Page<!--/f:t0-->']){const bad=fixture(text),before=bad.innerHTML;expect(()=>prepareAdoption(bad,()=>h('section',null,h('title',{id:'tt'},()=> 'Page')))).toThrow();expect(bad.innerHTML).toBe(before);}
 });
});
