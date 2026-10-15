import{describe,it,expect,vi}from'vitest';
import{prepareAdoption}from'../adoption.js';
import{h,fragment}from'../element.js';
import{createShow}from'../show.js';
import{createList}from'../list.js';
import{AdoptionLifecycle}from'../../reactive/adoption-lifecycle.js';
import{createRoot,registerDisposer}from'../../reactive/root.js';
import{createSignal}from'../../reactive/signal.js';
function fixture(html:string){const doc=document.implementation.createHTMLDocument();doc.body.innerHTML=html;return doc.body.firstElementChild!;}
describe('private public-hydrate target seam',()=>{
 it('consumes a marked element host or exact unmarked container child without changing either marker',()=>{
  for(const marked of [true,false]){
   const host=fixture(marked?'<button data-forma-island="0" data-forma-ssr>click</button>':'<main data-forma-ssr><button>click</button></main>'),button=marked?host:host.firstElementChild!,calls=vi.fn(),build=vi.fn(()=>h('button',{onClick:calls},'click')),before=host.outerHTML;
   const plan=prepareAdoption(host,build,{target:'public'});plan.commit();expect(build).toHaveBeenCalledOnce();expect(host.outerHTML).toBe(before);button.dispatchEvent(new Event('click'));expect(calls).toHaveBeenCalledOnce();plan.dispose();button.dispatchEvent(new Event('click'));expect(calls).toHaveBeenCalledOnce();
  }
 });
 it('retains public Fragment and Show ranges in marked targets without borrowing sibling content',()=>{
  const host=fixture('<main data-forma-island="0"><b>one</b><!--f:s0--><i>yes</i><!--/f:s0--></main>'),[on,setOn]=createSignal(true),old=[...host.childNodes],child=vi.fn(()=>fragment(h('b',null,'one'),createShow(on,()=>h('i',null,'yes'))));
  const plan=prepareAdoption(host,()=>h(child),{target:'public'});plan.commit();expect(child).toHaveBeenCalledOnce();expect([...host.childNodes]).toEqual(old);setOn(false);expect(host.querySelector('i')).toBeNull();plan.dispose();
  const outside=fixture('<main><b>one</b></main>');outside.after(outside.ownerDocument.createElement('i'));
  expect(()=>prepareAdoption(outside,()=>fragment(h('b',null,'one'),h('i',null)),{target:'public'})).toThrow('FORMA_E_HYDRATE_NODE');expect(outside.nextSibling).not.toBeNull();
 });
 it('retains public List ranges and text readers inside their explicit target',()=>{
  const host=fixture('<ul><!--f:l0--><li>a</li><!--/f:l0--></ul>'),[rows,setRows]=createSignal(['a']),plan=prepareAdoption(host,()=>createList(rows,x=>x,x=>h('li',null,x)),{target:'public'});plan.commit();expect(host.textContent).toBe('a');setRows(['b']);expect(host.textContent).toBe('b');plan.dispose();
  const text=fixture('<p><!--f:t0-->one<!--/f:t0--></p>'),[value,setValue]=createSignal('one'),textPlan=prepareAdoption(text,()=>value,{target:'public'});textPlan.commit();setValue('two');expect(text.textContent).toBe('two');textPlan.dispose();
 });
 it('does not search past whitespace, tolerate surplus children or widen default compiled host mode',()=>{
  for(const html of ['<main> <button>click</button></main>','<main><button>click</button><i>extra</i></main>']){
   const host=fixture(html),before=host.outerHTML;expect(()=>prepareAdoption(host,()=>h('button',null,'click'),{target:'public'})).toThrow();expect(host.outerHTML).toBe(before);
  }
  const host=fixture('<main><button>click</button></main>');expect(()=>prepareAdoption(host,()=>h('button',null,'click'))).toThrow('FORMA_E_HYDRATE_NODE');
 });
 it('registers unprivileged lifecycle disposal before a component can dispose its caller',()=>{
  const host=fixture('<main><button>click</button></main>'),click=vi.fn(),build=vi.fn();
  createRoot(dispose=>{
   expect(()=>prepareAdoption(host,()=>{build();dispose();return h('button',{onClick:click},'click');},{target:'public',scope:options=>{const owner=new AdoptionLifecycle(options);registerDisposer(()=>owner.abort());return owner;}})).toThrow('FORMA_E_HYDRATE_STRUCTURE');
  });host.firstElementChild!.dispatchEvent(new Event('click'));expect(build).toHaveBeenCalledOnce();expect(click).not.toHaveBeenCalled();
 });
});
