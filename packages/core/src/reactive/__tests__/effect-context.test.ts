import {describe, expect, it} from 'vitest';
import {createEffect} from '../effect.js';
import {createRoot, getOwner, registerDisposer, type Owner} from '../root.js';
import {createSignal} from '../signal.js';
import {onCleanup} from '../cleanup.js';
import {onError} from '../dev.js';
import {withAdoptionCallbacks} from '../adoption-hooks.js';

describe('effect execution context', () => {
  it('invokes the body without exposing its private record as a receiver', () => {
    let receiver: unknown = 'unset';
    const dispose = createEffect(function(this: unknown) { receiver = this; });
    expect(receiver).toBeUndefined();
    dispose();
  });

  it('owns work first created on a later run and preserves its generation owner', () => {
    const [value, setValue] = createSignal(0), owners: (Owner|null)[] = [], cleaned: string[] = [];
    const dispose = createEffect(() => {
      owners.push(getOwner());
      if (value()) {
        createRoot(() => { registerDisposer(() => cleaned.push('child')); });
        onCleanup(() => cleaned.push('parent'));
      }
    });
    setValue(1); setValue(2);
    expect(new Set(owners).size).toBe(1);
    expect(owners[0]).not.toBeNull();
    expect(cleaned).toEqual(['child', 'parent']);
    dispose();
    expect(cleaned).toEqual(['child', 'parent', 'child', 'parent']);
    expect(getOwner()).toBeNull();
  });

  it('reports a failed body in its caller owner and restores the caller context', () => {
    const seen: (Owner|null)[] = [], [value, setValue] = createSignal(0);
    const off = onError(() => seen.push(getOwner()));
    let root: Owner|null = null;
    const disposeRoot = createRoot(dispose => {
      root = getOwner();
      createEffect(() => { value(); throw new Error('expected'); });
      expect(getOwner()).toBe(root);
      return dispose;
    });
    setValue(1);
    expect(seen).toEqual([root, null]);
    expect(getOwner()).toBeNull();
    disposeRoot(); off();
  });

  it('runs a captured cleanup in its own adoption callback context exactly once', () => {
    const calls: string[] = [];
    const dispose = withAdoptionCallbacks(fn => { calls.push('captured'); return fn(); }, () => createEffect(() => () => { calls.push('cleanup'); }));
    calls.length = 0;
    withAdoptionCallbacks(fn => { calls.push('ambient'); return fn(); }, dispose);
    expect(calls).toEqual(['captured', 'cleanup']);
  });

  for (const contextual of [false, true]) {
    const start = (fn: () => void | (() => void)) => contextual
      ? withAdoptionCallbacks(fn => fn(), () => createEffect(fn))
      : createEffect(fn);

    it(`drains cleanup and children registered before and after self-disposal (${contextual ? 'captured' : 'ordinary'})`, () => {
      const [value, setValue] = createSignal(0), cleaned: string[] = [];
      let dispose: () => void;
      dispose = start(() => {
        if (!value()) return;
        createRoot(() => { registerDisposer(() => cleaned.push('child-before')); });
        onCleanup(() => { cleaned.push('before'); dispose(); });
        dispose();
        createRoot(() => { registerDisposer(() => cleaned.push('child-after')); });
        onCleanup(() => cleaned.push('after'));
        return () => cleaned.push('returned');
      });
      setValue(1);
      expect(cleaned).toEqual(['child-before', 'child-after', 'before', 'after', 'returned']);
      setValue(2); dispose();
      expect(cleaned).toEqual(['child-before', 'child-after', 'before', 'after', 'returned']);
      expect(getOwner()).toBeNull();
    });

    it(`drains the active generation after self-disposal and a thrown body (${contextual ? 'captured' : 'ordinary'})`, () => {
      const [value, setValue] = createSignal(0), cleaned: number[] = [], errors: unknown[] = [];
      const off = onError(error => errors.push(error));
      let dispose: () => void;
      try {
        dispose = start(() => {
          const current = value();
          onCleanup(() => cleaned.push(current));
          if (current) { dispose(); throw new Error('after disposal'); }
        });
        setValue(1); setValue(2); dispose();
        expect(cleaned).toEqual([0, 1]);
        expect(errors).toHaveLength(1);
        expect(getOwner()).toBeNull();
      } finally { off(); }
    });
  }
});
