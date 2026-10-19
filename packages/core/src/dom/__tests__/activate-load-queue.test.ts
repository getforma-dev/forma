import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateIslands, deactivateAllIslands, deactivateIsland, hasScheduledOrActiveIslands } from '../activate.js';
import { h } from '../element.js';
import { emptyRegistry, installState, useFreshDocument } from './helpers/compiled-island.js';

let now: number;
beforeEach(() => {
  now = 0;
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const tree = (name: string) => h('div', null, h('span', null, name));
function host(name: string, trigger = 'load') {
  return `<div data-forma-island="${name}" data-forma-component="${name}" data-forma-hydrate="${trigger}"><span>${name}</span></div>`;
}

describe('shared load scheduling', () => {
  it('bounds a clock-flat batch while preserving pending input, cancellation and readiness', async () => {
    const names = [...'ABCDEFGHIJ'], seen: string[] = [];
    document.body.innerHTML = names.map(name => host(name)).join(''); installState();
    const registry = emptyRegistry(Object.fromEntries(names.map(name => [name, () => {seen.push(name); return tree(name);}])));
    let done = false;
    const ready = activateIslands(registry).then(() => {done = true;});
    vi.advanceTimersToNextTimer();
    expect(seen).toEqual(['A', 'B', 'C', 'D']);
    await Promise.resolve(); expect(done).toBe(false);
    deactivateIsland(document.querySelector<HTMLElement>('[data-forma-component="E"]')!);
    document.querySelector<HTMLElement>('[data-forma-component="G"]')!.dispatchEvent(new Event('pointerdown'));
    expect(seen).toEqual(['A', 'B', 'C', 'D', 'G']);
    vi.runAllTimers(); await ready;
    expect(seen).toEqual(['A', 'B', 'C', 'D', 'G', 'F', 'H', 'I', 'J']);
    expect(done).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it('queues even the first load until a timer while readiness remains pending', async () => {
    document.body.innerHTML = host('A'); installState();
    const component = vi.fn(() => tree('A'));
    let done = false;
    const ready = activateIslands(emptyRegistry({ A: component })).then(() => { done = true; });
    expect(component).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await Promise.resolve();
    expect(done).toBe(false);
    vi.runAllTimers(); await ready;
    expect(component).toHaveBeenCalledOnce(); expect(done).toBe(true);
  });

  it('promotes the first load on its input before the initial timer without completing unrelated work', async () => {
    document.body.innerHTML = '<main><button data-forma-island="A" data-forma-component="A">A</button></main><aside>' + host('B') + '</aside>'; installState();
    const button = document.querySelector('button')!, clicks = vi.fn(), second = vi.fn(() => tree('B'));
    const first = vi.fn(() => h('button', { onClick: clicks }, 'A'));
    const registry = emptyRegistry({ A: first, B: second });
    let done = false, overlapDone = false;
    const ready = activateIslands(registry).then(() => { done = true; });
    const overlap = activateIslands(registry, document.querySelector('main')!).then(() => { overlapDone = true; });
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(overlapDone).toBe(false);
    button.click(); await overlap;
    expect(first).toHaveBeenCalledOnce(); expect(clicks).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled(); expect(done).toBe(false); expect(overlapDone).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.runAllTimers(); await ready;
    expect(second).toHaveBeenCalledOnce(); expect(done).toBe(true);
    expect(first).toHaveBeenCalledOnce(); expect(clicks).toHaveBeenCalledOnce();
  });

  it('does not strand a reserved deferred host when a later refusal reaches a throwing diagnostic', async () => {
    document.body.innerHTML = host('Good', 'interaction') + host('Bad'); installState();
    document.head.querySelector('script')!.textContent = JSON.stringify({v: 1, s: [], i: [{h: '0123456789abcdef', p: {}}, null]});
    vi.spyOn(console, 'error').mockImplementation(() => {throw Error('diagnostic callback failed');});
    const good = vi.fn(() => tree('Good'));
    let ready: Promise<void> | undefined;
    expect(() => {ready = activateIslands(emptyRegistry({Good: good, Bad: () => tree('Bad')}));}).not.toThrow();
    await ready;
    document.querySelector<HTMLElement>('[data-forma-component="Good"]')!.dispatchEvent(new Event('pointerdown'));
    expect(good).toHaveBeenCalledOnce();
  });

  it('finishes native trigger enrollment before a diagnostic reentrant request can drain loads', async () => {
    document.body.innerHTML = host('A') + host('Bad') + host('Good', 'interaction') + `<aside>${host('B')}</aside>`;
    installState();
    const block = document.head.querySelector('script')!, state = JSON.parse(block.textContent!);
    state.i[1] = null; block.textContent = JSON.stringify(state);
    const seen: string[] = [];
    const registry = emptyRegistry({
      A: () => {seen.push('A'); document.querySelector<HTMLElement>('[data-forma-component="Good"]')!.dispatchEvent(new Event('pointerdown')); now += 13; return tree('A');},
      Bad: () => tree('Bad'), Good: () => {seen.push('Good'); return tree('Good');}, B: () => {seen.push('B'); return tree('B');},
    });
    vi.spyOn(console, 'error').mockImplementationOnce(() => {void activateIslands(registry, document.querySelector('aside')!);});
    const ready = activateIslands(registry);
    expect(seen).toEqual([]);
    vi.advanceTimersToNextTimer();
    expect(seen).toEqual(['A', 'Good']);
    vi.runAllTimers(); await ready;
    expect(seen).toEqual(['A', 'Good', 'B']);
  });

  it('settles each invocation after its own loads, including cancellation and isolated failure', async () => {
    document.body.innerHTML = `<main>${host('A')}${host('B')}</main><aside>${host('C')}</aside>`; installState();
    const registry = emptyRegistry({ A: () => { now += 13; return tree('A'); }, B: () => tree('B'), C: () => { throw Error('isolated C'); } });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let first = false, second = false;
    const a = activateIslands(registry, document.querySelector('main')!).then(() => { first = true; });
    const b = activateIslands(registry, document.querySelector('aside')!).then(() => { second = true; });
    deactivateIsland(document.querySelector<HTMLElement>('[data-forma-component="B"]')!);
    vi.advanceTimersToNextTimer();
    await a;
    expect(first).toBe(true); expect(second).toBe(false);
    vi.runAllTimers(); await b;
    expect(second).toBe(true); expect(errors).toHaveBeenCalled();
  });

  it('resolves after deferred triggers are armed without waiting for their event', async () => {
    document.body.innerHTML = host('A', 'interaction'); installState();
    const component = vi.fn(() => tree('A'));
    await activateIslands(emptyRegistry({ A: component }));
    expect(component).not.toHaveBeenCalled();
    document.querySelector<HTMLElement>('[data-forma-island]')!.dispatchEvent(new Event('pointerdown'));
    expect(component).toHaveBeenCalledOnce();
  });

  it('links overlapping callers to the same pending work and resolves all on input promotion', async () => {
    document.body.innerHTML = host('A') + `<aside>${host('B')}</aside>`; installState();
    const second = vi.fn(() => tree('B'));
    const registry = emptyRegistry({ A: () => { now += 13; return tree('A'); }, B: second });
    let firstDone = false, overlapDone = false;
    const first = activateIslands(registry).then(() => { firstDone = true; });
    vi.advanceTimersToNextTimer();
    const overlap = activateIslands(registry, document.querySelector('aside')!).then(() => { overlapDone = true; });
    await Promise.resolve();
    expect(firstDone).toBe(false); expect(overlapDone).toBe(false);
    document.querySelector<HTMLElement>('[data-forma-component="B"]')!.click();
    await Promise.all([first, overlap]);
    expect(second).toHaveBeenCalledOnce();
    expect(firstDone).toBe(true); expect(overlapDone).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps preflight exceptions synchronous', () => {
    expect(() => activateIslands({}, { get ownerDocument() { throw Error('preflight trap'); } } as unknown as ParentNode)).toThrow('preflight trap');
  });

  it('enqueues a real disjoint-root reentrant call without giving it a fresh synchronous slice', () => {
    document.body.innerHTML = `<main>${host('A')}${host('C')}</main><aside>${host('B')}</aside>`;
    installState();
    const seen: string[] = [];
    let registry: ReturnType<typeof emptyRegistry>;
    registry = emptyRegistry({
      A: () => { seen.push('A'); now += 13; activateIslands(registry, document.querySelector('aside')!); return tree('A'); },
      B: () => { seen.push('B'); return tree('B'); },
      C: () => { seen.push('C'); return tree('C'); },
    });
    activateIslands(registry, document.querySelector('main')!);
    expect(seen).toEqual([]);
    vi.advanceTimersToNextTimer();
    expect(seen).toEqual(['A']);
    expect(vi.getTimerCount()).toBe(1);
    vi.runAllTimers();
    expect(seen).toEqual(['A', 'C', 'B']);
  });

  it.each(['constructor', 'observe', 'idle', 'listener'])('isolates a throwing %s setup and runs both load siblings', kind => {
    document.body.innerHTML = host('A') + host('Broken', kind === 'idle' ? 'idle' : kind === 'listener' ? 'interaction' : 'visible') + host('B');
    installState();
    const broken = document.querySelector<HTMLElement>('[data-forma-component="Broken"]')!;
    const disconnected = vi.fn();
    const originalAdd = broken.addEventListener.bind(broken);
    const originalRemove = broken.removeEventListener.bind(broken);
    const installed = new Set<EventListenerOrEventListenerObject>();
    if (kind === 'listener') {
      vi.spyOn(broken, 'addEventListener').mockImplementation((type, listener, options) => {
        originalAdd(type, listener, options); installed.add(listener);
        throw Error('listener attached then setup failed');
      });
      vi.spyOn(broken, 'removeEventListener').mockImplementation((type, listener, options) => {
        originalRemove(type, listener, options); installed.delete(listener);
      });
    }
    vi.stubGlobal('IntersectionObserver', class {
      constructor() { if (kind === 'constructor') throw Error('observer constructor failed'); }
      observe() { throw Error('observer observe failed'); }
      disconnect = disconnected;
    });
    vi.stubGlobal('requestIdleCallback', () => { throw Error('idle registration failed'); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {}), seen: string[] = [];
    const failed = vi.fn(() => tree('Broken'));
    const registry = emptyRegistry({ A: () => { seen.push('A'); now += 13; return tree('A'); }, B: () => { seen.push('B'); return tree('B'); }, Broken: failed });
    expect(() => activateIslands(registry)).not.toThrow();
    expect(seen).toEqual([]);
    vi.runAllTimers();
    expect(seen).toEqual(['A', 'B']);
    expect(failed).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
    expect(installed.size).toBe(0);
    if (kind === 'observe') expect(disconnected).toHaveBeenCalledOnce();
    deactivateAllIslands();
    expect(hasScheduledOrActiveIslands()).toBe(false);
  });

  it.each(['click', 'pointerdown', 'focusin'])('promotes queued work on %s once and removes its timer ownership', type => {
    document.body.innerHTML = host('A') + '<button data-forma-island="B" data-forma-component="B">B</button>';
    installState();
    const button = document.querySelector('button')!, clicks = vi.fn();
    const second = vi.fn(() => h('button', { onClick: clicks }, 'B'));
    activateIslands(emptyRegistry({ A: () => { now += 13; return tree('A'); }, B: second }));
    vi.advanceTimersToNextTimer();
    expect(second).not.toHaveBeenCalled();
    button.dispatchEvent(new Event(type, { bubbles: true }));
    expect(second).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    if (type !== 'click') button.click();
    expect(clicks).toHaveBeenCalledOnce();
    vi.runAllTimers();
    button.click();
    expect(second).toHaveBeenCalledOnce();
    expect(clicks).toHaveBeenCalledTimes(2);
  });

  it.each(['disposed', 'tampered'])('does not promote a %s host', kind => {
    document.body.innerHTML = host('A') + host('B'); installState();
    const button = document.querySelector<HTMLElement>('[data-forma-component="B"]')!, second = vi.fn(() => tree('B'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    activateIslands(emptyRegistry({ A: () => { now += 13; return tree('A'); }, B: second }));
    if (kind === 'disposed') deactivateIsland(button); else button.setAttribute('data-forma-h', 'tampered');
    button.dispatchEvent(new Event('click', { bubbles: true }));
    vi.runAllTimers();
    expect(second).not.toHaveBeenCalled();
  });

  it.each(['promotion', 'cancel'])('settles both callers when timer cancellation throws during %s', async kind => {
    document.body.innerHTML = host('A') + host('B'); installState();
    const target = document.querySelector<HTMLElement>('[data-forma-component="B"]')!;
    const second = vi.fn(() => tree('B'));
    const registry = emptyRegistry({A: () => {now += 13; return tree('A');}, B: second});
    let done = false, overlap = false;
    const ready = activateIslands(registry).then(() => {done = true;});
    vi.advanceTimersToNextTimer();
    const other = activateIslands(registry).then(() => {overlap = true;});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const clear = globalThis.clearTimeout;
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(handle => {clear(handle); throw Error('timer cancellation wrapper failed');});
    if (kind === 'promotion') expect(() => target.click()).not.toThrow();
    else expect(() => deactivateIsland(target)).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true); expect(overlap).toBe(true);
    await Promise.all([ready, other]);
    expect(second).toHaveBeenCalledTimes(kind === 'promotion' ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
    deactivateAllIslands(); expect(hasScheduledOrActiveIslands()).toBe(false);
  });

  it('consumes nested input promotion once and cancels the timer after both active loads finish', async () => {
    document.body.innerHTML = host('A') + host('B'); installState();
    const [a, b] = document.querySelectorAll<HTMLElement>('[data-forma-island]');
    const seen: string[] = [];
    let registry: ReturnType<typeof emptyRegistry>, overlap: Promise<void> | undefined;
    registry = emptyRegistry({
      A: () => {seen.push('A'); a!.click(); b!.click(); overlap = activateIslands(registry); return tree('A');},
      B: () => {seen.push('B'); a!.click(); return tree('B');},
    });
    vi.mocked(performance.now).mockReturnValueOnce(0).mockReturnValue(13);
    const ready = activateIslands(registry);
    expect(seen).toEqual([]); expect(vi.getTimerCount()).toBe(1);
    a!.click();
    await Promise.all([ready, overlap]);
    expect(seen).toEqual(['A', 'B']); expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers(); a!.click(); b!.click();
    expect(seen).toEqual(['A', 'B']);
  });

  it.each(['timer', 'promotion', 'cancel', 'partial-setup'])('settles ownership after a throwing removal during %s and attempts every listener cleanup', async kind => {
    document.body.innerHTML = host('A') + host('B'); installState();
    const target = document.querySelector<HTMLElement>('[data-forma-component="B"]')!;
    const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
    const attempts: string[] = [], second = vi.fn(() => tree('B'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(target, 'removeEventListener').mockImplementation((type, callback, options) => {
      attempts.push(type); remove(type, callback, options);
      if (type === 'pointerdown') throw Error('native removal completed then wrapper failed');
    });
    if (kind === 'partial-setup') vi.spyOn(target, 'addEventListener').mockImplementation((type, callback, options) => {
      add(type, callback, options);
      if (type === 'focusin') throw Error('partial setup failed');
    });
    const registry = emptyRegistry({A: () => {now += 13; return tree('A');}, B: second});
    let done = false, overlap = false;
    const ready = activateIslands(registry).then(() => {done = true;});
    const other = activateIslands(registry).then(() => {overlap = true;});
    if (kind === 'timer') expect(() => vi.runAllTimers()).not.toThrow();
    if (kind === 'promotion') expect(() => target.click()).not.toThrow();
    if (kind === 'cancel') expect(() => deactivateIsland(target)).not.toThrow();
    // Flush readiness without assuming a fixed number of promise microtasks.
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true); expect(overlap).toBe(true);
    await Promise.all([ready, other]);
    expect(attempts.sort()).toEqual(['click', 'focusin', 'pointerdown']);
    expect(second).not.toHaveBeenCalled();
    target.click(); vi.runAllTimers();
    expect(second).not.toHaveBeenCalled();
    deactivateAllIslands(); expect(hasScheduledOrActiveIslands()).toBe(false);
  });
});
useFreshDocument();
