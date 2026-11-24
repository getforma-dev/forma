/**
 * Forma HTTP - Fetch
 *
 * Typed fetch wrapper with reactive signal integration.
 * Zero dependencies — native browser APIs only.
 */

import { createSignal, internalEffect } from 'forma/reactive';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FetchOptions<T> extends Omit<RequestInit, 'signal'> {
  base?: string;
  params?: Record<string, string>;
  /**
   * Abort the request after this many ms (default 30000). A request that
   * times out reports an `Error` named `TimeoutError` through `error()`, so a
   * stalled endpoint is never mistaken for one that is still loading.
   */
  timeout?: number;
  transform?: (data: unknown) => T;
}

export interface FetchResult<T> {
  data: () => T | null;
  error: () => Error | null;
  loading: () => boolean;
  refetch: () => Promise<void>;
  abort: () => void;
}

// ---------------------------------------------------------------------------
// createFetch — reactive fetch with signals
// ---------------------------------------------------------------------------

/**
 * Create a reactive fetch that exposes data/error/loading as signals.
 *
 * If `url` is a signal getter (function), an effect auto-refetches when it
 * changes.
 *
 * ```ts
 * const { data, loading, error, refetch, abort } = createFetch<User[]>('/api/users');
 * ```
 */
export function createFetch<T>(
  url: string | (() => string),
  options?: FetchOptions<T>,
): FetchResult<T> {
  const [data, setData] = createSignal<T | null>(null);
  const [error, setError] = createSignal<Error | null>(null);
  const [loading, setLoading] = createSignal<boolean>(false);

  let currentController: AbortController | null = null;

  /** Resolve the URL string, applying base and params. */
  function resolveURL(): string {
    const raw = typeof url === 'function' ? url() : url;
    const base = options?.base || (typeof window !== 'undefined' ? window.location.origin : '');
    const fullURL = new URL(raw, base || undefined);

    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        fullURL.searchParams.set(key, value);
      }
    }

    return fullURL.toString();
  }

  /** Execute a single fetch request. */
  async function execute(): Promise<void> {
    // Abort any in-flight request
    if (currentController) {
      currentController.abort();
    }

    currentController = new AbortController();
    const controller = currentController;
    const timeoutMs = options?.timeout ?? 30_000;

    // Set up timeout. A timeout is an abort the caller did not ask for, so it
    // is remembered and reported as an error rather than swallowed with the
    // intentional aborts (abort(), a superseding refetch).
    // Verified by: src/http/__tests__/fetch.test.ts > "a request that outlives its timeout reports a TimeoutError and stops loading"
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    setLoading(true);
    setError(null);

    try {
      const resolvedURL = resolveURL();

      const { base: _base, params: _params, timeout: _timeout, transform, ...fetchInit } =
        options ?? {};

      const response = await fetch(resolvedURL, {
        ...fetchInit,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: unknown = await response.json();
      // A request that was aborted or superseded while its body was read must
      // not overwrite the state of the request that replaced it.
      // Verified by: src/http/__tests__/fetch.test.ts > "a superseded request that still resolves never overwrites the newer data"
      if (controller.signal.aborted) {
        if (timedOut && currentController === controller) {
          setError(timeoutError(timeoutMs));
        }
        return;
      }
      const transformed = transform ? transform(json) : (json as T);
      setData(transformed);
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        // An intentional abort (abort(), a superseding refetch) is silent. A
        // timeout is not: it is the request failing, so the caller hears it.
        if (timedOut && currentController === controller) {
          setError(timeoutError(timeoutMs));
        }
        return;
      }
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      clearTimeout(timeoutId);
      // Only update loading if this controller is still current
      if (currentController === controller) {
        currentController = null;
        setLoading(false);
      }
    }
  }

  // If url is a reactive getter, set up an effect to auto-refetch.
  if (typeof url === 'function') {
    internalEffect(() => {
      // Read the signal so the effect re-runs when it changes
      url();
      void execute();
    });
  } else {
    // Kick off the first request immediately
    void execute();
  }

  return {
    data,
    error,
    loading,
    refetch: execute,
    abort() {
      if (currentController) {
        currentController.abort();
      }
    },
  };
}

function timeoutError(timeoutMs: number): Error {
  const error = new Error(`Request timed out after ${timeoutMs} ms`);
  error.name = 'TimeoutError';
  return error;
}

// ---------------------------------------------------------------------------
// fetchJSON — simple one-shot helper
// ---------------------------------------------------------------------------

/**
 * One-shot fetch that returns parsed JSON.
 *
 * ```ts
 * const users = await fetchJSON<User[]>('/api/users');
 * ```
 */
export async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as T;
}
