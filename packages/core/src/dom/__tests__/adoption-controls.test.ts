import {describe,expect,it,vi} from 'vitest';
import {AdoptionControls} from '../adoption-controls.js';

function fixture(html:string,before='',after='') {
 const doc=document.implementation.createHTMLDocument();doc.body.innerHTML=before+`<section id="host">${html}</section>`+after;
 const host=doc.querySelector('#host')!;
 const get=<T extends Element=HTMLInputElement>(id:string)=>doc.querySelector<T>(`#${id}`)!;
 return {doc,host,get};
}
const code=(name:string)=>expect.objectContaining({code:name});
describe('read-only control default and edit observations',()=>{
 it('keeps untouched scalar defaults, nodes, attributes and live setters untouched',()=>{
  const {doc,host,get}=fixture('<input id="i" value="saved"><textarea id="t">notes</textarea><input id="c" type="checkbox" checked>');
  const observer=new MutationObserver(()=>{});observer.observe(doc,{subtree:true,attributes:true,childList:true,characterData:true});
  const input=get<HTMLInputElement>('i'),area=get<HTMLTextAreaElement>('t'),box=get<HTMLInputElement>('c');
  const setters=[vi.spyOn(input,'value','set'),vi.spyOn(area,'value','set'),vi.spyOn(box,'checked','set')];
  const controls=new AdoptionControls(host),tokens=[controls.add({element:input,key:'value',initial:'saved'}),controls.add({element:area,key:'text',initial:'notes'}),controls.add({element:box,key:'checked',initial:true})];
  expect(controls.finish()).toEqual(tokens.map((token,i)=>({token,edited:false,value:['saved','notes',true][i]})));controls.check();
  expect(new Set(tokens).size).toBe(3);expect(tokens.every(Object.isFrozen)).toBe(true);expect(observer.takeRecords()).toEqual([]);setters.forEach(setter=>{expect(setter).not.toHaveBeenCalled();setter.mockRestore();});observer.disconnect();
 });
 it('returns explicit edited text and boolean observations without altering either default',()=>{
  const {host,get}=fixture('<input id="i" value="saved"><input id="c" type="checkbox" checked>');
  const input=get<HTMLInputElement>('i'),box=get<HTMLInputElement>('c');input.value='typed';box.checked=false;
  const controls=new AdoptionControls(host),one=controls.add({element:input,key:'value',initial:'saved',codec:'string'}),two=controls.add({element:box,key:'checked',initial:true,codec:'boolean'});
  expect(controls.finish()).toEqual([{token:one,edited:true,value:'typed'},{token:two,edited:true,value:false}]);
  expect(input.defaultValue).toBe('saved');expect(box.defaultChecked).toBe(true);expect(input.value).toBe('typed');expect(box.checked).toBe(false);
 });
 it('validates every default before considering an edited readonly binding',()=>{
  const {host,get}=fixture('<input id="a" value="old"><input id="b" value="server">');get<HTMLInputElement>('a').value='typed';
  const controls=new AdoptionControls(host);controls.add({element:get('a'),key:'value',initial:'old'});controls.add({element:get('b'),key:'value',initial:'different'});
  expect(()=>controls.finish()).toThrowError(code('FORMA_E_HYDRATE_VALUE'));
 });
 it('does not let an early edit excuse a wrong decoded initial value',()=>{
  const {host,get}=fixture('<input id="i" value="server">');get<HTMLInputElement>('i').value='user';
  const controls=new AdoptionControls(host);controls.add({element:get('i'),key:'value',initial:'wrong',codec:'string'});
  expect(()=>controls.finish()).toThrowError(code('FORMA_E_HYDRATE_VALUE'));expect(get<HTMLInputElement>('i').value).toBe('user');
 });
 it.each([true,false,null])('uses native initial input/option value presence for %s',initial=>{
  const present=initial===true?' value':'';
  const {host,get}=fixture(`<input id="i"${present}><select><option id="o"${present}>label</option></select><textarea id="t">${initial==null?'':String(initial)}</textarea>`);
  const controls=new AdoptionControls(host);controls.add({element:get('i'),key:'value',initial});controls.add({element:get('o'),key:'value',initial});controls.add({element:get('t'),key:'value',initial});
  expect(controls.finish().every(item=>!item.edited)).toBe(true);
 });
 it('rejects an edited readonly or boolean-to-text inversion without invoking anything',()=>{
  for(const codec of [undefined,'boolean'] as const){const {host,get}=fixture('<input id="i" value>');get<HTMLInputElement>('i').value='typed';const controls=new AdoptionControls(host);controls.add({element:get('i'),key:'value',initial:true,codec});expect(()=>controls.finish()).toThrowError(code('FORMA_E_HYDRATE_INPUT_TARGET'));}
 });
 it('takes all group defaults before comparison even when registration order is reversed',()=>{
  const {host,get}=fixture('<form><input id="a" type="radio" name="r" checked><input id="b" type="radio" name="r"></form>');
  const controls=new AdoptionControls(host);controls.add({element:get('b'),key:'checked',initial:false});controls.add({element:get('a'),key:'checked',initial:true});
  expect(controls.finish().map(item=>[item.edited,item.value])).toEqual([[false,false],[false,true]]);
  // Native browser controls separately cover two checked defaults/last winner;
  // happy-dom does not normalize that parser case.
 });
 it('keeps same-named radios in distinct forms separate',()=>{
  const {host,get}=fixture('<form><input id="a" type="radio" name="r" checked></form><form><input id="b" type="radio" name="r" checked></form>');
  const controls=new AdoptionControls(host);controls.add({element:get('a'),key:'checked',initial:true});controls.add({element:get('b'),key:'checked',initial:true});
  expect(controls.finish().map(item=>item.value)).toEqual([true,true]);
 });
 it('observes same-form radio peers outside the host without admitting them as targets',()=>{
  const {host,get,doc}=fixture('<input id="a" type="radio" name="r" form="f" checked>','<form id="f"></form>','<input id="b" type="radio" name="r" form="f">');
  const controls=new AdoptionControls(host);controls.add({element:get('a'),key:'checked',initial:true});expect(()=>controls.add({element:get('b'),key:'checked',initial:false})).toThrowError(code('FORMA_E_HYDRATE_STRUCTURE'));
  controls.finish();const newRadio=doc.createElement('input');newRadio.type='radio';newRadio.name='r';newRadio.setAttribute('form','f');doc.body.append(newRadio);
  expect(()=>controls.check()).toThrowError(code('FORMA_E_HYDRATE_STRUCTURE'));
 });
 it('observes select defaults and returns a fresh ordered string-array edit',()=>{
  const {host,get}=fixture('<select id="s" multiple><option value="a" selected>A</option><option value="b">B</option><option value="c" selected>C</option></select>');
  const select=get<HTMLSelectElement>('s');select.options[0].selected=false;select.options[1].selected=true;
  const initial=['a','c'],controls=new AdoptionControls(host),token=controls.add({element:select,key:'value',initial,codec:'string-array'});initial.push('b');
  const result=controls.finish();expect(result).toEqual([{token,edited:true,value:['b','c']}]);expect(Object.isFrozen(result[0].value)).toBe(true);expect(select.options[0].hasAttribute('selected')).toBe(true);
 });
 it('validates selected bindings against complete option topology',()=>{
  const {host,get}=fixture('<select><option id="a" value="a" selected>A</option><option id="b" value="b">B</option></select>');
  const controls=new AdoptionControls(host);controls.add({element:get('b'),key:'selected',initial:false});controls.add({element:get('a'),key:'selected',initial:true});expect(controls.finish().every(item=>!item.edited)).toBe(true);
  get('b').setAttribute('value','changed');expect(()=>controls.check()).toThrowError(code('FORMA_E_HYDRATE_VALUE'));
 });
 it('rechecks optgroup default metadata instead of reading changed attributes during normalization',()=>{
  const {host,get}=fixture('<select id="s"><optgroup id="g" disabled><option value="a">A</option></optgroup><option value="b" selected>B</option></select>');
  const controls=new AdoptionControls(host);get('g').removeAttribute('disabled');controls.add({element:get('s'),key:'value',initial:'b'});
  expect(()=>controls.finish()).toThrowError(code('FORMA_E_HYDRATE_VALUE'));
 });
 it('converts only finite number/range edits with the explicit numeric codec',()=>{
  const {host,get}=fixture('<input id="n" type="number" value="7">');get<HTMLInputElement>('n').value='8.5';
  const controls=new AdoptionControls(host),token=controls.add({element:get('n'),key:'value',initial:7,codec:'number'});expect(controls.finish()).toEqual([{token,edited:true,value:8.5}]);
  const empty=fixture('<input id="n" type="number" value="7">');empty.get<HTMLInputElement>('n').value='';const refused=new AdoptionControls(empty.host);refused.add({element:empty.get('n'),key:'value',initial:7,codec:'number'});expect(()=>refused.finish()).toThrowError(code('FORMA_E_HYDRATE_INPUT_TARGET'));
 });
 it('captures live values before component code and refuses later changes',()=>{
  const {host,get}=fixture('<input id="i" value="saved">');const controls=new AdoptionControls(host);get<HTMLInputElement>('i').value='changed during prepare';controls.add({element:get('i'),key:'value',initial:'saved',codec:'string'});expect(()=>controls.finish()).toThrowError(code('FORMA_E_HYDRATE_VALUE'));
 });
 it('does not own nested-island controls or invoke arbitrary initial coercion',()=>{
  const {host,get}=fixture('<input id="i"><div data-forma-island="1"><input id="nested"></div>');const controls=new AdoptionControls(host);const callback=vi.fn(()=>''),value={toString:callback};
  expect(()=>controls.add({element:get('nested'),key:'value',initial:''})).toThrowError(code('FORMA_E_HYDRATE_STRUCTURE'));expect(()=>controls.add({element:get('i'),key:'value',initial:value})).toThrowError(code('FORMA_E_HYDRATE_VALUE'));expect(callback).not.toHaveBeenCalled();
  const array=['a'];Object.defineProperty(array,0,{get:callback});expect(()=>controls.add({element:get('i'),key:'value',initial:array})).toThrowError(code('FORMA_E_HYDRATE_VALUE'));expect(callback).not.toHaveBeenCalled();
 });
 it.each([
  ['<option id="host">one</option><option>two</option>',false,true],
  ['<option id="host" selected>one</option><option selected>two</option>',true,false],
 ] as const)('keeps external single-select normalization for %s',(options,initial,expected)=>{
  const doc=document.implementation.createHTMLDocument();doc.body.innerHTML=`<select>${options}</select>`;const host=doc.querySelector('#host')!;const controls=new AdoptionControls(host);controls.add({element:host,key:'selected',initial});expect(controls.finish()).toEqual([expect.objectContaining({edited:false,value:expected})]);
 });
 it('normalizes an option-root binding with its enclosing select peers',()=>{
  const doc=document.implementation.createHTMLDocument();doc.body.innerHTML='<select><option id="host">one</option><option id="peer" selected>two</option></select>';const host=doc.querySelector('#host')!,peer=doc.querySelector('#peer')!;
  const controls=new AdoptionControls(host);controls.add({element:host,key:'selected',initial:false});expect(controls.finish()).toEqual([expect.objectContaining({edited:false,value:false})]);expect(()=>controls.add({element:peer,key:'selected',initial:true})).toThrowError(code('FORMA_E_HYDRATE_STRUCTURE'));peer.removeAttribute('selected');expect(()=>controls.check()).toThrowError(code('FORMA_E_HYDRATE_VALUE'));
 });
 it('refuses only affected implicit disabled-optgroup selection observations',()=>{
  const setup=()=>fixture('<select id="s"><optgroup disabled><option id="d" value="d">D</option></optgroup><option id="a" value="a">A</option><option id="b" value="b">B</option></select>');
  for(const id of ['s','d','a']){const {host,get}=setup();const controls=new AdoptionControls(host);controls.add({element:get(id),key:id==='s'?'value':'selected',initial:id==='s'?'a':false,codec:id==='s'?'string':'boolean'});expect(()=>controls.finish()).toThrowError(code('FORMA_E_HYDRATE_VALUE'));}
  const {host,get}=setup();const controls=new AdoptionControls(host);controls.add({element:get('b'),key:'selected',initial:false});expect(controls.finish()).toEqual([expect.objectContaining({edited:false,value:false})]);
 });
 it('does not refuse an unbound unrelated ambiguous select',()=>{
  const {host,get}=fixture('<input id="i" value="saved"><select><optgroup disabled><option>D</option></optgroup><option>A</option></select>');const controls=new AdoptionControls(host);controls.add({element:get('i'),key:'value',initial:'saved'});expect(controls.finish()).toEqual([expect.objectContaining({edited:false,value:'saved'})]);
 });
 it('normalizes an optgroup-root island against its external select and sibling options',()=>{
  const doc=document.implementation.createHTMLDocument();doc.body.innerHTML='<select><optgroup id="host"><option id="a" selected>A</option></optgroup><option id="outside" selected>B</option></select>';const host=doc.querySelector('#host')!,a=doc.querySelector('#a')!;
  const controls=new AdoptionControls(host);controls.add({element:a,key:'selected',initial:true});expect(controls.finish()).toEqual([expect.objectContaining({edited:false,value:false})]);doc.querySelector('#outside')!.setAttribute('value','changed');expect(()=>controls.check()).toThrowError(code('FORMA_E_HYDRATE_VALUE'));
 });
 it('rechecks live observations when finish is requested again',()=>{
  const {host,get}=fixture('<input id="i" value="saved">');const controls=new AdoptionControls(host);controls.add({element:get('i'),key:'value',initial:'saved'});controls.finish();get<HTMLInputElement>('i').value='later';expect(()=>controls.finish()).toThrowError(code('FORMA_E_HYDRATE_VALUE'));
 });
 it('rejects stale ownership, duplicate bindings and use after idempotent release',()=>{
  const {host,get}=fixture('<input id="i">');const controls=new AdoptionControls(host);controls.add({element:get('i'),key:'value',initial:''});expect(()=>controls.add({element:get('i'),key:'value',initial:''})).toThrowError(code('FORMA_E_HYDRATE_STRUCTURE'));controls.finish();controls.release();controls.release();expect(()=>controls.check()).toThrowError(code('FORMA_E_HYDRATE_STRUCTURE'));expect(()=>controls.finish()).toThrowError(code('FORMA_E_HYDRATE_STRUCTURE'));
 });
});
