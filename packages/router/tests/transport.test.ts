import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHtmlAdapter, type NavigationContext } from '../src/index';
import { parseFragment, readBody, media, pathOnly, BODY_LIMIT } from '../src/transport';
const url = new URL('http://localhost:3000/a');
let root: HTMLElement;
beforeEach(() => { document.body.replaceChildren(); root = document.createElement('main'); document.body.append(root); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(['<script>alert(1)</script>', '<x-user></x-user>', '<div is="x-user"></div>', '<div/is="x-user"></div>', '<svg><use href="/x"></use></svg>', '<div onclick="bad()"></div>', '<img src="/track">', '<input type="image" src="/track">', '<iframe srcdoc="x"></iframe>', '<div><template shadowrootmode="open"></template></div>', '<div style="background:url(/track)"></div>', '<a href="javascript:bad()">bad</a>', '<a href="https://foreign.test">bad</a>', '<div><p></div>', '<div></div><div></div>'])('rejects unsupported markup before any activation: %s', html => { expect(() => parseFragment(html, document, url)).toThrow(); });
it('does not upgrade rejected custom elements or import them to the active document', () => {
  let upgrades = 0; customElements.define('router-tripwire', class extends HTMLElement { constructor() { super(); upgrades++; } });
  const imported = vi.spyOn(document, 'importNode'); expect(() => parseFragment('<router-tripwire></router-tripwire>', document, url)).toThrow(); expect(upgrades).toBe(0); expect(imported).not.toHaveBeenCalled();
});
it('allows ordinary escaped content, controls and same-origin destinations', () => {
  const node = parseFragment('<section><h1>&lt;Hello&gt;</h1><form action="/save"><input name="x" value="A"><button>Save</button></form></section>', document, url);
  expect(node.textContent).toBe('<Hello>Save'); expect(node.isConnected).toBe(false);
});
it.each([
  'aria-label="Link to How is this different from Solid?"',
  "aria-label='How is this useful?'",
  'data-note=" is=custom /shadowrootmode=open srcdoc=markup"',
  "data-note=' is=custom /shadowrootmode=open srcdoc=markup'",
  'data-note=/is=custom',
  'data-note=/shadowrootmode=open',
  'data-note=/srcdoc=markup',
  'data-note = " is=custom" aria-label="An ordinary heading"',
  'aria-label="A > B is ordinary"',
  "aria-label='A > B is ordinary'",
])('keeps forbidden-name words inside attribute values as ordinary text: %s', attributes => {
  const node = parseFragment(`<main><h1 ${attributes}>Page</h1></main>`, document, url, true);
  expect(node.querySelector('h1')?.textContent).toBe('Page');
  expect(node.querySelector('h1')?.hasAttribute('is')).toBe(false);
});
it.each([
  'data-note=" is safe" is="router-tripwire"',
  "data-note=' is safe' IS='router-tripwire'",
  'data-note="ordinary"/is=router-tripwire',
  'data-note=/is=ordinary is=router-tripwire',
  'data-note="ordinary" shadowrootmode=open',
  "data-note='ordinary' srcdoc='payload'",
  'data-note="ordinary" is',
  'data-note="ordinary"is=router-tripwire',
  "data-note='ordinary'srcdoc='payload'",
  'data-note="ordinary"shadowrootmode=open',
])('refuses actual upgrading attributes before even creating a parsing template: %s', attributes => {
  const create = vi.spyOn(document, 'createElement');
  expect(() => parseFragment(`<main><button ${attributes}>Page</button></main>`, document, url, true)).toThrow('ROUTER_HTML_PROFILE');
  expect(create).not.toHaveBeenCalled();
});
it('rejects excessive nesting and response bytes without trusting Content-Length', async () => {
  expect(() => parseFragment('<div>'.repeat(65) + '</div>'.repeat(65), document, url)).toThrow('ROUTER_HTML_DEPTH');
  await expect(readBody(new Response('x'.repeat(BODY_LIMIT + 1), { headers: { 'Content-Length': '2' } }))).rejects.toThrow('ROUTER_BODY_LIMIT');
  await expect(readBody(new Response(new Uint8Array([255, 255])))).rejects.toThrow();
});
it('requires no-store, Vary Accept, and a UTF-8-compatible representation', () => {
  const good = { 'content-type': 'application/vnd.forma.navigation+json; charset=utf-8', 'cache-control': 'private, no-store', vary: 'Accept, Accept-Encoding' };
  expect(() => media(new Response('', { headers: good }), 'application/vnd.forma.navigation+json')).not.toThrow();
  for (const [key, value] of [['vary', 'Accept-Encoding'], ['cache-control', 'max-age=0'], ['content-type', 'application/vnd.forma.navigation+json; charset=iso-8859-1']]) expect(() => media(new Response('', { headers: { ...good, [key]: value } }), 'application/vnd.forma.navigation+json')).toThrow();
});
it('accepts the server canonical endpoint grammar, excluding dot segments and query strings', () => {
  for (const value of ['/', '/save', '/v1/save.json', '/users/~mine', '/...', '/.hidden', '/a/file..']) expect(pathOnly(value)).toBe(true);
  for (const value of ['/save/', '/a/../b', '/a/./b', '/a/..', '/.', '/a//b', '/save?q=x', '//foreign', '/%73ave']) expect(pathOnly(value)).toBe(false);
});
const context = (): NavigationContext => ({ url, matches: [], signal: new AbortController().signal, revalidate: false, location: () => ({ url, key: 'a', matches: [] }) });
async function digest(text: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join(''); }
it('admits registered generated HTML without parsing the document head or executing its scripts', async () => {
  const html = '<!doctype html><html><head><script>window.unexpected=true</script></head><body><!--forma:region:start--><main><h1>Page A</h1></main><!--forma:region:end--></body></html>';
  const adapter = createHtmlAdapter({ head: 'same-policy-assets', pages: [{ path: '/a', sha256: await digest(html), head: 'same-policy-assets', title: 'A' }] });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } })));
  const session = adapter.connect(root); await session.initialize!(context()); const page = await session.prepare(context());
  if ('redirect' in page) throw Error('unexpected'); expect(root.textContent).toBe(''); page.commit(); await page.activate(); expect(root.textContent).toBe('Page A'); expect((window as any).unexpected).toBeUndefined(); session.dispose();
});
it('refuses changed documents and native roots in the generated-HTML adapter', async () => {
  const adapter = createHtmlAdapter({ head: 'sealed', pages: [{ path: '/a', sha256: '0'.repeat(64), head: 'sealed', title: 'A' }] });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('changed', { headers: { 'content-type': 'text/html' } })));
  await expect(adapter.connect(root).prepare(context())).rejects.toThrow('ROUTER_HTML_BUILD'); root.setAttribute('data-forma-ssr', ''); await expect(adapter.connect(root).initialize!(context())).rejects.toThrow('ROUTER_HTML_NATIVE_ROOT');
  expect(() => createHtmlAdapter({ head: 'one', pages: [{ path: '/a', sha256: '0'.repeat(64), head: 'two', title: 'A' }] })).toThrow('ROUTER_HTML_REGISTRY');
});
it('allows ordinary external anchors only in the verified generated-document profile', () => {
  const node = parseFragment('<main><a href="https://example.com/path">Web</a><a href="mailto:help@example.com">Email</a><a href="tel:123">Phone</a></main>', document, url, true); expect(node.querySelectorAll('a')).toHaveLength(3);
  expect(() => parseFragment('<main><a href="javascript:alert(1)">Bad</a></main>', document, url, true)).toThrow();
  expect(() => parseFragment('<form action="https://example.com/save"></form>', document, url, true)).toThrow();
});

it.each(['<main title="unterminated></main>', "<main title='unterminated></main>", '<main title=unfinished'])('refuses incomplete tag/quote tokens before parsing: %s', html => {
  const create = vi.spyOn(document, 'createElement');
  expect(() => parseFragment(html, document, url)).toThrow('ROUTER_HTML');
  expect(create).not.toHaveBeenCalled();
});
