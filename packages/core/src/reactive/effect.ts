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
  runWithOwner,
  registerOwnerDisposer,
  createChildOwner,
  disposeOwner,
  type Owner,
} from './root.js';
import { setCleanupCollector } from './cleanup.js';
import { reportError } from './dev.js';
import { getAdoptionEvents, withAdoptionEvents } from './adoption-events.js';
import { deferAdoptionEffect, getAdoptionCallbacks, bindAdoptionCallback } from './adoption-hooks.js';

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

function runCleanup(fn: (() => void) | undefined): void {
  if (fn === undefined) return;
  try {
    fn();
  } catch (e) {
    reportError(e, 'effect cleanup');
  }
}

function runCleanups(bag: (() => void)[] | undefined): void {
  if (bag === undefined) return;
  for (let i = 0; i < bag.length; i++) {
    try { bag[i]!(); } catch (e) { reportError(e, 'effect cleanup'); }
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

function createEffectNow(fn: () => void | (() => void), failure?: (error: unknown) => void, initialThrow = false): () => void {
  // Capture the owner active at creation time so this effect's disposer is owned
  // by whatever created it — a root, or (for a nested effect) the parent effect's
  // current child-owner. This replaces a hasActiveRoot() snapshot so nested
  // effects created during a parent re-run (when no root is lexically active) are
  // still owned and disposed.
  const ownerAtCreate = getOwner();
  const callbacks = getAdoptionCallbacks();
  const runCallback = bindAdoptionCallback(fn, callbacks);
  const events = getAdoptionEvents();

  // This effect owns its nested effects/roots via a reusable child-owner: it is
  // disposed (nested cleanups run) at the top of each run and on disposal, then
  // reused for the next generation. One small allocation per createEffect; the
  // ordinary CSR DOM path uses internalEffect without a child-owner. Adopted
  // internal bindings use this owner too, since readers can construct callbacks.
  const childOwner: Owner = createChildOwner();
  const internalReader = failure ? (reader: () => void) => createEffectNow(reader, failure, true) : undefined;

  // Most effects have zero or one cleanup. Track the single-cleanup case
  // without array allocation; only promote to pooled array when needed.
  let cleanup: (() => void) | undefined;
  let cleanupBag: (() => void)[] | undefined;
  let nextCleanup: (() => void) | undefined;
  let nextCleanupBag: (() => void)[] | undefined;
  let disposed = false;
  let firstRun = true;
  let initialError: {error:unknown}|undefined;

  const addCleanup = (cb: () => void) => {
    cb = bindAdoptionCallback(cb, callbacks);
    if (nextCleanupBag !== undefined) {
      nextCleanupBag.push(cb);
      return;
    }
    if (nextCleanup !== undefined) {
      const bag = acquireArray();
      bag.push(nextCleanup, cb);
      nextCleanup = undefined;
      nextCleanupBag = bag;
      return;
    }
    nextCleanup = cb;
  };

  const cleanCurrentRun = () => {
    // Dispose the previous generation of nested effects/roots (running their
    // cleanups) FIRST — children before parents, matching wrappedDispose so the
    // teardown order is consistent between the re-run and dispose paths and a
    // nested cleanup never observes parent-owned state already freed. (alien's
    // raw unwatched teardown of a nested effect bypasses our cleanup, so we own
    // nested work explicitly.)
    disposeOwner(childOwner);

    // Run and clear this effect's own previous cleanups.
    if (cleanup !== undefined) {
      runCleanup(cleanup);
      cleanup = undefined;
    }
    if (cleanupBag !== undefined) {
      runCleanups(cleanupBag);
      releaseArray(cleanupBag);
      cleanupBag = undefined;
    }
  };

  const runOnce = () => {
    const initial = firstRun; firstRun = false;
    cleanCurrentRun();

    nextCleanup = undefined;
    nextCleanupBag = undefined;

    // Always install the collector so onCleanup()/returned cleanups are captured
    // on EVERY run. (The old skipCleanupInfra fast-path latched after a clean
    // first run and then silently dropped — or cross-registered — cleanups
    // registered on later runs.) The single-cleanup/pooled-array promotion below
    // keeps the zero/one-cleanup case allocation-free.
    const prevCollector = setCleanupCollector(addCleanup);
    const previousFailure = adoptionFailure;
    const previousReader = adoptionInternalEffect;
    adoptionFailure = failure;
    adoptionInternalEffect = internalReader;

    try {
      // Run the body with this effect's child-owner installed so any nested
      // effects/roots it creates are owned by this generation.
      const result = withAdoptionEvents(events, () => runWithOwner(childOwner, runCallback));
      if (typeof result === 'function') {
        addCleanup(result as () => void);
      }
      // Commit this run's cleanups. When none were registered, both stay
      // undefined (allocation-free).
      if (nextCleanupBag !== undefined) {
        cleanupBag = nextCleanupBag;
      } else if (nextCleanup !== undefined) {
        cleanup = nextCleanup;
      }
    } catch (e) {
      if (nextCleanupBag !== undefined) {
        cleanupBag = nextCleanupBag;
      } else if (nextCleanup !== undefined) {
        cleanup = nextCleanup;
      }
      // Let the engine return its disposer even when the first reader throws.
      // A caught construction error must not leave a subscribed failed effect.
      // Verified by: src/dom/__tests__/reviewer-adoption-caught-construction.test.ts > "a caught initial h reader failure unsubscribes its failed binding and preserves its live owner"
      if (initialThrow && initial) { initialError={error:e}; return false; }
      if (failure) { failure(e); return false; }
      else reportError(e, 'effect');
    } finally {
      setCleanupCollector(prevCollector);
      adoptionFailure = previousFailure;
      adoptionInternalEffect = previousReader;
      // A nested callback can abort this island while this body is still on
      // the stack. JavaScript then continues the body: drain roots/effects and
      // cleanups created AFTER wrappedDispose's first synchronous teardown.
      if (disposed) cleanCurrentRun();
    }
  };

  const safeFn = () => {
    // alien-signals sets activeSub to this effect's node for the duration of this
    // callback, so getActiveSub() is our own node. If the body writes a signal we
    // depend on, alien-signals marks this node Pending but skips the re-run; we
    // detect that and run again, bounded so a genuine cycle is reported instead of
    // hanging.
    const node = getActiveSub() as SubNode | undefined;
    let reentrantRuns = 0;
    do {
      if (node) node.flags &= ~PENDING; // clear before running so we detect a fresh set
      if (runOnce() === false || disposed) break;
      if (node === undefined || (node.flags & PENDING) === 0) break;
      if (++reentrantRuns >= MAX_REENTRANT_RUNS) {
        node.flags &= ~PENDING;
        const error = new Error(`createEffect exceeded ${MAX_REENTRANT_RUNS} self-triggered re-runs (cycle?)`);
        if (failure) failure(error);
        else reportError(error, 'effect');
        break;
      }
    } while (true);
  };

  const dispose = rawEffect(safeFn);

  // Wrap dispose to also run final cleanups
  const wrappedDispose = () => {
    if (disposed) return;
    disposed = true;
    dispose();
    // Dispose nested effects/roots this effect owns, then run its own cleanups.
    cleanCurrentRun();
  };

  if(initialError){wrappedDispose();throw initialError.error;}

  // Register this effect's disposer with the owner active at creation (a root, or
  // a parent effect's child-owner).
  if (ownerAtCreate) {
    registerOwnerDisposer(ownerAtCreate, wrappedDispose);
  }

  return wrappedDispose;
}
