/**
 * Forma Reactive - Effect
 *
 * Side-effectful reactive computation that auto-tracks signal dependencies.
 * Backed by alien-signals for automatic dependency tracking.
 *
 * TC39 Signals equivalent: Signal.subtle.Watcher (effect is a userland concept)
 */

import { effect as rawEffect } from 'alien-signals';
import { startEffectNode, stopEffectNode, type EffectNode } from './effect-node.js';
import {
  hasActiveRoot,
  registerDisposer,
  getOwner,
  type Owner,
} from './root.js';
import { setExecutionContext } from './cleanup.js';
import { reportError } from './dev.js';
import { getAdoptionEvents, withAdoptionEvents } from './adoption-events.js';
import { deferAdoptionEffect, getAdoptionCallbacks, withAdoptionCallbacks, bindAdoptionCallback, runAdoptionCallback } from './adoption-hooks.js';

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
  adoptionInternalEffect = reader => createOwnedEffect(reader, failure, true);
  try { return fn(); } finally {
    adoptionFailure = previous;
    adoptionInternalEffect = previousReader;
  }
}

// ---------------------------------------------------------------------------
// Cleanup arrays are lazy and retained by their effect across generations.
// An effect without cleanup never allocates one.
// ---------------------------------------------------------------------------
const enum EffectLimit { ReentrantRuns = 100 }

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
const enum ReactiveFlag { Pending = 32 }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
export function createEffect(fn: () => void | (() => void)): () => void {
  const deferred = deferAdoptionEffect(fn, createOwnedEffect);
  if (deferred != null) return deferred;
  const owner = getOwner();
  if (owner) return createParentedEffect(fn, owner);
  return new EffectState(fn, adoptionFailure, false, runPlainEffect).start();
}

function createParentedEffect(fn: () => void | (() => void), owner: Owner): () => void {
  const dispose = new EffectState(fn, adoptionFailure, false, runPlainEffect).start();
  owner.disposers.push(dispose);
  return dispose;
}

// One record is both the engine subscriber and its Forma generation owner.
// Children and cleanup are allocated only when used; the ordinary record keeps
// a stable function-valued own slot for the native callback. Slow-only imports
// do not retain the public factory's plain runner.
type Cleanup = (() => void)[] | undefined;
// A single inert instance keeps this constructor's graph-node map reachable
// across GC. It never enters the graph or captures caller authority. The
// scoped setters restore ambient values; this initializer is safe to erase
// when the whole public/adopted effect class is unused by an entry point.
class EffectState implements Owner, EffectNode {
  private static readonly shapeAnchor = /* @__PURE__ */ withAdoptionCallbacks(undefined, () =>
    withAdoptionEvents(undefined, () => {
      const anchor = new this(() => {}, undefined, false);
      anchor.disposed = true;
      return anchor;
    }));

  fn: () => void;
  flags = 2 | 4;
  deps: EffectNode['deps'] = undefined;
  depsTail: EffectNode['depsTail'] = undefined;
  subs: EffectNode['subs'] = undefined;
  subsTail: EffectNode['subsTail'] = undefined;
  declare ownerOverride: Owner | null | undefined;
  get owner(): Owner | null { return this.ownerOverride === undefined ? this : this.ownerOverride; }
  set owner(owner: Owner | null) { this.ownerOverride = owner === this ? undefined : owner; }
  declare slow: boolean | undefined;
  // Optional state is installed only when used. A leaf reader retains just its
  // user callback and graph links, rather than empty slots for
  // cleanup, children, initial errors and adoption capabilities.
  declare children: (() => void)[] | undefined;
  declare cleanup: Cleanup;
  declare nextCleanup: Cleanup;
  declare disposed: boolean | undefined;
  declare initialError: { error: unknown } | undefined;
  declare callbacks: ReturnType<typeof getAdoptionCallbacks>;
  declare events: ReturnType<typeof getAdoptionEvents>;
  declare reader: ((fn: () => void) => () => void) | undefined;
  declare failure: ((error: unknown) => void) | undefined;
  declare initialThrow: boolean | undefined;

  constructor(
    public callback: () => void | (() => void),
    failure: ((error: unknown) => void) | undefined,
    initialThrow: boolean | undefined,
    run?: (this: EffectState) => void,
  ) {
    this.fn = run ?? this.run;
    const callbacks = getAdoptionCallbacks(), events = getAdoptionEvents();
    if (callbacks || events || failure || initialThrow) this.slow = true;
    if (callbacks) this.callbacks = callbacks;
    if (events) this.events = events;
    if (initialThrow) this.initialThrow = true;
    if (failure) {
      this.failure = failure;
      this.reader = fn => createOwnedEffect(fn, failure, true);
    }
  }

  get disposers(): (() => void)[] { this.slow = true; return this.children ??= []; }

  addCleanup(callback: () => void): void {
    this.slow = true;
    (this.nextCleanup ??= []).push(callback);
  }

  clean(): void {
    // Children before parents, including children registered during teardown.
    if (this.children) {
      for (const dispose of this.children) {
        try { dispose(); } catch { /* continue tearing down this generation */ }
      }
      this.children.length = 0;
    }
    const cleanup = this.cleanup;
    if (cleanup !== undefined) {
      for (const callback of cleanup) {
        try { runAdoptionCallback(callback, this.callbacks); } catch (error) { reportError(error, 'effect cleanup'); }
      }
      cleanup.length = 0;
      this.cleanup = undefined;
    }
  }


  run(reentrantRuns = 0): void {
    const node = this;
    do {
      node.flags &= ~ReactiveFlag.Pending;
      const initialThrow = this.initialThrow;
      if (initialThrow) this.initialThrow = false;
      this.clean();
      const previousContext = setExecutionContext(this);
      const previousFailure = adoptionFailure, previousReader = adoptionInternalEffect;
      const boundary = this.failure !== previousFailure;
      if (boundary) { adoptionFailure = this.failure; adoptionInternalEffect = this.reader; }
      let failed = false;
      try {
        const fn = this.callback;
        // A synchronously flushed ordinary neighbor still gets mode isolation,
        // never the adopted caller's authority. The usual path has no wrapper.
        const cleanup = this.callbacks || this.events || getAdoptionCallbacks() || getAdoptionEvents()
          ? withAdoptionEvents(this.events, () => runAdoptionCallback(fn, this.callbacks))
          : fn();
        if (typeof cleanup === 'function') this.addCleanup(cleanup);
        this.cleanup = this.nextCleanup;
      } catch (error) {
        this.cleanup = this.nextCleanup;
        // Reporters execute with the caller's owner but this run's collector.
        this.owner = previousContext.owner;
        try {
          if (initialThrow) { this.initialError = {error}; failed = true; }
          else if (this.failure) { this.failure(error); failed = true; }
          else reportError(error, 'effect');
        } finally {
          this.owner = this;
          // A reporter can allocate the first collector or dispose this effect.
          // Commit its cleanup before the outer finally drains a stopped run.
          this.cleanup = this.nextCleanup;
        }
      } finally {
        setExecutionContext(previousContext);
        if (boundary) { adoptionFailure = previousFailure; adoptionInternalEffect = previousReader; }
        // Abort can occur while the body is still executing. Drain work that
        // was created after the first synchronous disposal too.
        if (this.disposed) this.clean();
      }
      if (failed || this.disposed || !(node.flags & ReactiveFlag.Pending)) break;
      if (++reentrantRuns >= EffectLimit.ReentrantRuns) {
        node.flags &= ~ReactiveFlag.Pending;
        const error = new Error(`createEffect exceeded ${EffectLimit.ReentrantRuns} self-triggered re-runs (cycle?)`);
        if (this.failure) this.failure(error);
        else reportError(error, 'effect');
        break;
      }
    } while (true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    stopEffectNode(this);
    this.clean();
    // The body may still be collecting this generation's cleanup. Its finally
    // commits and drains that array, including work registered after disposal.
  }

  start(): () => void {
    startEffectNode(this);
    if (this.initialError) { this.dispose(); throw this.initialError.error; }
    return this.dispose.bind(this);
  }

}

function runPlainEffect(this: EffectState): void {
  if (this.slow || getAdoptionCallbacks() || getAdoptionEvents() || adoptionFailure) return this.run();
  // alien-signals 3.1.2 esm/index.mjs: effect() and run() enter callbacks
  // with Watching | Recursed (Pending clear), checked by effect-engine-contract.
  // Reentrant executions go through run(), which clears it each turn.
  const previous = setExecutionContext(this), node = this;
  try {
    const fn = this.callback, cleanup = fn();
    if (typeof cleanup === 'function') this.addCleanup(cleanup);
    if (this.nextCleanup) this.cleanup = this.nextCleanup;
  } catch (error) {
    if (this.nextCleanup) this.cleanup = this.nextCleanup;
    this.owner = previous.owner;
    try { reportError(error, 'effect'); } finally {
      this.owner = this;
      this.cleanup = this.nextCleanup;
    }
  } finally {
    setExecutionContext(previous);
    if (this.disposed) this.clean();
  }
  if (!this.disposed && (node.flags & ReactiveFlag.Pending)) this.run(1);
}

function createOwnedEffect(fn: () => void | (() => void), failure?: (error: unknown) => void, initialThrow?: boolean): () => void {
  const owner = getOwner();
  const dispose = new EffectState(fn, failure, initialThrow).start();
  if (owner) owner.disposers.push(dispose);
  return dispose;
}
