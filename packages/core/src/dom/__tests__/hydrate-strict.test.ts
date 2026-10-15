import { describe, it, expect, vi } from 'vitest';
import { hydrateIsland } from '../hydrate.js';
import { h, fragment } from '../element.js';
import { createRoot, registerDisposer } from '../../reactive/root.js';
import { createSignal } from '../../reactive/signal.js';
import { createEffect } from '../../reactive/effect.js';
import { onError } from '../../reactive/dev.js';

function fixture(html: string): Element {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = html;
  return doc.body.firstElementChild!;
}

describe('strict public hydrateIsland facade', () => {
  it('returns the exact target with zero writes and retains caller-owned live updates', async () => {
    const host = fixture('<main data-forma-ssr><button><!--f:t0-->1<!--/f:t0--></button></main>');
    const original = host.firstElementChild!;
    const [count, setCount] = createSignal(1);
    const click = vi.fn(() => setCount(count() + 1));
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(host, { subtree: true, attributes: true, characterData: true, childList: true });
    let dispose!: () => void;
    try {
      createRoot(stop => {
        dispose = stop;
        expect(hydrateIsland(() => h('button', { onClick: click }, count), host)).toBe(host);
      });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(records.concat(observer.takeRecords())).toEqual([]);
      expect(host.firstElementChild).toBe(original);
      expect(host.hasAttribute('data-forma-ssr')).toBe(true);
      original.dispatchEvent(new Event('click'));
      expect(host.textContent).toBe('2');
      dispose();
      original.dispatchEvent(new Event('click'));
      setCount(3);
      expect(click).toHaveBeenCalledOnce();
      expect(host.textContent).toBe('2');
    } finally { dispose?.(); observer.disconnect(); }
  });

  it('supports marked roots and exact Fragment ranges without replacing the host', () => {
    const marked = fixture('<button data-forma-island="0" data-forma-ssr>click</button>');
    const range = fixture('<main data-forma-island="1"><b>one</b><i>two</i></main>');
    const original = Array.from(range.childNodes);
    const click = vi.fn();
    createRoot(dispose => {
      try {
        expect(hydrateIsland(() => h('button', { onClick: click }, 'click'), marked)).toBe(marked);
        expect(hydrateIsland(() => fragment(h('b', null, 'one'), h('i', null, 'two')), range)).toBe(range);
        marked.dispatchEvent(new Event('click'));
        expect(click).toHaveBeenCalledOnce();
        expect(Array.from(range.childNodes)).toEqual(original);
      } finally { dispose(); }
    });
  });

  it.each(['<main><i>wrong</i></main>', '<main></main>'])('refuses %s without repair, effects or listeners', async html => {
    const host = fixture(html), before = host.outerHTML, nodes = Array.from(host.childNodes);
    const effect = vi.fn(), click = vi.fn(), observed = vi.fn();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {}), stop = onError(observed);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(host, { subtree: true, attributes: true, childList: true, characterData: true });
    try {
      createRoot(dispose => {
        try {
          expect(hydrateIsland(() => { createEffect(effect); return h('button', { onClick: click }, 'click'); }, host)).toBe(host);
        } finally { dispose(); }
      });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(observed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'FORMA_E_HYDRATE_NODE' }), { source: 'hydration' });
      expect(host.outerHTML).toBe(before);
      expect(Array.from(host.childNodes)).toEqual(nodes);
      expect(records.concat(observer.takeRecords())).toEqual([]);
      expect(effect).not.toHaveBeenCalled();
      host.firstElementChild?.dispatchEvent(new Event('click'));
      expect(click).not.toHaveBeenCalled();
    } finally { observer.disconnect(); stop(); log.mockRestore(); }
  });

  it('rethrows an initial user exception by identity after disposing partial work', () => {
    const host = fixture('<main><b>kept</b></main>');
    const error = Object.assign(new Error('FORMA_E_HYDRATE_NODE'), { code: 'FORMA_E_HYDRATE_NODE' });
    const cleaned = vi.fn(), observed = vi.fn(), stop = onError(observed);
    try {
      createRoot(dispose => {
        try {
          let thrown: unknown;
          try { hydrateIsland(() => { registerDisposer(cleaned); throw error; }, host); }
          catch (cause) { thrown = cause; }
          expect(thrown).toBe(error);
          expect(cleaned).toHaveBeenCalledOnce();
          expect(observed).not.toHaveBeenCalled();
        } finally { dispose(); }
      });
      expect(cleaned).toHaveBeenCalledOnce();
      expect(host.innerHTML).toBe('<b>kept</b>');
    } finally { stop(); }
  });

  it('cannot fabricate setter authority for an early edited reactive input', () => {
    const host = fixture('<main><input value="server"></main>'), input = host.firstElementChild as HTMLInputElement;
    input.value = 'typed';
    const [value, setValue] = createSignal('server'), observed = vi.fn();
    const stop = onError(observed), log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      createRoot(dispose => {
        try {
          expect(hydrateIsland(() => h('input', { value }), host)).toBe(host);
          expect(observed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'FORMA_E_HYDRATE_INPUT_TARGET' }), { source: 'hydration' });
          expect(input.value).toBe('typed');
          expect(value()).toBe('server');
          setValue('later');
          expect(input.value).toBe('typed');
        } finally { dispose(); }
      });
    } finally { stop(); log.mockRestore(); }
  });

  it('retains an early edit for literal initialization without creating writeback', () => {
    const host = fixture('<main><input value="server"></main>'), input = host.firstElementChild as HTMLInputElement;
    input.value = 'typed';
    const observed = vi.fn(), stop = onError(observed);
    try {
      createRoot(dispose => {
        try { expect(hydrateIsland(() => h('input', { value: 'server' }), host)).toBe(host); }
        finally { dispose(); }
      });
      expect(input.value).toBe('typed');
      expect(input.defaultValue).toBe('server');
      expect(observed).not.toHaveBeenCalled();
    } finally { stop(); }
  });

  it('revokes listeners and deferred work when the component disposes its caller', () => {
    const host = fixture('<main><button>click</button></main>'), click = vi.fn(), effect = vi.fn();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {}), observed = vi.fn(), stop = onError(observed);
    try {
      createRoot(dispose => {
        expect(hydrateIsland(() => { dispose(); createEffect(effect); return h('button', { onClick: click }, 'click'); }, host)).toBe(host);
      });
      host.firstElementChild!.dispatchEvent(new Event('click'));
      expect(click).not.toHaveBeenCalled();
      expect(effect).not.toHaveBeenCalled();
      expect(observed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'FORMA_E_HYDRATE_STRUCTURE' }), { source: 'hydration' });
    } finally { stop(); log.mockRestore(); }
  });

  it('contains a failing deferred ref once and revokes already installed listeners', () => {
    const host = fixture('<main><button>click</button></main>'), error = new Error('ref failure'), click = vi.fn(), cleaned = vi.fn();
    const observed = vi.fn(), stop = onError(observed), log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      createRoot(dispose => {
        try {
          expect(hydrateIsland(() => h('button', { onClick: click, ref: () => { registerDisposer(cleaned); throw error; } }, 'click'), host)).toBe(host);
          expect(observed).toHaveBeenCalledExactlyOnceWith(error, { source: 'hydration' });
          host.firstElementChild!.dispatchEvent(new Event('click'));
          expect(click).not.toHaveBeenCalled();
          expect(cleaned).toHaveBeenCalledOnce();
        } finally { dispose(); }
      });
      expect(cleaned).toHaveBeenCalledOnce();
    } finally { stop(); log.mockRestore(); }
  });
});
