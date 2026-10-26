import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEffect, onCleanup } from '@getforma/core';
import { createRouter, createBrowserAdapter, type Router, type RouteAdapter } from '../src/index';

let root: HTMLElement, router: Router;
beforeEach(() => {
  document.body.replaceChildren(); history.replaceState({}, '', '/current'); sessionStorage.clear();
  root = document.createElement('main'); document.body.append(root);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { router?.dispose(); vi.restoreAllMocks(); });

it.each(['commit', 'activate', 'title'] as const)('recovers one same-URL GET after an irreversible browser %s failure', async phase => {
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
  const adapter: RouteAdapter = { kind: 'browser', connect() { return {
    async initialize() { root.textContent = 'original'; },
    async prepare() { return {
      validate() {},
      commit() { root.textContent = 'replacement'; if (phase === 'commit') throw Error('commit'); },
      async activate() { if (phase === 'activate') throw Error('activate'); },
      dispose() {},
    }; },
    dispose() {},
  }; } };
  router = createRouter({ root, adapter, routes: [{ id: 'current', path: 'current' }],
    title() { if (phase === 'title') throw Error('title'); return 'Current'; } });
  await router.ready;
  const key = router.location().key, length = history.length;
  expect((await router.revalidate()).kind).toBe('document-navigation');
  expect(root.textContent).toBe('replacement');
  expect(replace).toHaveBeenCalledExactlyOnceWith(new URL('/current', location.href).href);
  expect(router.location().key).toBe(key); expect(history.length).toBe(length);
  // A repeatedly failing destination cannot create an automatic reload loop.
  expect(await router.revalidate()).toEqual({ kind: 'failed', code: 'ROUTER_RECOVERY_LIMIT' });
  expect(replace).toHaveBeenCalledTimes(1);
});

it('recovers a title failure after the built-in browser adapter releases and replaces its owner', async () => {
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
  let renders = 0, oldDisposed = 0;
  router = createRouter({ root, adapter: createBrowserAdapter(), routes: [{ id: 'current', path: 'current', render() {
    const number = ++renders, node = document.createElement('p'); node.textContent = String(number);
    createEffect(() => onCleanup(() => { if (number === 1) oldDisposed++; }));
    return node;
  } }], title() { throw Error('title after replacement'); } });
  await router.ready; const old = root.firstElementChild, length = history.length;
  expect((await router.revalidate()).kind).toBe('document-navigation');
  expect(oldDisposed).toBe(1); expect(root.firstElementChild).not.toBe(old); expect(root.textContent).toBe('2');
  expect(replace).toHaveBeenCalledExactlyOnceWith(new URL('/current', location.href).href);
  expect(history.length).toBe(length);
});

it('keeps the original owner when browser revalidation fails before commit', async () => {
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
  let renders = 0;
  router = createRouter({ root, adapter: createBrowserAdapter(), routes: [{ id: 'current', path: 'current', render() {
    if (++renders > 1) throw Error('prepare');
    const node = document.createElement('p'); node.textContent = 'original'; return node;
  } }] });
  await router.ready; const old = root.firstElementChild;
  expect((await router.revalidate()).kind).toBe('failed');
  expect(root.firstElementChild).toBe(old); expect(root.textContent).toBe('original');
  expect(replace).not.toHaveBeenCalled();
});
