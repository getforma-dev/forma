/** Declared head-state props, plus explicit refusal of the removed channels. */
import { describe, it, expect, vi } from 'vitest';
import { h } from '../element.js';
import { activateIslands } from '../activate';
import { compiled, emptyRegistry, FIXTURE_HASH, installState, useFreshDocument } from './helpers/compiled-island.js';

function hosts(count = 1): void {
  document.body.innerHTML = Array.from({ length: count }, (_, i) =>
    `<div data-forma-island="${i}" data-forma-component="Comp${i}" data-forma-status="pending"><p>Content ${i}</p></div>`,
  ).join('');
}

describe('props loading', () => {
  it.each(['inline', 'shared'] as const)('refuses the removed %s props channel without changing server DOM', channel => {
    hosts(2);
    if (channel === 'inline') document.querySelector('[data-forma-island]')!.setAttribute('data-forma-props', '{"name":"Alice","count":42}');
    else document.body.insertAdjacentHTML('beforeend', '<script id="__forma_islands" type="application/json">{"0":{"items":[1,2,3]}}</script>');
    const before = document.documentElement.outerHTML;
    const observer = new MutationObserver(() => {});
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const first = vi.fn(), second = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    activateIslands(emptyRegistry({ Comp0: first, Comp1: second }));
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
    expect(document.documentElement.outerHTML).toBe(before); expect(observer.takeRecords()).toEqual([]);
    expect(error.mock.calls).toHaveLength(2);
    expect(error.mock.calls.every(([message]) => String(message).includes('FORMA_E_ISLAND_STATE'))).toBe(true);
    observer.disconnect(); error.mockRestore();
  });

  it('loads declared scalar and array props from the first head state block', () => {
    hosts(2);
    installState([{ name: 'Alice', count: 42 }, { items: [1, 2, 3] }]);
    const first = vi.fn(() => h('div', null, h('p', null, 'Content 0'))), second = vi.fn(() => h('div', null, h('p', null, 'Content 1')));
    activateIslands({
      Comp0: compiled(first, [[{ name: 'name', type: { kind: 'string' } }, { name: 'count', type: { kind: 'number' } }]]),
      Comp1: compiled(second, [[{ name: 'items', type: { kind: 'array', element: { kind: 'number' } } }]]),
    });
    expect([...document.querySelectorAll('[data-forma-island]')].every(host => typeof (host as any).__formaDispose === 'function')).toBe(true);
    expect(first).toHaveBeenCalledExactlyOnceWith({ name: 'Alice', count: 42 });
    expect(second).toHaveBeenCalledExactlyOnceWith({ items: [1, 2, 3] });
    expect([...document.querySelectorAll('[data-forma-island]')].map(host => host.getAttribute('data-forma-status'))).toEqual(['pending', 'pending']);
  });

  it('refuses absent state instead of manufacturing null props', () => {
    hosts();
    const component = vi.fn(), error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = document.body.innerHTML;
    activateIslands(emptyRegistry({ Comp0: component }));
    expect(component).not.toHaveBeenCalled(); expect(document.body.innerHTML).toBe(before);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FORMA_E_ISLAND_STATE'));
    error.mockRestore();
  });

  it('a malformed state entry stays inert while a valid sibling activates', () => {
    hosts(2); installState([{}, { label: 'working' }]);
    document.head.querySelector('script')!.textContent = JSON.stringify({ v: 1, s: [], i: [null, { h: FIXTURE_HASH, p: { label: 'working' } }] });
    const first = vi.fn(), second = vi.fn(() => h('div', null, h('p', null, 'Content 1'))), error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const firstHost = document.querySelector('[data-forma-island="0"]')!, before = firstHost.outerHTML;
    activateIslands({ Comp0: compiled(first), Comp1: compiled(second, [[{ name: 'label', type: { kind: 'string' } }]]) });
    expect(first).not.toHaveBeenCalled(); expect(firstHost.outerHTML).toBe(before);
    expect(typeof (document.querySelector('[data-forma-island="1"]') as any).__formaDispose).toBe('function');
    expect(second).toHaveBeenCalledExactlyOnceWith({ label: 'working' });
    expect(document.querySelector('[data-forma-island="1"]')!.getAttribute('data-forma-status')).toBe('pending');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FORMA_E_ISLAND_STATE'));
    error.mockRestore();
  });

  it('preserves quoted strings in head JSON without attribute decoding', () => {
    hosts(); installState([{ label: 'Say "hello" & <goodbye>' }]);
    const component = vi.fn(() => h('div', null, h('p', null, 'Content 0')));
    activateIslands({ Comp0: compiled(component, [[{ name: 'label', type: { kind: 'string' } }]]) });
    expect(typeof (document.querySelector('[data-forma-island]') as any).__formaDispose).toBe('function');
    expect(component).toHaveBeenCalledExactlyOnceWith({ label: 'Say "hello" & <goodbye>' });
    expect(document.querySelector('[data-forma-island]')!.textContent).toBe('Content 0');
  });

  it('refuses scalar and array props roots while accepting declared object and array fields', () => {
    const invalid = [null, 7, 0, 'text', true, false, [1, 2]];
    hosts(invalid.length + 2); installState();
    document.head.querySelector('script')!.textContent = JSON.stringify({ v: 1, s: [], i: [...invalid, { rows: [1, 2] }, { ok: true, nested: { undeclared: 1 } }].map(p => ({ h: FIXTURE_HASH, p })) });
    const components = Array.from({ length: invalid.length + 2 }, (_, i) => vi.fn(() => h('div', null, h('p', null, `Content ${i}`))));
    const registry = Object.fromEntries(components.map((component, i) => [`Comp${i}`, compiled(component)]));
    registry.Comp7 = compiled(components[7]!, [[{ name: 'rows', type: { kind: 'array', element: { kind: 'number' } } }]]);
    registry.Comp8 = compiled(components[8]!, [[{ name: 'ok', type: { kind: 'boolean' } }, { name: 'nested', type: { kind: 'object', object: 1 } }], []]);
    const before = [...document.querySelectorAll('[data-forma-island]')].slice(0, invalid.length).map(host => host.outerHTML);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    activateIslands(registry);
    for (let i = 0; i < invalid.length; i++) {
      expect(components[i]).not.toHaveBeenCalled();
      expect(document.querySelector(`[data-forma-island="${i}"]`)!.outerHTML).toBe(before[i]);
    }
    expect(components[7]).toHaveBeenCalledExactlyOnceWith({ rows: [1, 2] });
    expect(components[8]).toHaveBeenCalledExactlyOnceWith({ ok: true, nested: {} });
    expect(error.mock.calls.filter(([message]) => String(message).includes('FORMA_E_ISLAND_STATE'))).toHaveLength(invalid.length);
    error.mockRestore();
  });
});

useFreshDocument();
