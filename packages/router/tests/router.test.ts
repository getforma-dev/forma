import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onCleanup, createEffect } from '@getforma/core';
import { createRouter, createBrowserAdapter, defineRoutes, matchRoutes, Link, Outlet, type Router, type RouteAdapter } from '../src/index';
const routers: Router[] = [];
let root: HTMLElement;
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function make(adapter: RouteAdapter, extra: Record<string, unknown> = {}) {
  const router = createRouter({ root, routes: [{ id: 'any', path: '*' }], adapter, ...extra }); routers.push(router); return router;
}
function fake(prepare?: (path: string) => Promise<void>, commit?: (path: string) => void) {
  const commits: string[] = [], disposals: string[] = [];
  const adapter: RouteAdapter = { kind: 'browser', connect(container) { return {
    async initialize() { container.textContent = 'initial'; },
    async prepare(context) { const path = context.url.pathname; await prepare?.(path); let transferred = false; return {
      validate() {}, commit() { commit?.(path); commits.push(path); container.textContent = path; transferred = true; }, async activate() {}, dispose() { if (!transferred) disposals.push(path); },
    }; }, allowsAction: () => true, admitAction: (value: any) => value, dispose() {},
  }; } };
  return { adapter, commits, disposals };
}
beforeEach(() => {
  document.body.replaceChildren(); window.history.replaceState({}, '', '/a'); sessionStorage.clear();
  root = document.createElement('main'); document.body.append(root); vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { for (const router of routers.splice(0)) router.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('matching', () => {
  it('ranks static, parameter and splat and splits before decoding', () => {
    const routes = defineRoutes([{ id: 'wild', path: '*' }, { id: 'user', path: 'users/:id' }, { id: 'new', path: 'users/new' }]);
    expect(matchRoutes(routes, '/users/new')!.at(-1)!.id).toBe('new'); expect(matchRoutes(routes, '/users/a%2Fb')!.at(-1)!.params.id).toBe('a/b'); expect(matchRoutes(routes, '/else/where')!.at(-1)!.params['*']).toBe('else/where');
  });
  it('copies definitions and scopes null-prototype params to each owner', () => {
    const input = [{ id: 'shell', path: 'users', children: [{ id: 'leaf', path: ':__proto__' }] }]; const routes = defineRoutes(input); input[0].path = 'changed'; const match = matchRoutes(routes, '/users/alice')!;
    expect(Object.keys(match[0].params)).toEqual([]); expect(Object.getPrototypeOf(match[1].params)).toBeNull(); expect(match[1].params.__proto__).toBe('alice'); expect(Object.isFrozen(match[1].params)).toBe(true);
  });
  it.each([
    [[{ id: 'a', path: ':x' }, { id: 'b', path: ':y' }]], [[{ id: 'a', path: 'a?' }]], [[{ id: 'a', path: 'a/*/b' }]],
    [[{ id: 'a' }, { id: 'a', path: 'b' }]], [[{ id: 'a', index: true, path: 'x' }]],
  ])('refuses unsupported or ambiguous route configuration %j', routes => { expect(() => defineRoutes(routes as any)).toThrow(); });
  it('rejects route count/depth and malformed encodings', () => {
    expect(() => defineRoutes(Array.from({ length: 1001 }, (_, i) => ({ id: `r${i}`, path: String(i) })))).toThrow('ROUTER_ROUTE_LIMIT'); let route: any = { id: 'leaf' }; for (let i = 0; i < 33; i++) route = { id: `p${i}`, children: [route] }; expect(() => defineRoutes([route])).toThrow('ROUTER_ROUTE_DEPTH'); expect(() => matchRoutes(defineRoutes([{ id: 'a', path: '*' }]), '/%ZZ')).toThrow('ROUTER_ENCODING');
  });
});
describe('ownership and coordination', () => {
  it('preserves the parent across parameter changes and disposes child before parent', async () => {
    const events: string[] = []; const router = make(createBrowserAdapter(), { routes: [{ id: 'shell', render: ({ outlet }: any) => { createEffect(() => onCleanup(() => events.push('shell'))); const node = document.createElement('section'); node.append(Outlet({ outlet })); return node; }, children: [{ id: 'leaf', path: ':id', render: ({ params }: any) => { createEffect(() => onCleanup(() => events.push(params.id))); const node = document.createElement('p'); node.textContent = params.id; return node; } }] }] });
    await router.ready; const shell = root.firstElementChild; expect((await router.navigate('/b')).kind).toBe('committed'); expect(root.firstElementChild).toBe(shell); expect(root.textContent).toBe('b'); expect(events).toEqual(['a']); router.dispose(); expect(events).toEqual(['a', 'b', 'shell']);
  });
  it('disposes failed setup and rejected detached candidates', async () => {
    let disposed = 0; const router = make(createBrowserAdapter(), { routes: [{ id: 'a', path: 'a', render: () => document.createElement('p') }, { id: 'b', path: 'b', render: () => { createEffect(() => onCleanup(() => disposed++)); throw Error('setup'); } }] }); await router.ready; expect((await router.navigate('/b')).kind).toBe('failed'); expect(disposed).toBe(1); expect(router.location().url.pathname).toBe('/a');
  });
  it('cancels ignored aborts promptly and disposes their late prepared view', async () => {
    const held = deferred<void>(), f = fake(path => path === '/b' ? held.promise : Promise.resolve()); const router = make(f.adapter); await router.ready; const b = router.navigate('/b'); await flush(); expect((await router.navigate('/c')).kind).toBe('committed'); expect((await b).kind).toBe('cancelled'); held.resolve(); await flush(); expect(f.commits).toEqual(['/c']); expect(f.disposals).toEqual(['/b']);
  });
  it('serializes cleanup reentrancy and keeps only the latest queued destination', async () => {
    let router: Router; const results: Promise<any>[] = []; const f = fake(undefined, path => { if (path === '/b') results.push(router.navigate('/c'), router.navigate('/d')); }); router = make(f.adapter); await router.ready; await router.navigate('/b'); await Promise.all(results); expect(f.commits).toEqual(['/b', '/d']); expect((await results[0]).kind).toBe('cancelled');
  });
  it('reserves fallible history before the candidate commits', async () => {
    const f = fake(), router = make(f.adapter); await router.ready; vi.spyOn(history, 'pushState').mockImplementation(() => { throw new DOMException('quota'); }); expect((await router.navigate('/b')).kind).toBe('failed'); expect(f.commits).toEqual([]); expect(f.disposals).toEqual(['/b']); expect(root.textContent).toBe('initial');
  });
  it('returns defensive URL and params snapshots and preserves repeated search keys', async () => {
    const router = make(fake().adapter); await router.ready; await router.navigate('/b?tag=1&tag=2'); router.location().url.pathname = '/oops'; const copy = router.location(); expect(copy.url.pathname).toBe('/b'); expect(copy.url.searchParams.getAll('tag')).toEqual(['1', '2']); expect(Object.isFrozen(copy.matches[0].params)).toBe(true);
  });
  it('revalidation keeps visit identity and hash-only navigation keeps owners', async () => {
    const f = fake(), router = make(f.adapter); await router.ready; const key = router.location().key, length = history.length; expect((await router.revalidate()).kind).toBe('committed'); expect(router.location().key).toBe(key); expect(history.length).toBe(length); await router.navigate('/a#missing'); expect(f.commits).toEqual(['/a']); expect(router.location().key).not.toBe(key); expect(await router.navigate('/a#missing')).toEqual({ kind: 'cancelled', reason: 'unchanged' });
  });
  it('aborts an uncooperative guard and owns the new intent', async () => {
    const held = deferred<boolean>(), f = fake(), router = make(f.adapter); await router.ready; router.beforeLeave(url => url.pathname === '/b' ? held.promise : true); const b = router.navigate('/b'); await flush(); await router.navigate('/c'); expect((await b).kind).toBe('cancelled'); held.resolve(true); await flush(); expect(f.commits).toEqual(['/c']);
  });
  it('bounds an ignored loader and releases the pending slot', async () => {
    vi.useFakeTimers(); const held = deferred<void>(), router = make(fake(() => held.promise).adapter); await router.ready; const result = router.navigate('/b'); await flush(); await vi.advanceTimersByTimeAsync(15001); expect(await result).toEqual({ kind: 'failed', code: 'ROUTER_DEADLINE' }); expect(router.pending()).toBeUndefined(); held.resolve(); await flush();
  });
  it('does not connect or initialize after immediate disposal', async () => {
    const connect = vi.fn(() => fake().adapter.connect(root)); const router = make({ kind: 'browser', connect }); router.dispose(); await expect(router.ready).rejects.toBeDefined(); expect(connect).not.toHaveBeenCalled();
  });
  it('keeps ordinary link semantics and rejects duplicate ownership', async () => {
    const f = fake(), router = make(f.adapter); await router.ready; expect(() => createRouter({ root, adapter: f.adapter, routes: [] })).toThrow('ROUTER_ROOT'); const link = Link({ href: '/b', children: 'B', target: '_blank' }); root.append(link); let intercepted = true; document.addEventListener('click', e => { intercepted = e.defaultPrevented; e.preventDefault(); }, { once: true }); const event = new MouseEvent('click', { bubbles: true, cancelable: true }); link.dispatchEvent(event); expect(intercepted).toBe(false); expect(link.textContent).toBe('B');
  });
});
function form() { const el = document.createElement('form'); el.method = 'post'; el.action = '/save'; el.innerHTML = '<input name="name" value="A"><p data-forma-form-error></p><button name="intent" value="save">Save</button>'; root.replaceChildren(el); return el; }
function response(outcome: string, data: Record<string, unknown> = {}, status = 200) { return new Response(JSON.stringify({ outcome, status, data }), { status, headers: { 'Content-Type': 'application/vnd.forma.action+json', 'Cache-Control': 'no-store', Vary: 'Accept' } }); }
describe('managed forms', () => {
  it('announces an unknown submission once and keeps the warning until resolution without resending', async () => {
    const warning = 'Submission outcome unknown. Check server status before submitting again.';
    const fetcher = vi.fn(async () => { throw new TypeError('Connection lost'); }); vi.stubGlobal('fetch', fetcher);
    const router = make(fake().adapter); await router.ready;
    const status = document.querySelector('[data-forma-router-status]')!;
    expect(await router.submit(form())).toEqual({ kind: 'uncertain' });
    expect(status.textContent).toBe(warning);
    const marker = sessionStorage.getItem('forma-router:uncertain'); expect(marker).not.toBeNull();
    expect(await router.submit(form())).toEqual({ kind: 'uncertain' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await router.navigate('/b')).kind).toBe('committed');
    expect(status.textContent).toBe(`Page ready. ${warning}`);
    expect(await router.resolveUncertain(async () => false)).toBe(false);
    expect(router.mutation()).toBe('uncertain');
    expect(sessionStorage.getItem('forma-router:uncertain')).toBe(marker);
    expect(await router.resolveUncertain(async () => true)).toBe(true);
    expect(router.mutation()).toBe('idle');
    expect(sessionStorage.getItem('forma-router:uncertain')).toBeNull();
    expect(status.textContent).toBe('Submission status resolved');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('holds one mutation slot and never replays a lost POST', async () => {
    const held = deferred<Response>(), fetcher = vi.fn(() => held.promise); vi.stubGlobal('fetch', fetcher); const router = make(fake().adapter); await router.ready; const el = form(); const first = router.submit(el); await flush(); expect(await router.submit(el)).toEqual({ kind: 'busy' }); held.resolve(new Response('lost', { status: 500 })); expect(await first).toEqual({ kind: 'uncertain' }); expect(await router.submit(el)).toEqual({ kind: 'uncertain' }); expect(fetcher).toHaveBeenCalledTimes(1); expect(await router.resolveUncertain(async () => false)).toBe(false); expect(await router.resolveUncertain(async () => true)).toBe(true); expect(router.mutation()).toBe('idle');
  });
  it('does not redirect a newer route when an old form completes', async () => {
    const held = deferred<Response>(); vi.stubGlobal('fetch', vi.fn(() => held.promise)); const f = fake(), router = make(f.adapter); await router.ready; const pending = router.submit(form()); await flush(); await router.navigate('/b'); held.resolve(response('redirect', { status: 303, location: '/old-success' })); expect(await pending).toEqual({ kind: 'success' }); expect(router.location().url.pathname).toBe('/b'); expect(f.commits).toEqual(['/b', '/b']);
  });
  it('restarts a pending newer GET when validation settles without stealing its UI', async () => {
    const action = deferred<Response>(), get = deferred<void>(); vi.stubGlobal('fetch', vi.fn(() => action.promise)); let reads = 0; const f = fake(path => path === '/b' && ++reads === 1 ? get.promise : Promise.resolve()); const onAction = vi.fn(); const router = make(f.adapter, { onAction }); await router.ready; const post = router.submit(form()); await flush(); const b = router.navigate('/b'); await flush(); action.resolve(response('validation', { message: 'Invalid' }, 422)); await post; await flush(); expect((await b).kind).toBe('cancelled'); expect(router.location().url.pathname).toBe('/b'); expect(onAction).not.toHaveBeenCalled(); get.resolve(); await flush(); expect(f.commits).toEqual(['/b']);
  });
  it('does not misclassify a throwing UI callback as an unknown server outcome', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('validation', { message: '<b>Invalid</b>' }, 422))); const router = make(fake().adapter, { onAction() { throw Error('UI failure'); } }); await router.ready; const el = form(); expect((await router.submit(el)).kind).toBe('validation'); expect(router.mutation()).toBe('idle'); expect(el.querySelector('[data-forma-form-error]')!.textContent).toBe('<b>Invalid</b>'); expect(el.querySelector('b')).toBeNull();
  });
  it('bounds a POST that ignores abort without claiming rollback', async () => {
    vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {}))); const router = make(fake().adapter); await router.ready; const post = router.submit(form()); await flush(); await vi.advanceTimersByTimeAsync(30001); expect(await post).toEqual({ kind: 'uncertain' }); expect(router.mutation()).toBe('uncertain');
  });
  it('preserves native handling of unsupported form targets/methods/encodings', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const router = make(fake().adapter); await router.ready; const el = form(); el.target = '_blank'; expect(await router.submit(el)).toEqual({ kind: 'unsupported' }); el.target = ''; el.enctype = 'text/plain'; expect(await router.submit(el)).toEqual({ kind: 'unsupported' }); expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('bounded speculation', () => {
  it('keeps at most two opted-in requests, shares only in-flight preparation, and keeps no completed cache', async () => {
    const held = deferred<void>(); let prepares = 0;
    const f = fake(async () => { prepares++; await held.promise; });
    const router = make({ ...f.adapter, kind: 'html' }, { canPrefetch: () => true }); await router.ready;
    const first = router.prefetch('/b'), second = router.prefetch('/c'); await flush();
    expect(await router.prefetch('/d')).toBe('skipped'); const navigation = router.navigate('/b'); await flush(); held.resolve();
    expect(await first).toBe('completed'); expect(await second).toBe('cancelled'); expect((await navigation).kind).toBe('committed'); expect(prepares).toBe(2);
    await router.prefetch('/c'); expect(prepares).toBe(3); await router.navigate('/c'); expect(prepares).toBe(4);
  });
  it('does not speculate without application permission or for browser-rendered owners', async () => {
    const f = fake(), router = make(f.adapter, { canPrefetch: () => true }); await router.ready; expect(await router.prefetch('/b')).toBe('skipped');
    router.dispose();
    const secondRoot = document.createElement('main'); document.body.append(secondRoot);
    const second = createRouter({ root: secondRoot, routes: [{ id: 'all', path: '*' }], adapter: { ...f.adapter, kind: 'html' } }); routers.push(second); await second.ready; expect(await second.prefetch('/b')).toBe('skipped');
  });
  it('releases a completed speculative owner immediately and disposal cancels a pending one', async () => {
    const f = fake(), router = make({ ...f.adapter, kind: 'html' }, { canPrefetch: () => true }); await router.ready;
    expect(await router.prefetch('/b')).toBe('completed'); expect(f.disposals).toEqual(['/b']);
    const pending = router.prefetch('/c'); router.dispose(); expect(await pending).toBe('cancelled');
  });
});
describe('synchronous teardown authority', () => {
  it.each(['dispose', 'invalidateContext'] as const)('cannot repopulate the root when old-owner cleanup calls %s', async method => {
    let router: Router, cleanups = 0;
    // Suppress actual document recovery in this unit environment; browser fixture verifies GETs.
    vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    router = make(createBrowserAdapter(), { routes: [
      { id: 'a', path: 'a', render: () => { createEffect(() => onCleanup(() => { cleanups++; router[method](); })); return document.createElement('p'); } },
      { id: 'b', path: 'b', render: () => { const node = document.createElement('section'); node.id = 'forbidden-after-revoke'; return node; } },
    ] });
    await router.ready; const outcome = await router.navigate('/b');
    expect(outcome.kind).toBe('cancelled'); expect(cleanups).toBe(1); expect(root.querySelector('#forbidden-after-revoke')).toBeNull(); expect(router.location().url.pathname).toBe('/a');
  });
  it('rechecks authority after a validator synchronously supersedes navigation', async () => {
    let router: Router, injected = false;
    const adapter: RouteAdapter = { kind: 'browser', connect() { return { async prepare(context) { return { validate() { if (context.url.pathname === '/b' && !injected) { injected = true; void router.navigate('/c'); } }, commit() { root.textContent = context.url.pathname; }, async activate() {}, dispose() {} }; }, dispose() {} }; } };
    router = make(adapter); await router.ready; await router.navigate('/b'); await flush(); expect(root.textContent).toBe('/c'); expect(router.location().url.pathname).toBe('/c');
  });
  it('revokes a foreground context checker that ignores its deadline', async () => {
    vi.useFakeTimers(); vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    const router = make(fake().adapter, { checkContext: () => new Promise<boolean>(() => {}) }); await router.ready;
    document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(15001);
    expect(root.childNodes.length).toBe(0); expect((await router.navigate('/b')).kind).toBe('cancelled');
  });
});
it('revokes private owners after a transmitted POST receives an authentication boundary', async () => {
  vi.spyOn(window.location, 'replace').mockImplementation(() => {}); vi.stubGlobal('fetch', vi.fn(async () => new Response('Login required', { status: 401 })));
  const router = make(fake().adapter); await router.ready; expect(await router.submit(form())).toEqual({ kind: 'uncertain' }); expect(root.childNodes.length).toBe(0); expect(router.mutation()).toBe('uncertain'); expect((await router.navigate('/b')).kind).toBe('cancelled');
});
it('suspends enhanced reads, speculation and POST while a fresh context check is held', async () => {
  const check = deferred<boolean>(), fetcher = vi.fn(async () => response('validation', {}, 422)), f = fake(); vi.stubGlobal('fetch', fetcher);
  const router = make({ ...f.adapter, kind: 'html' }, { checkContext: () => check.promise, canPrefetch: () => true }); await router.ready; const el = form();
  document.dispatchEvent(new Event('visibilitychange')); const nav = router.navigate('/b'), post = router.submit(el); await flush();
  expect(await router.prefetch('/c')).toBe('skipped'); expect(f.commits).toEqual([]); expect(fetcher).not.toHaveBeenCalled();
  check.resolve(true); await nav; await post; expect(fetcher.mock.calls.length).toBeLessThanOrEqual(1);
});
it('a stale successful context check cannot reopen an invalidated private branch', async () => {
  vi.spyOn(window.location, 'replace').mockImplementation(() => {}); const check = deferred<boolean>();
  const router = make(fake().adapter, { checkContext: () => check.promise }); await router.ready; document.dispatchEvent(new Event('visibilitychange')); const nav = router.navigate('/b'); await flush(); router.invalidateContext(); check.resolve(true);
  expect((await nav).kind).toBe('cancelled'); expect(root.childNodes.length).toBe(0); expect((await router.navigate('/c')).kind).toBe('cancelled');
});
describe('history cursor ownership', () => {
  it.each([false, true])('uses the visible cursor for an imperative write during a held POP (replace=%s)', async replace => {
    const router = make(fake().adapter); await router.ready; const aState = structuredClone(history.state);
    await router.navigate('/b'); const bState = structuredClone(history.state); await router.navigate('/c');
    const held = deferred<boolean>(); let hold = true;
    router.beforeLeave(url => url.pathname === '/b' && hold ? held.promise : true);
    history.replaceState(bState, '', '/b'); window.dispatchEvent(new PopStateEvent('popstate', { state: bState })); await flush();
    await router.navigate('/d', { replace }); hold = false; held.resolve(false); await flush();
    expect((history.state as any).__formaRouter.index).toBe(replace ? 1 : 2);
    const dState = structuredClone(history.state), oldState = replace ? aState : bState;
    router.beforeLeave(() => false); const go = vi.spyOn(history, 'go').mockImplementation(delta => { expect(delta).toBe(1); history.replaceState(dState, '', '/d'); window.dispatchEvent(new PopStateEvent('popstate', { state: dState })); });
    history.replaceState(oldState, '', replace ? '/a' : '/b'); window.dispatchEvent(new PopStateEvent('popstate', { state: oldState })); await flush(); expect(go).toHaveBeenCalledWith(1); expect(router.location().url.pathname).toBe('/d');
  });
  it('updates a redirected POP URL with replace while retaining its entry identity', async () => {
    let redirect = false;
    const base = fake(); const adapter: RouteAdapter = { kind: 'browser', connect(root) { const inner = base.adapter.connect(root); return { ...inner, async prepare(context) { return redirect && context.url.pathname === '/a' ? { redirect: '/target' } : inner.prepare(context); } }; } };
    const router = make(adapter); await router.ready; const aState = structuredClone(history.state); await router.navigate('/b'); redirect = true;
    history.replaceState(aState, '', '/a'); const length = history.length; window.dispatchEvent(new PopStateEvent('popstate', { state: aState })); await flush();
    expect(router.location().url.pathname).toBe('/target'); expect(window.location.pathname).toBe('/target'); expect(router.location().key).toBe((aState as any).__formaRouter.key); expect(history.length).toBe(length);
  });
});
it.each(['revalidate', 'foreground', 'submit'])('repairs a cancelled pending POP before %s resumes the committed view', async operation => {
  const router = make(fake().adapter, { checkContext: async () => true }); await router.ready; await router.navigate('/b'); const b = structuredClone(history.state); await router.navigate('/c'); const c = structuredClone(history.state);
  const held = deferred<boolean>(); router.beforeLeave(url => url.pathname === '/b' ? held.promise : true);
  history.replaceState(b, '', '/b'); window.dispatchEvent(new PopStateEvent('popstate', { state: b })); await flush();
  vi.spyOn(history, 'go').mockImplementation(delta => { expect(delta).toBe(1); history.replaceState(c, '', '/c'); window.dispatchEvent(new PopStateEvent('popstate', { state: c })); });
  if (operation === 'revalidate') await router.revalidate();
  else if (operation === 'foreground') { document.dispatchEvent(new Event('visibilitychange')); await flush(); }
  else { vi.stubGlobal('fetch', vi.fn(async () => response('validation', {}, 422))); await router.submit(form()); }
  held.resolve(false); await flush(); expect(history.go).toHaveBeenCalledWith(1); expect(window.location.pathname).toBe('/c'); expect(router.location().url.pathname).toBe('/c'); expect(router.location().key).toBe((c as any).__formaRouter.key);
});
it('does not start speculative resources after a permission callback disposes the router', async () => {
  let router: Router; const prepare = vi.fn(async () => {}), f = fake(prepare);
  router = make({ ...f.adapter, kind: 'html' }, { canPrefetch() { router.dispose(); return true; } }); await router.ready;
  expect(await router.prefetch('/b')).toBe('skipped'); expect(prepare).not.toHaveBeenCalled();
});
it('does not speculate while offline', async () => {
  const f = fake(), router = make({ ...f.adapter, kind: 'html' }, { canPrefetch: () => true }); await router.ready;
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); expect(await router.prefetch('/b')).toBe('skipped'); expect(f.disposals).toEqual([]);
});
