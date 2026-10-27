import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBrowserAdapter, createRouter, type Router } from '../src/index';

let root: HTMLElement, router: Router | undefined;
beforeEach(() => {
  document.body.replaceChildren(); history.replaceState({}, '', '/initial'); sessionStorage.clear();
  root = document.createElement('main'); document.body.append(root);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { router?.dispose(); router = undefined; vi.restoreAllMocks(); });

it('keeps at most1,000 scroll records immediately after each committed visit', async () => {
  let now = 0, scroll: Map<string, [number, number]> | undefined;
  vi.spyOn(window.performance, 'now').mockImplementation(() => now);
  const originalSet = Map.prototype.set;
  vi.spyOn(Map.prototype, 'set').mockImplementation(function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    const result = originalSet.call(this, key, value);
    if (typeof key === 'string' && /^[a-f0-9-]{36}$/.test(key) && Array.isArray(value)
      && value.length === 2 && value.every(coordinate => typeof coordinate === 'number')) {
      scroll = this as Map<string, [number, number]>;
    }
    return result;
  });
  router = createRouter({ root, adapter: createBrowserAdapter(), routes: [{ id: 'all', path: '*', render: () => document.createElement('p') }] });
  await router.ready;
  const initial = router.location().key;
  for (let i = 1; i <= 1000; i++) {
    now += 200; // Keep this metadata-boundary test outside the separate history-rate bound.
    expect((await router.navigate(`/visit/${i}`, { replace: true })).kind).toBe('committed');
    expect(scroll!.has(router.location().key)).toBe(true);
    expect(scroll!.size).toBeLessThanOrEqual(1000);
    if (i === 999) { expect(scroll!.size).toBe(1000); expect(scroll!.has(initial)).toBe(true); }
  }
  expect(scroll!.size).toBe(1000);
  expect(scroll!.has(initial)).toBe(false);
});

it('bounds newly committed scroll identity before a title failure and a later preparation failure', async () => {
  let now = 0, scroll: Map<string, [number, number]> | undefined;
  vi.spyOn(window.performance, 'now').mockImplementation(() => now);
  const originalSet = Map.prototype.set;
  vi.spyOn(Map.prototype, 'set').mockImplementation(function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    const result = originalSet.call(this, key, value);
    if (typeof key === 'string' && /^[a-f0-9-]{36}$/.test(key) && Array.isArray(value)
      && value.length === 2 && value.every(coordinate => typeof coordinate === 'number')) {
      scroll = this as Map<string, [number, number]>;
    }
    return result;
  });
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
  sessionStorage.setItem('forma-router:recovery', JSON.stringify({ build: 'default', entries: Array.from({ length: 32 }, (_, i) => `full:${i}`) }));
  router = createRouter({ root, adapter: createBrowserAdapter(), routes: [{ id: 'all', path: '*', render({ url }) {
    if (url.pathname === '/prepare-failure') throw Error('Preparation failed');
    return document.createElement('p');
  } }], title({ url }) { if (url.pathname === '/title-failure') throw Error('Title failed'); return 'Page'; } });
  await router.ready;
  for (let i = 1; i <= 999; i++) {
    now += 200;
    expect((await router.navigate(`/visit/${i}`, { replace: true })).kind).toBe('committed');
  }
  expect(scroll!.size).toBe(1000);
  now += 200;
  expect(await router.navigate('/title-failure', { replace: true })).toEqual({ kind: 'failed', code: 'ROUTER_RECOVERY_LIMIT' });
  expect(scroll!.has(router.location().key)).toBe(true);
  expect(scroll!.size).toBe(1000);
  now += 200;
  expect((await router.navigate('/prepare-failure', { replace: true })).kind).toBe('failed');
  expect(scroll!.size).toBe(1000);
  expect(replace).not.toHaveBeenCalled();
});
