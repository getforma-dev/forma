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
