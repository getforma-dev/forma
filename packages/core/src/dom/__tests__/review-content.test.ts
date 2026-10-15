import {expect,it} from 'vitest';
import {prepareStyle,prepareRaw} from '../adoption-content.js';
import {trustedHtml} from '../trusted-html.js';

it('clears a previous valid declaration after the browser ignores an invalid update',()=>{
 const element=document.createElement('div');element.style.color='red';
 const style=prepareStyle(element,'color:red');
 style.write('color:not-a-color');
 // Existing CSSOM assignment retains the previous declaration on invalid input.
 expect(element.style.color).toBe('red');
 style.write('');
 expect(element.style.color).toBe('');
 expect(element.style.length).toBe(0);
});

it('does not teardown or cache a typed raw update when its owner vetoes replacement',()=>{
 const element=document.createElement('div');element.innerHTML='<b>A</b>';
 const before=element.firstChild,raw=prepareRaw(element,{__html:trustedHtml('<b>A</b>')});
 const error=new Error('owner invalidated');
 expect(()=>raw.write({__html:trustedHtml('<i>B</i>')},()=>{throw error})).toThrow(error);
 expect(element.firstChild).toBe(before);
 raw.write({__html:trustedHtml('<i>B</i>')});expect(element.innerHTML).toBe('<i>B</i>');
});


it('clears the actual template content once while preserving its fragment identity',()=>{
 const element=document.createElement('template');element.innerHTML='<b>A</b>';
 const content=element.content,original=content.firstChild,plan=prepareRaw(element,{__html:trustedHtml('<b>A</b>')});
 expect(element.content).toBe(content);expect(content.firstChild).toBe(original);
 let teardowns=0;const before=()=>{teardowns++;expect(content.firstChild).toBe(original)};
 plan.write(false,before);plan.write(false,before);
 expect(teardowns).toBe(1);expect(content.childNodes.length).toBe(0);expect(element.innerHTML).toBe('');
 plan.write({__html:trustedHtml('<i>B</i>')});expect(element.innerHTML).toBe('<i>B</i>');expect(element.content).toBe(content);
});


it('refuses typed HTML noscript in live and inert documents without changing fallback or granting a later raw transition',()=>{
 for(const doc of [document,document.implementation.createHTMLDocument()]){
  const element=doc.createElement('noscript');element.textContent='<br/>';
  const original=element.firstChild,typed={__html:trustedHtml('<br/>')};
  expect(()=>prepareRaw(element,{__html:'<br/>'})).toThrow('FORMA_E_RAW_INNER_HTML');
  expect(()=>prepareRaw(element,typed)).toThrowError(expect.objectContaining({code:'FORMA_E_HYDRATE_STRUCTURE'}));
  expect(()=>prepareRaw(element,{__html:trustedHtml('')})).toThrowError(expect.objectContaining({code:'FORMA_E_HYDRATE_STRUCTURE'}));
  for(const fallback of [null,false]){
   const plan=prepareRaw(element,fallback);expect(plan.ownsContent).toBe(false);let calls=0;
   expect(()=>plan.write(typed,()=>calls++)).toThrowError(expect.objectContaining({code:'FORMA_E_HYDRATE_STRUCTURE'}));
   expect(()=>plan.write({__html:'<br/>'},()=>calls++)).toThrow('FORMA_E_RAW_INNER_HTML');
   expect(calls).toBe(0);expect(element.firstChild).toBe(original);
  }
  const plan=prepareRaw(element,null);let calls=0;plan.write(false,()=>calls++);plan.write(null,()=>calls++);
  expect(calls).toBe(1);expect(element.firstChild).toBeNull();
 }
});
