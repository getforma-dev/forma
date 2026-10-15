import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareAdoption, type PreparedAdoption } from '../adoption.js';
import { h } from '../element.js';
import { __islandRegistration, preflightIslands } from '../island-state.js';
import { AdoptionScope } from '../../reactive/adoption-scope.js';
import { __adoptionSignal, __adoptionWritable, type AdoptionCodec } from '../../reactive/adoption-hooks.js';
import { createSignal } from '../../reactive/signal.js';
import { createEffect } from '../../reactive/effect.js';
import { batch } from '../../reactive/batch.js';

const H='0123456789abcdef',plans:PreparedAdoption[]=[];
afterEach(()=>{for(const plan of plans.splice(0))plan.dispose();});
function fixture(html:string){
  const doc=document.implementation.createHTMLDocument();
  doc.head.innerHTML=`<script type="application/json" data-island-state>{"v":1,"s":[],"i":[{"h":"${H}","p":{}}]}</script>`;
  doc.body.innerHTML=html;const host=doc.body.firstElementChild!;
  for(const [key,value]of Object.entries({'data-forma-island':'0','data-forma-state':'0','data-forma-component':'Test','data-forma-h':H}))host.setAttribute(key,value);
  const result=preflightIslands({Test:__islandRegistration(()=>{}, {h:H,schema:[[]],mode:0})},doc)[0]!;
  if('error'in result)throw result.error;
  const records:MutationRecord[]=[],observer=new MutationObserver(batch=>records.push(...batch));
  observer.observe(host,{attributes:true,childList:true,characterData:true,subtree:true});
  return {doc,host,checked:result.value,records:()=>records.splice(0).concat(observer.takeRecords()),
    prepare(build:()=>unknown,compiled=true){const plan=prepareAdoption(host,build,compiled?{scope:options=>new AdoptionScope(result.value,options)}:{});plans.push(plan);return plan;}};
}
function local<T>(value:T,codec:AdoptionCodec){
  const pair=__adoptionSignal(0,createSignal(value));
  return {get:pair[0],set:pair[1],read:__adoptionWritable(pair[0],pair[0],codec,0)};
}
const drain=()=>new Promise(resolve=>setTimeout(resolve,0));

describe('private walker control bindings',()=>{
  it('seeds an actual local text getter without rewriting the edited control, focus or selection',async()=>{
    const f=fixture('<input value="server">'),input=f.host as HTMLInputElement;
    input.value='typed';input.focus();input.setSelectionRange(1,3,'backward');
    const writes=vi.spyOn(input,'value','set'),effects:string[]=[];let value!:ReturnType<typeof local<string>>;
    const plan=f.prepare(()=>{value=local('server','string');createEffect(()=>{effects.push(value.get());});return h('input',{value:value.read});});
    expect(value.get()).toBe('server');expect(effects).toEqual([]);plan.commit();await drain();
    expect(value.get()).toBe('typed');expect(effects).toEqual(['typed']);expect(writes).not.toHaveBeenCalled();expect(f.records()).toEqual([]);
    expect(input.selectionStart).toBe(1);expect(input.selectionEnd).toBe(3);expect(input.selectionDirection).toBe('backward');expect(f.doc.activeElement).toBe(input);
    value.set('later');expect(input.value).toBe('later');expect(writes).toHaveBeenCalledOnce();expect(input.getAttribute('value')).toBe('later');
    plan.dispose();value.set('disposed');expect(input.value).toBe('later');
  });
  it('keeps untouched captured readers reactive but refuses captured, computed and unprivileged edited bindings',()=>{
    for(const edited of [false,true])for(const kind of ['captured','computed','direct'] as const){
      const f=fixture('<input value="server">'),input=f.host as HTMLInputElement,[get,set]=createSignal('server');
      if(edited)input.value='typed';
      const build=()=>h('input',{value:kind==='computed'?()=>get().slice():get});
      if(edited){expect(()=>f.prepare(build,kind!=='direct')).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');set('later');expect(input.value).toBe('typed');expect(f.records()).toEqual([]);}
      else{const plan=f.prepare(build,kind!=='direct');plan.commit();expect(f.records()).toEqual([]);set('later');expect(input.value).toBe('later');}
    }
  });
  it('preserves edited literal value, checked and textarea initialization with no seed authority',async()=>{
    const f=fixture('<div><input value="server"><input type="checkbox" checked><textarea>server</textarea></div>');
    const [input,check]=Array.from(f.host.querySelectorAll('input')),area=f.host.querySelector('textarea')!;
    input!.value='typed';check!.checked=false;area.value='typed area';
    const writes=[vi.spyOn(input!,'value','set'),vi.spyOn(check!,'checked','set'),vi.spyOn(area,'defaultValue','set')];
    const plan=f.prepare(()=>h('div',null,h('input',{value:'server'}),h('input',{type:'checkbox',checked:true}),h('textarea',null,'server')),false);
    plan.commit();await drain();expect([input!.value,check!.checked,area.value]).toEqual(['typed',false,'typed area']);
    expect(writes.every(spy=>spy.mock.calls.length===0)).toBe(true);expect(f.records()).toEqual([]);
  });
  it('rejects wrong literal defaults despite early edits, without repair or deferred callbacks',()=>{
    for(const [html,build]of [
      ['<input value="wrong">',()=>h('input',{value:'server'})],
      ['<input type="checkbox">',()=>h('input',{type:'checkbox',checked:true})],
      ['<textarea>wrong</textarea>',()=>h('textarea',null,'server')],
    ] as const){const f=fixture(html),before=f.host.outerHTML;expect(()=>f.prepare(build)).toThrow('FORMA_E_HYDRATE_VALUE');expect(f.host.outerHTML).toBe(before);expect(f.records()).toEqual([]);}
  });
  it('uses numeric and boolean codecs without stringifying their local signal values',async()=>{
    const f=fixture('<div><input type="number" value="7"><input type="checkbox"></div>');
    const [number,check]=Array.from(f.host.querySelectorAll('input'));number!.value='8';check!.checked=true;
    let n!:ReturnType<typeof local<number>>,b!:ReturnType<typeof local<boolean>>;
    const plan=f.prepare(()=>{n=local(7,'number');b=local(false,'boolean');return h('div',null,h('input',{type:'number',value:n.read}),h('input',{type:'checkbox',checked:b.read}));});
    plan.commit();await drain();expect(n.get()).toBe(8);expect(b.get()).toBe(true);expect(f.records()).toEqual([]);
    n.set(9);b.set(false);expect(number!.value).toBe('9');expect(check!.checked).toBe(false);
  });
  it('seeds multiple selection as a string array while preserving selected properties at commit',async()=>{
    const f=fixture('<select multiple><option value="a" selected>A</option><option value="b">B</option></select>'),select=f.host as HTMLSelectElement;
    select.options[0]!.selected=false;select.options[1]!.selected=true;let value!:ReturnType<typeof local<string[]>>;
    const writes=Array.from(select.options,option=>vi.spyOn(option,'selected','set'));
    const plan=f.prepare(()=>{value=local(['a'],'string-array');return h('select',{multiple:true,value:value.read},h('option',{value:'a',selected:true},'A'),h('option',{value:'b'},'B'));});
    plan.commit();await drain();expect(value.get()).toEqual(['b']);expect(writes.every(spy=>!spy.mock.calls.length)).toBe(true);expect(f.records()).toEqual([]);
    value.set(['a','b']);expect(Array.from(select.selectedOptions,option=>option.value)).toEqual(['a','b']);
  });
  it('keeps sole textarea getter authority but rejects edited composed text',async()=>{
    const f=fixture('<textarea>server</textarea>'),area=f.host as HTMLTextAreaElement;area.value='typed';let value!:ReturnType<typeof local<string>>;
    const writes=vi.spyOn(area,'defaultValue','set');const plan=f.prepare(()=>{value=local('server','string');return h('textarea',null,value.read);});
    plan.commit();await drain();expect(value.get()).toBe('typed');expect(writes).not.toHaveBeenCalled();expect(f.records()).toEqual([]);
    value.set('later');expect(area.defaultValue).toBe('later');expect(area.value).toBe('typed');
    const g=fixture('<textarea>prefix server</textarea>');(g.host as HTMLTextAreaElement).value='typed';
    expect(()=>g.prepare(()=>{const v=local('server','string');return h('textarea',null,'prefix ',v.read);})).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');expect(g.records()).toEqual([]);
  });
  it('refuses conflicting edits to one local getter before any seed or write',()=>{
    const f=fixture('<div><input value="server"><input value="server"></div>'),inputs=Array.from(f.host.querySelectorAll('input'));
    inputs[0]!.value='one';inputs[1]!.value='two';let value!:ReturnType<typeof local<string>>;
    expect(()=>f.prepare(()=>{value=local('server','string');return h('div',null,h('input',{value:value.read}),h('input',{value:value.read}));})).toThrow('FORMA_E_HYDRATE_INPUT_CONFLICT');
    expect(value.get()).toBe('server');value.set('later');expect(inputs.map(input=>input.value)).toEqual(['one','two']);expect(f.records()).toEqual([]);
  });
  it('rechecks live edits before listeners or seeds and leaves every observer dormant on failure',()=>{
    const f=fixture('<input value="server">'),input=f.host as HTMLInputElement;input.value='typed';let value!:ReturnType<typeof local<string>>;
    const effect=vi.fn(),click=vi.fn(),listener=vi.spyOn(input,'addEventListener');
    const plan=f.prepare(()=>{value=local('server','string');createEffect(effect);return h('input',{value:value.read,onClick:click});});input.value='changed again';
    expect(()=>plan.commit()).toThrow('FORMA_E_HYDRATE_VALUE');expect(value.get()).toBe('server');expect(listener).not.toHaveBeenCalled();expect(effect).not.toHaveBeenCalled();expect(f.records()).toEqual([]);
  });
  it('does not globally suppress seeded dependent text updates',()=>{
    const f=fixture('<div><input value="server"><span><!--f:t0-->server<!--/f:t0--></span></div>');(f.host.querySelector('input')!).value='typed';
    let value!:ReturnType<typeof local<string>>;const plan=f.prepare(()=>{value=local('server','string');return h('div',null,h('input',{value:value.read}),h('span',null,value.get));});
    plan.commit();expect(value.get()).toBe('typed');expect(f.host.querySelector('span')!.textContent).toBe('typed');expect(f.host.querySelector('input')!.getAttribute('value')).toBe('server');
  });
  it('handles a surrounding batch without skipping a later different control value',()=>{
    for(const replace of [false,true]){const f=fixture('<input value="server">'),input=f.host as HTMLInputElement;input.value='typed';let value!:ReturnType<typeof local<string>>;
      const plan=f.prepare(()=>{value=local('server','string');return h('input',{value:value.read});});
      batch(()=>{plan.commit();expect(value.get()).toBe('typed');if(replace)value.set('later');});
      expect(input.value).toBe(replace?'later':'typed');expect(input.getAttribute('value')).toBe(replace?'later':'server');if(!replace)expect(f.records()).toEqual([]);
    }
  });
  it('refuses a revoked claim during listener installation before applying seeds',()=>{
    const f=fixture('<input value="server">'),input=f.host as HTMLInputElement;input.value='typed';let value!:ReturnType<typeof local<string>>;
    // A normal listener installation callback can revoke a retained claim;
    // checked seeding must refuse without calling any application effect.
    const original=input.addEventListener.bind(input);vi.spyOn(input,'addEventListener').mockImplementation((...args)=>{original(...args);input.removeAttribute('data-forma-h');});
    const plan=f.prepare(()=>{value=local('server','string');return h('input',{value:value.read,onClick:()=>{}});});
    expect(()=>plan.commit()).toThrow('FORMA_E_ISLAND_IDENTITY');expect(value.get()).toBe('server');expect(input.value).toBe('typed');
  });
  it('rolls back a seeded getter before observers can run when publication recheck fails',()=>{
    const f=fixture('<input value="server">'),input=f.host as HTMLInputElement;input.value='typed';
    let value!:ReturnType<typeof local<string>>;const effects:string[]=[];
    class RevokedPublication extends AdoptionScope {
      protected override applySeeds():void{super.applySeeds();input.removeAttribute('data-forma-h');}
    }
    const plan=prepareAdoption(input,()=>{value=local('server','string');createEffect(()=>{effects.push(value.get());});return h('input',{value:value.read});},{scope:options=>new RevokedPublication(f.checked,options)});plans.push(plan);
    expect(()=>plan.commit()).toThrow('FORMA_E_ISLAND_IDENTITY');expect(value.get()).toBe('server');expect(effects).toEqual([]);expect(input.value).toBe('typed');
    value.set('later');expect(input.value).toBe('typed');expect(effects).toEqual([]);
  });
  it('does not skip a future different number when its normalized seed equals the original signal',()=>{
    const f=fixture('<input type="number" value="1">'),input=f.host as HTMLInputElement;input.value='1.0';let value!:ReturnType<typeof local<number>>;
    const plan=f.prepare(()=>{value=local(1,'number');return h('input',{type:'number',value:value.read});});plan.commit();
    expect(value.get()).toBe(1);expect(input.value).toBe('1.0');expect(f.records()).toEqual([]);value.set(2);expect(input.value).toBe('2');
  });

});
