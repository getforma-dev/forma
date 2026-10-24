/**
 * Forma Reactive - Effect
 *
 * Side-effectful reactive computation that auto-tracks signal dependencies.
 * Backed by alien-signals for automatic dependency tracking.
 *
 * TC39 Signals equivalent: Signal.subtle.Watcher (effect is a userland concept)
 */

import { effect as rawEffect, getActiveSub } from 'alien-signals';
import {
  hasActiveRoot,
  registerDisposer,
  getOwner,
  registerOwnerDisposer,
  type Owner,
} from './root.js';
import { setExecutionContext } from './cleanup.js';
import { reportError } from './dev.js';
import { getAdoptionEvents, withAdoptionEvents } from './adoption-events.js';
import { deferAdoptionEffect, getAdoptionCallbacks, bindAdoptionCallback, runAdoptionCallback, type AdoptionCallbackRunner } from './adoption-hooks.js';

declare const __FORMA_FRAME_BUILD__: boolean | undefined;

// A live adopted callback's nested effects inherit its failure boundary. This
// is dynamically scoped around execution and restored even when it throws.
let adoptionFailure: ((error: unknown) => void) | undefined;
// Only actual adoption consumers install the heavy reader implementation.
// Ordinary runtime entries can invoke this context without retaining it.
// Verified by: src/reactive/__tests__/effect-dependency.test.ts > "keeps the ordinary runtime reader reactive without retaining the public effect implementation"
let adoptionInternalEffect: ((fn: () => void) => () => void) | undefined;

/** @internal A committed ref may construct effects owned by the same island. */
export function withAdoptionEffectFailure<T>(failure: (error: unknown) => void, fn: () => T): T {
  const previous = adoptionFailure;
  const previousReader = adoptionInternalEffect;
  adoptionFailure = failure;
  adoptionInternalEffect = reader => createEffectNow(reader, failure, true);
  try { return fn(); } finally {
    adoptionFailure = previous;
    adoptionInternalEffect = previousReader;
  }
}

// ---------------------------------------------------------------------------
// Cleanup array pool — avoids allocating a new array every effect re-run
// ---------------------------------------------------------------------------

const POOL_SIZE = 32;
const MAX_REENTRANT_RUNS = 100;
// Allocate slots only when the public effect path uses them. A top-level
// fill loop would survive in runtime bundles that do not use this pool.
const pool: (() => void)[][] = [];
let poolIdx = POOL_SIZE;

// ---------------------------------------------------------------------------
// Self-write detection — alien-signals' propagate() never notifies a subscriber
// that is currently running, so an effect writing a signal it depends on is left
// stale. When that happens alien-signals still sets the Pending flag on the
// running subscriber's node (but skips the re-run). We read that flag on the
// EFFECT's own node after each run and loop, so a self-dependent effect
// converges. Reading the effect's own node (not a global) makes this precise:
// writes to signals the effect does not depend on, writes from a nested computed,
// and a nested effect's self-write never set THIS node's Pending, so they cause
// no spurious re-run. It also works through batch() (Pending is set at flush).
// ---------------------------------------------------------------------------

// alien-signals ReactiveFlags.Pending (not exported from the package root).
const PENDING = 32;

interface SubNode { flags: number; }

function acquireArray(): (() => void)[] {
  if (poolIdx > 0) {
    const arr = pool[--poolIdx] ?? [];
    arr.length = 0;
    return arr;
  }
  return [];
}

function releaseArray(arr: (() => void)[]): void {
  arr.length = 0;
  if (poolIdx < POOL_SIZE) {
    pool[poolIdx++] = arr;
  }
}

// ---------------------------------------------------------------------------
// Unified cleanup runner — single function for both re-run and dispose paths
// ---------------------------------------------------------------------------

function runCleanup(fn: (() => void) | undefined, callbacks: AdoptionCallbackRunner | undefined): void {
  if (fn === undefined) return;
  try {
    runAdoptionCallback(fn, callbacks);
  } catch (e) {
    reportError(e, 'effect cleanup');
  }
}

function runCleanups(bag: (() => void)[] | undefined, callbacks: AdoptionCallbackRunner | undefined): void {
  if (bag === undefined) return;
  for (let i = 0; i < bag.length; i++) {
    try { runAdoptionCallback(bag[i]!, callbacks); } catch (e) { reportError(e, 'effect cleanup'); }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a reactive effect that auto-tracks signal dependencies.
 *
 * The provided function runs immediately and re-runs whenever any signal it
 * reads changes. If the function returns a cleanup function, that cleanup is
 * called before each re-run and on disposal.
 *
 * Additionally, `onCleanup()` can be called inside the effect to register
 * cleanup functions composably.
 *
 * Returns a dispose function that stops the effect.
 */
/**
 * @internal — Lightweight effect for Forma's internal DOM bindings.
 *
 * Ordinary CSR bindings bypass createEffect's cleanup infrastructure. A live
 * adopted binding instead retains a generation owner and failure boundary,
 * because its reader can construct nodes and callbacks on a later run.
 *
 * ONLY use for effects that:
 * 1. Never call onCleanup()
 * 2. Never return a cleanup function
 * 3. Contain simple "read signal → write DOM" logic
 *
 * Error handling is split by run:
 * - The FIRST run is synchronous inside the caller (h(), adoption, mount), so a
 *   throw propagates to that caller. Island activation wraps that call in
 *   try/catch, so a component whose binding throws while being built is marked
 *   `status="error"` with its SSR content intact, instead of half-built.
 * - Every LATER run happens inside alien-signals' flush, which is driven by a
 *   signal write that may come from completely unrelated code. A throw there
 *   aborts the flush: the remaining queued bindings are skipped and the
 *   exception surfaces at the setter's call site, so one broken binding would
 *   silently freeze every other island subscribed to that signal. Re-run errors
 *   are therefore caught and routed to reportError()/onError() and the flush
 *   continues.
 *
 * Verified by: src/reactive/__tests__/effect.test.ts > "a binding that throws on re-run does not abort the flush for other bindings"
 * Verified by: src/reactive/__tests__/effect.test.ts > "a binding that throws on its first run still propagates to the caller"
 * Verified by: src/dom/__tests__/hydrate.test.ts > "a binding that throws while being built fails only its own island"
 * Verified by: src/dom/__tests__/hydrate.test.ts > "a binding that throws on a shared-signal update does not freeze the other island"
 */
export function internalEffect(fn: () => void): () => void {
  // Adopted live readers can construct nodes, listeners and nested work. Reuse
  // the effect generation owner/failure boundary while retaining initial throw.
  // Verified by: src/dom/__tests__/reviewer-events-internal-generation.test.ts > "revokes removed public h function-child listeners and their callback resources on each generation"
  // The frame has no adopted regions; keep its ordinary reader independent
  // of the adoption-only effect owner and event context. Undefined flags keep
  // raw-source tooling on the normal path.
  // Verified by: src/reactive/__tests__/frame-effect.test.ts > "keeps the frame reader reactive and disposable without linking the unused adoption effect graph"
  if (!(typeof __FORMA_FRAME_BUILD__ === 'boolean' && __FORMA_FRAME_BUILD__) && adoptionInternalEffect) return adoptionInternalEffect(fn);
  const events = (typeof __FORMA_FRAME_BUILD__ === 'boolean' && __FORMA_FRAME_BUILD__) ? undefined : getAdoptionEvents();
  const callback = (typeof __FORMA_FRAME_BUILD__ === 'boolean' && __FORMA_FRAME_BUILD__) ? fn : bindAdoptionCallback(fn, getAdoptionCallbacks());
  const run = (typeof __FORMA_FRAME_BUILD__ === 'boolean' && __FORMA_FRAME_BUILD__) ? fn : () => withAdoptionEvents(events, callback);
  let firstRun = true;
  const dispose = rawEffect(() => {
    if (firstRun) {
      firstRun = false;
      run();
      return;
    }
    try {
      run();
    } catch (e) {
      reportError(e, 'binding');
    }
  });
  if (hasActiveRoot()) {
    registerDisposer(dispose);
  }
  return dispose;
}

export function createEffect(fn: () => void | (() => void)): () => void {
  return deferAdoptionEffect(fn, createEffectNow) ?? createEffectNow(fn, adoptionFailure);
}

// The effect record is also its generation owner. Its disposer array is allocated
// only when nested work registers; an ordinary signal reader has no child owner
// allocation and never traverses disposeOwner's empty array.
type Cleanup = (() => void) | (() => void)[] | undefined;
class EffectState implements Owner {
  owner: Owner | null = this;
  declare private slow: boolean | undefined;
  // Optional state is installed only when used. A leaf reader retains just its
  // callback, ownership context and engine disposer, rather than empty slots for
  // cleanup, children, initial errors and adoption capabilities.
  declare private children: (() => void)[] | undefined;
  declare private cleanup: Cleanup;
  declare private nextCleanup: Cleanup;
  declare private disposed: boolean | undefined;
  declare private initialError: { error: unknown } | undefined;
  declare private stop: () => void;
  declare private callbacks: ReturnType<typeof getAdoptionCallbacks>;
  declare private events: ReturnType<typeof getAdoptionEvents>;
  declare private reader: ((fn: () => void) => () => void) | undefined;
  declare private failure: ((error: unknown) => void) | undefined;
  declare private initialThrow: boolean | undefined;

  constructor(
    private fn: () => void | (() => void),
    failure: ((error: unknown) => void) | undefined,
    initialThrow: boolean,
  ) {
    const callbacks = getAdoptionCallbacks(), events = getAdoptionEvents();
    if (callbacks || events || failure || initialThrow) this.slow = true;
    if (callbacks) this.callbacks = callbacks;
    if (events) this.events = events;
    if (initialThrow) this.initialThrow = true;
    if (failure) {
      this.failure = failure;
      this.reader = fn => createEffectNow(fn, failure, true);
    }
  }

  get disposers(): (() => void)[] { this.slow = true; return this.children ??= []; }

  addCleanup(callback: () => void): void {
    this.slow = true;
    if (this.nextCleanup === undefined) this.nextCleanup = callback;
    else if (typeof this.nextCleanup === 'function') {
      const bag = acquireArray();
      bag.push(this.nextCleanup, callback);
      this.nextCleanup = bag;
    } else this.nextCleanup.push(callback);
  }

  private clean(): void {
    // Children before parents, including children registered during teardown.
    if (this.children) {
      for (const dispose of this.children) {
        try { dispose(); } catch { /* continue tearing down this generation */ }
      }
      this.children.length = 0;
    }
    const cleanup = this.cleanup;
    if (cleanup !== undefined) {
      if (typeof cleanup === 'function') runCleanup(cleanup, this.callbacks);
      else { runCleanups(cleanup, this.callbacks); releaseArray(cleanup); }
      this.cleanup = undefined;
    }
  }

  runPlain(): void {
    if (this.slow || getAdoptionCallbacks() || getAdoptionEvents() || adoptionFailure) return this.run();
    const previous = setExecutionContext(this), node = getActiveSub() as SubNode;
    node.flags &= ~PENDING;
    try {
      const fn = this.fn, cleanup = fn();
      if (typeof cleanup === 'function') this.addCleanup(cleanup);
      if (this.nextCleanup) this.cleanup = this.nextCleanup;
    } catch (error) {
      if (this.nextCleanup) this.cleanup = this.nextCleanup;
      this.owner = previous.owner;
      try { reportError(error, 'effect'); } finally { this.owner = this; }
    } finally {
      setExecutionContext(previous);
      if (this.disposed) this.clean();
    }
    if (!this.disposed && (node.flags & PENDING)) this.run(1);
  }

  run(reentrantRuns = 0): void {
    const node = getActiveSub() as SubNode | undefined;
    do {
      if (node) node.flags &= ~PENDING;
      const initialThrow = this.initialThrow;
      if (initialThrow) this.initialThrow = false;
      if (this.children || this.cleanup) this.clean();
      if (this.nextCleanup) this.nextCleanup = undefined;
      const previousContext = setExecutionContext(this);
      const previousFailure = adoptionFailure, previousReader = adoptionInternalEffect;
      const boundary = this.failure !== previousFailure;
      if (boundary) { adoptionFailure = this.failure; adoptionInternalEffect = this.reader; }
      let failed = false;
      try {
        const fn = this.fn;
        // A synchronously flushed ordinary neighbor still gets mode isolation,
        // never the adopted caller's authority. The usual path has no wrapper.
        const cleanup = this.callbacks || this.events || getAdoptionCallbacks() || getAdoptionEvents()
          ? withAdoptionEvents(this.events, () => runAdoptionCallback(fn, this.callbacks))
          : fn();
        if (typeof cleanup === 'function') this.addCleanup(cleanup);
        if (this.nextCleanup) this.cleanup = this.nextCleanup;
      } catch (error) {
        if (this.nextCleanup) this.cleanup = this.nextCleanup;
        // Reporters execute with the caller's owner but this run's collector.
        this.owner = previousContext.owner;
        try {
          if (initialThrow) { this.initialError = {error}; failed = true; }
          else if (this.failure) { this.failure(error); failed = true; }
          else reportError(error, 'effect');
        } finally { this.owner = this; }
      } finally {
        setExecutionContext(previousContext);
        if (boundary) { adoptionFailure = previousFailure; adoptionInternalEffect = previousReader; }
        // Abort can occur while the body is still executing. Drain work that
        // was created after the first synchronous disposal too.
        if (this.disposed) this.clean();
      }
      if (failed || this.disposed || !node || !(node.flags & PENDING)) break;
      if (++reentrantRuns >= MAX_REENTRANT_RUNS) {
        node.flags &= ~PENDING;
        const error = new Error(`createEffect exceeded ${MAX_REENTRANT_RUNS} self-triggered re-runs (cycle?)`);
        if (this.failure) this.failure(error);
        else reportError(error, 'effect');
        break;
      }
    } while (true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.clean();
  }

  start(): () => void {
    this.stop = rawEffect((this.initialThrow || this.failure ? this.run : this.runPlain).bind(this));
    if (this.initialError) { this.dispose(); throw this.initialError.error; }
    return this.dispose.bind(this);
  }
}

function createEffectNow(fn: () => void | (() => void), failure?: (error: unknown) => void, initialThrow = false): () => void {
  const owner = getOwner();
  const dispose = new EffectState(fn, failure, initialThrow).start();
  if (owner) registerOwnerDisposer(owner, dispose);
  return dispose;
}
