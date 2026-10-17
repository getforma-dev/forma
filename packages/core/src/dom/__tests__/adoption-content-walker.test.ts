import {describe,it,expect,vi} from 'vitest';
import {prepareAdoption} from '../adoption.js';
import {h} from '../element.js';
import {trustedHtml} from '../trusted-html.js';
import {createSignal} from '../../reactive/signal.js';
import {registerDisposer} from '../../reactive/root.js';
function fixture(html:string){const doc=document.implementation.createHTMLDocument();doc.body.innerHTML=html;return doc.body.firstElementChild!;}
const raw=(value:string)=>({__html:trustedHtml(value)});
describe('prepared style and raw content integration',()=>{
 it('retains the development raw-plus-children warning without evaluating fallback or writing live DOM',()=>{
  const registry=Symbol.for('@getforma/core#trusted-types');delete (globalThis as Record<symbol,unknown>)[registry];
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),host=fixture('<div><b>raw</b></div>'),fallback=vi.fn(()=>h('i',null,'unused')),observer=new MutationObserver(()=>{});
  observer.observe(host,{subtree:true,attributes:true,childList:true,characterData:true});
  try{const plan=prepareAdoption(host,()=>h('div',{dangerouslySetInnerHTML:raw('<b>raw</b>')},fallback));plan.commit();
   expect(warn.mock.calls.filter(([line])=>String(line).includes('FORMA_W_INNER_HTML_CHILDREN'))).toHaveLength(1);expect(fallback).not.toHaveBeenCalled();expect(observer.takeRecords()).toEqual([]);plan.dispose();
  }finally{warn.mockRestore();observer.disconnect();delete (globalThis as Record<symbol,unknown>)[registry];}
 });
 it('validates normalized CSS once without initial writes and retains later style updates',async()=>{
  const host=fixture('<div style="color: red; padding: 1px">kept</div>'),[style,setStyle]=createSignal<unknown>({color:'red',padding:'1px'}),read=vi.fn(style),records:MutationRecord[]=[];
  const observer=new MutationObserver(batch=>records.push(...batch));observer.observe(host,{attributes:true,childList:true,subtree:true,characterData:true});
  const plan=prepareAdoption(host,()=>h('div',{style:read},'kept'));plan.commit();await new Promise(resolve=>setTimeout(resolve,0));expect(read).toHaveBeenCalledOnce();expect(records.concat(observer.takeRecords())).toEqual([]);
  setStyle({color:'blue'});expect((host as HTMLElement).style.color).toBe('blue');expect((host as HTMLElement).style.padding).toBe('');plan.dispose();setStyle('color: green');expect((host as HTMLElement).style.color).toBe('blue');observer.disconnect();
 });
 it('keeps raw markup opaque and skips fallback construction until a real later replacement',async()=>{
  const host=fixture('<div><b>raw<!--f:s0--></b></div>'),original=host.firstChild,[value,setValue]=createSignal<unknown>(raw('<b>raw<!--f:s0--></b>')),fallback=vi.fn(()=>h('i',null,'unused')),records:MutationRecord[]=[];
  const observer=new MutationObserver(batch=>records.push(...batch));observer.observe(host,{attributes:true,childList:true,subtree:true,characterData:true});
  const plan=prepareAdoption(host,()=>h('div',{dangerouslySetInnerHTML:value as never},fallback));plan.commit();await new Promise(resolve=>setTimeout(resolve,0));expect(fallback).not.toHaveBeenCalled();expect(host.firstChild).toBe(original);expect(records.concat(observer.takeRecords())).toEqual([]);
  setValue(raw('<b>raw<!--f:s0--></b>'));expect(host.firstChild).toBe(original);setValue(null);expect(host.childNodes).toHaveLength(0);setValue(raw('<i>new</i>'));expect(host.textContent).toBe('new');expect(fallback).not.toHaveBeenCalled();plan.dispose();observer.disconnect();
 });
 it('disposes fallback bindings only on a real raw replacement and does not resurrect them',()=>{
  const host=fixture('<div><b><!--f:t0-->1<!--/f:t0--></b></div>'),old=host.firstElementChild!,[value,setValue]=createSignal<unknown>(null),[n,setN]=createSignal(1),cleaned=vi.fn();
  const Fallback=()=>{registerDisposer(cleaned);return h('b',null,n);};
  const plan=prepareAdoption(host,()=>h('div',{dangerouslySetInnerHTML:value as never},h(Fallback)));plan.commit();setN(2);expect(old.textContent).toBe('2');expect(cleaned).not.toHaveBeenCalled();setValue(raw('<i>raw</i>'));expect(cleaned).toHaveBeenCalledOnce();setN(3);expect(old.textContent).toBe('2');setValue(null);expect(host.childNodes).toHaveLength(0);plan.dispose();expect(cleaned).toHaveBeenCalledOnce();
 });
 it.each(['dispose','move'] as const)('rechecks raw target after fallback cleanup can %s it',mode=>{
  const host=fixture('<div><b>fallback</b></div>'),[value,setValue]=createSignal<unknown>(null),failure=vi.fn();let plan:ReturnType<typeof prepareAdoption>;
  const Fallback=()=>{registerDisposer(()=>{if(mode==='dispose')plan.dispose();else host.ownerDocument.body.appendChild(host.ownerDocument.createElement('aside')).appendChild(host);});return h('b',null,'fallback');};
  plan=prepareAdoption(host,()=>h('div',{dangerouslySetInnerHTML:value as never},h(Fallback)),{failure});plan.commit();const before=host.innerHTML;setValue(raw('<i>must not appear</i>'));expect(host.innerHTML).toBe(before);expect(plan.phase).toBe('aborted');expect(failure).toHaveBeenCalledTimes(mode==='dispose'?0:1);plan.dispose();
 });
 it('uses the original template content fragment and refuses same-markup replacement during construction',()=>{
  const host=fixture('<template><b>kept</b></template>') as HTMLTemplateElement,[value,setValue]=createSignal<unknown>(raw('<b>kept</b>')),fragment=host.content,old=fragment.firstChild;
  const plan=prepareAdoption(host,()=>h('template',{dangerouslySetInnerHTML:value as never}));plan.commit();expect(host.content).toBe(fragment);expect(fragment.firstChild).toBe(old);setValue(null);expect(fragment.childNodes).toHaveLength(0);plan.dispose();
  const bad=fixture('<template><b>kept</b></template>') as HTMLTemplateElement;
  expect(()=>prepareAdoption(bad,()=>{const b=bad.content.firstChild!;b.parentNode!.replaceChild(b.cloneNode(true),b);return h('template',{dangerouslySetInnerHTML:raw('<b>kept</b>')});})).toThrow('FORMA_E_HYDRATE_STRUCTURE');
 });
 it('refuses untyped markup even when equal and leaves the existing tree on later refusal',()=>{
  const host=fixture('<div><b>kept</b></div>');expect(()=>prepareAdoption(host,()=>h('div',{dangerouslySetInnerHTML:{__html:'<b>kept</b>'} as never}))).toThrow('FORMA_E_RAW_INNER_HTML');
  const [value,setValue]=createSignal<unknown>(raw('<b>kept</b>')),failure=vi.fn(),old=host.firstChild,plan=prepareAdoption(host,()=>h('div',{dangerouslySetInnerHTML:value as never}),{failure});plan.commit();setValue({__html:'<b>kept</b>'});expect(plan.phase).toBe('aborted');expect(host.firstChild).toBe(old);expect(failure).toHaveBeenCalledOnce();
 });
 it('retains null raw fallback on noscript and refuses a later typed transition before replacement',()=>{
  const host=fixture('<noscript>kept</noscript>'),[value,setValue]=createSignal<unknown>(null),failure=vi.fn();
  const plan=prepareAdoption(host,()=>h('noscript',{dangerouslySetInnerHTML:value as never},'kept'),{failure});plan.commit();setValue(raw('<b>new</b>'));expect(plan.phase).toBe('aborted');expect(host.textContent).toBe('kept');expect(failure).toHaveBeenCalledOnce();
 });
});
