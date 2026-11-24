/**
 * createFetch / fetchJSON: the reactive fetch wrapper's request lifecycle.
 *
 * The network is a stubbed `fetch`. `deferredFetch` hands each call a promise
 * the test settles by hand and, like a real request, rejects with an
 * AbortError when its signal aborts, so ordering, supersession, abort and
 * timeout can be driven step by step.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'forma/reactive';
import { createFetch, fetchJSON } from '../fetch';

interface PendingCall {
  url: string;
  init: RequestInit;
  resolve: (body: unknown, init?: { ok?: boolean; status?: number; statusText?: string }) => void;
  reject: (error: unknown) => void;
}

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number; statusText?: string }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    json: async () => body,
  };
}

/** A fetch whose calls stay pending until the test settles them. */
function deferredFetch(options: { honorAbort?: boolean } = {}) {
  const honorAbort = options.honorAbort ?? true;
  const calls: PendingCall[] = [];
  const fn = vi.fn((url: string, init: RequestInit) =>
    new Promise((resolve, reject) => {
      if (honorAbort) {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }
      calls.push({
        url,
        init,
        resolve: (body, responseInit) => resolve(jsonResponse(body, responseInit)),
        reject,
      });
    }),
  );
  vi.stubGlobal('fetch', fn as unknown as typeof fetch);
  return { fn, calls };
}

/** Let pending promise continuations run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createFetch', () => {
  it('starts loading at once and settles data on success', async () => {
    const { calls } = deferredFetch();
    const req = createFetch<{ id: number }>('https://api.test/item');

    expect(req.loading()).toBe(true);
    expect(req.data()).toBeNull();

    calls[0]!.resolve({ id: 7 });
    await flush();

    expect(req.loading()).toBe(false);
    expect(req.error()).toBeNull();
    expect(req.data()).toEqual({ id: 7 });
  });

  it('reports a non-2xx response as an error with its status and keeps data null', async () => {
    const { calls } = deferredFetch();
    const req = createFetch('https://api.test/missing');

    calls[0]!.resolve({ message: 'nope' }, { ok: false, status: 404, statusText: 'Not Found' });
    await flush();

    expect(req.loading()).toBe(false);
    expect(req.data()).toBeNull();
    expect(req.error()?.message).toBe('HTTP 404: Not Found');
  });

  it('reports a network failure as an error, wrapping a non-Error rejection', async () => {
    const { calls } = deferredFetch();
    const req = createFetch('https://api.test/down');

    calls[0]!.reject('connection refused');
    await flush();

    expect(req.loading()).toBe(false);
    expect(req.error()).toBeInstanceOf(Error);
    expect(req.error()?.message).toBe('connection refused');
  });

  it('reports a transform that throws as an error', async () => {
    const { calls } = deferredFetch();
    const req = createFetch('https://api.test/item', {
      transform: () => {
        throw new Error('bad shape');
      },
    });

    calls[0]!.resolve({});
    await flush();

    expect(req.data()).toBeNull();
    expect(req.error()?.message).toBe('bad shape');
  });

  it('applies transform to the parsed body', async () => {
    const { calls } = deferredFetch();
    const req = createFetch<string[]>('https://api.test/users', {
      transform: (raw) => (raw as { users: { name: string }[] }).users.map((u) => u.name),
    });

    calls[0]!.resolve({ users: [{ name: 'Ada' }, { name: 'Lin' }] });
    await flush();

    expect(req.data()).toEqual(['Ada', 'Lin']);
  });

  it('resolves a relative path against base and sets params, overriding an existing query value', () => {
    const { calls } = deferredFetch();
    createFetch('/v1/search?q=old&page=1', {
      base: 'https://api.test',
      params: { q: 'new value', limit: '10' },
    });

    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://api.test/v1/search');
    expect(url.searchParams.get('q')).toBe('new value');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('forwards RequestInit fields but never its own options or a caller signal', () => {
    const { calls } = deferredFetch();
    createFetch('https://api.test/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
      timeout: 5_000,
      params: { x: '1' },
      transform: (d) => d,
    });

    const init = calls[0]!.init as Record<string, unknown>;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    for (const own of ['base', 'params', 'timeout', 'transform']) {
      expect(init).not.toHaveProperty(own);
    }
  });

  it('reports an invalid URL as an error instead of throwing from createFetch', async () => {
    deferredFetch();
    const req = createFetch('http://[not a host', { base: 'not a base either' });
    await flush();

    expect(req.loading()).toBe(false);
    expect(req.error()).toBeInstanceOf(Error);
  });

  it('refetch clears a previous error and replaces the data', async () => {
    const { calls } = deferredFetch();
    const req = createFetch<number>('https://api.test/n');

    calls[0]!.resolve(null, { ok: false, status: 500, statusText: 'Server Error' });
    await flush();
    expect(req.error()?.message).toBe('HTTP 500: Server Error');

    const done = req.refetch();
    expect(req.loading()).toBe(true);
    expect(req.error()).toBeNull();

    calls[1]!.resolve(2);
    await done;
    expect(req.loading()).toBe(false);
    expect(req.data()).toBe(2);
  });

  it('abort() stops an in-flight request silently: no error, loading false, data unchanged', async () => {
    const { calls } = deferredFetch();
    const req = createFetch<number>('https://api.test/slow');

    req.abort();
    await flush();

    expect(calls[0]!.init.signal?.aborted).toBe(true);
    expect(req.loading()).toBe(false);
    expect(req.error()).toBeNull();
    expect(req.data()).toBeNull();
  });

  it('abort() with nothing in flight is a no-op', async () => {
    const { calls } = deferredFetch();
    const req = createFetch<number>('https://api.test/n');
    calls[0]!.resolve(1);
    await flush();

    expect(() => req.abort()).not.toThrow();
    expect(req.data()).toBe(1);
  });

  it('a refetch aborts the request it supersedes and only the newer one settles state', async () => {
    const { calls } = deferredFetch();
    const req = createFetch<string>('https://api.test/v');

    const second = req.refetch();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.init.signal?.aborted).toBe(true);
    // The superseded request's abort must not end the newer request's loading.
    await flush();
    expect(req.loading()).toBe(true);

    calls[1]!.resolve('fresh');
    await second;
    expect(req.data()).toBe('fresh');
    expect(req.loading()).toBe(false);
    expect(req.error()).toBeNull();
  });

  it('a superseded request that still resolves never overwrites the newer data', async () => {
    // A fetch that ignores its signal stands for a body that was already read
    // when the newer request started.
    const { calls } = deferredFetch({ honorAbort: false });
    const req = createFetch<string>('https://api.test/v');

    const second = req.refetch();
    calls[1]!.resolve('new');
    await second;
    expect(req.data()).toBe('new');

    calls[0]!.resolve('stale');
    await flush();
    expect(req.data()).toBe('new');
    expect(req.error()).toBeNull();
    expect(req.loading()).toBe(false);
  });

  it('a superseded request that fails late never reports its error', async () => {
    const { calls } = deferredFetch({ honorAbort: false });
    const req = createFetch<string>('https://api.test/v');

    const second = req.refetch();
    calls[1]!.resolve('ok');
    await second;

    calls[0]!.reject(new TypeError('Failed to fetch'));
    await flush();
    expect(req.error()).toBeNull();
    expect(req.data()).toBe('ok');
  });

  it('a request that outlives its timeout reports a TimeoutError and stops loading', async () => {
    vi.useFakeTimers();
    const { calls } = deferredFetch();
    const req = createFetch('https://api.test/stalled', { timeout: 1_000 });

    await vi.advanceTimersByTimeAsync(999);
    expect(req.loading()).toBe(true);
    expect(req.error()).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(calls[0]!.init.signal?.aborted).toBe(true);
    expect(req.loading()).toBe(false);
    expect(req.error()?.name).toBe('TimeoutError');
    expect(req.error()?.message).toBe('Request timed out after 1000 ms');
  });

  it('times out after 30 s by default', async () => {
    vi.useFakeTimers();
    deferredFetch();
    const req = createFetch('https://api.test/stalled');

    await vi.advanceTimersByTimeAsync(29_999);
    expect(req.error()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(req.error()?.message).toBe('Request timed out after 30000 ms');
  });

  it('a request that answers in time clears its timer and never times out', async () => {
    vi.useFakeTimers();
    const { calls } = deferredFetch();
    const req = createFetch<number>('https://api.test/fast', { timeout: 1_000 });

    calls[0]!.resolve(5);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(req.data()).toBe(5);
    expect(req.error()).toBeNull();
  });

  it('a superseded request timing out does not report on behalf of the newer one', async () => {
    vi.useFakeTimers();
    const { calls } = deferredFetch({ honorAbort: false });
    const req = createFetch<number>('https://api.test/v', { timeout: 1_000 });

    await vi.advanceTimersByTimeAsync(500);
    const second = req.refetch();
    calls[1]!.resolve(2);
    await second;

    await vi.advanceTimersByTimeAsync(2_000);
    calls[0]!.resolve(1);
    await vi.advanceTimersByTimeAsync(0);

    expect(req.data()).toBe(2);
    expect(req.error()).toBeNull();
  });

  it('refetches when a reactive URL changes, aborting the request for the old URL', async () => {
    const { calls } = deferredFetch();
    const [id, setId] = createSignal(1);
    const req = createFetch<{ id: number }>(() => `https://api.test/items/${id()}`);

    expect(calls.map((c) => c.url)).toEqual(['https://api.test/items/1']);

    setId(2);
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.test/items/1',
      'https://api.test/items/2',
    ]);
    expect(calls[0]!.init.signal?.aborted).toBe(true);

    calls[1]!.resolve({ id: 2 });
    await flush();
    expect(req.data()).toEqual({ id: 2 });
    expect(req.loading()).toBe(false);
  });
});

describe('fetchJSON', () => {
  it('returns the parsed body and passes RequestInit through', async () => {
    const fn = vi.fn().mockResolvedValue(jsonResponse({ ok: 1 }));
    vi.stubGlobal('fetch', fn as unknown as typeof fetch);

    await expect(fetchJSON('/api/x', { method: 'PUT' })).resolves.toEqual({ ok: 1 });
    expect(fn).toHaveBeenCalledWith('/api/x', { method: 'PUT' });
  });

  it('propagates a network failure unchanged', async () => {
    const failure = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure) as unknown as typeof fetch);

    await expect(fetchJSON('/api/x')).rejects.toBe(failure);
  });
});
