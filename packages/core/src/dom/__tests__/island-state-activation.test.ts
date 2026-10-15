import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateIslands, deactivateAllIslands, hasScheduledOrActiveIslands } from '../activate.js';
import { __islandRegistration, type IslandSchema } from '../island-state.js';
import { createEffect, createSignal } from '../../reactive/index.js';

const H = '0123456789abcdef';
const shape: IslandSchema = [[{ name: 'value', type: { kind: 'number' } }]];
const docs: Document[] = [];
function page(triggers = ['load'], props = triggers.map(() => ({ value: 1001 }))) {
  const doc = document.implementation.createHTMLDocument('activation'); docs.push(doc);
  const block = doc.createElement('script'); block.type = 'application/json'; block.setAttribute('data-island-state', '');
  block.textContent = JSON.stringify({ v: 1, s: [], i: props.map(p => ({ h: H, p })) }); doc.head.appendChild(block);
  doc.body.innerHTML = triggers.map((trigger, i) => `<div data-forma-island="${i}" data-forma-component="C${i}" data-forma-state="${i}" data-forma-h="${H}" data-forma-hydrate="${trigger}" data-forma-status="pending"><span>server-${i}</span></div>`).join('');
  return doc;
}
function registration(component: (props: { value: number }) => unknown, mode: 0 | 1 = 0) {
  return __islandRegistration(component, { h: H, schema: shape, mode });
}
afterEach(() => { for (const doc of docs.splice(0)) deactivateAllIslands(doc); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('state preflight precedes every activation side effect', () => {
  it.each(['missing', 'truncated', 'hash', 'schema', 'registration', 'duplicate'] as const)('keeps %s refusals inert with zero DOM writes and no triggers', failure => {
    const doc = page(['load', 'visible', 'idle', 'interaction']);
    const component = vi.fn();
    const registry = Object.fromEntries([0, 1, 2, 3].map(i => [`C${i}`, registration(component)]));
    if (failure === 'missing') doc.head.querySelector('script')!.remove();
    if (failure === 'truncated') doc.head.querySelector('script')!.textContent = '{';
    if (failure === 'hash') for (const host of doc.querySelectorAll('[data-forma-island]')) host.setAttribute('data-forma-h', 'ffffffffffffffff');
    if (failure === 'schema') doc.head.querySelector('script')!.textContent = JSON.stringify({ v: 1, s: [], i: [0, 1, 2, 3].map(() => ({ h: H, p: { value: 'wrong' } })) });
    if (failure === 'registration') for (const name of Object.keys(registry)) registry[name] = component;
    if (failure === 'duplicate') for (const host of doc.querySelectorAll('[data-forma-island]')) host.setAttribute('data-forma-state', '0');
    const before = doc.documentElement.outerHTML;
    const observer = new MutationObserver(() => {}); observer.observe(doc, { subtree: true, childList: true, characterData: true, attributes: true });
    const visible = vi.fn(), idle = vi.fn(); vi.stubGlobal('IntersectionObserver', visible); vi.stubGlobal('requestIdleCallback', idle);
    const adds = [...doc.querySelectorAll('[data-forma-island]')].map(host => vi.spyOn(host, 'addEventListener'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    activateIslands(registry, doc);
    expect(component).not.toHaveBeenCalled(); expect(visible).not.toHaveBeenCalled(); expect(idle).not.toHaveBeenCalled();
    expect(adds.every(spy => spy.mock.calls.length === 0)).toBe(true);
    expect(doc.documentElement.outerHTML).toBe(before); expect(observer.takeRecords()).toEqual([]);
    expect(error).toHaveBeenCalledTimes(4); expect(error.mock.calls.every(call => String(call[0]).includes('FORMA_E_ISLAND_'))).toBe(true);
    expect(hasScheduledOrActiveIslands()).toBe(false); observer.disconnect();
  });
  it('validates every requested props object before the first component runs', () => {
    const doc = page(['load', 'load']);
    const seen: number[] = [];
    activateIslands({
      C0: registration(props => { seen.push(props.value); doc.head.querySelector('script')!.textContent = JSON.stringify({ v: 1, s: [], i: [{ h: H, p: { value: 7 } }, { h: H, p: { value: 42 } }] }); }),
      C1: registration(props => { seen.push(props.value); }),
    }, doc);
    expect(seen).toEqual([1001, 1001]);
  });
  it('rechecks a later immediate host after an earlier component changes its markers', () => {
    const doc = page(['load', 'load']), second = doc.querySelector('[data-forma-state="1"]')!;
    const skipped = vi.fn(), error = vi.spyOn(console, 'error').mockImplementation(() => {});
    activateIslands({ C0: registration(() => { second.setAttribute('data-forma-h', 'ffffffffffffffff'); }), C1: registration(skipped) }, doc);
    expect(skipped).not.toHaveBeenCalled(); expect(second.getAttribute('data-forma-status')).toBe('pending');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FORMA_E_ISLAND_IDENTITY'));
  });
  it.each(['visible', 'idle', 'interaction'])('rechecks frozen identity immediately before %s activation', trigger => {
    const doc = page([trigger]); const host = doc.querySelector('[data-forma-island]')!;
    let callback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class { constructor(fn: (entries: { isIntersecting: boolean }[]) => void) { callback = () => fn([{ isIntersecting: true }]); } observe() {} disconnect = disconnect; });
    vi.stubGlobal('requestIdleCallback', (fn: () => void) => { callback = fn; return 1; }); vi.stubGlobal('cancelIdleCallback', vi.fn());
    const component = vi.fn(), error = vi.spyOn(console, 'error').mockImplementation(() => {});
    activateIslands({ C0: registration(component) }, doc); expect(component).not.toHaveBeenCalled();
    host.setAttribute('data-forma-state', '1');
    const before = doc.documentElement.outerHTML;
    if (trigger === 'interaction') host.dispatchEvent(new Event('pointerdown')); else callback();
    expect(component).not.toHaveBeenCalled(); expect(doc.documentElement.outerHTML).toBe(before);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FORMA_E_ISLAND_IDENTITY'));
    expect(hasScheduledOrActiveIslands()).toBe(false);
  });
  it('runs a valid sibling while an individually malformed entry stays unchanged', () => {
    const doc = page(['load', 'load']); doc.head.querySelector('script')!.textContent = JSON.stringify({ v: 1, s: [], i: [null, { h: H, p: { value: 7 } }] });
    const bad = vi.fn(), good = vi.fn(); vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = doc.querySelector('[data-forma-state="0"]')!, before = first.outerHTML;
    activateIslands({ C0: registration(bad), C1: registration(good) }, doc);
    expect(bad).not.toHaveBeenCalled(); expect(first.outerHTML).toBe(before); expect(good).toHaveBeenCalledExactlyOnceWith({ value: 7 });
  });
  it('seeds distinct local signals from1001 before first effects and preserves imported captures', () => {
    const doc = page(), observed: number[] = [];
    const [captured, setCaptured] = createSignal(5);
    let updateFirst: (value: number) => void = () => {};
    let second: () => number = () => 0;
    activateIslands({ C0: registration(props => {
      const [a, setA] = createSignal(props.value ?? 42), [b] = createSignal(props.value);
      updateFirst = setA; second = b;
      createEffect(() => { observed.push(a() + captured()); });
    }) }, doc);
    expect(observed).toEqual([1006]); updateFirst(7); expect(second()).toBe(1001);
    setCaptured(8); expect(observed).toEqual([1006, 12, 15]);
  });
  it('never admits a later injected host on repeated calls', () => {
    const doc = page(), component = vi.fn(), error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = { C0: registration(component) }; activateIslands(registry, doc);
    const clone = doc.querySelector('[data-forma-island]')!.cloneNode(true) as HTMLElement;
    clone.setAttribute('data-forma-status', 'pending'); doc.body.appendChild(clone);
    activateIslands(registry, doc);
    expect(component).toHaveBeenCalledTimes(1); expect(clone.getAttribute('data-forma-status')).toBe('pending');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FORMA_E_ISLAND_IDENTITY'));
  });
});
