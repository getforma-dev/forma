import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MountHandle } from '../runtime';

let runtime: typeof import('../runtime');
const handles: MountHandle[] = [];
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '<main><div id="root"></div></main>';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  runtime = await import('../runtime');
});
afterEach(() => {
  for (const handle of handles.splice(0)) handle.unmount();
  // First-failure replay on A2 must stop its old body observer. In3.x this
  // property is absent, and no production compatibility entry is introduced.
  (runtime as unknown as { destroyRuntime?: () => void }).destroyRuntime?.();
  document.head.querySelectorAll('[data-forma-mount],[data-forma-expr-budget]').forEach(node => node.remove());
  delete (window as unknown as Record<string, unknown>).__FORMA_RUNTIME_CONFIG;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const markup = `<section data-forma-state='{"failed":""}'>
  <p id="live" data-text="{1+2}">unbound</p>
  <p id="reach" data-text="{$el.closest('body') ? 'escaped' : 'confined'}">unbound</p>
  <button id="trigger" data-on:click="{$refs.target.click()}">trigger</button><a data-ref="target" id="target">target</a>
  <div data-fetch="GET /api/widget/items → data |error:failed"></div>
  <p id="error" data-text="{failed}"></p>
</section>`;

describe('FORMA-108: every binding has a named tier and explicit authority', () => {
  it.each(['compiled', 'reviewed'] as const)('%s omitted grants confine DOM and refuse fetch and activation', async tier => {
    const fetch = vi.fn(async () => new Response('"ok"', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const root = document.getElementById('root')!;
    handles.push(runtime.mountMarkup(root, runtime.trustedHtml(markup), { tier }));
    const activated = vi.fn();
    root.querySelector('#target')!.addEventListener('click', activated);
    (root.querySelector('#trigger') as HTMLElement).click();
    await settle();
    expect(root.querySelector('#live')?.textContent).toBe('3');
    expect(root.querySelector('#reach')?.textContent).toBe('confined');
    expect(fetch).not.toHaveBeenCalled();
    expect(activated).not.toHaveBeenCalled();
    expect(root.querySelector('#error')?.textContent).toMatch(/^data-fetch denied:/);
    expect(runtime.getDiagnostics().map(row => row.code).sort()).toEqual(['FORMA_E_GRANT_FETCH', 'FORMA_E_GRANT_NAVIGATE']);
  });

  it('explicit grants retain their actual authorized DOM, fetch and activation paths', async () => {
    const fetch = vi.fn(async () => new Response('"ok"', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const root = document.getElementById('root')!;
    handles.push(runtime.mountMarkup(root, runtime.trustedHtml(markup), { tier: 'reviewed', grants: {
      dom: true, navigate: true, fetch: { methods: ['GET'], paths: ['/api/widget/'], cookies: false },
    } }));
    const activated = vi.fn(); root.querySelector('#target')!.addEventListener('click', activated);
    (root.querySelector('#trigger') as HTMLElement).click(); await settle();
    expect(root.querySelector('#live')?.textContent).toBe('3');
    expect(root.querySelector('#reach')?.textContent).toBe('escaped');
    expect(fetch).toHaveBeenCalledTimes(1); expect(activated).toHaveBeenCalledTimes(1);
    expect(runtime.getDiagnostics()).toEqual([]);
  });

  it('import, DOMContentLoaded, injected nodes and state-attribute changes never bind without a handed root', async () => {
    document.body.innerHTML = `<div data-forma-state='{"n":1}'><p id="served" data-text="{n}">raw</p></div><div id="root"></div>`;
    (runtime as unknown as { destroyRuntime?: () => void }).destroyRuntime?.();
    vi.resetModules();
    runtime = await import('../runtime');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    document.body.insertAdjacentHTML('beforeend', `<div data-forma-state='{"n":2}'><p id="injected" data-text="{n}">raw</p></div>`);
    document.querySelector('[data-forma-state]')!.setAttribute('data-forma-state', '{"n":3}');
    await settle();
    expect(document.getElementById('served')?.textContent).toBe('raw');
    expect(document.getElementById('injected')?.textContent).toBe('raw');
    handles.push(runtime.mountMarkup(document.getElementById('root')!, runtime.trustedHtml('<div data-forma-state="{}"><p id="owned" data-text="{1+2}">raw</p></div>'), { tier: 'reviewed' }));
    expect(document.getElementById('owned')?.textContent).toBe('3');
    expect(document.getElementById('served')?.textContent).toBe('raw');
  });

  it('exports only explicit mount lifecycle and host inspection helpers', () => {
    expect(Object.keys(runtime).sort()).toEqual([
      'applyContainmentHints', 'clearDiagnostics', 'getDiagnostics', 'getScopes', 'mountMarkup',
      'resetScope', 'setScopeValue', 'trustedHtml', 'yieldToMain',
    ].sort());
  });

  it('warns once about the obsolete manual switch and names the replacement mount call', async () => {
    const key = Symbol.for('@getforma/core#deprecations');
    delete (globalThis as unknown as Record<symbol, unknown>)[key];
    const script = document.createElement('script'); script.dataset.formaMount = 'manual'; document.head.append(script);
    for (let i = 0; i < 2; i++) {
      (runtime as unknown as { destroyRuntime?: () => void }).destroyRuntime?.();
      vi.resetModules(); runtime = await import('../runtime');
    }
    const warnings = vi.mocked(console.warn).mock.calls.flat().map(String).filter(text => text.includes('FORMA_W_MANUAL_MOUNT_REMOVED'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('mountMarkup(root, markup, { tier, grants })');
    delete (globalThis as unknown as Record<symbol, unknown>)[key];
  });
});
