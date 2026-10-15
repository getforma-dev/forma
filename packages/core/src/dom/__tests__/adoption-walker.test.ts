import { describe, expect, it, vi } from 'vitest';
import { prepareAdoption } from '../adoption.js';
import { h, fragment } from '../element.js';
import { createShow } from '../show.js';
import { createSignal } from '../../reactive/signal.js';
import { createEffect } from '../../reactive/effect.js';
import { registerDisposer } from '../../reactive/root.js';

function fixture(html:string){
  const doc=document.implementation.createHTMLDocument();doc.body.innerHTML=html;
  const host=doc.body.firstElementChild!;
  const records:MutationRecord[]=[];
  const native=new MutationObserver(batch=>records.push(...batch));native.observe(host,{attributes:true,childList:true,characterData:true,subtree:true});
  const observer={takeRecords:()=>records.splice(0).concat(native.takeRecords()),disconnect:()=>native.disconnect()};
  return {doc,host,observer};
}
describe('private prepared descriptor walker',()=>{
  it('reads props/text once, commits without DOM writes and keeps later updates live',async()=>{
    const {host,observer}=fixture('<p class="one" title="title">before <!--f:t0-->7<!--/f:t0--></p>');
    const nodes=[...host.childNodes],initial=host.outerHTML;
    const [count,setCount]=createSignal(7),[label,setLabel]=createSignal('one');
    const countRead=vi.fn(count),labelRead=vi.fn(label),effect=vi.fn(),ref=vi.fn();
    const prepare=vi.fn(()=>{createEffect(effect);return h('p',{class:labelRead,title:'title',ref},'before ',countRead);});
    const plan=prepareAdoption(host,prepare);
    expect(plan.phase).toBe('validated');expect(prepare).toHaveBeenCalledOnce();expect(countRead).toHaveBeenCalledOnce();expect(labelRead).toHaveBeenCalledOnce();expect(effect).not.toHaveBeenCalled();expect(ref).not.toHaveBeenCalled();
    expect(observer.takeRecords()).toEqual([]);plan.commit();await new Promise(resolve=>setTimeout(resolve,0));
    expect(effect).toHaveBeenCalledOnce();expect(ref).toHaveBeenCalledExactlyOnceWith(host);expect(countRead).toHaveBeenCalledOnce();expect(labelRead).toHaveBeenCalledOnce();
    expect(host.outerHTML).toBe(initial);expect([...host.childNodes]).toEqual(nodes);expect(observer.takeRecords()).toEqual([]);
    setCount(8);setLabel('two');expect(host.className).toBe('two');expect(host.childNodes[2]!.textContent).toBe('8');
    plan.dispose();setCount(9);setLabel('three');expect(host.className).toBe('two');expect(host.childNodes[2]!.textContent).toBe('8');observer.disconnect();
  });
  it('retains the native empty text sentinel initially and uses ordinary empty text on a later update',()=>{
    const {host,observer}=fixture('<p><!--f:t0-->\u200b<!--/f:t0--></p>'),[value,setValue]=createSignal('');
    const target=host.childNodes[1],plan=prepareAdoption(host,()=>h('p',null,value));plan.commit();expect(observer.takeRecords()).toEqual([]);expect(target!.textContent).toBe('\u200b');
    setValue('next');expect(target!.textContent).toBe('next');setValue('');expect(target!.textContent).toBe('');expect(host.childNodes[1]).toBe(target);plan.dispose();observer.disconnect();
  });
  it('removes owned listeners if a retained live reader later throws',()=>{
    const {host}=fixture('<button title="ok">click</button>'),[fail,setFail]=createSignal(false),click=vi.fn(),failure=vi.fn();
    const plan=prepareAdoption(host,()=>h('button',{onClick:click,title:()=>{if(fail())throw new Error('live read');return 'ok';}},'click'),{failure});plan.commit();
    host.dispatchEvent(new Event('click'));expect(click).toHaveBeenCalledOnce();setFail(true);expect(plan.phase).toBe('aborted');expect(failure).toHaveBeenCalledOnce();host.dispatchEvent(new Event('click'));expect(click).toHaveBeenCalledOnce();expect(host.getAttribute('title')).toBe('ok');
  });
  it('discards all earlier readers, deferred effects, refs and listeners after a late mismatch',()=>{
    const {host,observer}=fixture('<div><button title="ok"><!--f:t0-->1<!--/f:t0--></button><b>wrong</b></div>');
    const before=host.outerHTML,[n,setN]=createSignal(1),read=vi.fn(n),effect=vi.fn(),ref=vi.fn(),click=vi.fn();
    const listener=vi.spyOn(host.firstElementChild!,'addEventListener');
    expect(()=>prepareAdoption(host,()=>{createEffect(effect);return h('div',null,h('button',{title:'ok',ref,onClick:click},read),h('b',null,'expected'));})).toThrow('FORMA_E_HYDRATE_VALUE');
    setN(2);host.firstElementChild!.dispatchEvent(new Event('click'));
    expect(read).toHaveBeenCalledOnce();expect(effect).not.toHaveBeenCalled();expect(ref).not.toHaveBeenCalled();expect(click).not.toHaveBeenCalled();expect(listener).not.toHaveBeenCalled();
    expect(host.outerHTML).toBe(before);expect(observer.takeRecords()).toEqual([]);observer.disconnect();
  });
  it('does not invoke listeners before commit, and disposes only its owned listeners',()=>{
    const {host}=fixture('<button>click</button>'),outside=vi.fn(),owned=vi.fn();host.addEventListener('click',outside);
    const plan=prepareAdoption(host,()=>h('button',{onClick:owned},'click'));
    host.dispatchEvent(new Event('click'));expect(owned).not.toHaveBeenCalled();expect(outside).toHaveBeenCalledOnce();
    plan.commit();host.dispatchEvent(new Event('click'));expect(owned).toHaveBeenCalledOnce();expect(outside).toHaveBeenCalledTimes(2);
    expect(()=>plan.commit()).toThrow('FORMA_E_HYDRATE_STRUCTURE');host.dispatchEvent(new Event('click'));expect(owned).toHaveBeenCalledTimes(2);
    plan.dispose();host.dispatchEvent(new Event('click'));expect(owned).toHaveBeenCalledTimes(2);expect(outside).toHaveBeenCalledTimes(4);
  });
  it('rechecks node/range identity before installing even one listener',()=>{
    const {doc,host}=fixture('<main><button>click</button></main>'),button=host.firstElementChild!,clicked=vi.fn(),listener=vi.spyOn(button,'addEventListener');
    const plan=prepareAdoption(host,()=>h('main',null,h('button',{onClick:clicked},'click')));
    const other=doc.createElement('aside');doc.body.append(other);other.append(button);
    expect(()=>plan.commit()).toThrow('FORMA_E_HYDRATE_STRUCTURE');expect(listener).not.toHaveBeenCalled();button.dispatchEvent(new Event('click'));expect(clicked).not.toHaveBeenCalled();expect(plan.phase).toBe('aborted');
  });
  it('aborts prior dormant work when a later reader throws, preserving a live neighbor',()=>{
    const a=fixture('<p><!--f:t0-->1<!--/f:t0--></p>'),b=fixture('<p><!--f:t0-->1<!--/f:t0--><!--f:t1-->2<!--/f:t1--></p>');
    const [n,setN]=createSignal(1),live=prepareAdoption(a.host,()=>h('p',null,n));live.commit();
    const first=vi.fn(n),effect=vi.fn(),cleanup=vi.fn();
    expect(()=>prepareAdoption(b.host,()=>h('p',null,first,()=>{createEffect(effect);registerDisposer(cleanup);throw new Error('reader');}))).toThrow('reader');
    expect(cleanup).toHaveBeenCalledOnce();setN(3);expect(first).toHaveBeenCalledOnce();expect(effect).not.toHaveBeenCalled();expect(a.host.textContent).toBe('3');expect(b.host.textContent).toBe('12');
    expect(b.observer.takeRecords()).toEqual([]);live.dispose();a.observer.disconnect();b.observer.disconnect();
  });
  it('invalidates a prepared dependency instead of rerunning its reader before commit',()=>{
    const {host,observer}=fixture('<p><!--f:t0-->1<!--/f:t0--></p>'),[n,setN]=createSignal(1),read=vi.fn(n);
    const plan=prepareAdoption(host,()=>h('p',null,read));setN(2);
    expect(()=>plan.commit()).toThrow('FORMA_E_HYDRATE_VALUE');expect(read).toHaveBeenCalledOnce();expect(host.textContent).toBe('1');expect(observer.takeRecords()).toEqual([]);observer.disconnect();
  });
  it('keeps unsafe/odd-cased attributes absent and refuses a server value rather than removing it',()=>{
    const good=fixture('<a>safe</a>'),bad=fixture('<a href="javascript:bad()">safe</a>');
    const plan=prepareAdoption(good.host,()=>h('a',{href:()=> 'javascript:bad()',ONCLICK:()=>{}},'safe'));plan.commit();expect(good.observer.takeRecords()).toEqual([]);
    const before=bad.host.outerHTML;expect(()=>prepareAdoption(bad.host,()=>h('a',{href:()=> 'javascript:bad()'},'safe'))).toThrow('FORMA_E_HYDRATE_VALUE');expect(bad.host.outerHTML).toBe(before);expect(bad.observer.takeRecords()).toEqual([]);
    plan.dispose();good.observer.disconnect();bad.observer.disconnect();
  });
  it('matches SVG namespace/case and namespaced values, preserving authored whitespace and fragments',()=>{
    const {host,observer}=fixture('<svg><g> <use xlink:href="#shape"></use> </g></svg>');
    const use=host.querySelector('use')!;
    // happy-dom does not parse xlink namespaces; establish native namespace.
    use.removeAttribute('xlink:href');use.setAttributeNS('http://www.w3.org/1999/xlink','xlink:href','#shape');observer.takeRecords();
    const [href,setHref]=createSignal('#shape');const plan=prepareAdoption(host,()=>h('svg',null,h('g',null,fragment(' ',h('use',{'xlink:href':href}),' '))));
    plan.commit();expect(observer.takeRecords()).toEqual([]);setHref('#other');expect(use.getAttributeNS('http://www.w3.org/1999/xlink','href')).toBe('#other');plan.dispose();observer.disconnect();
  });
  it('keeps callbacks dormant through listener installation and cleans after a later callback failure',()=>{
    const {host}=fixture('<button>click</button>'),click=vi.fn(),failure=vi.fn();const original=host.addEventListener.bind(host);
    const add=vi.spyOn(host,'addEventListener').mockImplementation((type,listener,options)=>{original(type,listener,options);host.dispatchEvent(new Event('click'));});
    const plan=prepareAdoption(host,()=>h('button',{onClick:click,ref:()=>{throw new Error('ref');}},'click'),{failure});
    plan.commit();expect(plan.phase).toBe('aborted');expect(click).not.toHaveBeenCalled();expect(failure).toHaveBeenCalledOnce();host.dispatchEvent(new Event('click'));expect(click).not.toHaveBeenCalled();add.mockRestore();
  });
  it('prepares Show once without writes, disposes its initial owner and keeps later cached branches live',async()=>{
    const {host,observer}=fixture('<div><!--f:s0--><b><!--f:t0-->1<!--/f:t0--></b><!--/f:s0--></div>');
    const [visible,setVisible]=createSignal(true),[n,setN]=createSignal(1),read=vi.fn(visible),cleaned=vi.fn();
    const original=host.querySelector('b')!;
    const yes=vi.fn(()=>{registerDisposer(cleaned);return h('b',null,n);});
    const no=vi.fn(()=>h('i',null,n));
    const plan=prepareAdoption(host,()=>h('div',null,createShow(read,yes,no)));
    expect(read).toHaveBeenCalledOnce();expect(yes).toHaveBeenCalledOnce();expect(no).not.toHaveBeenCalled();
    plan.commit();await new Promise(resolve=>setTimeout(resolve,0));expect(observer.takeRecords()).toEqual([]);expect(host.querySelector('b')).toBe(original);
    setVisible(false);expect(cleaned).toHaveBeenCalledOnce();const falseBranch=host.querySelector('i')!;
    setN(2);expect(original.textContent).toBe('1');expect(falseBranch.textContent).toBe('2');
    setVisible(true);const rebuilt=host.querySelector('b')!;expect(rebuilt).not.toBe(original);expect(yes).toHaveBeenCalledTimes(2);
    setN(3);expect(rebuilt.textContent).toBe('3');expect(falseBranch.textContent).toBe('3');
    setVisible(false);expect(host.querySelector('i')).toBe(falseBranch);expect(no).toHaveBeenCalledOnce();setVisible(true);expect(host.querySelector('b')).toBe(rebuilt);
    plan.dispose();setN(4);expect(rebuilt.textContent).toBe('3');expect(falseBranch.textContent).toBe('3');expect(cleaned).toHaveBeenCalledTimes(2);observer.disconnect();
  });
  it('validates empty and repeated/nested Show ranges without creating fallback content',()=>{
    const good=fixture('<svg><!--f:s0--><!--/f:s0--><!--f:s0--><!--f:s0--><circle></circle><!--/f:s0--><!--/f:s0--></svg>');
    const [on,setOn]=createSignal(false),factory=vi.fn(()=>h('circle',null));
    const plan=prepareAdoption(good.host,()=>h('svg',null,createShow(on,factory),createShow(()=>true,()=>createShow(()=>true,()=>h('circle',null)))));
    plan.commit();expect(factory).not.toHaveBeenCalled();expect(good.observer.takeRecords()).toEqual([]);setOn(true);expect(factory).toHaveBeenCalledOnce();expect(good.host.querySelector('circle')!.namespaceURI).toBe('http://www.w3.org/2000/svg');plan.dispose();good.observer.disconnect();
    for(const html of ['<div><!--f:s0--><b>wrong</b><!--/f:s0--></div>','<div><!--f:s0--><!--/f:s0--></div>']){
      const bad=fixture(html),before=bad.host.outerHTML,callback=vi.fn();
      expect(()=>prepareAdoption(bad.host,()=>h('div',null,createShow(()=>true,()=>{createEffect(callback);return h('b',null,'expected');})))).toThrow();
      expect(callback).not.toHaveBeenCalled();expect(bad.host.outerHTML).toBe(before);expect(bad.observer.takeRecords()).toEqual([]);bad.observer.disconnect();
    }
  });
  it('keeps another live Show update outside an unrelated preparation context',()=>{
    const first=fixture('<div><!--f:s0--><b>old</b><!--/f:s0--></div>'),second=fixture('<p>wrong</p>'),[on,setOn]=createSignal(true),effect=vi.fn();
    const plan=prepareAdoption(first.host,()=>h('div',null,createShow(on,()=>h('b',null,'old'),()=>{createEffect(effect);return h('i',null,'new');})));plan.commit();
    expect(()=>prepareAdoption(second.host,()=>{setOn(false);return h('p',null,'expected');})).toThrow('FORMA_E_HYDRATE_VALUE');
    expect(first.host.querySelector('i')!.textContent).toBe('new');expect(effect).toHaveBeenCalledOnce();expect(plan.phase).toBe('live');plan.dispose();first.observer.disconnect();second.observer.disconnect();
  });
  it('disposes partial live branch construction and keeps existing DOM on a callback failure',()=>{
    const {host}=fixture('<div><!--f:s0--><b>old</b><!--/f:s0--></div>'),[on,setOn]=createSignal(true),[n,setN]=createSignal(0),failure=vi.fn(),cleanup=vi.fn(),runs=vi.fn();
    const plan=prepareAdoption(host,()=>h('div',null,createShow(on,()=>h('b',null,'old'),()=>{registerDisposer(cleanup);createEffect(()=>{n();runs();});throw new Error('branch');})),{failure});
    plan.commit();setOn(false);expect(plan.phase).toBe('aborted');expect(failure).toHaveBeenCalledOnce();expect(cleanup).toHaveBeenCalledOnce();expect(host.querySelector('b')!.textContent).toBe('old');expect(runs).toHaveBeenCalledOnce();setN(1);expect(runs).toHaveBeenCalledOnce();
  });
  it('refuses a nested island before executing its independent component in this private checkpoint',()=>{
    const {host,observer}=fixture('<div><!--f:i0--><b data-forma-island="0">child</b><!--/f:i0--></div>'),child=vi.fn(()=>h('b',null,'child'));
    expect(()=>prepareAdoption(host,()=>h('div',null,h(child,null)))).toThrow('FORMA_E_HYDRATE_STRUCTURE');expect(child).not.toHaveBeenCalled();expect(observer.takeRecords()).toEqual([]);observer.disconnect();
  });
});
