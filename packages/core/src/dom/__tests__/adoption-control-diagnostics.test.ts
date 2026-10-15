import {describe,expect,it,vi} from 'vitest';
import {AdoptionControls,type ControlToken} from '../adoption-controls.js';

function fixture(html:string){
 const document=globalThis.document.implementation.createHTMLDocument();document.body.innerHTML=`<section>${html}</section>`;
 const host=document.body.firstElementChild!,get=(id:string)=>document.getElementById(id) as HTMLInputElement;
 return{document,host,get};
}
function capture(fn:()=>unknown):unknown{try{fn();}catch(error){return error;}throw Error('expected refusal');}
const code=(error:unknown)=>(error as {code:string}).code;

describe('private control failure context',()=>{
 it('identifies the exact mismatching default without exposing a value or replacing the error',()=>{
  const{host,get}=fixture('<input id="a" value="first"><input id="b" value="server">');
  const controls=new AdoptionControls(host);controls.add({element:get('a'),key:'value',initial:'first'});
  const bad=controls.add({element:get('b'),key:'value',initial:'wrong'}),report=vi.fn();
  const error=capture(()=>controls.finish(report));expect(code(error)).toBe('FORMA_E_HYDRATE_VALUE');
  expect(report.mock.calls).toEqual([[bad,error]]);expect(Object.keys(bad)).toEqual([]);expect(Object.isFrozen(bad)).toBe(true);
  expect(get('b').value).toBe('server');
 });
 it('keeps all defaults ahead of an earlier edited readonly binding',()=>{
  const{host,get}=fixture('<input id="a" value="old"><input id="b" value="server">');get('a').value='typed';
  const controls=new AdoptionControls(host);controls.add({element:get('a'),key:'value',initial:'old'});
  const bad=controls.add({element:get('b'),key:'value',initial:'wrong'}),report=vi.fn();
  const error=capture(()=>controls.finish(report));expect(code(error)).toBe('FORMA_E_HYDRATE_VALUE');expect(report.mock.calls).toEqual([[bad,error]]);
 });
 it('identifies a later conversion failure only after every default passed',()=>{
  const{host,get}=fixture('<input id="a" value="saved"><input id="b" type="number" value="7">');get('b').value='';
  const controls=new AdoptionControls(host);controls.add({element:get('a'),key:'value',initial:'saved'});
  const bad=controls.add({element:get('b'),key:'value',initial:7,codec:'number'}),report=vi.fn();
  const error=capture(()=>controls.finish(report));expect(code(error)).toBe('FORMA_E_HYDRATE_INPUT_TARGET');expect(report.mock.calls).toEqual([[bad,error]]);
 });
 it('identifies only an affected bound implicit-selection ambiguity',()=>{
  const{host,get}=fixture('<select id="s"><optgroup disabled><option value="d">D</option></optgroup><option value="a">A</option></select>');
  const controls=new AdoptionControls(host),bad=controls.add({element:get('s'),key:'value',initial:'a'}),report=vi.fn();
  const error=capture(()=>controls.finish(report));expect(code(error)).toBe('FORMA_E_HYDRATE_VALUE');expect(report.mock.calls).toEqual([[bad,error]]);
 });
 it('keeps whole-group topology and release refusals tokenless',()=>{
  const{document,host,get}=fixture('<input id="i" type="radio" name="r" checked>');
  const controls=new AdoptionControls(host);controls.add({element:get('i'),key:'checked',initial:true});
  const peer=document.createElement('input');peer.type='radio';peer.name='r';document.body.appendChild(peer);const report=vi.fn();
  expect(code(capture(()=>controls.finish(report)))).toBe('FORMA_E_HYDRATE_STRUCTURE');expect(report).not.toHaveBeenCalled();
  controls.release();expect(code(capture(()=>controls.finish(report)))).toBe('FORMA_E_HYDRATE_STRUCTURE');expect(report).not.toHaveBeenCalled();
 });
 it('reports neither successful observations nor cached reads',()=>{
  const{host,get}=fixture('<input id="i" value="server">');get('i').value='edited';
  const controls=new AdoptionControls(host),token=controls.add({element:get('i'),key:'value',initial:'server',kind:'initial'}),report=vi.fn();
  const result=controls.finish(report);expect(result).toEqual([{token,kind:'initial',edited:true,value:'edited'}]);
  expect(controls.finish(report)).toBe(result);expect(report).not.toHaveBeenCalled();
 });
 it('preserves the original refusal if diagnostic recording itself throws',()=>{
  const{host,get}=fixture('<input id="i" value="server">');const controls=new AdoptionControls(host);
  const token=controls.add({element:get('i'),key:'value',initial:'wrong'});let seen:unknown,seenToken:ControlToken|undefined;
  const error=capture(()=>controls.finish((current,cause)=>{seen=cause;seenToken=current;throw Error('reporting');}));
  expect(error).toBe(seen);expect(seenToken).toBe(token);expect(code(error)).toBe('FORMA_E_HYDRATE_VALUE');
 });
});
