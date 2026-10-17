// Feasibility only: these tests describe an intentionally changed load contract.
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {activateIslands,deactivateIsland,hasScheduledOrActiveIslands} from '../activate.js';
import {h} from '../element.js';
import {emptyRegistry,installState,useFreshDocument} from './helpers/compiled-island.js';
let now:number;
beforeEach(()=>{now=0;vi.useFakeTimers();vi.spyOn(performance,'now').mockImplementation(()=>now);});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function setup(names:string[],triggers:Record<string,string>={}) {
 document.body.innerHTML=names.map((name,i)=>`<div data-forma-island="${i}" data-forma-component="${name}"${triggers[name]?` data-forma-hydrate="${triggers[name]}"`:''}><span>${name}</span></div>`).join('');
 installState();return [...document.querySelectorAll<HTMLElement>('[data-forma-island]')];
}
const tree=(name:string)=>h('div',null,h('span',null,name));
describe('load queue prototype',()=>{
 it('finishes whole islands, returns with queued work, then advances in real timer tasks',()=>{
  setup(['A','B','C']);const seen:string[]=[];
  const registry=emptyRegistry(Object.fromEntries(['A','B','C'].map(name=>[name,()=>{seen.push(name);now+=13;return tree(name);}])));
  activateIslands(registry);expect(seen).toEqual([]);expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersToNextTimer();expect(seen).toEqual(['A']);expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersToNextTimer();expect(seen).toEqual(['A','B']);expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersToNextTimer();expect(seen).toEqual(['A','B','C']);expect(vi.getTimerCount()).toBe(0);
 });
 it('marks later loads before component reentry and arms deferred interaction before the first load',()=>{
  const hosts=setup(['A','B','Interaction'],{Interaction:'interaction'});const seen:string[]=[];
  let registry:ReturnType<typeof emptyRegistry>;
  registry=emptyRegistry({A:()=>{expect(typeof (hosts[2] as any).__formaInteractionHandler).toBe('function');activateIslands(registry);seen.push('A');now+=13;return tree('A');},B:()=>{seen.push('B');return tree('B');},Interaction:()=>{seen.push('Interaction');return tree('Interaction');}});
  activateIslands(registry);expect(seen).toEqual([]);
  vi.advanceTimersToNextTimer();expect(seen).toEqual(['A']);
  hosts[2]!.dispatchEvent(new Event('pointerdown'));expect(seen).toEqual(['A','Interaction']);
  vi.runAllTimers();expect(seen).toEqual(['A','Interaction','B']);
 });
 it('cancels pending host ownership and the final shared timer without resurrecting it',()=>{
  const hosts=setup(['A','B']);const second=vi.fn(()=>tree('B'));
  activateIslands(emptyRegistry({A:()=>{now+=13;return tree('A');},B:second}));
  expect(vi.getTimerCount()).toBe(1);deactivateIsland(hosts[1]!);deactivateIsland(hosts[0]!);
  expect(vi.getTimerCount()).toBe(0);expect(hasScheduledOrActiveIslands()).toBe(false);
  vi.runAllTimers();expect(second).not.toHaveBeenCalled();
 });
 it.each(['marker','detached'])('rechecks the original claim before queued %s work',kind=>{
  const hosts=setup(['A','B']);const second=vi.fn(()=>tree('B'));const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
  activateIslands(emptyRegistry({A:()=>{now+=13;return tree('A');},B:second}));
  if(kind==='marker')hosts[1]!.setAttribute('data-forma-component','A');else hosts[1]!.remove();
  vi.runAllTimers();expect(second).not.toHaveBeenCalled();expect(errors).toHaveBeenCalled();
  deactivateIsland(hosts[1]!);
 });
 it('isolates a failed island and continues the queued sibling without splitting its adoption',()=>{
  setup(['A','B']);const errors=vi.spyOn(console,'error').mockImplementation(()=>{}),second=vi.fn(()=>tree('B'));
  activateIslands(emptyRegistry({A:()=>{now+=13;throw Error('expected prototype failure');},B:second}));
  expect(second).not.toHaveBeenCalled();expect(errors).not.toHaveBeenCalled();
  vi.advanceTimersToNextTimer();expect(second).not.toHaveBeenCalled();expect(errors).toHaveBeenCalled();
  vi.runAllTimers();expect(second).toHaveBeenCalledTimes(1);expect(document.querySelector('[data-forma-component="B"] span')!.textContent).toBe('B');
 });
});
useFreshDocument();
