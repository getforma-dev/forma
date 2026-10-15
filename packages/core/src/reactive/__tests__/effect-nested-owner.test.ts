// F2 (1.1.0): a nested effect must be owned by its parent effect's current
// generation, so its cleanup runs when the parent re-runs (previously leaked via
// alien-signals' raw unwatched teardown) and on disposal — including effects
// created during a re-run after createRoot returned.
import { describe, it, expect } from 'vitest';
import { createSignal } from '../signal';
import { createEffect } from '../effect';
import { createRoot, createUnownedRoot, registerDisposer } from '../root';
import { onCleanup } from '../cleanup';

const COLON = String.fromCharCode(58);

describe('nested effect ownership (1.1.0)', () => {
  it('nested child effect cleanup runs when parent re-runs (no leak via raw unwatched)', () => {
    const order: string[] = [];
    createRoot(() => {
      const [outer, setOuter] = createSignal(0);
      const [inner] = createSignal(0);
      createEffect(() => {
        const o = outer();
        order.push('outer' + COLON + o);
        createEffect(() => {
          const i = inner();
          order.push('inner' + COLON + o + COLON + i);
          onCleanup(() => order.push('innerclean' + COLON + o + COLON + i));
        });
      });
      order.length = 0;
      setOuter(1);
      expect(order).toContain('innerclean:0:0');
    });
  });

  it('child effect created during a re-run after createRoot returns is still owned+disposed', () => {
    const seen: string[] = [];
    let setOuterRef: (v: number) => void = () => {};
    let disposeRoot = () => {};
    createRoot((dispose) => {
      disposeRoot = dispose;
      const [outer, setOuter] = createSignal(0);
      setOuterRef = setOuter;
      createEffect(() => {
        outer();
        createEffect(() => { onCleanup(() => seen.push('disposed')); });
      });
    });
    setOuterRef(1);
    seen.length = 0;
    disposeRoot();
    expect(seen).toContain('disposed');
  });

  it('nested effects still re-run independently on their own dependency', () => {
    const inner: number[] = [];
    createRoot(() => {
      const [o] = createSignal(0);
      const [i, setI] = createSignal(0);
      createEffect(() => {
        o();
        createEffect(() => { inner.push(i()); });
      });
      setI(1);
      setI(2);
      expect(inner).toEqual([0, 1, 2]);
    });
  });

  it('cleans owned roots per effect generation while an explicit unowned root survives', () => {
    const [get, set] = createSignal(0), [inner, setInner] = createSignal(0);
    const cleaned: number[] = [], seen: number[] = [], independent: number[] = [];
    let stopIndependent = () => {};
    const stop = createEffect(() => {
      const generation = get();
      createRoot(() => {
        registerDisposer(() => cleaned.push(generation));
        createEffect(() => { seen.push(generation * 10 + inner()); });
      });
      if (!generation) createUnownedRoot(dispose => {
        stopIndependent = dispose;
        createEffect(() => { independent.push(inner()); });
      });
    });
    set(1); setInner(1); stop(); setInner(2);
    expect(cleaned).toEqual([0, 1]);
    expect(seen).toEqual([0, 10, 11]);
    expect(independent).toEqual([0, 1, 2]);
    stopIndependent(); setInner(3);
    expect(independent).toEqual([0, 1, 2]);
  });
});
