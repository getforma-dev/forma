/** Scoped native owner adoption for the optional Forma router. */
import { activateCheckedIslands, deactivateIsland, activationPhase } from './dom/activate.js';
import { rawHtml, trustedHtml } from './dom/trusted-html.js';
import {
  prepareNavigationIslandState, prepareInitialNavigationIslandStates,
  validateNavigationIslandState, activateNavigationIslandState, revokeNavigationIslandState,
  type NavigationIslandState,
} from './dom/navigation-state.js';
import { IslandStateError } from './dom/island-state.js';

/** @internal Shared URL policy for router-created anchors, including caller-owned documents. */
export { isDangerousUrl } from './security/url-safety.js';

export type NativeIslandRegistry = Record<string, (...args: never[]) => unknown>;
export interface NativeOwnerRoot {
  readonly root: HTMLElement;
  readonly outlet?: HTMLElement;
}
export interface NativeOwnerScope extends NativeOwnerRoot {
  validate(): void;
  activate(): Promise<void>;
  dispose(): void;
}
const states = new WeakMap<NativeOwnerScope, NavigationIslandState>();

/** @internal Router parser sink for admitted server HTML; no sanitization is performed here. */
export function navigationHTML(html: string): string {
  return rawHtml(trustedHtml(html), 'template');
}

function scopeFor(descriptor: NativeOwnerRoot, state: NavigationIslandState): NativeOwnerScope {
  let ready: Promise<void> | undefined, disposed = false;
  const scope: NativeOwnerScope = Object.freeze({
    root: descriptor.root,
    outlet: descriptor.outlet,
    validate(): void { validateNavigationIslandState(state); },
    activate(): Promise<void> {
      if (disposed) throw new IslandStateError('FORMA_E_ISLAND_IDENTITY', 'native owner was disposed');
      if (!ready) {
        const checked = activateNavigationIslandState(state);
        ready = activateCheckedIslands(checked).then(() => {
          if (!disposed && checked.some(item => !['scheduled', 'live'].includes(activationPhase.get(item.host)!))) {
            throw new IslandStateError('FORMA_E_ISLAND_IDENTITY', 'native owner activation failed');
          }
        });
      }
      return ready;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const failures: unknown[] = [];
      for (const host of revokeNavigationIslandState(state)) {
        try { deactivateIsland(host); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'native owner cleanup failed');
    },
  });
  states.set(scope, state);
  return scope;
}

/** Prepare an imported, detached owner with its own typed state envelope. */
export function prepareNativeOwner(
  registry: NativeIslandRegistry,
  root: HTMLElement,
  stateJson: string,
  options: { readonly outlet?: HTMLElement } = {},
): NativeOwnerScope {
  const descriptor = { root, outlet: options.outlet };
  return scopeFor(descriptor, prepareNavigationIslandState(registry, root, stateJson, root.ownerDocument, options.outlet));
}

/** Partition original document claims before the initial group activates. */
export function prepareInitialNativeOwners(
  registry: NativeIslandRegistry,
  owners: readonly NativeOwnerRoot[],
): readonly NativeOwnerScope[] {
  if (!owners.length || owners.length > 32) throw new IslandStateError('FORMA_E_ISLAND_IDENTITY', 'native branch requires 1 to 32 owners');
  for (const owner of owners) {
    for (const host of owner.root.querySelectorAll<HTMLElement>('[data-forma-island]')) {
      if (activationPhase.has(host)) throw new IslandStateError('FORMA_E_ISLAND_IDENTITY', 'initial native owner already activated');
    }
  }
  const handles = prepareInitialNavigationIslandStates(registry, owners);
  return Object.freeze(handles.map((state, index) => scopeFor(owners[index]!, state)));
}

/** Validate the assembled linear owner branch before the router commits it. */
export function validateNativeOwnerTree(owners: readonly NativeOwnerScope[]): void {
  if (!owners.length || owners.length > 32) throw new IslandStateError('FORMA_E_ISLAND_IDENTITY', 'native branch requires 1 to 32 owners');
  const roots = new Set<HTMLElement>();
  for (let index = 0; index < owners.length; index++) {
    const owner = owners[index]!, parent = owners[index - 1];
    const state = states.get(owner);
    if (!state || roots.has(owner.root) || parent && (owner.root.parentNode !== parent.outlet || parent.outlet?.childNodes.length !== 1)
      || index === owners.length - 1 && owner.outlet) {
      throw new IslandStateError('FORMA_E_ISLAND_IDENTITY', 'invalid native owner branch');
    }
    validateNavigationIslandState(state);
    roots.add(owner.root);
  }
}
