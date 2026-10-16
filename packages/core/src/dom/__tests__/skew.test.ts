import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateIslands, deactivateAllIslands, hasScheduledOrActiveIslands } from '../activate.js';
import { mount } from '../mount.js';
import { h } from '../element.js';
import { __islandRegistration } from '../island-state.js';

const docs: Document[] = [];
const H = '0123456789abcdef';
function storage() {
  const values = new Map<string, string>();
  return { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
}
function page(identity: string | null = 'page-build', saved = storage(), triggers = ['load']) {
  const doc = document.implementation.createHTMLDocument('skew'); docs.push(doc);
  const reload = vi.fn();
  // Navigation and storage are the only substituted browser services.
  Object.defineProperty(doc, 'defaultView', { configurable: true, value: { sessionStorage: saved, location: { reload }, CustomEvent } });
  const app = doc.createElement('div'); app.id = 'app';
  if (identity !== null) app.setAttribute('data-forma-build', identity);
  doc.body.append(app);
  const state = doc.createElement('script'); state.type = 'application/json'; state.setAttribute('data-island-state', '');
  state.textContent = JSON.stringify({ v: 1, s: [], i: triggers.map(() => ({ h: H, p: {} })) }); doc.head.append(state);
  app.innerHTML = triggers.map((trigger, i) => `<div data-forma-island="${i}" data-forma-component="C" data-forma-state="${i}" data-forma-h="${H}" data-forma-hydrate="${trigger}"><span>served</span></div>`).join('');
  const component = vi.fn(() => h('div', null, h('span', null, 'served')));
  const registry = { C: __islandRegistration(component, { h: H, schema: [[]], mode: 0 }) };
  const events: CustomEvent[] = []; doc.addEventListener('forma:skew', event => events.push(event as CustomEvent));
  return { doc, app, component, registry, reload, saved, events };
}
beforeEach(() => vi.stubGlobal('__FORMA_BUILD__', 'bundle-build'));
afterEach(() => { for (const doc of docs.splice(0)) deactivateAllIslands(doc); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('deployment identity before public activation', () => {
  it('refuses every trigger before components, owners, observers, timers or interaction listeners', () => {
    const p = page('page-build', storage(), ['load', 'visible', 'idle', 'interaction']);
    const visible = vi.fn(), idle = vi.fn(); vi.stubGlobal('IntersectionObserver', visible); vi.stubGlobal('requestIdleCallback', idle);
    const hosts = [...p.app.children]; const children = hosts.map(host => host.firstChild);
    const adds = hosts.map(host => vi.spyOn(host, 'addEventListener'));
    const observer = new MutationObserver(() => {}); observer.observe(p.app, { subtree: true, childList: true, characterData: true });
    activateIslands(p.registry, p.doc);
    expect(p.component).not.toHaveBeenCalled(); expect(visible).not.toHaveBeenCalled(); expect(idle).not.toHaveBeenCalled();
    expect(adds.every(spy => spy.mock.calls.length === 0)).toBe(true); expect(hasScheduledOrActiveIslands()).toBe(false);
    expect(hosts.map(host => host.firstChild)).toEqual(children); expect(observer.takeRecords()).toEqual([]); observer.disconnect();
    expect(hosts.map(host => host.getAttribute('data-forma-status'))).toEqual(['skew', 'skew', 'skew', 'skew']);
    expect(p.events).toHaveLength(1); expect(p.events[0]!.detail).toEqual({ page: 'page-build', bundle: 'bundle-build', reload: true });
    expect(p.events[0]!.cancelable).toBe(true); expect(p.events[0]!.target).toBe(p.doc); expect(p.reload).toHaveBeenCalledTimes(1);
  });
  it.each(['equal', 'absent-page', 'absent-bundle', 'empty-page', 'empty-bundle'])('%s preserves valid activation and Browser mount', async mode => {
    const p = page(mode === 'absent-page' ? null : mode === 'empty-page' ? '' : mode === 'equal' ? 'bundle-build' : 'page-build');
    if (mode === 'absent-bundle') vi.stubGlobal('__FORMA_BUILD__', undefined);
    if (mode === 'empty-bundle') vi.stubGlobal('__FORMA_BUILD__', '');
    await activateIslands(p.registry, p.doc); expect(p.component).toHaveBeenCalledTimes(1);
    const target = p.doc.createElement('aside'); p.app.append(target);
    const render = vi.fn(() => h('button', null, 'mounted')); const dispose = mount(render, target);
    expect(render).toHaveBeenCalledOnce(); expect(target.textContent).toBe('mounted'); dispose(); expect(target.childNodes).toHaveLength(0);
    expect(p.events).toHaveLength(0); expect(p.reload).not.toHaveBeenCalled(); expect(p.saved.getItem).not.toHaveBeenCalled();
  });
  it.each(['early-attribute', 'nested-attribute', 'head-app', 'nested-app'])('a %s decoy cannot mask the actual server root', kind => {
    const p = page(); const decoy = p.doc.createElement('div'); decoy.setAttribute('data-forma-build', 'bundle-build');
    if (kind.endsWith('app')) decoy.id = 'app';
    if (kind === 'head-app') p.doc.head.append(decoy);
    else if (kind === 'nested-app') { const wrapper = p.doc.createElement('aside'); wrapper.append(decoy); p.doc.body.prepend(wrapper); }
    else if (kind === 'nested-attribute') p.app.prepend(decoy);
    else p.doc.body.prepend(decoy);
    activateIslands(p.registry, p.app);
    expect(p.component).not.toHaveBeenCalled(); expect(p.events[0]!.detail.page).toBe('page-build');
  });
  it('descendant identities do not supply an absent page identity', async () => {
    const p = page(null); p.app.firstElementChild!.setAttribute('data-forma-build', 'page-build');
    await activateIslands(p.registry, p.doc); expect(p.component).toHaveBeenCalledOnce(); expect(p.events).toHaveLength(0);
  });
  it('mount refuses before its component and returns an inert idempotent disposer', () => {
    const p = page(); const target = p.doc.createElement('aside'); target.textContent = 'preserved'; p.app.append(target);
    const component = vi.fn(() => h('button', null, 'wrong')); const child = target.firstChild;
    const dispose = mount(component, target); dispose(); dispose();
    expect(component).not.toHaveBeenCalled(); expect(target.firstChild).toBe(child); expect(target.textContent).toBe('preserved');
    activateIslands(p.registry, p.doc); expect(p.component).not.toHaveBeenCalled(); expect(p.events).toHaveLength(1);
  });
  it('retains refusal before reentrant listeners and later root changes', () => {
    const p = page(); p.doc.addEventListener('forma:skew', () => { p.app.setAttribute('data-forma-build', 'bundle-build'); activateIslands(p.registry, p.app); mount(p.component, p.app); });
    activateIslands(p.registry, p.doc); activateIslands(p.registry, p.doc);
    expect(p.component).not.toHaveBeenCalled(); expect(p.events).toHaveLength(1); expect(p.reload).toHaveBeenCalledOnce();
  });
  it('cancellation keeps the page inert without consuming reload eligibility', () => {
    const p = page(); p.doc.addEventListener('forma:skew', event => event.preventDefault());
    activateIslands(p.registry, p.doc); expect(p.component).not.toHaveBeenCalled(); expect(p.reload).not.toHaveBeenCalled(); expect(p.saved.setItem).not.toHaveBeenCalled();
    const next = page('page-build', p.saved); activateIslands(next.registry, next.doc); expect(next.reload).toHaveBeenCalledOnce();
  });
  it.each(['access', 'read', 'write', 'silent-write'])('%s storage refusal leaves skew inert without navigation', failure => {
    const p = page();
    if (failure === 'access') Object.defineProperty(p.doc.defaultView, 'sessionStorage', { get() { throw new Error('blocked'); } });
    if (failure === 'read') p.saved.getItem.mockImplementation(() => { throw new Error('blocked'); });
    if (failure === 'write') p.saved.setItem.mockImplementation(() => { throw new Error('blocked'); });
    if (failure === 'silent-write') p.saved.setItem.mockImplementation(() => {});
    expect(() => activateIslands(p.registry, p.doc)).not.toThrow(); expect(p.events).toHaveLength(1); expect(p.reload).not.toHaveBeenCalled(); expect(p.component).not.toHaveBeenCalled();
    if (failure === 'read' || failure === 'access') expect(p.events[0]!.detail.reload).toBe(false);
  });
  it('reloads once per full identity across Documents, including a shared 64-character prefix', () => {
    const saved = storage(), prefix = 'x'.repeat(64);
    for (const suffix of ['one', 'one', 'two', 'two']) {
      const p = page(prefix + suffix, saved); activateIslands(p.registry, p.doc);
      const first = docs.filter(doc => doc.body.querySelector('#app')?.getAttribute('data-forma-build') === prefix + suffix).length === 1;
      expect(p.reload).toHaveBeenCalledTimes(first ? 1 : 0); expect(p.events[0]!.detail.reload).toBe(first);
    }
    expect(saved.setItem).toHaveBeenCalledTimes(2);
  });
});
