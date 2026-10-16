/** FORMA-140: the same INV1 inputs exercise native emission and client writers. */
import { describe, expect, it } from 'vitest';
import { h } from '../element.js';
import { prepareAttribute } from '../adoption-attributes.js';
import { prepareAdoption } from '../adoption.js';
import { createSignal } from '../../reactive/signal.js';
import { createRoot } from '../../reactive/root.js';
import { isSafeAttrName, isUnsafeAttrWrite, URL_ATTRS } from '../../security/url-safety.js';
import { readVectors } from './value-rule-vectors.js';

interface Name { id: string; name: string; valid: boolean; written: boolean }
interface Url { id: string; tag: string; name: string; value: string; written: boolean }
const vectors = readVectors<{ names: Name[]; urls: Url[]; urlAttributes: string[]; payloads: { value: string; text: string; attribute: string }[] }>('inv1.json');
// happy-dom 20.x getAttribute('xml:lang') returns its stale first value even
// when the actual Attr.value/serialized DOM changed. Read the attribute node;
// the three-engine replay also checks the real browser getAttribute path.
const read = (el: Element, name: string): string | null => [...el.attributes].find(attr =>
  name.startsWith('xlink:') ? attr.namespaceURI === 'http://www.w3.org/1999/xlink' && attr.localName === name.slice(6)
    : attr.name === (el.namespaceURI === 'http://www.w3.org/1999/xhtml' ? name.toLowerCase() : name))?.value ?? null;
function writers(tag: string, name: string, value: string, written: boolean): void {
  const expected = written ? value.replace(/\r\n?/g, '\n').replace(/\0/g, '\ufffd') : null;
  const element = h(tag, { id: 'ok', [name]: value });
  expect(read(element, name)).toBe(expected);
  expect(element.getAttribute('id')).toBe('ok');
  createRoot(() => {
    const [current, set] = createSignal('safe');
    const reactive = h(tag, { [name]: current });
    set(value);
    expect(read(reactive, name)).toBe(expected);
    set('safe');
    expect(read(reactive, name)).toBe(isSafeAttrName(name) && !/^on/i.test(name) ? 'safe' : null);
  });
  const target = h(tag, null);
  const prepared = prepareAttribute(target, name, value);
  expect(prepared.initial).toBe(expected);
  // Prime through the same writer, then test a later update (never seed stale DOM).
  prepared.write('safe');
  prepared.write(value);
  expect(read(target, name)).toBe(expected);
}

describe('shared INV1 name and URL vectors', () => {
  it('names the complete URL-bearing set', () => expect([...URL_ATTRS].sort()).toEqual([...vectors.urlAttributes].sort()));
  it.each(vectors.names)('$id: attribute name policy on every writer', ({ name, valid, written }) => {
    expect(isSafeAttrName(name)).toBe(valid);
    writers('div', name, 'value', written);
  });
  it.each(vectors.urls)('$id: raw URL value policy on every writer', ({ tag, name, value, written }) => {
    expect(isUnsafeAttrWrite(tag, name, value)).toBe(!written);
    writers(tag, name, value, written);
  });
  it('does not evaluate a rejected fresh prop getter', () => {
    let calls = 0;
    const props = Object.defineProperty({}, 'café', { enumerable: true, get() { calls++; return 'value'; } });
    expect(h('div', props).getAttribute('café')).toBeNull();
    expect(calls).toBe(0);
  });
  // Rejected qualified names use the real-browser island replay: happy-dom
  // also splits a no-namespace colon name's localName, unlike the browser.
  it.each(['café', 'javascript-guide'])('a served rejected value %s refuses adoption with a code and no repair', value => {
    const isName = value !== 'javascript-guide', name = isName ? value : 'href', tag = isName ? 'div' : 'a';
    const host = document.createElement(tag);
    host.setAttribute(name, value);
    document.body.append(host);
    const observer = new MutationObserver(() => {});
    observer.observe(host, { attributes: true, childList: true, subtree: true });
    try {
      expect(() => prepareAdoption(host, () => h(tag, { [name]: value }))).toThrowError(/FORMA_E_HYDRATE_VALUE/);
      expect(observer.takeRecords()).toEqual([]);
      expect(host.getAttribute(name)).toBe(value);
    } finally { observer.disconnect(); host.remove(); }
  });
  it.each(vectors.payloads)('ordinary text and attribute payloads remain data: $value', ({ value: payload }) => {
    const el = h('p', { title: payload }, payload);
    expect(el.textContent).toBe(payload);
    expect(el.getAttribute('title')).toBe(payload);
    expect(el.querySelector('script,img')).toBeNull();
    // @ts-expect-error the runtime must also refuse untyped JavaScript callers.
    expect(() => h('iframe', { srcdoc: payload })).toThrow();
    // @ts-expect-error a raw string cannot cross the TrustedHtml boundary.
    expect(() => h('div', { dangerouslySetInnerHTML: { __html: payload } })).toThrow();
  });
});
