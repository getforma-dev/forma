import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEffect, createUnownedRoot } from '@getforma/core';
import { createRouter, NavigationError, type Router, type RouteAdapter, type RouterOptions } from '../src/index';
const routers: Router[] = [], stops: (() => void)[] = [];
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; };
let root: HTMLElement;
function make(adapter: RouteAdapter, options: Partial<RouterOptions> = {}) { const router = createRouter({ root, routes: [{ id: 'all', path: '*' }], adapter, ...options }); routers.push(router); return router; }
function observe(fn: () => void) { createUnownedRoot(stop => { stops.push(stop); createEffect(fn); }); }
function fixture(options: { kind?: 'browser' | 'native'; prepare?: (path: string) => void; commit?: (path: string) => void; dispose?: () => void; invalidate?: () => void } = {}) {
  const commits: string[] = [], activations: string[] = [];
  const adapter: RouteAdapter = { kind: options.kind ?? 'browser', connect() { return {
    async initialize() { root.textContent = 'initial'; },
    async prepare({ url }) { options.prepare?.(url.pathname); return { validate() {}, commit() { options.commit?.(url.pathname); commits.push(url.pathname); root.innerHTML = '<h1 tabindex="-1">' + url.pathname + '</h1>'; }, async activate() { activations.push(url.pathname); }, dispose() {} }; },
    allowsAction: () => true, admitAction: (data: any) => data,
    dispose() { options.dispose?.(); }, invalidate() { options.invalidate?.(); },
  }; } };
  return { adapter, commits, activations };
}
function form() { const el = document.createElement('form'); el.method = 'post'; el.action = '/save'; el.innerHTML = '<input name="name" value="test">'; root.append(el); return el; }
function response(outcome = 'success', status = 200) { return new Response(JSON.stringify({ outcome, status, data: {} }), { status, headers: { 'Content-Type': 'application/vnd.forma.action+json', 'Cache-Control': 'no-store', Vary: 'Accept' } }); }
beforeEach(() => { document.body.replaceChildren(); history.replaceState({}, '', '/a'); sessionStorage.clear(); document.title = 'Original'; root = document.createElement('main'); document.body.append(root); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
afterEach(() => { for (const stop of stops.splice(0)) stop(); for (const router of routers.splice(0)) router.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each(['dispose', 'navigate', 'invalidate'] as const)('does not recover an old navigation after onError calls %s', async mode => {
  const replace = vi.spyOn(location, 'replace').mockImplementation(() => {}); let router: Router, newer: Promise<unknown> | undefined;
  const f = fixture({ kind: 'native', prepare(path) { if (path === '/b') throw new NavigationError('TEST_FAILURE', true); } });
  router = make(f.adapter, { onError() { if (mode === 'dispose') router.dispose(); else if (mode === 'invalidate') router.invalidateContext(); else newer = router.navigate('/c'); } });
  await router.ready; expect((await router.navigate('/b')).kind).toBe('cancelled'); await newer;
  expect(replace.mock.calls.map(([url]) => url)).toEqual(mode === 'invalidate' ? ['http://localhost:3000/a'] : []);
  if (mode === 'navigate') expect(router.location().url.pathname).toBe('/c');
});
it('still performs one method-safe recovery for its own authentication revocation', async () => {
  const replace = vi.spyOn(location, 'replace').mockImplementation(() => {}), errors: string[] = [];
  const router = make(fixture({ kind: 'native', prepare() { throw new NavigationError('ROUTER_AUTH', true, true); } }).adapter, { onError: code => errors.push(code) });
  await router.ready; expect((await router.navigate('/b')).kind).toBe('document-navigation');
  expect(replace).toHaveBeenCalledOnce(); expect(errors).toEqual(['ROUTER_AUTH']); expect(root.childNodes).toHaveLength(0);
});
it('makes invalidation inert after disposal and repeated revocation', async () => {
  const replace = vi.spyOn(location, 'replace').mockImplementation(() => {}); const router = make(fixture().adapter); await router.ready;
  router.dispose(); router.invalidateContext(); expect(replace).not.toHaveBeenCalled();
  const second = make(fixture().adapter); await second.ready; second.invalidateContext();
  const text = document.querySelector('[data-forma-router-status]')!.textContent; second.invalidateContext();
  expect(replace).toHaveBeenCalledOnce(); expect(document.querySelector('[data-forma-router-status]')!.textContent).toBe(text);
});
it('does not clear replacement content or recover after revocation cleanup reports an error that disposes', async () => {
  const replace = vi.spyOn(location, 'replace').mockImplementation(() => {}); let router: Router;
  router = make(fixture({ invalidate() { throw Error('cleanup'); } }).adapter, { onError() { router.dispose(); root.textContent = 'replacement'; } });
  await router.ready; router.invalidateContext(); expect(replace).not.toHaveBeenCalled(); expect(root.textContent).toBe('replacement');
});
it('does not restore busy state after a pending subscriber disposes', async () => {
  const router = make(fixture().adapter); await router.ready; observe(() => { if (router.pending()) router.dispose(); });
  expect((await router.navigate('/b')).kind).toBe('cancelled'); expect(root.hasAttribute('aria-busy')).toBe(false);
});
it('does not assign a title or activate after the title callback disposes', async () => {
  let router: Router; const f = fixture(); router = make(f.adapter, { title() { router.dispose(); return 'stale title'; } });
  await router.ready; expect((await router.navigate('/b')).kind).toBe('cancelled'); expect(f.activations).toEqual([]); expect(document.title).toBe('Original');
});
it('preserves the new destination requested by a mutation-state subscriber', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response())); const f = fixture(), router = make(f.adapter); await router.ready; let once = false;
  observe(() => { if (router.mutation() === 'revalidating' && !once) { once = true; void router.navigate('/c'); } });
  expect((await router.submit(form())).kind).toBe('success'); await flush(); expect(router.location().url.pathname).toBe('/c'); expect(f.commits).toEqual(['/c']);
});
it('resolves a cleanup-queued revalidation from the newly committed URL', async () => {
  let router: Router, queued: Promise<unknown> | undefined, once = false;
  const f = fixture({ commit(path) { if (path === '/b' && !once) { once = true; queued = router.revalidate(); } } }); router = make(f.adapter); await router.ready;
  await router.navigate('/b'); await queued; expect(f.commits).toEqual(['/b', '/b']); expect(router.location().url.pathname).toBe('/b'); expect(location.pathname).toBe('/b');
});
it('retains the Document reservation until every disposal callback finishes', async () => {
  let refusal: string | undefined;
  const router = make(fixture({ dispose() { try { make(fixture().adapter); } catch (error) { refusal = (error as NavigationError).code; } } }).adapter);
  await router.ready; router.dispose(); expect(refusal).toBe('ROUTER_ROOT');
  const replacement = make(fixture().adapter); await replacement.ready;
});
it('disposes a session returned after connect revokes the coordinator without initializing it', async () => {
  let router: Router; const initialized = vi.fn(), disposed = vi.fn();
  router = make({ kind: 'browser', connect() { router.dispose(); return { initialize: async () => { initialized(); }, prepare: async () => { throw Error('unused'); }, dispose: disposed }; } });
  await expect(router.ready).rejects.toBeDefined(); expect(initialized).not.toHaveBeenCalled(); expect(disposed).toHaveBeenCalledOnce();
});
it('does not scroll after destination focus synchronously disposes', async () => {
  const f = fixture(), router = make(f.adapter); await router.ready;
  root.addEventListener('focusin', () => router.dispose(), { once: true });
  await router.navigate('/b'); expect(window.scrollTo).not.toHaveBeenCalled();
});
it('aborts the one owned uncertainty resolver on disposal', async () => {
  sessionStorage.setItem('forma-router:uncertain', '1'); const router = make(fixture().adapter); await router.ready;
  const held = deferred<boolean>(); let signal!: AbortSignal, settled: boolean | undefined;
  const result = router.resolveUncertain(value => { signal = value; return held.promise; }); void result.then(value => { settled = value; });
  try { router.dispose(); await flush(); expect(signal.aborted).toBe(true); expect(settled).toBe(false); }
  finally { held.resolve(false); await result; }
});
it('persists uncertainty before sending and clears it only after an admitted outcome', async () => {
  const held = deferred<Response>(); const fetcher = vi.fn(() => held.promise); vi.stubGlobal('fetch', fetcher);
  const router = make(fixture().adapter); await router.ready; const post = router.submit(form()); await flush();
  try { expect(fetcher).toHaveBeenCalledOnce(); expect(sessionStorage.getItem('forma-router:uncertain')).toMatch(/^[a-f0-9-]{36}$/); expect(router.mutation()).toBe('submitting'); }
  finally { held.resolve(response('validation', 422)); await post; }
  expect(sessionStorage.getItem('forma-router:uncertain')).toBeNull();
});
it('fresh documents expose the uncertainty latch and cannot transmit another POST', async () => {
  sessionStorage.setItem('forma-router:uncertain', '1'); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const router = make(fixture().adapter); await router.ready; expect(router.mutation()).toBe('uncertain'); expect(await router.submit(form())).toEqual({ kind: 'uncertain' }); expect(fetcher).not.toHaveBeenCalled();
});
it('refuses before transmission if the durable uncertainty marker cannot be written', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const router = make(fixture().adapter); await router.ready;
  const storage = sessionStorage; vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue({ ...storage, getItem: storage.getItem.bind(storage), setItem() { throw new DOMException('blocked', 'SecurityError'); } } as Storage);
  expect(await router.submit(form())).toEqual({ kind: 'error', status: 0, data: { code: 'ROUTER_UNCERTAINTY_STORAGE' } }); expect(fetcher).not.toHaveBeenCalled(); expect(router.mutation()).toBe('idle');
});

it('rechecks the shared marker before transmission instead of overwriting another document attempt', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const router = make(fixture().adapter); await router.ready;
  sessionStorage.setItem('forma-router:uncertain', 'other-document');
  expect(await router.submit(form())).toEqual({ kind: 'uncertain' }); expect(fetcher).not.toHaveBeenCalled(); expect(sessionStorage.getItem('forma-router:uncertain')).toBe('other-document');
});
it('a late known response cannot clear a newer document marker', async () => {
  const held = deferred<Response>(); vi.stubGlobal('fetch', vi.fn(() => held.promise)); const router = make(fixture().adapter); await router.ready;
  const post = router.submit(form()); await flush(); sessionStorage.setItem('forma-router:uncertain', 'newer-attempt'); held.resolve(response('validation', 422));
  expect((await post).kind).toBe('validation'); expect(sessionStorage.getItem('forma-router:uncertain')).toBe('newer-attempt'); expect(router.mutation()).toBe('uncertain');
  expect(await router.resolveUncertain(async () => true)).toBe(false); expect(sessionStorage.getItem('forma-router:uncertain')).toBe('newer-attempt');
});
it('disposal cannot replace a newer marker with an old in-flight attempt', async () => {
  const held = deferred<Response>(); vi.stubGlobal('fetch', vi.fn(() => held.promise)); const router = make(fixture().adapter); await router.ready;
  const post = router.submit(form()); await flush(); sessionStorage.setItem('forma-router:uncertain', 'newer-attempt'); router.dispose(); await post;
  expect(sessionStorage.getItem('forma-router:uncertain')).toBe('newer-attempt'); held.resolve(response());
});
it('a resolver cannot clear a marker replaced while its status check was pending', async () => {
  sessionStorage.setItem('forma-router:uncertain', '1'); const router = make(fixture().adapter); await router.ready;
  const held = deferred<boolean>(); const resolving = router.resolveUncertain(() => held.promise); sessionStorage.setItem('forma-router:uncertain', 'newer-attempt'); held.resolve(true);
  expect(await resolving).toBe(false); expect(sessionStorage.getItem('forma-router:uncertain')).toBe('newer-attempt'); expect(router.mutation()).toBe('uncertain');
});
it('refuses before transmission if the uncertainty marker cannot be read', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const router = make(fixture().adapter); await router.ready;
  vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue({ getItem() { throw new DOMException('blocked', 'SecurityError'); } } as unknown as Storage);
  expect(await router.submit(form())).toEqual({ kind: 'error', status: 0, data: { code: 'ROUTER_UNCERTAINTY_STORAGE' } }); expect(fetcher).not.toHaveBeenCalled();
});
it('does not invoke a queued foreground check after disposal', async () => {
  const checkContext = vi.fn(async () => true), router = make(fixture().adapter, { checkContext }); await router.ready;
  document.dispatchEvent(new Event('visibilitychange')); router.dispose(); await flush(); expect(checkContext).not.toHaveBeenCalled();
});
it('refuses speculation when its attestation callback changes context', async () => {
  const check = deferred<boolean>(), prepare = vi.fn(); let router: Router;
  router = make(fixture({ kind: 'native', prepare }).adapter, { checkContext: () => check.promise, canPrefetch() { document.dispatchEvent(new Event('visibilitychange')); return true; } });
  await router.ready; expect(await router.prefetch('/b')).toBe('skipped'); expect(prepare).not.toHaveBeenCalled(); check.resolve(true); await flush();
});

it('an abort listener owns its newer navigation instead of sharing the cancelled outer epoch', async () => {
  const held = deferred<any>(), commits: string[] = []; let router: Router, newer: Promise<unknown> | undefined;
  const view = (path: string) => ({ validate() {}, commit() { commits.push(path); }, async activate() {}, dispose() {} });
  router = make({ kind: 'browser', connect() { return { async prepare({ url, signal }) {
    if (url.pathname === '/b') { signal.addEventListener('abort', () => { newer = router.navigate('/c'); }, { once: true }); return held.promise; }
    return view(url.pathname);
  }, dispose() {} }; } });
  await router.ready; const first = router.navigate('/b'); await flush(); const outer = router.navigate('/d');
  expect((await outer).kind).toBe('cancelled'); await newer; expect(commits).toEqual(['/c']); expect(router.location().url.pathname).toBe('/c');
  held.resolve(view('/b')); expect((await first).kind).toBe('cancelled');
});
it('restores form busy ownership during disposal without writing over a later owner', async () => {
  const held = deferred<Response>(); vi.stubGlobal('fetch', vi.fn(() => held.promise)); const router = make(fixture().adapter); await router.ready; const el = form();
  const post = router.submit(el); await flush(); router.dispose(); expect(el.hasAttribute('aria-busy')).toBe(false);
  el.setAttribute('aria-busy', 'replacement'); await post; expect(el.getAttribute('aria-busy')).toBe('replacement'); held.resolve(response());
});

it('does not abort a foreground checker that has already completed', async () => {
  const aborted = vi.fn(), router = make(fixture().adapter, { checkContext: async signal => { signal.addEventListener('abort', aborted); return true; } }); await router.ready;
  document.dispatchEvent(new Event('visibilitychange')); await flush(); document.dispatchEvent(new Event('visibilitychange')); await flush(); router.dispose();
  expect(aborted).not.toHaveBeenCalled();
});

it('a POST cancelled from an old navigation abort listener does not reconnect a disposed session', async () => {
  let router: Router; const connects = vi.fn(), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  router = make({ kind: 'browser', connect() { connects(); return {
    async prepare({ signal }) { signal.addEventListener('abort', () => router.dispose(), { once: true }); return new Promise<any>(() => {}); },
    allowsAction: () => true, admitAction: (data: any) => data, dispose() {},
  }; } });
  await router.ready; const el = form(), navigation = router.navigate('/b'); await flush();
  expect(await router.submit(el)).toEqual({ kind: 'disposed' }); expect(connects).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled(); await navigation;
});

it('reserves foreground verification before old abort listeners can start speculation', async () => {
  const check = deferred<boolean>(), prepares: string[] = []; let router: Router, speculation: Promise<string> | undefined;
  router = make({ kind: 'native', connect() { return { async prepare({ url, signal }) {
    prepares.push(url.pathname); signal.addEventListener('abort', () => { speculation = router.prefetch('/c'); }, { once: true }); return new Promise<any>(() => {});
  }, dispose() {} }; } }, { checkContext: () => check.promise, canPrefetch: () => true });
  await router.ready; const first = router.navigate('/b'); await flush(); document.dispatchEvent(new Event('visibilitychange')); await flush();
  expect(await speculation).toBe('skipped'); expect(prepares).toEqual(['/b']); check.resolve(true); await first;
});
