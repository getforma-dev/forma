// Context auto-teardown defects found by adversarial verification (1.5.0).
import { describe, it, expect, vi } from 'vitest';
import { defineComponent, disposeComponent, onMount, onUnmount, trackDisposer } from '../define';
import { createContext, provide, inject } from '../context';
import { createEffect, createSignal } from '../../reactive';

describe('context auto-teardown correctness', () => {
  it('disposing one component does not corrupt a still-mounted sibling (HIGH)', () => {
    const ctx = createContext('default');
    const a = defineComponent(() => { provide(ctx, 'A'); return document.createElement('div'); })();
    const b = defineComponent(() => { provide(ctx, 'B'); return document.createElement('div'); })();
    expect(inject(ctx)).toBe('B'); // B provided last
    disposeComponent(a); // dispose A while B is still mounted
    // B's value must survive; A's frame is removed, not B's top frame.
    expect(inject(ctx)).toBe('B');
    disposeComponent(b);
    expect(inject(ctx)).toBe('default');
  });

  it('a setup that throws after provide() does not leak the value globally (HIGH)', () => {
    const ctx = createContext('def');
    const factory = defineComponent(() => {
      provide(ctx, 'LEAK');
      throw new Error('setup boom');
    });
    expect(() => factory()).toThrow('setup boom');
    expect(inject(ctx)).toBe('def'); // provide was unwound on throw
  });

  it('failed setup releases retained listeners and tracked reactive effects without mounting', () => {
    const [value, setValue] = createSignal(0);
    const button = document.createElement('button');
    const text = document.createElement('span');
    const mounted = vi.fn();
    const released = vi.fn();
    const failure = new Error('setup did not complete');
    const click = () => setValue(value() + 1);
    let stopEffect = () => {};
    const factory = defineComponent(() => {
      stopEffect = createEffect(() => { text.textContent = String(value()); });
      trackDisposer(stopEffect);
      button.addEventListener('click', click);
      trackDisposer(() => button.removeEventListener('click', click));
      onUnmount(released);
      onMount(mounted);
      throw failure;
    });
    try {
      expect(factory).toThrow(failure);
      button.click();
      expect(value()).toBe(0);
      setValue(2);
      expect(text.textContent).toBe('0');
      expect(released).toHaveBeenCalledTimes(1);
      expect(mounted).not.toHaveBeenCalled();
    } finally {
      // The deliberately failing original source has no returned dispose handle.
      stopEffect();
      button.removeEventListener('click', click);
    }
  });

  it('failed setup preserves its error while every cleanup and context unwinds', () => {
    const context = createContext('outside');
    const error = new Error('original setup error');
    const cleanup = vi.fn();
    const unmounted = vi.fn();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const factory = defineComponent(() => {
        provide(context, 'inside');
        onUnmount(() => { throw new Error('unmount cleanup failed'); });
        onUnmount(unmounted);
        trackDisposer(() => { throw new Error('tracked cleanup failed'); });
        trackDisposer(cleanup);
        throw error;
      });
      expect(factory).toThrow(error);
      expect(unmounted).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(inject(context)).toBe('outside');
      expect(log).toHaveBeenCalledTimes(2);
    } finally { log.mockRestore(); }
  });

  it('provide() inside onMount is balanced on dispose (MEDIUM)', () => {
    const ctx = createContext('base');
    const dom = defineComponent(() => {
      onMount(() => { provide(ctx, 'mounted'); });
      return document.createElement('div');
    })();
    expect(inject(ctx)).toBe('mounted');
    disposeComponent(dom);
    expect(inject(ctx)).toBe('base');
  });

  it('trackDisposer() inside onMount is cleaned up on dispose (LOW)', () => {
    const spy = vi.fn();
    const dom = defineComponent(() => {
      onMount(() => { trackDisposer(spy); });
      return document.createElement('div');
    })();
    expect(spy).not.toHaveBeenCalled();
    disposeComponent(dom);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
