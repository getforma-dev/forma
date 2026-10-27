import { beforeEach, describe, expect, it } from 'vitest';
import { createEffect, onCleanup } from '@getforma/core';
import { createBrowserAdapter, defineRoutes, matchRoutes, type NavigationContext, type PreparedView } from '../src/index';

let root: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('main');
  document.body.append(root);
});

describe('browser owner abort lifetimes', () => {
  function fixture() {
    const signals = new Map<string, AbortSignal>();
    const aborts: string[] = [], cleanups: string[] = [];
    const routes = defineRoutes([
      { id: 'outside', path: 'outside', render({ signal }) {
        signals.set('outside', signal);
        return document.createElement('p');
      } },
      { id: 'layout', path: 'layout', render({ signal, outlet }) {
        signals.set('layout', signal);
        signal.addEventListener('abort', () => aborts.push('layout'));
        createEffect(() => onCleanup(() => cleanups.push('layout')));
        const section = document.createElement('section');
        section.append(outlet);
        return section;
      }, children: [{ id: 'leaf', path: ':id', render({ signal, params }) {
        signals.set(params.id, signal);
        signal.addEventListener('abort', () => aborts.push(params.id));
        createEffect(() => onCleanup(() => cleanups.push(params.id)));
        return document.createElement('p');
      } }] },
    ]);
    const context = (path: string, controller = new AbortController()): NavigationContext => {
      const url = new URL(path, 'http://localhost:3000');
      return { url, signal: controller.signal, matches: matchRoutes(routes, path)!, revalidate: false,
        location: () => ({ url, key: 'test', matches: [] }) };
    };
    return { session: createBrowserAdapter().connect(root), signals, aborts, cleanups, context };
  }

  it('aborts the initial departing leaf while retaining its layout lifetime', async () => {
    const f = fixture();
    try {
      await f.session.initialize!(f.context('/layout/a'));
      const layout = root.firstElementChild;
      const next = await f.session.prepare(f.context('/layout/b')) as PreparedView;
      next.commit();
      expect(f.signals.get('a')!.aborted).toBe(true);
      expect(f.signals.get('layout')!.aborted).toBe(false);
      expect(f.signals.get('b')!.aborted).toBe(false);
      expect(root.firstElementChild).toBe(layout);
      expect(f.aborts).toEqual(['a']);
      expect(f.cleanups).toEqual(['a']);
      f.session.dispose();
      expect(f.aborts).toEqual(['a', 'b', 'layout']);
      expect(f.cleanups).toEqual(['a', 'b', 'layout']);
    } finally { f.session.dispose(); }
  });

  it('transfers newly committed owners away from the preparation signal', async () => {
    const f = fixture(), preparation = new AbortController();
    try {
      await f.session.initialize!(f.context('/outside'));
      const entering = await f.session.prepare(f.context('/layout/a', preparation)) as PreparedView;
      entering.commit();
      preparation.abort();
      expect(f.signals.get('outside')!.aborted).toBe(true);
      expect(f.signals.get('layout')!.aborted).toBe(false);
      expect(f.signals.get('a')!.aborted).toBe(false);
      const next = await f.session.prepare(f.context('/layout/b')) as PreparedView;
      next.commit();
      expect(f.signals.get('layout')!.aborted).toBe(false);
      expect(f.signals.get('a')!.aborted).toBe(true);
      f.session.invalidate!();
      expect(f.signals.get('b')!.aborted).toBe(true);
      expect(f.signals.get('layout')!.aborted).toBe(true);
      expect(root.childNodes).toHaveLength(0);
    } finally { f.session.dispose(); }
  });

  it('aborts detached preparation promptly and disposes its effects exactly once', async () => {
    const f = fixture(), preparation = new AbortController();
    try {
      const candidate = await f.session.prepare(f.context('/layout/a', preparation)) as PreparedView;
      preparation.abort();
      expect(f.signals.get('layout')!.aborted).toBe(true);
      expect(f.signals.get('a')!.aborted).toBe(true);
      expect(() => candidate.commit()).toThrow('ROUTER_CANCELLED');
      candidate.dispose(); candidate.dispose();
      expect(f.cleanups).toEqual(['a', 'layout']);
      expect(root.childNodes).toHaveLength(0);
    } finally { f.session.dispose(); }
  });

  it('aborts a render lifetime even when setup throws before producing an owner', async () => {
    let signal!: AbortSignal, cleanups = 0;
    const routes = defineRoutes([{ id: 'a', path: 'a', render(context) {
      signal = context.signal;
      createEffect(() => onCleanup(() => cleanups++));
      throw Error('setup failed');
    } }]);
    const session = createBrowserAdapter().connect(root), url = new URL('http://localhost:3000/a');
    try {
      await expect(session.initialize!({ url, signal: new AbortController().signal,
        matches: matchRoutes(routes, '/a')!, revalidate: false,
        location: () => ({ url, key: 'test', matches: [] }),
      })).rejects.toThrow('setup failed');
      expect(signal.aborted).toBe(true);
      expect(cleanups).toBe(1);
    } finally { session.dispose(); }
  });

  it('owns fresh resources before connection callbacks can dispose the session', async () => {
    let signal!: AbortSignal, cleanups = 0;
    const session = createBrowserAdapter().connect(root);
    const name = `forma-route-owner-${crypto.randomUUID()}`;
    customElements.define(name, class extends HTMLElement {
      connectedCallback() { session.dispose(); }
    });
    const routes = defineRoutes([{ id: 'a', path: 'a', render(context) {
      signal = context.signal;
      createEffect(() => onCleanup(() => cleanups++));
      return document.createElement(name);
    } }]);
    const url = new URL('http://localhost:3000/a');
    try {
      await expect(session.initialize!({ url, signal: new AbortController().signal,
        matches: matchRoutes(routes, '/a')!, revalidate: false,
        location: () => ({ url, key: 'test', matches: [] }),
      })).rejects.toThrow('ROUTER_CANCELLED');
      expect(signal.aborted).toBe(true);
      expect(cleanups).toBe(1);
    } finally { session.dispose(); }
  });

  it('does not erase replacement content installed by invalidation cleanup', async () => {
    const replacement = document.createElement('article');
    const routes = defineRoutes([{ id: 'a', path: 'a', render() {
      createEffect(() => onCleanup(() => root.replaceChildren(replacement)));
      return document.createElement('p');
    } }]);
    const session = createBrowserAdapter().connect(root), url = new URL('http://localhost:3000/a');
    await session.initialize!({ url, signal: new AbortController().signal,
      matches: matchRoutes(routes, '/a')!, revalidate: false,
      location: () => ({ url, key: 'test', matches: [] }),
    });
    session.invalidate!();
    expect(root.firstElementChild).toBe(replacement);
    session.dispose();
    expect(root.firstElementChild).toBe(replacement);
  });
});
