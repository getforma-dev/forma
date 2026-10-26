import { activateCheckedIslands, deactivateIsland } from './activate.js';
import { IslandStateError } from './island-state.js';
import { prepareNavigationIslandState, activateNavigationIslandState, revokeNavigationIslandState } from './navigation-state.js';
function reportActivationError(error: unknown): void {
  try { console.error(error instanceof Error ? error.message : error); } catch { /* preserve independent cleanup */ }
}
/**
 * @internal Experimental native-navigation feasibility API. Response transport
 * policy and build admission belong to the router, not to this state decoder.
 * Prepare a fresh detached wrapper; insert that same wrapper before activate().
 * dispose() revokes deferred authority before tearing down captured route hosts.
 * Existing activateIslands() continues to use only the original Document claims.
 */
export function __prepareNavigationIslands(
  registry: Record<string, (...args: never[]) => unknown>, root: HTMLElement,
  stateJson: string,
): Readonly<{ activate(): Promise<void>; dispose(): void }> {
  const handle = prepareNavigationIslandState(registry, root, stateJson);
  let ready: Promise<void> | undefined;
  let disposed = false;
  return Object.freeze({
    activate(): Promise<void> {
      if (disposed) throw new IslandStateError('FORMA_E_ISLAND_IDENTITY', 'navigation scope was disposed');
      if (!ready) ready = activateCheckedIslands(activateNavigationIslandState(handle));
      return ready;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const hosts = revokeNavigationIslandState(handle);
      for (const host of hosts) {
        try { deactivateIsland(host); } catch (error) { reportActivationError(error); }
      }
    },
  });
}
