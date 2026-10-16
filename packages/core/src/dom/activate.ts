/**
 * Forma DOM - Island Activation
 *
 * Discovers SSR-rendered islands via [data-forma-island] attributes,
 * preflights the head state against compiled contracts, and hydrates each island inside
 * an independent createRoot scope with try/catch error isolation.
 */

import { createUnownedRoot } from 'forma/reactive';
import { isHydrateError, reportHydrateError } from './adoption-errors.js';
import { prepareAdoption, type PreparedAdoption } from './adoption.js';
import { AdoptionScope } from '../reactive/adoption-scope.js';
import { currentAdoptionDiagnostic, type AdoptionDiagnostic } from '../reactive/adoption-diagnostics.js';
import { preflightIslands, checkIslandClaim, IslandStateError, type ValidatedIsland } from './island-state.js';
import { skewed } from './skew.js';

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

type ActivationPhase = 'scheduled'|'preparing'|'live'|'error'|'disposed';
const activationPhase = new WeakMap<Element,ActivationPhase>();

type LoadWork = ((event?: Event | false) => void) & { ready: Promise<void> };
const loadQueue = new Set<LoadWork>();
const pendingLoad = new WeakMap<HTMLElement, LoadWork>();
const loadEvents = ['pointerdown', 'focusin', 'click'] as const;
let loadBusy = 0;
let loadTimer: ReturnType<typeof setTimeout> | undefined;

function reportActivationError(error: unknown): void {
  // User-replaced diagnostics cannot strand independent scheduled hosts.
  try { console.error(error instanceof Error ? error.message : error); } catch { /* retain sibling progress */ }
}

function setupFailed(island: HTMLElement, error: unknown): void {
  try { deactivateIsland(island); } catch (cleanupError) { reportActivationError(cleanupError); }
  reportActivationError(error);
}

function queueLoad(value: ValidatedIsland, children: ReadonlyMap<Element, ValidatedIsland>): LoadWork {
  let complete!: () => void;
  const work = ((event?: Event | false) => {
    // Deletion is the atomic take shared by FIFO, input promotion and cancel.
    // Keep pendingLoad until finally so reentrant callers share real readiness.
    if (!loadQueue.delete(work)) return;
    loadBusy++;
    try {
      let failed = false;
      if (!loadQueue.size) {
        const timer = loadTimer; loadTimer = undefined;
        try { clearTimeout(timer); } catch (error) { failed = true; reportActivationError(error); }
      }
      for (const type of loadEvents) {
        try { value.host.removeEventListener(type, work, true); }
        catch (error) { failed = true; reportActivationError(error); }
      }
      if (failed || event === false) deactivateIsland(value.host);
      else hydrateIslandRoot(value, children);
    } catch (error) { setupFailed(value.host, error); }
    finally {
      pendingLoad.delete(value.host); complete(); loadBusy--; scheduleLoads();
    }
  }) as LoadWork;
  work.ready = new Promise<void>(resolve => { complete = resolve; });
  loadQueue.add(work); pendingLoad.set(value.host, work);
  return work;
}

function drainLoads(deadline = performance.now() + 12): void {
  loadTimer = undefined; loadBusy++;
  try {
    for (const work of loadQueue) {
      if (performance.now() >= deadline) break;
      work();
    }
  } finally {
    loadBusy--; scheduleLoads();
  }
}

function scheduleLoads(): void {
  if (!loadBusy && loadQueue.size && loadTimer === undefined) loadTimer = setTimeout(drainLoads, 0);
}

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
 * @returns Resolves when requested load work has activated, failed in isolation,
 *          or been disposed. Existing pending loads are included; visible,
 *          idle and interaction work completes its part once its trigger is armed.
 *          Preflight remains synchronous; the function itself is not async.
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
): Promise<void> {
  // Preflight is atomic, but its cost belongs to the first cooperative slice.
  const deadline = performance.now() + 12;
  if (skewed(root)) return Promise.resolve();
  const checked = preflightIslands(registry, root);
  const children = new Map<Element, ValidatedIsland>();
  for (const result of checked) if ('value' in result) children.set(result.host, result.value);
  const ready: Promise<void>[] = [];
  loadBusy++;
  try {
    // Native observer/idle/input callbacks run after enrollment. Reserve and
    // arm every host before starting loads; depth also guards diagnostic reentry.
    for (const result of checked) {
      if ('error' in result) { reportActivationError(result.error); continue; }
      const value = result.value, island = value.host;
      const pending = pendingLoad.get(island);
      if (pending) {
        ready.push(pending.ready);
        continue;
      }
      if (activationPhase.has(island) || (island as any).__formaScheduled) continue;
      try { checkIslandClaim(value); } catch (error) {
        reportActivationError(error); continue;
      }
      delete (island as any).__formaDisposed;
      trackIsland(island); activationPhase.set(island, 'scheduled');
      const trigger = island.getAttribute('data-forma-hydrate') || 'load';
      const work = trigger === 'visible' || trigger === 'idle' || trigger === 'interaction'
        ? undefined : queueLoad(value, children);
      if (work) ready.push(work.ready);
      try {
        if (work) {
          // Retained SSR targets can receive the same event after priority activation.
          for (const type of loadEvents) island.addEventListener(type, work, true);
        } else if (trigger === 'visible') {
          (island as any).__formaScheduled = true;
          const observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              observer.disconnect(); delete (island as any).__formaObserver;
              hydrateIslandRoot(value, children);
            }
          }, { rootMargin: '200px' });
          (island as any).__formaObserver = observer;
          observer.observe(island);
        } else if (trigger === 'idle') {
          (island as any).__formaScheduled = true;
          const hydrate = () => hydrateIslandRoot(value, children);
          if (typeof requestIdleCallback === 'function') {
            const handle = requestIdleCallback(hydrate);
            (island as any).__formaIdleCancel = () => cancelIdleCallback(handle);
          } else {
            const handle = setTimeout(hydrate, 200);
            (island as any).__formaIdleCancel = () => clearTimeout(handle);
          }
        } else {
          (island as any).__formaScheduled = true;
          const hydrate = () => {
            island.removeEventListener('pointerdown', hydrate, true);
            island.removeEventListener('focusin', hydrate, true);
            delete (island as any).__formaInteractionHandler;
            hydrateIslandRoot(value, children);
          };
          (island as any).__formaInteractionHandler = hydrate;
          island.addEventListener('pointerdown', hydrate, { capture: true, once: true });
          island.addEventListener('focusin', hydrate, { capture: true, once: true });
        }
      } catch (error) {
        setupFailed(island, error);
      }
    }
  } finally {
    loadBusy--;
    if (!loadBusy && loadTimer === undefined) drainLoads(deadline);
  }
  return Promise.all(ready).then(() => {});
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
  const previous=activationPhase.get(el);
  activationPhase.set(el,'disposed');
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
  pendingLoad.get(el)?.(false);
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
    if(previous==='live')el.setAttribute('data-forma-status', 'disposed');
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

/** Activate one checked host. Browser-only replacement is explicit; SSR never
 * falls back to creating DOM just because its original host is empty. */
function hydrateIslandRoot(value:ValidatedIsland,children:ReadonlyMap<Element,ValidatedIsland>):void {
  const root=value.host;
  if((root as any).__formaDisposed||activationPhase.get(root)!=='scheduled')return;
  try{checkIslandClaim(value);}catch(error){
    deactivateIsland(root);console.error(error instanceof Error?error.message:error);return;
  }
  delete (root as any).__formaScheduled;
  activationPhase.set(root,'preparing');
  const componentName=root.getAttribute('data-forma-component')!,occurrence=value.occurrence;
  let plan:PreparedAdoption|undefined,scope:AdoptionScope|undefined,disposeRoot:(()=>void)|undefined,activeRoot:Element=root,reported=false,initialDiagnostic:AdoptionDiagnostic|undefined;
  const dispose=()=>{scope?.abort();plan?.dispose();disposeRoot?.();};
  (root as any).__formaDispose=dispose;
  const failed=(error:unknown,fallback='FORMA_E_HYDRATE_COMPONENT')=>{
    if(reported)return;reported=true;
    dispose();delete (activeRoot as any).__formaDispose;untrackIsland(activeRoot);activationPhase.set(activeRoot,'error');
    if(error instanceof IslandStateError){console.error(error.message);return;}
    activeRoot.setAttribute('data-forma-status','error');
    const code=isHydrateError(error)?error.code:fallback;
    const context=currentAdoptionDiagnostic()??initialDiagnostic;
    const detail=Object.freeze({island:componentName,occurrence,binding:context?.binding??null,code,...(context?{path:context.path}:{})});
    const EventType=activeRoot.ownerDocument.defaultView?.CustomEvent??CustomEvent;
    activeRoot.dispatchEvent(new EventType('forma:error',{bubbles:true,detail}));
    reportHydrateError(error,` (island "${componentName}", id=${occurrence})`);
  };
  try{
    if(value.registration.mode===1){
      // Ordinary client construction has no adoption/early-edit authority.
      createUnownedRoot(stop=>{
        disposeRoot=stop;
        const result=value.registration.hydrate(root,value.props);
        if((root as any).__formaDisposed){stop();return;}
        checkIslandClaim(value);
        if(result instanceof Element){
          for(const attr of Array.from(root.attributes))if(attr.name.startsWith('data-forma-'))result.setAttribute(attr.name,attr.value);
          root.replaceWith(result);activeRoot=result;
          delete (root as any).__formaDispose;(result as any).__formaDispose=dispose;
          untrackIsland(root);trackIsland(result);activationPhase.set(root,'disposed');
        }else if(result instanceof Node)root.appendChild(result);
      });
      if((root as any).__formaDisposed)return;
      activationPhase.set(activeRoot,'live');activeRoot.setAttribute('data-forma-status','active');return;
    }
    plan=prepareAdoption(root,()=>value.registration.hydrate(root,value.props),{
      children,
      scope:options=>(scope=new AdoptionScope(value,options)),
      failure:failed,
      errorContext:context=>{initialDiagnostic=context;},
    });
    plan.commit();
    if(plan.phase==='live')activationPhase.set(root,'live');
  }catch(error){failed(error);}
}
