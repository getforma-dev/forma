import { expect, it } from 'vitest';
import { createRouter, type RouteAdapter } from '../src/index';

it('exposes only immutable, prototype-safe matches in independent location snapshots', async () => {
  history.replaceState({}, '', '/alice/value');
  const root = document.createElement('main'); document.body.append(root);
  const adapter: RouteAdapter = { kind: 'browser', connect() { return {
    async prepare() { throw new Error('not used'); }, dispose() {},
  }; } };
  const router = createRouter({ root, adapter, routes: [{ id: 'user', path: ':constructor/:__proto__' }] });
  try {
    await router.ready;
    const first = router.location(), second = router.location();
    first.url.pathname = '/changed';
    expect(second.url.pathname).toBe('/alice/value');
    expect(Object.keys(first.matches[0])).toEqual(['id', 'params']);
    expect(Object.getPrototypeOf(first.matches[0].params)).toBeNull();
    expect(Object.entries(first.matches[0].params)).toEqual([['constructor', 'alice'], ['__proto__', 'value']]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.matches)).toBe(true);
    expect(Object.isFrozen(first.matches[0])).toBe(true);
    expect(Object.isFrozen(first.matches[0].params)).toBe(true);
    expect(Reflect.set(first.matches[0].params, 'constructor', 'changed')).toBe(false);
    expect(Reflect.set(first.matches[0], 'definition', {})).toBe(false);
    expect(router.location().matches[0].params.constructor).toBe('alice');
  } finally { router.dispose(); root.remove(); }
});
