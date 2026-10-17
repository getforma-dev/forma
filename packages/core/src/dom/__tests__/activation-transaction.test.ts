import {describe,it,expect,vi,afterEach} from 'vitest';
import {activateIslands,deactivateAllIslands,deactivateIsland} from '../activate.js';
import {h} from '../element.js';
import {compiled,installState,useFreshDocument} from './helpers/compiled-island.js';
import {createEffect} from '../../reactive/effect.js';
import {createSignal} from '../../reactive/signal.js';
import {__adoptionSignal,__adoptionWritable} from '../../reactive/adoption-hooks.js';
afterEach(()=>vi.restoreAllMocks());
function hosts(contents:string[]){document.body.innerHTML=contents.map((content,i)=>`<section data-forma-island="${i}" data-forma-component="C${i}" data-forma-status="pending" data-forma-ssr>${content}</section>`).join('');installState(contents.map(()=>({})));return [...document.querySelectorAll<HTMLElement>('section')];}
describe('compiled activation transaction',()=>{
 it('records successful SSR activation internally with zero writes and no duplicate component call',async()=>{
  const [host]=hosts(['<button><!--f:t0-->1<!--/f:t0--></button>']),original=host!.firstChild,[n,setN]=createSignal(1),component=vi.fn(()=>h('section',null,h('button',{onClick:()=>setN(n()+1)},n))),registry={C0:compiled(component)},records:MutationRecord[]=[];
  const observer=new MutationObserver(batch=>records.push(...batch));observer.observe(host!,{subtree:true,attributes:true,childList:true,characterData:true});await Promise.all([activateIslands(registry),activateIslands(registry)]);
  expect(component).toHaveBeenCalledOnce();expect(host!.getAttribute('data-forma-status')).toBe('pending');expect(host!.hasAttribute('data-forma-ssr')).toBe(true);expect(host!.firstChild).toBe(original);expect(records.concat(observer.takeRecords())).toEqual([]);
  host!.querySelector('button')!.click();expect(host!.textContent).toBe('2');deactivateIsland(host!);setN(3);expect(host!.textContent).toBe('2');observer.disconnect();
 });
 it('emits one bubbling coded mismatch with only one status write and keeps its neighbor live',async()=>{
  const [bad,good]=hosts(['<b>wrong</b>','<button>go</button>']),effect=vi.fn(),click=vi.fn(),events:CustomEvent[]=[],records:MutationRecord[]=[],log=vi.spyOn(console,'error').mockImplementation(()=>{});
  document.addEventListener('forma:error',event=>events.push(event as CustomEvent));const observer=new MutationObserver(batch=>records.push(...batch));observer.observe(bad!,{subtree:true,attributes:true,childList:true,characterData:true});
  await activateIslands({C0:compiled(()=>{createEffect(effect);return h('section',null,h('b',null,'expected'));}),C1:compiled(()=>h('section',null,h('button',{onClick:click},'go')))});
  expect(effect).not.toHaveBeenCalled();expect(bad!.innerHTML).toBe('<b>wrong</b>');expect(events).toHaveLength(1);expect(Object.isFrozen(events[0]!.detail)).toBe(true);expect(events[0]!.detail).toMatchObject({island:'C0',occurrence:0,code:'FORMA_E_HYDRATE_VALUE'});
  expect(records.concat(observer.takeRecords()).map(record=>[record.type,record.attributeName])).toEqual([['attributes','data-forma-status']]);good!.querySelector('button')!.click();expect(click).toHaveBeenCalledOnce();observer.disconnect();log.mockRestore();
 });
 it('retains deterministic binding indices through initial failures, refs and later listeners without retaining error-object authority',async()=>{
  const [a,b,c]=hosts(['<b>ok</b>','<b>ok</b>','<button>go</button>']),events:CustomEvent[]=[],sameError=new Error('same');document.addEventListener('forma:error',event=>events.push(event as CustomEvent));vi.spyOn(console,'error').mockImplementation(()=>{});
  await activateIslands({C0:compiled(()=>h('section',{title:()=>{throw sameError;}},h('b',null,'ok'))),C1:compiled(()=>h('section',null,h('b',{ref:()=>{throw sameError;}},'ok'))),C2:compiled(()=>h('section',null,h('button',{onClick:()=>{throw 'primitive';}},'go')))});
  c!.querySelector('button')!.click();expect(events).toHaveLength(3);
  expect(events.map(event=>event.detail.binding)).toEqual([1,2,2]);expect(events[0]!.detail.path).toBe('/node[0]/@title[1]');expect(events[1]!.detail.path).toBe('/node[0]/node[1]/@ref[2]');expect(events[2]!.detail.path).toBe('/node[0]/node[1]/@onClick[2]');expect(events[1]!.detail.code).toBe('FORMA_E_HYDRATE_REF');expect(events[2]!.detail.code).toBe('FORMA_E_HYDRATE_EFFECT');
  expect(a!.getAttribute('data-forma-status')).toBe('error');expect(b!.getAttribute('data-forma-status')).toBe('error');
 });
 it('retains the exact control binding context for default and edited-target refusals',async()=>{
  const [wrong,edited]=hosts(['<input value="wrong">','<input value="server">']),events:CustomEvent[]=[];edited!.querySelector('input')!.value='typed';
  document.addEventListener('forma:error',event=>events.push(event as CustomEvent));vi.spyOn(console,'error').mockImplementation(()=>{});
  await activateIslands({C0:compiled(()=>h('section',null,h('input',{value:()=> 'server'}))),C1:compiled(()=>h('section',null,h('input',{value:()=> 'server'})))});
  expect(events.map(event=>event.detail)).toEqual([
   {island:'C0',occurrence:0,binding:2,path:'/node[0]/node[1]/@value[2]',code:'FORMA_E_HYDRATE_VALUE'},
   {island:'C1',occurrence:1,binding:2,path:'/node[0]/node[1]/@value[2]',code:'FORMA_E_HYDRATE_INPUT_TARGET'},
  ]);expect(wrong!.querySelector('input')!.value).toBe('wrong');expect(edited!.querySelector('input')!.value).toBe('typed');
 });
 it('never selects a client fallback for an empty SSR host',async()=>{
  const [host]=hosts(['']),original=host!,component=vi.fn(()=>h('section',null,h('button',null,'new')));vi.spyOn(console,'error').mockImplementation(()=>{});await activateIslands({C0:compiled(component)});
  expect(document.body.firstElementChild).toBe(original);expect(host!.childNodes).toHaveLength(0);expect(host!.getAttribute('data-forma-status')).toBe('error');expect(component).toHaveBeenCalledOnce();
 });
 it('preserves write-free identity refusal before execution',()=>{
  const [host]=hosts(['<b>kept</b>']),component=vi.fn(()=>h('section',null,h('b',null,'kept'))),before=host!.outerHTML,events=vi.fn();document.addEventListener('forma:error',events);host!.setAttribute('data-forma-h','fedcba9876543210');const observer=new MutationObserver(()=>{});observer.observe(host!,{subtree:true,attributes:true,childList:true,characterData:true});vi.spyOn(console,'error').mockImplementation(()=>{});
  activateIslands({C0:compiled(component)});expect(component).not.toHaveBeenCalled();expect(events).not.toHaveBeenCalled();expect(observer.takeRecords()).toEqual([]);expect(host!.getAttribute('data-forma-status')).toBe('pending');expect(host!.outerHTML.replace('fedcba9876543210','0123456789abcdef')).toBe(before);observer.disconnect();
 });
 it('uses actual compiled local authority to seed an early edit and later control the live value',async()=>{
  const [host]=hosts(['<input value="server">']);const input=host!.querySelector('input')!;input.value='typed';let read!:()=>string,set!:(value:string)=>void;
  const component=()=>{const pair=__adoptionSignal(0,createSignal('server'));[read,set]=pair;return h('section',null,h('input',{value:__adoptionWritable(read,read,'string',0)}));};
  const setter=vi.spyOn(input,'value','set');await activateIslands({C0:compiled(component)});expect(read()).toBe('typed');expect(input.value).toBe('typed');expect(setter).not.toHaveBeenCalled();set('later');expect(input.value).toBe('later');expect(setter).toHaveBeenCalledOnce();
 });
 it('revokes precommit callbacks if the component deactivates its own host',async()=>{
  const [host]=hosts(['<button>go</button>']),effect=vi.fn(),click=vi.fn();vi.spyOn(console,'error').mockImplementation(()=>{});
  await activateIslands({C0:compiled(()=>{deactivateIsland(host!);createEffect(effect);return h('section',null,h('button',{onClick:click},'go'));})});host!.querySelector('button')!.click();expect(effect).not.toHaveBeenCalled();expect(click).not.toHaveBeenCalled();expect(host!.getAttribute('data-forma-status')).toBe('error');
 });
 it('isolates a postcommit callback failure and emits one production-shaped diagnostic',async()=>{
  const [bad,good]=hosts(['<button>bad</button>','<button>good</button>']),events:CustomEvent[]=[],click=vi.fn();document.addEventListener('forma:error',event=>events.push(event as CustomEvent));vi.spyOn(console,'error').mockImplementation(()=>{});
  await activateIslands({C0:compiled(()=>h('section',null,h('button',{onClick:()=>{throw new Error('event');}},'bad'))),C1:compiled(()=>h('section',null,h('button',{onClick:click},'good')))});
  bad!.querySelector('button')!.click();bad!.querySelector('button')!.click();good!.querySelector('button')!.click();expect(events).toHaveLength(1);expect(events[0]!.detail.code).toBe('FORMA_E_HYDRATE_EFFECT');expect(bad!.getAttribute('data-forma-status')).toBe('error');expect(click).toHaveBeenCalledOnce();deactivateAllIslands();
 });
});
useFreshDocument();
