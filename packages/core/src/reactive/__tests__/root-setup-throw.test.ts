import { describe, expect, it, vi } from 'vitest';
import { createRoot, createUnownedRoot, getOwner, registerDisposer } from '../root.js';
import { createSignal } from '../signal.js';
import { createEffect, internalEffect } from '../effect.js';

describe.each([['owned', createRoot], ['unowned', createUnownedRoot]] as const)('%s root setup failures', (_name, root) => {
  it.each(['before', 'after', 'none'] as const)('drains effects and native resources when explicit dispose is %s setup', timing => {
    const [read, write] = createSignal(0);
    const run = vi.fn(); const cleaned = vi.fn(); const clicked = vi.fn();
    const target = document.createElement('button');
    const controller = new AbortController();
    const failure = { setup: 'failure' };
    let captured!: () => void;
    expect(() => root(dispose => {
      captured = dispose;
      if (timing === 'before') dispose();
      createEffect(() => { read(); run(); return cleaned; });
      target.addEventListener('click', clicked, { signal: controller.signal });
      registerDisposer(() => controller.abort());
      if (timing === 'after') dispose();
      throw failure;
    })).toThrow(failure);
    expect(run).toHaveBeenCalledTimes(1);
    expect(cleaned).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
    write(1); target.click(); captured();
    expect(run).toHaveBeenCalledTimes(1);
    expect(cleaned).toHaveBeenCalledTimes(1);
    expect(clicked).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 0, '', { original: true }])('rethrows the exact value %j despite a throwing cleanup', failure => {
    let caught = false; const cleaned: string[] = [];
    try {
      root(() => {
        registerDisposer(() => { cleaned.push('throwing cleanup'); throw new Error('cleanup'); });
        registerDisposer(() => { cleaned.push('remaining cleanup'); });
        throw failure;
      });
    } catch (error) {
      caught = true; expect(error).toBe(failure);
    }
    expect(caught).toBe(true);
    expect(cleaned).toEqual(['throwing cleanup', 'remaining cleanup']);
  });

  it('keeps the parent alive and restores its owner when a child setup fails', () => {
    const [read, write] = createSignal(0);
    const parentRuns = vi.fn(); const childRuns = vi.fn(); const afterRuns = vi.fn();
    const failure = new Error('child setup');
    const dispose = createRoot(stop => {
      const owner = getOwner();
      internalEffect(() => { read(); parentRuns(); });
      expect(() => root(childStop => {
        childStop(); internalEffect(() => { read(); childRuns(); });
        throw failure;
      })).toThrow(failure);
      expect(getOwner()).toBe(owner);
      internalEffect(() => { read(); afterRuns(); });
      return stop;
    });
    write(1);
    expect(parentRuns).toHaveBeenCalledTimes(2);
    expect(afterRuns).toHaveBeenCalledTimes(2);
    expect(childRuns).toHaveBeenCalledTimes(1);
    dispose(); write(2);
    expect(parentRuns).toHaveBeenCalledTimes(2);
    expect(afterRuns).toHaveBeenCalledTimes(2);
  });

  it('drains a child resource appended by cleanup before propagating the setup error', () => {
    const failure = new Error('setup'); const cleaned = vi.fn();
    expect(() => root(() => {
      registerDisposer(() => {
        createRoot(() => registerDisposer(cleaned));
        throw new Error('cleanup');
      });
      throw failure;
    })).toThrow(failure);
    expect(cleaned).toHaveBeenCalledTimes(1);
  });
});
