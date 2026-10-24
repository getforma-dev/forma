/**
 * Forma Reactive - Cleanup
 *
 * Register cleanup functions within reactive scopes.
 * Inspired by SolidJS onCleanup().
 */

// ---------------------------------------------------------------------------
// Cleanup context tracking
// ---------------------------------------------------------------------------

import type { Owner } from './root.js';

/** @internal Ownership and cleanup move together when an effect runs. */
export interface ExecutionContext {
  owner: Owner | null;
  addCleanup?(fn: () => void): void;
}
export let executionContext: ExecutionContext = { owner: null };

/**
 * Register a cleanup function in the current reactive scope.
 * The cleanup runs before the effect re-executes and on disposal.
 *
 * More composable than returning a cleanup from the effect function,
 * since it can be called from helper functions.
 *
 * ```ts
 * createEffect(() => {
 *   const timer = setInterval(tick, 1000);
 *   onCleanup(() => clearInterval(timer));
 * });
 * ```
 */
export function onCleanup(fn: () => void): void {
  executionContext.addCleanup?.(fn);
}

/**
 * @internal — Install an effect's owner and cleanup collector in one operation.
 */
export function setExecutionContext(context: ExecutionContext): ExecutionContext {
  const prev = executionContext;
  executionContext = context;
  return prev;
}
