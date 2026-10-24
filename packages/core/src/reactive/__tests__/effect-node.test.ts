import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { computed, effect, effectScope, getActiveSub, getBatchDepth, signal, startBatch, endBatch } from 'alien-signals';
import type { ReactiveNode } from 'alien-signals/system';
import { startEffectNode, stopEffectNode, type EffectNode } from '../effect-node.js';
import { createEffect, internalEffect, withAdoptionEffectFailure } from '../effect.js';
import { createSignal } from '../signal.js';
import { onCleanup } from '../cleanup.js';
import { getOwner } from '../root.js';

function node(fn: () => void): EffectNode {
  return {fn, flags: 2 | 4, deps: undefined, depsTail: undefined, subs: undefined, subsTail: undefined};
}

describe('supplied nodes on the pinned shared engine graph', () => {
  it('pins the initialization and unlink/unwatched contract to the exact installed engine', () => {
    const root = resolve(dirname(createRequire(import.meta.url).resolve('alien-signals')), '..');
    expect(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version).toBe('3.1.2');
    for (const [path, hash] of [
      ['esm/index.mjs', '90c6c82f407aa8bde7dc9db24c5e3100019a3a29e1163892eb3091bb5d89c0a7'],
      ['esm/system.mjs', 'e8b51483df69ef48690c2596bd05d4a4a4433a3a814359bf18b2d8c17cda0d52'],
      ['cjs/index.cjs', '82e581e64b9a6c02553bae18dfa71d449b1c50ebee11d2a7557613d7db40981f'],
      ['cjs/system.cjs', '7018369194136f70044009dc9e5e4905d09849e7b1f2d25d9bc7549a00bc5014'],
    ]) expect(createHash('sha256').update(readFileSync(resolve(root, path!))).digest('hex')).toBe(hash);
  });

  it('retains one inert shape anchor without caller authority or graph links', () => {
    let owner: ReturnType<typeof getOwner>;
    const stop = createEffect(() => { owner = getOwner(); });
    stop();
    const anchor = (owner!.constructor as unknown as {shapeAnchor: Record<string, unknown>}).shapeAnchor;
    expect(anchor).toBeDefined();
    expect(anchor).not.toBe(owner!);
    expect(anchor.disposed).toBe(true);
    expect(anchor.flags).toBe(2 | 4);
    expect(anchor.fn).toBe((owner! as unknown as {run: unknown}).run);
    for (const field of ['deps', 'depsTail', 'subs', 'subsTail', 'callbacks', 'events', 'failure', 'reader', 'ownerOverride', 'children', 'cleanup', 'nextCleanup']) {
      expect(anchor[field]).toBeUndefined();
    }
    expect(Object.keys(anchor).sort()).toEqual(['callback', 'deps', 'depsTail', 'disposed', 'flags', 'fn', 'subs', 'subsTail']);
    expect((anchor.callback as () => unknown)()).toBeUndefined();
    let second: ReturnType<typeof getOwner>;
    const stopSecond = createEffect(() => { second = getOwner(); });
    stopSecond();
    expect((second!.constructor as unknown as {shapeAnchor: unknown}).shapeAnchor).toBe(anchor);
  });

  it('links and restores the actual raw parent and clears its native subscription on stop', () => {
    const value = signal(0); let calls = 0;
    const child = node(() => {expect(getActiveSub()).toBe(child); value(); calls++;});
    const stop = effectScope(() => {
      const parent = getActiveSub();
      startEffectNode(child);
      expect(getActiveSub()).toBe(parent);
      expect(child.subs?.sub).toBe(parent);
      expect(child.flags).toBe(2);
    });
    value(1); expect(calls).toBe(2);
    stopEffectNode(child); stopEffectNode(child); value(2);
    expect(calls).toBe(2); expect(child.flags).toBe(0);
    expect(child.deps).toBeUndefined(); expect(child.subs).toBeUndefined(); stop();
  });

  it('preserves raw start restoration after an initial throw and permits explicit graph teardown', () => {
    const value = signal(0), error = Error('initial');
    const child = node(() => {value(); throw error;});
    const stop = effectScope(() => {
      const parent = getActiveSub();
      expect(() => startEffectNode(child)).toThrow(error);
      expect(getActiveSub()).toBe(parent);
      expect(child.flags & 4).toBe(0);
      stopEffectNode(child);
    });
    expect(() => value(1)).not.toThrow(); stop();
  });

  it('shares signal subscriptions, batching and computed values in both raw/Forma directions', () => {
    const raw = signal(0), [get, set] = createSignal(0);
    const sum = computed(() => raw() + get());
    const rawSeen: number[] = [], formaSeen: number[] = [];
    const stopRaw = effect(() => {rawSeen.push(sum());});
    const stopForma = createEffect(() => {formaSeen.push(sum());});
    startBatch(); expect(getBatchDepth()).toBe(1); raw(1); set(2);
    expect(rawSeen).toEqual([0]); expect(formaSeen).toEqual([0]); endBatch();
    expect(rawSeen).toEqual([0, 3]); expect(formaSeen).toEqual([0, 3]);
    stopForma(); raw(2); expect(formaSeen).toEqual([0, 3]); expect(rawSeen).toEqual([0, 3, 4]);
    stopRaw(); set(4); expect(rawSeen).toEqual([0, 3, 4]);
  });

  it.each(['raw', 'forma'] as const)('retains a shared computed until its last %s subscription is removed', last => {
    const raw = signal(0); let computations = 0; let computedNode: ReactiveNode | undefined;
    const derived = computed(() => {computedNode = getActiveSub(); computations++; return raw();});
    const stopRaw = effect(() => {derived();});
    const stopForma = createEffect(() => {derived();});
    const first = last === 'raw' ? stopForma : stopRaw, final = last === 'raw' ? stopRaw : stopForma;
    first(); raw(1); expect(computations).toBe(2); expect(computedNode?.deps).toBeDefined();
    final(); expect(computedNode?.flags).toBe(1 | 16); expect(computedNode?.deps).toBeUndefined();
    raw(2); expect(computations).toBe(2);
  });

  it.each([128, 512])('matches raw teardown of a %i-computed chain without retaining mutable dependencies', depth => {
    for (const observe of [effect, createEffect]) {
      const raw = signal(0); const nodes: ReactiveNode[] = [];
      let read: () => number = raw;
      for (let i = 0; i < depth; i++) {
        const previous = read;
        read = computed(() => {const active = getActiveSub()!; if (!nodes.includes(active)) nodes.push(active); return previous() + 1;});
      }
      let result = 0;
      const stop = observe(() => {result = read();});
      expect(result).toBe(depth); expect(nodes).toHaveLength(depth);
      expect(() => stop()).not.toThrow();
      for (const current of nodes) {expect(current.flags).toBe(1 | 16); expect(current.deps).toBeUndefined();}
      raw(1); const second = observe(() => {result = read();}); expect(result).toBe(depth + 1); second();
    }
  });

  it('lets a native nested scope stop a supplied node before the Forma disposer drains its cleanup', () => {
    const raw = signal(0); let calls = 0, cleanups = 0, dispose = () => {};
    const stopScope = effectScope(() => {
      dispose = createEffect(() => {raw(); calls++; onCleanup(() => {cleanups++;});});
    });
    raw(1); expect(calls).toBe(2); expect(cleanups).toBe(1);
    stopScope(); raw(2); expect(calls).toBe(2);
    dispose(); dispose(); expect(cleanups).toBe(2);
  });

  it('unsubscribes a failing adopted initial reader and restores its raw parent', () => {
    const raw = signal(0), error = Error('reader'); let reader: ReactiveNode | undefined;
    const stop = effectScope(() => {
      const parent = getActiveSub();
      expect(() => withAdoptionEffectFailure(() => {}, () => internalEffect(() => {
        reader = getActiveSub(); raw(); throw error;
      }))).toThrow(error);
      expect(getActiveSub()).toBe(parent);
    });
    expect(reader?.flags).toBe(0); expect(reader?.deps).toBeUndefined();
    expect(() => raw(1)).not.toThrow(); stop();
  });
});
