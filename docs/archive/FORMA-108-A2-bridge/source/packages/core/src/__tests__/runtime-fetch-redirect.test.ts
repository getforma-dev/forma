import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearDiagnostics, mountMarkup, trustedHtml } from '../runtime';

let root: HTMLDivElement;
let handle: ReturnType<typeof mountMarkup> | undefined;
beforeEach(() => { root = document.createElement('div'); document.body.append(root); clearDiagnostics(); });
afterEach(() => { handle?.unmount(); handle = undefined; root.remove(); vi.unstubAllGlobals(); });
const markup = `<div data-forma-state='{}'><div data-fetch="GET /api/widget/items → result |error:failed |loading:busy"></div><p id="result" data-text="{result?.ok}"></p><p id="failed" data-text="{failed}"></p><p id="busy" data-text="{busy}"></p></div>`;
const text = (id: string) => root.querySelector(`#${id}`)?.textContent;
const mount = () => { handle = mountMarkup(root, trustedHtml(markup), { tier: 'reviewed', grants: { fetch: { paths: ['/api/widget/'], cookies: false } } }); };

it('forces error-mode redirects before a granted fetch reaches the network', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
    return { ok: true, json: async () => ({ ok: true }) };
  });
  vi.stubGlobal('fetch', fetch); mount();
  await vi.waitFor(() => expect(text('result')).toBe('true'));
  expect(fetch).toHaveBeenCalledTimes(1); expect(text('failed')).toBe(''); expect(text('busy')).toBe('false');
});

it('reports a stable generic pre-response failure without misidentifying the cause', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('engine-specific network or redirect failure'); })); mount();
  await vi.waitFor(() => expect(text('failed')).toBe('FORMA_E_FETCH_REQUEST: data-fetch failed before a response; redirects are not followed'));
  expect(text('result')).toBe(''); expect(text('busy')).toBe('false');
});

it('preserves non-2xx and JSON-error response semantics', async () => {
  for (const response of [
    { ok: false, status: 404, json: async () => ({ ok: true }) },
    { ok: true, json: async () => { throw new SyntaxError('fixture invalid JSON'); } },
  ]) {
    vi.stubGlobal('fetch', vi.fn(async () => response)); mount();
    await vi.waitFor(() => expect(text('failed')).toBe(response.ok ? 'fixture invalid JSON' : 'data-fetch answered HTTP 404'));
    expect(text('result')).toBe(''); handle!.unmount(); handle = undefined;
  }
});
