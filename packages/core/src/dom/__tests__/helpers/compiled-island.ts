/** Test fixtures matching the compiler registration and native head-state contract. */
import { afterEach, beforeEach, vi } from 'vitest';
import { deactivateAllIslands, type IslandHydrateFn } from '../../activate.js';
import { __islandRegistration, type IslandSchema } from '../../island-state.js';

export const FIXTURE_HASH = '0123456789abcdef';
export const EMPTY_SCHEMA: IslandSchema = [[]];

export function compiled<P extends object>(component: (props: P) => unknown, schema: IslandSchema = EMPTY_SCHEMA, mode: 0 | 1 = 0): IslandHydrateFn {
  return __islandRegistration(component, { h: FIXTURE_HASH, schema, mode });
}

/** Explicitly register no-props components; no legacy host/props adapter. */
export function emptyRegistry(components: Record<string, (props: Record<string, never>) => unknown>): Record<string, IslandHydrateFn> {
  return Object.fromEntries(Object.entries(components).map(([name, component]) => [name, compiled(component)]));
}

/** Install the original document's state before activation or DOM-write observers. */
export function installState(props?: readonly object[], doc: Document = document): void {
  const hosts = [...doc.querySelectorAll('[data-forma-island]')];
  if (props && props.length !== hosts.length) throw new Error('Fixture state must match every original host');
  hosts.forEach((host, occurrence) => {
    host.setAttribute('data-forma-state', String(occurrence));
    host.setAttribute('data-forma-h', FIXTURE_HASH);
  });
  const block = doc.createElement('script');
  block.type = 'application/json';
  block.setAttribute('data-island-state', '');
  block.textContent = JSON.stringify({ v: 1, s: [], i: hosts.map((_, i) => ({ h: FIXTURE_HASH, p: props?.[i] ?? {} })) });
  doc.head.appendChild(block);
}

/** Register last in each suite so teardown runs before its older cleanup hooks. */
export function useFreshDocument(): void {
  let current: Document;
  beforeEach(() => {
    current = document.implementation.createHTMLDocument('compiled island fixture');
    vi.stubGlobal('document', current);
  });
  afterEach(() => {
    deactivateAllIslands(current);
    vi.unstubAllGlobals();
  });
}
