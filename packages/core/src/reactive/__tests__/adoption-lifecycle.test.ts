import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBatchDepth } from 'alien-signals';
import { AdoptionLifecycle, type PreparationOptions } from '../adoption-lifecycle.js';
import { __adoptionSignal, __adoptionWritable } from '../adoption-hooks.js';
import { createSignal } from '../signal.js';
import { createComputed } from '../computed.js';
import { createEffect } from '../effect.js';
import { onCleanup } from '../cleanup.js';
import { onError } from '../dev.js';
import { createRoot, registerDisposer } from '../root.js';
import { AdoptionDom } from '../../dom/adoption-plan.js';

const scopes: AdoptionLifecycle[] = [], disposers: (() => void)[] = [];
function scope(options?: PreparationOptions) { const value = new AdoptionLifecycle(options); scopes.push(value); return value; }
function publish(value: AdoptionLifecycle) { value.seal(); value.seed(); value.publish(); }
afterEach(() => {
  scopes.splice(0).forEach(value => value.abort()); disposers.splice(0).forEach(dispose => dispose());
  expect(getBatchDepth()).toBe(0);
});

describe('unprivileged shared preparation', () => {
  it('can adopt an untouched reader without a 103 token but never grants compiler hook seed authority', () => {
    const value = scope(), write = vi.fn();
    const pair = value.run(() => __adoptionSignal(1, createSignal('original')));
    const read = () => pair[0]();
    expect(value.run(() => __adoptionWritable(read, pair[0], 'string', 2))).toBe(read);
    expect(value.observe(read, write)).toBe('original'); publish(value);
    expect(write).not.toHaveBeenCalled(); pair[1]('next'); expect(write).toHaveBeenCalledExactlyOnceWith('next');
    const edited = scope();
    expect(() => edited.queueEdit(read, 'typed')).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');
    expect(pair[0]()).toBe('next');
  });

  it('keeps public effects dormant through seal and seed, then retains rerun and cleanup ownership', () => {
    const value = scope(), [get, set] = createSignal(0), runs: number[] = [], cleanups: number[] = [];
    value.run(() => createEffect(() => {
      const n = get(); runs.push(n); onCleanup(() => cleanups.push(n));
    }));
    expect(runs).toEqual([]); value.seal(); value.seed(); expect(runs).toEqual([]);
    value.publish(); expect(runs).toEqual([0]);
    set(1); set(2); expect(runs).toEqual([0, 1, 2]); expect(cleanups).toEqual([0, 1]);
    value.abort(); set(3); expect(runs).toEqual([0, 1, 2]); expect(cleanups).toEqual([0, 1, 2]);
  });

  it('allows cancelling a dormant effect and ref before their first callback', () => {
    const value = scope(), effect = vi.fn(), ref = vi.fn();
    const cancelEffect = value.run(() => createEffect(effect));
    const cancelRef = value.run(() => value.deferRef(ref));
    cancelEffect(); cancelEffect(); cancelRef(); publish(value);
    expect(effect).not.toHaveBeenCalled(); expect(ref).not.toHaveBeenCalled();
    const immediate = vi.fn(); disposers.push(createEffect(immediate)); expect(immediate).toHaveBeenCalledOnce();
  });

  it('retains the lifetime of a caller-owned nested root before and after publication', () => {
    for (const before of [true, false]) {
      const value = scope(), [get, set] = createSignal(0), effect = vi.fn(), cleanup = vi.fn();
      const disposeRoot = value.run(() => createRoot(dispose => {
        createEffect(() => { get(); effect(); onCleanup(cleanup); }); return dispose;
      }));
      if (before) disposeRoot(); publish(value);
      if (!before) disposeRoot(); set(1);
      expect(effect).toHaveBeenCalledTimes(before ? 0 : 1); expect(cleanup).toHaveBeenCalledTimes(before ? 0 : 1);
    }
  });

  it('does not attach deferred effects to an unrelated effect that publishes the plan', () => {
    const value = scope(), [get, set] = createSignal(0), [trigger, retrigger] = createSignal(0), runs: number[] = [];
    value.run(() => createEffect(() => { runs.push(get()); }));
    disposers.push(createEffect(() => { if (trigger() === 0) publish(value); }));
    retrigger(1); set(1); set(2);
    expect(runs).toEqual([0, 1, 2]); expect(value.phase).toBe('live');
  });

  it('drops deferred callbacks and partial reader dependencies on a construction throw', () => {
    const value = scope(), [get, set] = createSignal(0), compute = vi.fn(get), effect = vi.fn();
    const derived = createComputed(compute);
    expect(() => value.run(() => {
      createEffect(effect); value.deferRef(effect);
      value.observe(derived, vi.fn()); throw new Error('construction');
    })).toThrow('construction');
    set(1); set(2); expect(compute).toHaveBeenCalledOnce(); expect(effect).not.toHaveBeenCalled();
    expect(value.phase).toBe('aborted');
  });

  it('keeps a reader-created public effect dormant and disposes its partial root on refusal', () => {
    const value = scope(), [get, set] = createSignal(0), callback = vi.fn(), cleanup = vi.fn();
    expect(() => value.observe(() => {
      createRoot(() => { createEffect(() => { get(); callback(); }); registerDisposer(cleanup); });
      throw new Error('reader failed');
    }, vi.fn())).toThrow('reader failed');
    set(1); expect(callback).not.toHaveBeenCalled(); expect(cleanup).toHaveBeenCalledOnce();
  });

  it('rechecks the exact DOM at seal, seed and publish without writing it', () => {
    const doc = document.implementation.createHTMLDocument(); doc.body.innerHTML = '<main>server</main><aside></aside>';
    const host = doc.querySelector('main')!, dom = new AdoptionDom(host), check = vi.fn(() => dom.assertUnchanged());
    const value = scope({ check }), effect = vi.fn(); value.run(() => createEffect(effect));
    value.seal(); value.seed(); doc.querySelector('aside')!.appendChild(host);
    expect(() => value.publish()).toThrow('FORMA_E_HYDRATE_STRUCTURE');
    expect(check).toHaveBeenCalledTimes(3); expect(effect).not.toHaveBeenCalled(); expect(host.textContent).toBe('server');
  });
});

describe('per-row and per-branch ownership', () => {
  it('disposes one live row while other rows and the parent retain their readers and effects', () => {
    const value = scope(), [get, set] = createSignal(0), a = vi.fn(), b = vi.fn(), parent = vi.fn();
    value.observe(get, parent);
    const first = value.group(() => { value.observe(get, a); createEffect(() => { get(); a('effect'); }); return 'a'; });
    const second = value.group(() => { value.observe(get, b); createEffect(() => { get(); b('effect'); }); return 'b'; });
    expect(first.value).toBe('a'); expect(second.value).toBe('b'); publish(value);
    first.dispose(); first.dispose(); a.mockClear(); b.mockClear(); set(1);
    expect(first.alive).toBe(false); expect(second.alive).toBe(true);
    expect(a).not.toHaveBeenCalled(); expect(b).toHaveBeenCalledWith(1); expect(b).toHaveBeenCalledWith('effect');
    expect(parent).toHaveBeenCalledExactlyOnceWith(1); expect(value.phase).toBe('live');
  });

  it('keeps later row-planning work owned by that row and recursively disposes its child groups', () => {
    const value = scope(), [get, set] = createSignal(0), childWrite = vi.fn(), laterWrite = vi.fn();
    const row = value.group(() => value.group(() => value.observe(get, childWrite)));
    row.run(() => value.observe(get, laterWrite)); publish(value); row.dispose(); set(1);
    expect(row.alive).toBe(false); expect(row.value.alive).toBe(false);
    expect(childWrite).not.toHaveBeenCalled(); expect(laterWrite).not.toHaveBeenCalled();
    expect(() => row.run(() => 1)).toThrow('FORMA_E_HYDRATE_STRUCTURE');
  });

  it('owns roots and effects created by a deferred ref, including its cleanup after a throw', () => {
    const failure = vi.fn(), value = scope({ failure }), [get, set] = createSignal(0), runs = vi.fn(), cleaned = vi.fn();
    value.run(() => value.deferRef(() => {
      createRoot(() => { createEffect(() => { get(); runs(); }); registerDisposer(cleaned); });
      throw new Error('partial ref');
    }));
    publish(value); set(1); set(2);
    expect(runs).toHaveBeenCalledOnce(); expect(cleaned).toHaveBeenCalledOnce(); expect(failure).toHaveBeenCalledOnce();
  });

  it('routes a ref-created effect failure to the effect code and removes its partial dependencies', () => {
    const failure = vi.fn(), value = scope({ failure }), [get, set] = createSignal(0), run = vi.fn(), cleaned = vi.fn();
    value.run(() => value.deferRef(() => {
      createEffect(() => { get(); run(); onCleanup(cleaned); throw new Error('ref child effect'); });
    }));
    publish(value); set(1);
    expect(run).toHaveBeenCalledOnce(); expect(cleaned).toHaveBeenCalledOnce();
    expect(failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'ref child effect' }), 'FORMA_E_HYDRATE_EFFECT');
  });

  it('invalidates a prepared plan if one of its described groups is disposed', () => {
    const value = scope(), callback = vi.fn();
    const row = value.group(() => createEffect(callback)); row.dispose();
    expect(() => value.seal()).toThrow('FORMA_E_HYDRATE_VALUE');
    expect(callback).not.toHaveBeenCalled(); expect(value.phase).toBe('aborted');
  });

  it('cleans all earlier rows and a partially constructed row when a later row throws', () => {
    const value = scope(), [get, set] = createSignal(0), readers = [vi.fn(get), vi.fn(get)], effects = vi.fn();
    const first = value.group(() => { value.observe(readers[0]!, vi.fn()); createEffect(effects); });
    expect(() => value.group(() => {
      value.observe(readers[1]!, vi.fn()); createEffect(effects); throw new Error('row');
    })).toThrow('row');
    set(1); expect(first.alive).toBe(false); expect(effects).not.toHaveBeenCalled();
    readers.forEach(read => expect(read).toHaveBeenCalledOnce());
  });
});

describe('honest post-commit callback failures', () => {
  it('runs refs and effects after commit in recorded order and cancels all remaining work after a ref throws', () => {
    const failure = vi.fn(), value = scope({ failure }), [get, set] = createSignal(0), order: string[] = [];
    value.run(() => {
      createEffect(() => { get(); order.push('effect'); });
      value.deferRef(() => { order.push('ref'); throw new Error('ref failed'); });
      createEffect(() => { order.push('never'); });
    });
    expect(order).toEqual([]); publish(value); set(1);
    expect(order).toEqual(['effect', 'ref']); expect(value.phase).toBe('aborted');
    expect(failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'ref failed' }), 'FORMA_E_HYDRATE_REF');
  });

  it('disposes a first effect that throws after registering cleanup without claiming its application write was rolled back', () => {
    const failure = vi.fn(), value = scope({ failure }), cleanup = vi.fn(), [get, set] = createSignal(0), run = vi.fn();
    const target = document.createElement('div'); target.textContent = 'server';
    value.run(() => createEffect(() => {
      get(); run(); onCleanup(cleanup); target.textContent = 'application write'; throw new Error('effect failed');
    }));
    expect(target.textContent).toBe('server'); publish(value); set(1); value.abort();
    expect(target.textContent).toBe('application write'); expect(run).toHaveBeenCalledOnce(); expect(cleanup).toHaveBeenCalledOnce();
    expect(failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'effect failed' }), 'FORMA_E_HYDRATE_EFFECT');
  });

  it('keeps an unrelated observer alive after a later adopted effect fails', () => {
    const failure = vi.fn(), value = scope({ failure }), [get, set] = createSignal(0), neighbor: number[] = [], cleanup = vi.fn();
    value.run(() => createEffect(() => { const n = get(); onCleanup(cleanup); if (n) throw new Error('later'); }));
    disposers.push(createEffect(() => { neighbor.push(get()); })); publish(value); set(1); set(2);
    expect(value.phase).toBe('aborted'); expect(neighbor).toEqual([0, 1, 2]);
    expect(failure).toHaveBeenCalledOnce(); expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('inherits the failure boundary through effects created by a live adopted callback', () => {
    const failure = vi.fn(), value = scope({ failure }), [get, set] = createSignal(0), parentCleanup = vi.fn(), childCleanup = vi.fn();
    value.run(() => createEffect(() => {
      onCleanup(parentCleanup);
      createEffect(() => { const n = get(); onCleanup(childCleanup); if (n) throw new Error('nested'); });
    }));
    publish(value); set(1); set(2);
    expect(failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'nested' }), 'FORMA_E_HYDRATE_EFFECT');
    expect(parentCleanup).toHaveBeenCalledOnce(); expect(childCleanup).toHaveBeenCalledTimes(2);
  });

  it('drains late roots and returned cleanup after a nested failure without rerunning the aborted parent', () => {
    const failure = vi.fn(), value = scope({ failure });
    const [trigger, setTrigger] = createSignal(0), [later, setLater] = createSignal(0);
    const parent = vi.fn(), late = vi.fn(), rootCleanup = vi.fn(), returnedCleanup = vi.fn();
    value.run(() => createEffect(() => {
      const n = trigger(); parent();
      if (!n) return;
      createEffect(() => { throw new Error('nested live failure'); });
      createRoot(() => {
        createEffect(() => { later(); late(); });
        registerDisposer(rootCleanup);
      });
      setTrigger(n + 1);
      return returnedCleanup;
    }));
    publish(value); setTrigger(1);
    expect(value.phase).toBe('aborted'); expect(failure).toHaveBeenCalledOnce();
    expect(parent).toHaveBeenCalledTimes(2); expect(late).toHaveBeenCalledOnce();
    expect(rootCleanup).toHaveBeenCalledOnce(); expect(returnedCleanup).toHaveBeenCalledOnce();
    setLater(1); setTrigger(4); value.abort();
    expect(parent).toHaveBeenCalledTimes(2); expect(late).toHaveBeenCalledOnce();
    expect(rootCleanup).toHaveBeenCalledOnce(); expect(returnedCleanup).toHaveBeenCalledOnce();
  });

  it('restores ordinary effect error handling after a deferred callback finishes', () => {
    const failure = vi.fn(), value = scope({ failure }), errors: unknown[] = [];
    value.run(() => createEffect(() => {})); publish(value);
    disposers.push(onError(error => { errors.push(error); }));
    disposers.push(createEffect(() => { throw new Error('ordinary'); }));
    expect(failure).not.toHaveBeenCalled(); expect(value.phase).toBe('live'); expect(errors).toHaveLength(1);
  });
});
