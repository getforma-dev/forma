/**
 * FORMA-182 rule 5: null writes nothing on every side. Every vector runs with
 * null and again with undefined, since h() treats both alike; the walker has
 * one absent value, Null, and reads the same vectors in its own suite.
 */
import { describe, expect, it } from 'vitest';
import { h } from '../element.js';
import { childText } from '../form-control.js';
import { prepareAttribute } from '../adoption-attributes.js';
import { createSignal } from '../../reactive/signal.js';
import { createRoot } from '../../reactive/root.js';
import { adoptServed, readVectors, servedRange, WITHOUT_WRITE } from './value-rule-vectors.js';

interface ChildrenVector { id: string; children: (string | number | null)[]; expected: string }
interface AttributeVector { id: string; attribute: string }
const nulls = readVectors<{ children: ChildrenVector[]; attribute: AttributeVector[] }>('null.json');
const absent = [null, undefined] as const;

describe('rule 5 vectors: null writes nothing', () => {
  it.each(nulls.children)('$id: h() children, childText and a textarea compose with nothing for null and undefined', ({ children, expected }) => {
    for (const nothing of absent) {
      const values = children.map(child => (child === null ? nothing : child));
      const element = h('p', null, ...values);
      expect(element.textContent).toBe(expected);
      for (const node of element.childNodes) expect(node.textContent).not.toContain('null');
      expect(childText(values)).toBe(expected);
      expect((h('textarea', null, ...values) as HTMLTextAreaElement).value).toBe(expected);
      createRoot(() => {
        expect(h('p', null, ...values.map(value => () => value)).textContent).toBe(expected);
      });
    }
  });

  it.each(nulls.attribute)('$id: a null or undefined attribute is absent, static, reactive and on adoption, and a later null removes it', ({ attribute }) => {
    for (const nothing of absent) {
      expect(h('span', { [attribute]: nothing, id: 'ok' }).hasAttribute(attribute)).toBe(false);
      createRoot(() => {
        const [value, setValue] = createSignal<string | null | undefined>('x');
        const element = h('span', { [attribute]: value, id: 'ok' });
        expect(element.getAttribute(attribute)).toBe('x');
        setValue(nothing);
        expect(element.hasAttribute(attribute)).toBe(false);
        expect(element.getAttribute('id')).toBe('ok');
        // Verified by: the walker omits a DYN_ATTR whose slot is Null, so the
        // client must not leave a stale or literal "null" value behind.
        setValue('y');
        expect(element.getAttribute(attribute)).toBe('y');
      });
      expect(prepareAttribute(document.createElement('span'), attribute, nothing).initial).toBe(null);
    }
  });

  it('a served empty range adopts a null child without a write, and a later null clears the retained text', async () => {
    for (const nothing of absent) {
      const doc = document.implementation.createHTMLDocument();
      const host = servedRange(doc, '');
      const [value, setValue] = createSignal<string | null | undefined>(nothing);
      expect(await adoptServed(host, () => h('p', null, value), text => {
        setValue('later');
        expect(host.childNodes[1]).toBe(text);
        expect(text.data).toBe('later');
        setValue(nothing);
        expect(host.childNodes[1]).toBe(text);
        expect(text.data).toBe('');
        expect(host.textContent).not.toContain('null');
      })).toEqual(WITHOUT_WRITE);
    }
  });
});
