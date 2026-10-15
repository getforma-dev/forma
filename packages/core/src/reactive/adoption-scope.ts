/**
 * Private FORMA-104 preparation seam. Not yet connected to the DOM adopter.
 * The compiler hooks carry function identity; the planner carries DOM policy.
 */
import { effect as rawEffect, getActiveSub, setActiveSub } from 'alien-signals';
import { checkIslandClaim, type ValidatedIsland } from '../dom/island-state.js';
import { withAdoptionSink, type AdoptionCodec, type AdoptionSink } from './adoption-hooks.js';
import { openBatch, closeBatchWithoutRoot } from './batch.js';
import { createUnownedRoot } from './root.js';
import { reportError } from './dev.js';
import type { SignalGetter, SignalSetter } from './signal.js';

type Phase = 'preparing' | 'validated' | 'seeding' | 'live' | 'aborted';
type Code = 'FORMA_E_HYDRATE_INPUT_TARGET' | 'FORMA_E_HYDRATE_INPUT_CONFLICT'
  | 'FORMA_E_HYDRATE_VALUE' | 'FORMA_E_HYDRATE_STRUCTURE';
type Value = string | number | boolean | string[];
type Local = { get: SignalGetter<unknown>; set: SignalSetter<unknown> };
type Binding = { local: Local; codec: AdoptionCodec; site: number };
type Edit = Binding & { before: Value; baseline: Value; next: Value };

export class AdoptionScopeError extends Error {
  constructor(readonly code: Code, readonly site?: number) {
    super(`[forma] ${code}`);
    this.name = 'AdoptionScopeError';
  }
}

function untracked<T>(read: () => T): T {
  const previous = setActiveSub(undefined);
  try { return read(); } finally { setActiveSub(previous); }
}

function accepts(codec: AdoptionCodec, value: unknown): value is Value {
  switch (codec) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'string-array': {
      if (!Array.isArray(value)) return false;
      for (const item of value) if (typeof item !== 'string') return false;
      return true;
    }
  }
}

function copy(value: Value): Value { return Array.isArray(value) ? [...value] : value; }
function equal(a: unknown, b: Value): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item, index) => item === b[index])
    : Object.is(a, b);
}

/** @internal Constructed only after the existing document preflight. */
export class AdoptionScope implements AdoptionSink {
  private state: Phase = 'preparing';
  private invalidated = false;
  private batchOpen = false;
  private readonly builtins = new WeakMap<SignalGetter<unknown>, SignalSetter<unknown>>();
  private readonly locals = new WeakMap<SignalGetter<unknown>, Local>();
  private readonly bindings = new WeakMap<() => unknown, Binding>();
  private readonly edits = new Map<SignalGetter<unknown>, Edit>();
  private readonly disposers: (() => void)[] = [];
  // alien-signals 3.1.2 Dirty/Pending, also used by effect.ts's self-write guard.
  private readonly readers: { flags: number }[] = [];

  constructor(private readonly island: ValidatedIsland) {
    checkIslandClaim(island);
    if (island.registration.mode !== 0) throw new AdoptionScopeError('FORMA_E_HYDRATE_STRUCTURE');
  }

  get phase(): Phase { return this.state; }

  private require(phase: Phase): void {
    if (this.state !== phase) throw new AdoptionScopeError('FORMA_E_HYDRATE_STRUCTURE');
  }

  /** Run one component/branch/row construction in an owned, synchronous scope. */
  run<T>(fn: () => T): T {
    this.require('preparing');
    let result!: T;
    let failed = false;
    let error: unknown;
    let dispose!: () => void;
    // Catch inside the raw scope so even a thrown component leaves us a disposer.
    // Verified by: src/reactive/__tests__/adoption-scope.test.ts > "a component throw disposes prior and partially constructed readers"
    withAdoptionSink(this, () => createUnownedRoot(rootDispose => {
      dispose = rootDispose;
      try { result = fn(); } catch (cause) { failed = true; error = cause; }
    }));
    if (this.state === 'aborted') dispose();
    else this.disposers.push(dispose);
    if (failed) {
      this.abort();
      throw error;
    }
    return result;
  }

  capture<T>(get: SignalGetter<T>, set: SignalSetter<T>): void {
    if (this.state === 'preparing') this.builtins.set(get, set as SignalSetter<unknown>);
  }

  enroll<T>(_site: number, [get, set]: [SignalGetter<T>, SignalSetter<T>]): void {
    if (this.state !== 'preparing' || this.builtins.get(get) !== set) return;
    this.locals.set(get, { get, set: set as SignalSetter<unknown> });
  }

  writable<T>(read: () => T, get: SignalGetter<T>, codec: AdoptionCodec, site: number): () => T {
    const local = this.locals.get(get);
    if (this.state !== 'preparing' || !local) return read;
    const wrapper = () => read();
    this.bindings.set(wrapper, { local, codec, site });
    return wrapper;
  }

  /** The planner calls this only after detecting a real normalized early edit. */
  queueEdit(read: () => unknown, value: unknown): void {
    this.require('preparing');
    try {
      const binding = this.bindings.get(read);
      if (!binding) throw new AdoptionScopeError('FORMA_E_HYDRATE_INPUT_TARGET');
      const before = untracked(binding.local.get);
      if (!accepts(binding.codec, value) || !accepts(binding.codec, before)) {
        throw new AdoptionScopeError('FORMA_E_HYDRATE_INPUT_TARGET', binding.site);
      }
      const prior = this.edits.get(binding.local.get);
      if (prior && (prior.codec !== binding.codec || !equal(prior.next, value))) {
        throw new AdoptionScopeError('FORMA_E_HYDRATE_INPUT_CONFLICT', binding.site);
      }
      if (!prior) this.edits.set(binding.local.get, { ...binding, before, baseline: copy(before), next: copy(value) });
    } catch (cause) {
      this.abort();
      throw cause;
    }
  }

  /** Track one initial reader while its eventual writer remains dormant. */
  observe<T>(read: () => T, write: (value: T) => void): T {
    this.require('preparing');
    let initial!: T;
    let first = true;
    let failed = false;
    let error: unknown;
    const dispose = rawEffect(() => {
      if (first) {
        first = false;
        this.readers.push(getActiveSub()!);
        // The effect constructor must return its disposer even on a throwing read.
        // Verified by: src/reactive/__tests__/adoption-scope.test.ts > "a throwing first reader removes its partial computed dependency"
        try { initial = read(); } catch (cause) { failed = true; error = cause; }
      } else if (this.state === 'live') {
        try { write(read()); } catch (cause) { this.abort(); reportError(cause, 'adoption binding'); }
      } else {
        this.invalidated = true;
      }
    });
    if (this.state === 'aborted') dispose();
    else this.disposers.push(dispose);
    if (failed) { this.abort(); throw error; }
    if (this.state === 'aborted') throw new AdoptionScopeError('FORMA_E_HYDRATE_STRUCTURE');
    return initial;
  }

  private checkPrepared(): void {
    checkIslandClaim(this.island);
    if (this.invalidated || this.readers.some(reader => (reader.flags & (16 | 32)) !== 0)) {
      throw new AdoptionScopeError('FORMA_E_HYDRATE_VALUE');
    }
  }

  seal(): void {
    this.require('preparing');
    try { this.checkPrepared(); this.state = 'validated'; }
    catch (cause) { this.abort(); throw cause; }
  }

  /** Hold the batch through the planner's final claim/range checks. */
  seed(): void {
    this.require('validated');
    try {
      this.checkPrepared();
      for (const edit of this.edits.values()) {
        if (!equal(untracked(edit.local.get), edit.baseline)) throw new AdoptionScopeError('FORMA_E_HYDRATE_VALUE', edit.site);
      }
      openBatch();
      this.batchOpen = true;
      this.state = 'seeding';
      for (const edit of this.edits.values()) edit.local.set(edit.next);
    } catch (cause) { this.abort(); throw cause; }
  }

  publish(): void {
    this.require('seeding');
    try {
      checkIslandClaim(this.island);
      this.state = 'live';
      this.edits.clear();
      this.closeBatch();
    } catch (cause) { this.abort(); throw cause; }
  }

  private closeBatch(): void {
    if (!this.batchOpen) return;
    this.batchOpen = false;
    closeBatchWithoutRoot();
  }

  abort(): void {
    if (this.state === 'aborted') return;
    const rollback = this.state === 'seeding';
    this.state = 'aborted';
    for (const dispose of this.disposers.splice(0)) dispose();
    // Only recorded default createSignal setters can reach this loop. Their
    // scalar/array values bypass updater functions and custom equality callbacks.
    // Verified by: src/reactive/__tests__/adoption-scope.test.ts > "rolls back built-in assignments before releasing the batch"
    if (rollback) for (const edit of this.edits.values()) edit.local.set(edit.before);
    this.edits.clear();
    this.readers.length = 0;
    this.closeBatch();
  }
}
