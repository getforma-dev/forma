import { afterEach, expect, it, vi } from 'vitest';
import { __islandRegistration, createEffect, createSignal, h, onCleanup } from '@getforma/core';
import { createNativeAdapter, createRouter, type Router, type RouteAdapter } from '../src/index';

let router: Router | undefined;
afterEach(() => { router?.dispose(); document.body.replaceChildren(); document.head.querySelectorAll('script[data-forma-navigation],script[data-island-state]').forEach(node => node.remove()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('releases successfully activated sibling islands when native readiness rejects after transfer', async () => {
  history.replaceState({}, '', '/current'); sessionStorage.clear(); document.body.replaceChildren();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = document.createElement('main'); document.body.append(root);
  const hash = 'a'.repeat(64), islandHash = '0123456789abcdef', disposed: string[] = [];
  const [tick, setTick] = createSignal(0); let liveRuns = 0;
  const Row = __islandRegistration((props: { label: string }) => {
    createEffect(() => onCleanup(() => disposed.push(props.label)));
    createEffect(() => { tick(); if (props.label === 'live') liveRuns++; });
    return h('section', null, h('button', null, props.label));
  }, { h: islandHash, schema: [[{ name: 'label', type: { kind: 'string' } }]], mode: 0 });
  const first = { id: 'page', parent: null, outlet: null, contract: hash, reuseKey: hash, propsDigest: hash };
  root.innerHTML = '<div data-forma-owner="page" data-forma-ssr data-forma-build="build"><p>original</p></div>';
  const initial = { version: 1, app: 'app', build: 'build', group: 'group', layout: 'layout', context: 'context', policy: hash, policyProfile: 'page-response-only-v1', actions: [], assets: [{ kind: 'script', url: '/_assets/app.js', integrity: 'sha384-' + 'A'.repeat(64) }], owners: [first] };
  for (const [attribute, value] of [['data-forma-navigation', initial], ['data-island-state', { v: 1, s: [], i: [] }]] as const) {
    const script = document.createElement('script'); script.type = 'application/json'; script.setAttribute(attribute, ''); script.textContent = JSON.stringify(value); document.head.append(script);
  }
  const island = (index: number, label: string) => `<section data-forma-island="${index}" data-forma-state="${index}" data-forma-component="Row" data-forma-h="${islandHash}" data-forma-hydrate="load"><button>${label}</button></section>`;
  const destination = { ...initial, kind: 'page', status: 200, route: '/next', title: 'Next', owners: [{ ...first, reuseKey: 'b'.repeat(64), propsDigest: 'b'.repeat(64), html: `<div data-forma-owner="page" data-forma-ssr data-forma-build="build">${island(0, 'live')}${island(1, 'wrong server text')}</div>`, state: { v: 1, s: [], i: ['live', 'expected'].map(label => ({ h: islandHash, p: { label } })) } }] };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(destination), { headers: { 'content-type': 'application/vnd.forma.navigation+json', 'cache-control': 'no-store', vary: 'Accept' } })));
  const replace = vi.spyOn(location, 'replace').mockImplementation(() => { expect(disposed).toContain('live'); });
  router = createRouter({ root, adapter: createNativeAdapter({ app: 'app', build: 'build', group: 'group', owners: ['page'], registrations: { Row } }), routes: [{ id: 'all', path: '*' }] });
  await router.ready;
  expect((await router.navigate('/next')).kind).toBe('document-navigation');
  expect(liveRuns).toBeGreaterThan(0); expect(disposed.filter(label => label === 'live')).toHaveLength(1);
  const before = liveRuns; setTick(1); expect(liveRuns).toBe(before);
  root.querySelector('button')!.click(); expect(liveRuns).toBe(before);
  expect(replace).toHaveBeenCalledOnce();
});

it('does not dispose a shared session after a superseded activation rejects', async () => {
  history.replaceState({}, '', '/current'); sessionStorage.clear(); document.body.replaceChildren();
  const root = document.createElement('main'); document.body.append(root);
  let reject!: (error: Error) => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>((_, fail) => { reject = fail; });
  const dispose = vi.fn(), replace = vi.spyOn(location, 'replace').mockImplementation(() => {});
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const adapter: RouteAdapter = { kind: 'native', connect() { return {
    async prepare({ url }) { return { validate() {}, commit() { root.textContent = url.pathname; }, activate() { if (url.pathname === '/slow') { started(); return held; } return Promise.resolve(); }, dispose() {} }; }, dispose,
  }; } };
  router = createRouter({ root, adapter, routes: [{ id: 'all', path: '*' }] }); await router.ready;
  const old = router.navigate('/slow'); await waiting;
  expect((await router.navigate('/new')).kind).toBe('committed'); reject(Error('old readiness'));
  expect((await old).kind).toBe('cancelled'); expect(dispose).not.toHaveBeenCalled();
  expect(root.textContent).toBe('/new'); expect(replace).not.toHaveBeenCalled();
});
