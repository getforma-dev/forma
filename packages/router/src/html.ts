import { cleanup } from '@getforma/core';
import { NavigationError, type RouteAdapter, type NavigationContext } from './types';
import { parseFragment, readBody } from './transport';
export interface HtmlPage {
  readonly path: string;
  /** SHA-256 of the complete UTF-8 generated document, emitted at build time. */
  readonly sha256: string;
  readonly title: string;
  /** Build-generated identity of the immutable head/policy/assets. */
  readonly head: string;
}
export interface HtmlAdapterOptions {
  readonly head: string;
  readonly pages: readonly HtmlPage[];
}
const START = '<!--forma:region:start-->', END = '<!--forma:region:end-->';
/** Explicitly registered static documents. Only the marked region is ever parsed. */
export function createHtmlAdapter(options: HtmlAdapterOptions): RouteAdapter {
  const pages = new Map<string, Readonly<HtmlPage>>();
  if (!options.head || options.pages.length > 1000) throw new NavigationError('ROUTER_HTML_REGISTRY');
  for (const page of options.pages) {
    if (!page.path.startsWith('/') || /[?#\\]/.test(page.path) || pages.has(page.path) || !/^[a-f0-9]{64}$/.test(page.sha256) || page.head !== options.head || page.title.length > 4096) throw new NavigationError('ROUTER_HTML_REGISTRY');
    pages.set(page.path, Object.freeze({ ...page }));
  }
  return Object.freeze({ kind: 'html' as const, connect(root: HTMLElement) {
    let closed = false;
    function checkRoot() {
      if (closed || root.hasAttribute('data-forma-ssr') || root.querySelector('[data-forma-ssr],[data-forma-island],[data-forma-state]')) throw new NavigationError('ROUTER_HTML_NATIVE_ROOT', true);
    }
    return {
      async initialize() { checkRoot(); },
      async prepare(context: NavigationContext) {
        checkRoot();
        const page = pages.get(context.url.pathname);
        if (!page || context.url.search) throw new NavigationError('ROUTER_HTML_UNREGISTERED', true);
        const response = await fetch(context.url, { headers: { Accept: 'text/html' }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: context.signal });
        if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/html') throw new NavigationError('ROUTER_HTML_RESPONSE', true);
        const html = await readBody(response, context.signal);
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html)))].map(b => b.toString(16).padStart(2, '0')).join('');
        if (digest !== page.sha256) throw new NavigationError('ROUTER_HTML_BUILD', true);
        const start = html.indexOf(START), end = html.indexOf(END);
        if (start < 0 || end <= start || html.indexOf(START, start + 1) !== -1 || html.indexOf(END, end + 1) !== -1) throw new NavigationError('ROUTER_HTML_REGION', true);
        const node = parseFragment(html.slice(start + START.length, end), root.ownerDocument, context.url, true);
        if (node.matches('[data-forma-ssr],[data-forma-island],[data-forma-state]') || node.querySelector('[data-forma-ssr],[data-forma-island],[data-forma-state]')) throw new NavigationError('ROUTER_HTML_NATIVE_ROOT', true);
        let disposed = false, committed = false;
        function validate() { checkRoot(); if (context.signal.aborted || disposed) throw new NavigationError('ROUTER_CANCELLED'); }
        return {
          title: page.title, validate,
          commit() { validate(); cleanup(root); root.replaceChildren(node); committed = true; },
          async activate() {},
          dispose() { if (disposed || committed) return; disposed = true; cleanup(node); },
        };
      },
      invalidate() { cleanup(root); root.replaceChildren(); },
      dispose() { if (closed) return; closed = true; cleanup(root); },
    };
  } });
}
