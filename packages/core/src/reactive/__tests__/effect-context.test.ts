import {describe, expect, it, vi} from 'vitest';
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

    for (const disposal of ['body', 'reporter', 'later'] as const) {
      it(`owns cleanup first registered by an error reporter (${contextual ? 'captured' : 'ordinary'}, ${disposal} disposal)`, () => {
        const [value, setValue] = createSignal(0), cleaned: number[] = [];
        const owners: (Owner | null)[] = [];
        let dispose: () => void;
        const off = onError(() => {
          owners.push(getOwner());
          onCleanup(() => cleaned.push(1));
          if (disposal === 'reporter') dispose();
        });
        try {
          dispose = start(() => {
            if (value() !== 1) return;
            if (disposal === 'body') dispose();
            throw new Error('first reporter cleanup');
          });
          setValue(1);
          expect(cleaned).toEqual(disposal === 'later' ? [] : [1]);
          setValue(2);
          expect(cleaned).toEqual([1]);
          dispose(); dispose();
          expect(cleaned).toEqual([1]);
          expect(owners).toEqual([null]);
          expect(getOwner()).toBeNull();
        } finally { off(); }
      });
    }

    it(`commits reporter cleanup even when development reporting throws (${contextual ? 'captured' : 'ordinary'})`, () => {
      const [value, setValue] = createSignal(0), cleaned: string[] = [];
      const reportingError = new Error('reporter failed');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { throw reportingError; });
      const off = onError(() => onCleanup(() => cleaned.push('reporter')));
      let dispose: () => void;
      try {
        dispose = start(() => {
          if (!value()) return;
          dispose();
          throw new Error('body failed');
        });
        expect(() => setValue(1)).toThrow(reportingError);
        expect(cleaned).toEqual(['reporter']);
        dispose();
        expect(cleaned).toEqual(['reporter']);
        expect(getOwner()).toBeNull();
      } finally { off(); consoleError.mockRestore(); }
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
