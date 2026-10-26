import { expect, it } from 'vitest';
import { defineRoutes, matchRoutes } from '../src/index';

it.each([
  [{ id: 'a' }, { id: 'b', path: '/' }],
  [{ id: 'a', children: [{ id: 'one', index: true }] }, { id: 'b', path: '' }],
  [{ id: 'a', path: 'users/:name' }, { id: 'b', path: 'users/:other' }],
  [{ id: 'a', path: 'users/*' }, { id: 'b', path: 'users/*' }],
])('refuses overlapping equal-rank branches including empty and splat owners', (a, b) => {
  expect(() => defineRoutes([a, b])).toThrow('ROUTER_AMBIGUOUS');
});

it('accepts different literals at the same rank and preserves static/param/splat ordering', () => {
  const routes = defineRoutes([
    { id: 'a', path: 'a/:name' }, { id: 'b', path: 'b/:name' },
    { id: 'static', path: 'a/new' }, { id: 'tail', path: 'a/*' },
    { id: 'other-tail', path: 'b/*' }, { id: 'fallback', path: '*' },
  ]);
  for (const [url, id] of [
    ['/a/new', 'static'], ['/a/person', 'a'], ['/b/person', 'b'],
    ['/a/one/two', 'tail'], ['/b/one/two', 'other-tail'], ['/elsewhere', 'fallback'],
  ]) expect(matchRoutes(routes, url)!.at(-1)!.id).toBe(id);
});

it('distinguishes deeper same-rank literals and allows disjoint splat prefixes', () => {
  const routes = defineRoutes([
    { id: 'left', path: 'a/:id/left' }, { id: 'right', path: 'a/:id/right' },
    { id: 'x', path: 'x/*' }, { id: 'y', path: 'y/*' },
  ]);
  expect(matchRoutes(routes, '/a/42/left')!.at(-1)!.id).toBe('left');
  expect(matchRoutes(routes, '/a/42/right')!.at(-1)!.id).toBe('right');
  expect(matchRoutes(routes, '/x')!.at(-1)!.id).toBe('x');
  expect(matchRoutes(routes, '/y/path')!.at(-1)!.id).toBe('y');
});

it('keeps root/trailing-slash behavior and splits before decoding encoded slashes', () => {
  const routes = defineRoutes([{ id: 'root', index: true }, { id: 'value', path: ':value' }]);
  expect(matchRoutes(routes, '/')!.at(-1)!.id).toBe('root');
  expect(matchRoutes(routes, '/plain/')!.at(-1)!.params.value).toBe('plain');
  expect(matchRoutes(routes, '/a%2Fb/')!.at(-1)!.params.value).toBe('a/b');
  expect(matchRoutes(routes, '/%2F')!.at(-1)!.params.value).toBe('/');
  expect(matchRoutes(routes, '//')).toBeNull();
  expect(matchRoutes(routes, '/plain//')).toBeNull();
});
