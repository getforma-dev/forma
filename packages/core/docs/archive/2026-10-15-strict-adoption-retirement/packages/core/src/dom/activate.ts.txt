/**
 * Forma DOM - Island Activation
 *
 * Discovers SSR-rendered islands via [data-forma-island] attributes,
 * preflights the head state against compiled contracts, and hydrates each island inside
 * an independent createRoot scope with try/catch error isolation.
 */

import { createUnownedRoot, __DEV__ } from 'forma/reactive';
import { hydrateIslandOrFail, isHydrateError, reportHydrateError } from './hydrate.js';
import { preflightIslands, checkIslandClaim, type ValidatedIsland } from './island-state.js';

/**
 * Function that hydrates an island.
 *
 * @param el     The root element of the island (`[data-forma-island]`).
 *               Useful for layout measurement, focus management, CSS class
 *               toggling, third-party library init, or reading extra `data-*`
 *               attributes from the server-rendered shell.
 * @param props  Fresh declared props from the checked head state. Compiler
 *               registrations pass this object to the original unary component.
 * @returns      A component tree (from `h()` calls) for descriptor-based
 *               hydration, or `undefined` for imperative islands that set up
 *               their own effects.
 */
export type IslandHydrateFn = (el: HTMLElement, props: Record<string, unknown> | null) => unknown;

const FORBIDDEN_PROP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ---------------------------------------------------------------------------
// Scheduled-or-active island count
// ---------------------------------------------------------------------------

/**
 * How many islands currently hold state that {@link deactivateIsland} would
 * have to tear down: a deferred trigger's IntersectionObserver, idle timer or
 * interaction listeners, or a hydrated island's reactive root.
 *
 * This exists so `deactivateIslandsIn` (src/dom/list.ts) can decide with an
 * integer compare whether a departing list row can possibly contain an island,
 * instead of running `querySelectorAll('[data-forma-island]')` over every
 * removed row on every page. An island cannot acquire any of that state without
 * going through {@link activateIslands} — which is the only caller of
 * `hydrateIslandRoot` — so zero here means no element anywhere has anything to
 * deactivate, and the scan is provably wasted work.
 *
 * The per-element `__formaTracked` marker is what keeps the count honest: both
 * transitions are idempotent per element, so re-activating an island cannot
 * inflate the count (which would silently restore the scan cost) and the
 * deliberately-idempotent `deactivateIsland` cannot drive it below the number
 * of islands still live (which would silently restore the leak).
 *
 * Verified by: src/dom/__tests__/list-disposal.test.ts > "does not scan a removed row when no island has ever been activated"
 * Verified by: src/dom/__tests__/list-disposal.test.ts > "still deactivates a live island after a different island was deactivated"
 * Verified by: src/dom/__tests__/list-disposal.test.ts > "still deactivates a live island after the same island was deactivated twice"
 */
let scheduledOrActiveIslands = 0;

function trackIsland(el: Element): void {
  if ((el as any).__formaTracked) return;
  (el as any).__formaTracked = true;
  scheduledOrActiveIslands++;
}

function untrackIsland(el: Element): void {
  if (!(el as any).__formaTracked) return;
  delete (el as any).__formaTracked;
  scheduledOrActiveIslands--;
}

/**
 * @internal — true when at least one island is scheduled or active anywhere.
 *
 * Verified by: src/dom/__tests__/list-disposal.test.ts > "stops scanning once every island has been deactivated with deactivateAllIslands"
 */
export function hasScheduledOrActiveIslands(): boolean {
  return scheduledOrActiveIslands > 0;
}

/**
 * Strip `__proto__` / `constructor` / `prototype` keys from an island props
 * object **at every depth**, in place.
 *
 * The compiled state decoder projects only declared safe fields into fresh
 * objects. This standalone helper remains available for application data that
 * reaches code by other means; it is not an SSR state fallback.
 *
 * It runs after `JSON.parse` rather than as its reviver: V8 applies a reviver
 * recursively and overflows the stack near 5,000 levels of nesting, where
 * `JSON.parse` alone parses 100,000. This pass is iterative with an explicit
 * stack and a WeakSet, so neither deeply nested nor cyclic props can overflow
 * the stack or loop forever.
 *
 * Verified by: src/dom/__tests__/activate-isolation.test.ts > "sanitizePropsDeep strips forbidden keys at every depth"
 * Verified by: src/dom/__tests__/activate-isolation.test.ts > "sanitizePropsDeep terminates on cyclic props"
 */
export function sanitizePropsDeep<T>(props: T): T {
  const stack: unknown[] = [props];
  const seen = new WeakSet<object>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);

    for (const key of FORBIDDEN_PROP_KEYS) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        const desc = Object.getOwnPropertyDescriptor(current, key);
        // A non-configurable key cannot be deleted; skipping it beats throwing.
        if (desc?.configurable) delete (current as Record<string, unknown>)[key];
      }
    }

    for (const k of Object.keys(current as Record<string, unknown>)) {
      stack.push((current as Record<string, unknown>)[k]);
    }
  }

  return props;
}

/**
 * Discover and activate all SSR-rendered islands on the page.
 *
 * Each island is activated inside its own createRoot scope with try/catch
 * isolation — a broken island never takes down its siblings.
 *
 * @param registry  Own component names with compiler-bound registrations.
 * @param root      Requested subtree (defaults to document). Identity and state
 *                  authority are always frozen across the original Document.
 *                  A shadow-only or later-injected host has no original claim.
 *
 * Verified by: src/dom/__tests__/activate.test.ts > "error in island 0 does not prevent island 1 from activating"
 */
export function activateIslands(
  // Source registries contain declared unary components; compiler output
  // contains branded internal callbacks. This opaque callable constraint
  // accepts either without pretending their parameter types are identical.
  // Only preflight may recover a registered callback and invoke its signature.
  registry: Record<string, (...args: never[]) => unknown>,
  root: ParentNode = document,
): void {
  // Materialize every requested result before running any component or arming
  // any trigger. An earlier component cannot alter a later host's input state.
  const checked = preflightIslands(registry, root);
  for (const result of checked) {
    if ('error' in result) { console.error(result.error.message); continue; }
    const value = result.value;
    const island = value.host;
    // Skip islands already processed or with a deferred trigger already
    // scheduled, so a second activateIslands() (HMR / SPA re-mount) does not
    // double-hydrate, double-bind handlers, or double-register observers. A
    // freshly re-rendered island (status reset to 'pending', no scheduled
    // marker) re-activates.
    // Verified by: src/dom/__tests__/activate-reactivate.test.ts > "does not re-run a load island when activateIslands is called twice"
    // Verified by: src/dom/__tests__/activate-reactivate.test.ts > "does not attach duplicate handlers on re-activation"
    // Verified by: src/dom/__tests__/activate-reactivate.test.ts > "does not double-register a visible-trigger observer on re-invocation"
    // Verified by: src/dom/__tests__/activate-reactivate.test.ts > "re-activates a freshly re-rendered island (status reset to pending)"
    const status = island.getAttribute('data-forma-status');
    if (status === 'active' || status === 'hydrating' || status === 'disposed' || status === 'error') continue;
    if ((island as any).__formaScheduled) continue;

    // The previous component (or a diagnostic callback) may have changed a
    // later host since the all-host preflight. Refuse before retaining work.
    try { checkIslandClaim(value); } catch (error) {
      console.error(error instanceof Error ? error.message : error); continue;
    }
    delete (island as any).__formaDisposed;

    // From here every branch either schedules deferred work or hydrates, so the
    // island now has something to tear down and must be counted. Every exit —
    // deactivateIsland, deactivateAllIslands, disposal of a row containing it,
    // and the failed-hydration path below — untracks it again.
    trackIsland(island);

    const trigger = island.getAttribute('data-forma-hydrate') || 'load';

    if (trigger === 'visible') {
      // Defer hydration until island enters the viewport
      (island as any).__formaScheduled = true;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.disconnect();
            delete (island as any).__formaObserver;
            hydrateIslandRoot(value);
          }
        },
        { rootMargin: '200px' },
      );
      // Track the observer so deactivateIsland can disconnect it if the island
      // is torn down before it ever intersects (otherwise it leaks).
      (island as any).__formaObserver = observer;
      observer.observe(island);
    } else if (trigger === 'idle') {
      (island as any).__formaScheduled = true;
      const hydrate = () => hydrateIslandRoot(value);
      // Track the timer so deactivateIsland can cancel it before it fires.
      if (typeof requestIdleCallback === 'function') {
        const handle = requestIdleCallback(hydrate);
        (island as any).__formaIdleCancel = () => cancelIdleCallback(handle);
      } else {
        const handle = setTimeout(hydrate, 200);
        (island as any).__formaIdleCancel = () => clearTimeout(handle);
      }
    } else if (trigger === 'interaction') {
      (island as any).__formaScheduled = true;
      const hydrate = () => {
        island.removeEventListener('pointerdown', hydrate, true);
        island.removeEventListener('focusin', hydrate, true);
        delete (island as any).__formaInteractionHandler;
        hydrateIslandRoot(value);
      };
      // Track the handler so deactivateIsland can remove it if the island is
      // torn down before the user ever interacts (otherwise it leaks and a
      // stray event would re-hydrate a disposed island).
      (island as any).__formaInteractionHandler = hydrate;
      island.addEventListener('pointerdown', hydrate, { capture: true, once: true });
      island.addEventListener('focusin', hydrate, { capture: true, once: true });
    } else {
      // load (default) — hydrate immediately
      hydrateIslandRoot(value);
    }
  }
}

/**
 * Dispose a single island, tearing down its reactive root and all effects.
 *
 * Safe to call multiple times (idempotent). Sets `data-forma-status` to
 * `"disposed"` so the island can be distinguished from active/error states.
 *
 * Verified by: src/dom/__tests__/deactivate.test.ts > "is idempotent — double disposal does not throw"
 * Verified by: src/dom/__tests__/deactivate.test.ts > "stops effects from running after disposal"
 */
export function deactivateIsland(el: HTMLElement): void {
  // Tear down any pending deferred-trigger work so it does not leak when the
  // island is torn down before it ever ran: the visible-trigger observer, and
  // the interaction-trigger pointerdown/focusin listeners (whose only other
  // removal path is inside a hydrate that may never fire).
  // Verified by: src/dom/__tests__/activate-visible-leak.test.ts > "disconnects the observer when the island is deactivated before intersecting"
  const observer = (el as any).__formaObserver as { disconnect: () => void } | undefined;
  if (observer) {
    observer.disconnect();
    delete (el as any).__formaObserver;
  }
  const interactionHandler = (el as any).__formaInteractionHandler as EventListener | undefined;
  if (interactionHandler) {
    el.removeEventListener('pointerdown', interactionHandler, true);
    el.removeEventListener('focusin', interactionHandler, true);
    delete (el as any).__formaInteractionHandler;
  }
  const idleCancel = (el as any).__formaIdleCancel as (() => void) | undefined;
  if (idleCancel) {
    idleCancel();
    delete (el as any).__formaIdleCancel;
  }
  delete (el as any).__formaScheduled;
  // Nothing above is left to tear down, so this island no longer forces list
  // rows to be scanned. Marker-guarded, so the documented idempotence of this
  // function cannot double-decrement and hide an island that is still live.
  untrackIsland(el);
  // Mark disposed so any deferred callback that still fires (e.g. a timer that
  // could not be cancelled) cannot resurrect a torn-down island.
  // Verified by: src/dom/__tests__/activate-visible-leak.test.ts > "a deferred callback that fires after disposal cannot resurrect the island"
  (el as any).__formaDisposed = true;

  const dispose = (el as any).__formaDispose;
  if (typeof dispose === 'function') {
    dispose();
    delete (el as any).__formaDispose;
    el.setAttribute('data-forma-status', 'disposed');
  }
}

/**
 * Dispose ALL active islands under a root element (or the whole document).
 *
 * Use this when swapping module content — e.g., replacing the contents of
 * a `<forma-stage>` Shadow DOM during AI generation. Prevents leaked effects
 * and event listeners from accumulating across swaps.
 *
 * `root` is a `ParentNode` so a ShadowRoot is accepted — the documented
 * forma-stage case did not typecheck under the previous `Element | Document`,
 * and it takes the same argument as `activateIslands`.
 */
export function deactivateAllIslands(root: ParentNode = document): void {
  // Tear down ALL islands — active ones AND pending deferred ones (visible/idle/
  // interaction), whose observers/listeners would otherwise survive a content
  // swap and later zombie-hydrate. deactivateIsland is idempotent and a no-op
  // for islands with no scheduled/active work.
  const islands = root.querySelectorAll<HTMLElement>('[data-forma-island]');
  for (const island of islands) {
    deactivateIsland(island);
  }
}

/** Hydrate a single island root with error isolation. */
function hydrateIslandRoot(value: ValidatedIsland): void {
  const root = value.host;
  // A deferred callback may outlive disposal or marker changes. Check the
  // private validation and frozen claim immediately before component execution.
  if ((root as any).__formaDisposed) return;
  try { checkIslandClaim(value); } catch (error) {
    deactivateIsland(root);
    console.error(error instanceof Error ? error.message : error);
    return;
  }
  const id = value.occurrence;
  const componentName = root.getAttribute('data-forma-component')!;
  const hydrateFn = value.registration.hydrate;
  let disposeRoot: (() => void) | undefined;
  try {
    // Clear the deferred-trigger marker now that hydration is happening; the
    // 'hydrating'/'active' status guards prevent re-runs from here on.
    delete (root as any).__formaScheduled;
    const props = value.props;
    root.setAttribute('data-forma-status', 'hydrating');

    // hydrateIsland may replace the shell element with the component's own
    // root element (CSR fallback for empty islands). Track the active root.
    let activeRoot: Element = root;
    createUnownedRoot((dispose) => {
      // Publish the disposer BEFORE running the component. Effects are created
      // as the component runs, so if it throws half-way the ones already created
      // are live — and if the disposer were only assigned after hydrateIsland
      // returned, nothing would ever reach them: the island would keep reacting
      // to signal writes forever and deactivateIsland would find nothing to
      // dispose. The catch below uses this handle to tear the partial root down.
      disposeRoot = dispose;
      (root as any).__formaDispose = dispose;
      activeRoot = hydrateIslandOrFail(() => hydrateFn(root, props), root);
      if (activeRoot !== root) {
        // The shell was replaced — move the handle onto the element that is
        // actually in the document, so deactivateIsland finds it there. The
        // tracking marker moves with the handle: it has to sit on the element
        // deactivateIsland will be called with, or tearing the island down
        // would never decrement the count.
        delete (root as any).__formaDispose;
        (activeRoot as any).__formaDispose = dispose;
        untrackIsland(root);
        trackIsland(activeRoot);
      }
    });

    activeRoot.setAttribute('data-forma-status', 'active');
  } catch (err) {
    // A coded hydration error is logged in every build and passed to onError:
    // in production the island's `error` status would otherwise be its only trace.
    // Verified by: src/dom/__tests__/hydrate-fragment.test.ts > "an island that returns a detached DOM node is marked error with its code, its sibling unaffected"
    // Verified by: src/dom/__tests__/list-adoption-count.test.ts > "marks the island error with FORMA_E_HYDRATE_LIST_COUNT and removes or adds no row"
    if (isHydrateError(err)) reportHydrateError(err, ` (island "${componentName}", id=${id})`);
    else if (__DEV__) console.error(`[forma] Island "${componentName}" (id=${id}) failed:`, err);
    // Dispose whatever was built before the throw: a failed island must not
    // leave live effects writing into DOM nobody will hydrate again.
    // Verified by: src/dom/__tests__/activate-isolation.test.ts > "disposes effects created before a failing island threw"
    if (disposeRoot) {
      try { disposeRoot(); } catch { /* a broken disposer must not mask the original error */ }
      delete (root as any).__formaDispose;
    }
    // A failed island has no live root and no scheduled trigger left, so it must
    // stop forcing the row scan — otherwise one broken island on a page makes
    // every list pay the subtree walk forever.
    untrackIsland(root);
    root.setAttribute('data-forma-status', 'error');
  }
}
