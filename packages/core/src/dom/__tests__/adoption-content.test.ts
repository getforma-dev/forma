import {describe,expect,it,vi} from 'vitest';
import {prepareRaw,prepareStyle} from '../adoption-content.js';
import {prepareAttribute} from '../adoption-attributes.js';
import {trustedHtml} from '../trusted-html.js';
const VALUE=expect.objectContaining({code:'FORMA_E_HYDRATE_VALUE'});
function host(html:string){const element=document.createElement('div');element.innerHTML=html;document.body.append(element);return element;}
function observe(element:Element){const records:MutationRecord[]=[];const observer=new MutationObserver(batch=>records.push(...batch));observer.observe(element,{subtree:true,attributes:true,childList:true,characterData:true});return()=>{records.push(...observer.takeRecords());observer.disconnect();return records;};}

describe('prepared content validates without initial writes',()=>{
 it('normalizes string declarations without replacing nodes or assigning a live style block',()=>{
  const element=host('<b>kept</b>');element.setAttribute('style','font-size:14px; color: red');const child=element.firstChild,finish=observe(element);
  const block=vi.spyOn(element.style,'cssText','set'),attribute=vi.spyOn(element,'setAttribute');
  const plan=prepareStyle(element,'color:red;font-size:14px');plan.write('font-size: 14px; color: red');
  expect(finish()).toEqual([]);expect(element.firstChild).toBe(child);expect(block).not.toHaveBeenCalled();expect(attribute).not.toHaveBeenCalled();block.mockRestore();attribute.mockRestore();element.remove();
 });
 it('reconciles later declarations through the shared CSSOM writer and preserves ordinary null behavior',()=>{
  const element=host('');element.style.color='red';element.style.fontWeight='bold';const plan=prepareStyle(element,'color:red;font-weight:bold');
  plan.write('font-weight:normal');expect(element.style.color).toBe('');expect(element.style.fontWeight).toBe('normal');plan.write(null);expect(element.style.fontWeight).toBe('normal');plan.write('');expect(element.style.length).toBe(0);element.remove();
 });
 it('supports own string and finite-number object fields for the direct hydration facade',()=>{
  const element=host('');element.style.color='red';element.style.opacity='0.5';const finish=observe(element),plan=prepareStyle(element,{color:'red',opacity:0.5});expect(finish()).toEqual([]);
  plan.write({opacity:1});expect(element.style.color).toBe('');expect(element.style.opacity).toBe('1');element.remove();
 });
 it('refuses a missing or different served style rather than filling or repairing it',()=>{
  const element=host('');const finish=observe(element);expect(()=>prepareStyle(element,{color:'red'})).toThrowError(VALUE);expect(()=>prepareStyle(element,'color:red')).toThrowError(VALUE);expect(finish()).toEqual([]);element.remove();
 });
 it('refuses style getters, coercions, nonfinite values and cssText before oracle/live writes',()=>{
  const element=host(''),get=vi.fn(()=> 'red'),coerce=vi.fn(()=> 'red');
  for(const value of [Object.defineProperty({},'color',{enumerable:true,get}),{color:{toString:coerce}},{opacity:Infinity},{cssText:'color:red'},{removeProperty:'red'},{length:1},{constructor:'red'},'css-text:color:red',()=>get()])expect(()=>prepareStyle(element,value)).toThrowError(VALUE);
  expect(get).not.toHaveBeenCalled();expect(coerce).not.toHaveBeenCalled();expect(element.getAttribute('style')).toBeNull();element.remove();
 });
 it('does not accept invalid style on an unchanged normalized-cache path',()=>{
  const element=host('');const plan=prepareStyle(element,'');expect(()=>plan.write({cssText:''})).toThrowError(VALUE);expect(()=>plan.write({opacity:NaN})).toThrowError(VALUE);element.remove();
 });
 it.each(['<br/>',"<b title='x'>a&#39;b</b>",'<table><tr><td>x</td></tr></table>','<!--f:l1-->raw markers are opaque'])('owns normalized trusted markup without writes: %s',markup=>{
  const element=host(markup),first=element.firstChild,finish=observe(element);const plan=prepareRaw(element,{__html:trustedHtml(markup)});expect(plan.ownsContent).toBe(true);plan.write({__html:trustedHtml(markup)});expect(element.firstChild).toBe(first);expect(finish()).toEqual([]);element.remove();
 });
 it('refuses empty-server/nonempty-raw and different trusted content without repairs',()=>{
  for(const initial of ['', '<b>server</b>']){const element=host(initial),finish=observe(element);expect(()=>prepareRaw(element,{__html:trustedHtml('<i>client</i>')})).toThrowError(VALUE);expect(element.innerHTML).toBe(initial);expect(finish()).toEqual([]);element.remove();}
 });
 it('refuses inherited/accessor/raw lookalike wrappers before parsing or teardown',()=>{
  const element=host('<b>kept</b>'),get=vi.fn(()=>trustedHtml('<b>kept</b>')),coerce=vi.fn(()=>'<b>kept</b>'),finish=observe(element),plan=prepareRaw(element,{__html:trustedHtml('<b>kept</b>')}),teardown=vi.fn();
  for(const value of ['<b>kept</b>',{__html:'<b>kept</b>'},{__html:{toString:coerce}},Object.create({__html:trustedHtml('<b>kept</b>')}),Object.defineProperty({},'__html',{get})]){expect(()=>prepareRaw(element,value)).toThrow('FORMA_E_RAW_INNER_HTML');expect(()=>plan.write(value,teardown)).toThrow('FORMA_E_RAW_INNER_HTML');}
  expect(get).not.toHaveBeenCalled();expect(coerce).not.toHaveBeenCalled();expect(teardown).not.toHaveBeenCalled();expect(finish()).toEqual([]);element.remove();
 });
 it.each([null,false,undefined])('leaves initial fallback for %s but later clear owns real replacement',initial=>{
  const element=host('<b>fallback</b>'),first=element.firstChild,finish=observe(element),plan=prepareRaw(element,initial);expect(plan.ownsContent).toBe(false);expect(element.firstChild).toBe(first);expect(finish()).toEqual([]);
  const teardown=vi.fn(()=>expect(element.firstChild).toBe(first));plan.write(null,teardown);expect(teardown).toHaveBeenCalledOnce();expect(element.childNodes.length).toBe(0);element.remove();
 });
 it('updates typed raw through null and back, disposing only before an actual replacement',()=>{
  const value={__html:trustedHtml('<b>A</b>')},element=host('<b>A</b>'),plan=prepareRaw(element,value),calls:string[]=[];
  const teardown=()=>calls.push(element.innerHTML);plan.write(value,teardown);expect(calls).toEqual([]);plan.write(false,teardown);expect(element.innerHTML).toBe('');plan.write(value,teardown);expect(element.innerHTML).toBe('<b>A</b>');expect(calls).toEqual(['<b>A</b>','']);element.remove();
 });
 it('does not cache a raw replacement whose owned teardown refused',()=>{
  const element=host('<b>A</b>'),plan=prepareRaw(element,{__html:trustedHtml('<b>A</b>')}),next={__html:trustedHtml('<i>B</i>')};expect(()=>plan.write(next,()=>{throw Error('disposed');})).toThrow('disposed');expect(element.innerHTML).toBe('<b>A</b>');plan.write(next);expect(element.innerHTML).toBe('<i>B</i>');element.remove();
 });
 it('keeps typed srcdoc through the guarded attribute path and checks brand before cache',()=>{
  const frame=document.createElement('iframe'),value=trustedHtml('<p>same</p>');frame.setAttribute('srcdoc',String(value));const finish=observe(frame),plan=prepareAttribute(frame,'srcdoc',value);expect(plan.initial).toBe('<p>same</p>');plan.write(value);expect(finish()).toEqual([]);
  for(const bad of ['<p>same</p>',{toString:()=>'<p>same</p>'},true]){expect(()=>prepareAttribute(frame,'srcdoc',bad)).toThrow('FORMA_E_RAW_SRCDOC');expect(()=>plan.write(bad)).toThrow('FORMA_E_RAW_SRCDOC');}
  plan.write(trustedHtml('<b>next</b>'));expect(frame.getAttribute('srcdoc')).toBe('<b>next</b>');plan.write(false);expect(frame.hasAttribute('srcdoc')).toBe(false);plan.write(value);expect(frame.getAttribute('srcdoc')).toBe('<p>same</p>');
 });
});
