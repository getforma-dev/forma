import { NavigationError } from './types';
export const BODY_LIMIT = 1024 * 1024;
export async function readBody(response: Response, signal?: AbortSignal): Promise<string> {
  if (!response.body) throw new NavigationError('ROUTER_BODY');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const item = await reader.read(); signal?.throwIfAborted(); if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > BODY_LIMIT) throw new NavigationError('ROUTER_BODY_LIMIT');
      chunks.push(item.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
  const buffer = new Uint8Array(bytes); let at = 0;
  for (const chunk of chunks) { buffer.set(chunk, at); at += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
}
export function media(response: Response, expected: string) {
  const type = response.headers.get('content-type')?.split(';').map(s => s.trim().toLowerCase());
  if (type?.[0] !== expected || type.slice(1).some(p => p.startsWith('charset=') && !['charset=utf-8', 'charset="utf-8"'].includes(p)) || !response.headers.get('cache-control')?.split(',').some(s => s.trim().toLowerCase() === 'no-store') || !response.headers.get('vary')?.split(',').some(s => s.trim().toLowerCase() === 'accept')) throw new NavigationError('ROUTER_MEDIA');
}
export function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NavigationError('ROUTER_SCHEMA');
  return value as Record<string, any>;
}
export function pathOnly(value: string): boolean { return value === '/' || value.length <= 2048 && /^\/[A-Za-z0-9_.~-]+(?:\/[A-Za-z0-9_.~-]+)*$/.test(value) && value.split('/').every(p => p !== '.' && p !== '..'); }
/** Strict own-renderer fragment profile. No resource-loading or upgrade-capable node reaches importNode. */
export function parseFragment(html: string, doc: Document, destination: URL, externalLinks = false): HTMLElement {
  if (typeof html !== 'string' || html.length > BODY_LIMIT) throw new NavigationError('ROUTER_HTML_LIMIT');
  const voids = new Set(['area', 'br', 'col', 'hr', 'input', 'wbr']);
  const forbidden = new Set(['head', 'html', 'body', 'script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'style', 'template', 'img', 'audio', 'video', 'source', 'track', 'svg', 'math']);
  const stack: string[] = []; let cursor = 0, nodes = 0;
  while (cursor < html.length) {
    if (++nodes > 10000) throw new NavigationError('ROUTER_NODE_LIMIT');
    if (html.startsWith('<!--', cursor)) { const end = html.indexOf('-->', cursor + 4); if (end < 0) throw new NavigationError('ROUTER_HTML'); cursor = end + 3; continue; }
    if (html[cursor] !== '<') { const end = html.indexOf('<', cursor); cursor = end < 0 ? html.length : end; continue; }
    const match = /^<\/?([a-zA-Z][a-zA-Z0-9:-]*)(?=[\s/>])/.exec(html.slice(cursor));
    if (!match) throw new NavigationError('ROUTER_HTML');
    const name = match[1].toLowerCase();
    if (name.includes('-') || name.includes(':') || forbidden.has(name)) throw new NavigationError('ROUTER_HTML_PROFILE');
    let end = cursor + match[0].length, quote = '';
    for (; end < html.length; end++) { const c = html[end]; if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break; }
    if (end === html.length) throw new NavigationError('ROUTER_HTML');
    const token = html.slice(cursor, end + 1);
    if (/[\s/](?:is|shadowrootmode|srcdoc)(?:\s|=|\/|>)/i.test(token)) throw new NavigationError('ROUTER_HTML_PROFILE');
    if (html[cursor + 1] === '/') { if (stack.pop() !== name) throw new NavigationError('ROUTER_HTML_NESTING'); }
    else if (!voids.has(name)) { stack.push(name); if (stack.length > 64) throw new NavigationError('ROUTER_HTML_DEPTH'); }
    cursor = end + 1;
  }
  if (stack.length) throw new NavigationError('ROUTER_HTML_NESTING');
  const template = doc.createElement('template');
  // Core's named Trusted Types policy owns the sole raw boundary. Never retry as an unchecked string.
  template.innerHTML = navigationHTML(html) as string;
  for (const element of template.content.querySelectorAll('*')) {
    if (element.localName.includes('-') || element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || forbidden.has(element.localName)) throw new NavigationError('ROUTER_HTML_PROFILE');
    if (element.localName === 'input' && element.getAttribute('type')?.toLowerCase() === 'image') throw new NavigationError('ROUTER_HTML_PROFILE');
    for (const attr of element.attributes) {
      if (/^on/i.test(attr.name) || ['is', 'shadowrootmode', 'srcdoc', 'style', 'background'].includes(attr.name)) throw new NavigationError('ROUTER_HTML_PROFILE');
      if (['href', 'src', 'action', 'formaction', 'background', 'poster'].includes(attr.name)) {
        const target = new URL(attr.value, destination);
        const ordinaryLink = externalLinks && attr.name === 'href' && ['a', 'area'].includes(element.localName);
        if (!(ordinaryLink ? ['http:', 'https:', 'mailto:', 'tel:'].includes(target.protocol) : ['http:', 'https:'].includes(target.protocol) && target.origin === destination.origin) || target.username || target.password) throw new NavigationError('ROUTER_HTML_URL');
      }
    }
  }
  if (template.content.children.length !== 1 || [...template.content.childNodes].some(n => n.nodeType === 3 && n.textContent?.trim())) throw new NavigationError('ROUTER_HTML_ROOT');
  return doc.importNode(template.content.firstElementChild!, true) as HTMLElement;
}
// Injected from the authenticated core navigation surface; kept separate for readable sink review.
import { navigationHTML } from '@getforma/core/navigation';
