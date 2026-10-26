import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { h } from '@getforma/core';
import { createBrowserAdapter, createHtmlAdapter, defineRoutes, matchRoutes, type NavigationContext } from '../src/index';
let root: HTMLElement;
const url = new URL('http://localhost:3000/a');
const context = (signal = new AbortController().signal): NavigationContext => ({ url, matches: [], signal, revalidate: false, location: () => ({ url, key: 'a', matches: [] }) });
beforeEach(() => { document.body.replaceChildren(); root = document.createElement('main'); document.body.append(root); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(['data-forma-ssr', 'data-forma-island', 'data-forma-state'].flatMap(marker => [false, true].map(nested => ({ marker, nested }))))('refuses existing native claims before browser rendering: %j', async ({ marker, nested }) => {
  const original = document.createElement('section'); original.textContent = 'Native content'; root.append(original);
  (nested ? original : root).setAttribute(marker, 'native');
  const render = vi.fn(() => document.createElement('p'));
  const routes = defineRoutes([{ id: 'a', path: 'a', render }]);
  const session = createBrowserAdapter().connect(root);
  await expect(session.initialize!({ ...context(), matches: matchRoutes(routes, '/a')! })).rejects.toThrow('ROUTER_BROWSER_NATIVE_ROOT');
  expect(render).not.toHaveBeenCalled(); expect(root.firstElementChild).toBe(original); expect(root.textContent).toBe('Native content');
  session.dispose();
});
it.each(['dispose', 'revoke'] as const)('does not resurrect generated HTML when cleanup calls %s', async mode => {
  root.remove(); root = h('main', { onClick() {} }, 'Original content'); document.body.append(root);
  const html = '<!--forma:region:start--><section>New content</section><!--forma:region:end-->';
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html)))].map(n => n.toString(16).padStart(2, '0')).join('');
  const session = createHtmlAdapter({ head: 'same', pages: [{ path: '/a', sha256, head: 'same', title: 'A' }] }).connect(root);
  const controller = new AbortController();
  // A real h() event controller exercises cleanup's synchronous user-observable
  // abort boundary. Revocation mirrors the coordinator's abort-then-clear order.
  const events = (root as unknown as Record<symbol, AbortController>)[Symbol.for('forma-abort')];
  const disposed = vi.fn(() => { if (mode === 'dispose') session.dispose(); else { controller.abort(); session.invalidate!(); } });
  events.signal.addEventListener('abort', disposed, { once: true });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } })));
  await session.initialize!(context(controller.signal)); const page = await session.prepare(context(controller.signal));
  if ('redirect' in page) throw Error('unexpected redirect');
  expect(() => page.commit()).toThrow(); expect(disposed).toHaveBeenCalledOnce();
  expect(root.textContent).toBe(mode === 'dispose' ? 'Original content' : '');
  page.dispose(); session.dispose();
});
