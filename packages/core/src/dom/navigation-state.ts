/** Optional native navigation ownership; shares the original document authority. */
import { IslandStateError, occurrenceOf, readDocument, readStateEntries, originalClaim, validateHost, validatedAuthorities,
  type IslandStateCode, type IslandAuthority, type DocumentState, type IslandPreflight } from './island-state.js';
function refuse(code: IslandStateCode, detail: string): never { throw new IslandStateError(code, detail); }

/** Native navigation authority. Never replaces the original Document snapshot. */
interface NavigationState extends IslandAuthority {
  readonly root: HTMLElement;
  readonly document: Document;
  readonly outlet?: HTMLElement;
  readonly outletPath: readonly Node[];
  readonly outletName: string | null;
  readonly checked: readonly IslandPreflight[];
  phase: 'prepared' | 'active' | 'disposed';
}
const navigationRoots = new WeakSet<HTMLElement>();
const navigationHandles = new WeakMap<object, NavigationState>();
/** @internal Opaque proof handle; callers cannot mint validated island claims. */
export interface NavigationIslandState { readonly kind: 'forma-navigation-islands'; }


/**
 * @internal Experimental FORMA-301 feasibility boundary, not a supported public
 * transport. The caller must first validate response app/build/policy and import
 * inert markup into the destination document. Root must be a detached non-island
 * wrapper owned by that document. No component executes and no DOM write occurs.
 *
 * Unlike initial Document preflight, an invalid navigation candidate fails as a
 * unit before the router can replace the committed view. A handle is single-use.
 */
export interface NavigationOwnerRoot { readonly root: HTMLElement; readonly outlet?: HTMLElement; }

function ownerHosts(root: HTMLElement, outlet?: HTMLElement): HTMLElement[] {
  const hosts: HTMLElement[] = [], work: Element[] = Array.from(root.children).reverse();
  let nodes = 0;
  while (work.length) {
    if (++nodes > 10000) refuse('FORMA_E_ISLAND_STATE', 'owner exceeds 10000 elements');
    const element = work.pop()!;
    if (element.hasAttribute('data-forma-outlet') && element !== outlet) {
      refuse('FORMA_E_ISLAND_IDENTITY', 'unclaimed owner outlet');
    }
    if (element === outlet) continue;
    if (element.hasAttribute('data-forma-island')) hosts.push(element as HTMLElement);
    for (let i = element.children.length - 1; i >= 0; i--) work.push(element.children[i]!);
  }
  if (hosts.length > 200) refuse('FORMA_E_ISLAND_STATE', 'owner exceeds 200 islands');
  return hosts;
}
function outletPath(root: HTMLElement, outlet?: HTMLElement): readonly Node[] {
  if (!outlet) return [];
  if (outlet === root || !root.contains(outlet) || !outlet.hasAttribute('data-forma-outlet')) {
    refuse('FORMA_E_ISLAND_IDENTITY', 'outlet must be an owned descendant placeholder');
  }
  const path: Node[] = [];
  for (let node: Node | null = outlet; node !== root; node = node.parentNode) {
    if (!node || path.length >= 64 || node instanceof Element && node.hasAttribute('data-forma-island')) {
      refuse('FORMA_E_ISLAND_IDENTITY', 'outlet cannot occur inside an island');
    }
    path.push(node);
  }
  path.push(root);
  return path;
}

function pathUnchanged(path: readonly Node[], name: string | null): boolean {
  return (!path.length || (path[0] as Element).getAttribute('data-forma-outlet') === name)
    && path.every((node, i) => !(node as Element).hasAttribute('data-forma-island')
      && (i === path.length - 1 || node.parentNode === path[i + 1]));
}

function prepareOwnerState(registry: Record<string, (...args: never[]) => unknown>,
  descriptor: NavigationOwnerRoot, state: DocumentState, initial: boolean): NavigationIslandState {
  const { root, outlet } = descriptor, document = root.ownerDocument;
  if (root.hasAttribute('data-forma-island') || navigationRoots.has(root)
    || (initial ? !document.contains(root) : root.isConnected || document.contains(root))) {
    refuse('FORMA_E_ISLAND_IDENTITY', 'navigation requires a fresh detached route wrapper');
  }
  const path = outletPath(root, outlet);
  const name = outlet?.getAttribute('data-forma-outlet') ?? null;
  if (!initial && outlet?.childNodes.length) refuse('FORMA_E_ISLAND_IDENTITY', 'detached owner outlet must be empty');
  const hosts = ownerHosts(root, outlet);
  if (state.error) throw state.error;
  if (!initial) {
    const occurrences = new Set<number>();
    for (const host of hosts) {
      const occurrence = occurrenceOf(host.getAttribute('data-forma-state'));
      if (occurrence === null || occurrences.has(occurrence)) {
        refuse('FORMA_E_ISLAND_IDENTITY', 'invalid or duplicate navigation occurrence');
      }
      occurrences.add(occurrence);
      state.claims.set(host, {
        boundary: host.getAttribute('data-forma-island'), component: host.getAttribute('data-forma-component'),
        h: host.getAttribute('data-forma-h'), occurrence, duplicate: false,
      });
    }
  }
  const checked = hosts.map(host => {
    const value = validateHost(registry, host, state);
    if (value.registration.mode !== 0) {
      refuse('FORMA_E_ISLAND_REGISTRATION', 'native navigation requires adopting registrations');
    }
    return { host, value };
  });
  const scope: NavigationState = {
    root, document, outlet, outletPath: path, outletName: name, state, checked, phase: 'prepared', active: false,
    contains: host => document.contains(root) && root.contains(host) && (!outlet || !outlet.contains(host)) && pathUnchanged(path, name),
  };
  const handle: NavigationIslandState = Object.freeze({ kind: 'forma-navigation-islands' });
  for (const result of checked) validatedAuthorities.set(result.value, scope);
  navigationRoots.add(root);
  navigationHandles.set(handle, scope);
  return handle;
}

export function prepareNavigationIslandState(
  registry: Record<string, (...args: never[]) => unknown>, root: HTMLElement,
  stateJson: string, document: Document = root.ownerDocument, outlet?: HTMLElement,
): NavigationIslandState {
  if (root.ownerDocument !== document) refuse('FORMA_E_ISLAND_IDENTITY', 'navigation document differs');
  return prepareOwnerState(registry, { root, outlet }, { entries: readStateEntries(stateJson), claims: new WeakMap() }, false);
}

/** Internal initial owner partition; all descriptors are admitted before activation. */
export function prepareInitialNavigationIslandStates(
  registry: Record<string, (...args: never[]) => unknown>, owners: readonly NavigationOwnerRoot[],
): readonly NavigationIslandState[] {
  if (!owners.length || owners.length > 32) refuse('FORMA_E_ISLAND_STATE', 'initial branch requires 1 to 32 owners');
  const document = owners[0]!.root.ownerDocument;
  const state = readDocument(document), seen = new Set<HTMLElement>();
  for (let i = 0; i < owners.length; i++) {
    const current = owners[i]!, parent = owners[i - 1];
    if (seen.has(current.root) || current.root.ownerDocument !== document
      || parent && (current.root.parentNode !== parent.outlet || parent.outlet?.childNodes.length !== 1)
      || i === owners.length - 1 && current.outlet) {
      refuse('FORMA_E_ISLAND_IDENTITY', 'invalid initial owner branch');
    }
    seen.add(current.root);
  }
  const handles: NavigationIslandState[] = [];
  try {
    for (const owner of owners) handles.push(prepareOwnerState(registry, owner, state, true));
    return Object.freeze(handles);
  } catch (error) {
    for (const handle of handles) revokeNavigationIslandState(handle);
    throw error;
  }
}

/** Check a captured owner after branch assembly or before commit. */
export function validateNavigationIslandState(handle: NavigationIslandState, connected = false): void {
  const scope = navigationHandles.get(handle);
  if (!scope || scope.phase === 'disposed' || scope.root.ownerDocument !== scope.document
    || connected && !scope.document.contains(scope.root) || !pathUnchanged(scope.outletPath, scope.outletName)) {
    refuse('FORMA_E_ISLAND_IDENTITY', 'navigation scope cannot activate');
  }
  const hosts = ownerHosts(scope.root, scope.outlet);
  if (hosts.length !== scope.checked.length || scope.checked.some((result, index) => hosts[index] !== result.host)) {
    refuse('FORMA_E_ISLAND_IDENTITY', 'navigation host set changed after preparation');
  }
  for (const result of scope.checked) {
    const claim = originalClaim(result.host, scope.state);
    if ('value' in result && (claim.occurrence !== result.value.occurrence || claim.h !== result.value.registration.h)) {
      refuse('FORMA_E_ISLAND_IDENTITY', 'navigation claim changed after preparation');
    }
  }
}

/** @internal Admission of the exact prepared owner, once the router inserts it. */
export function activateNavigationIslandState(handle: NavigationIslandState): readonly IslandPreflight[] {
  validateNavigationIslandState(handle, true);
  const scope = navigationHandles.get(handle)!;
  if (scope.phase !== 'prepared') refuse('FORMA_E_ISLAND_IDENTITY', 'navigation scope cannot activate');
  scope.phase = 'active'; scope.active = true;
  return scope.checked;
}

/** @internal Revoke first, then let the caller dispose every captured host. */
export function revokeNavigationIslandState(handle: NavigationIslandState): readonly HTMLElement[] {
  const scope = navigationHandles.get(handle);
  if (!scope || scope.phase === 'disposed') return [];
  scope.phase = 'disposed'; scope.active = false;
  return scope.checked.map(result => result.host);
}
