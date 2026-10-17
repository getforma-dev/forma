/**
 * FORMA-182 rule 6: a boolean in text is a build error (the compiler's suite
 * refuses the `compiledText` shapes with BUILD-614). This is the rendered
 * side: the admitted near miss String(flag) writes the word and the
 * browser-only h() API keeps dropping a bare boolean child, which a compiled
 * page never carries. A boolean attribute follows rule 6's attribute table
 * (value-rule-6-attributes.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { h } from '../element.js';
import { createSignal } from '../../reactive/signal.js';
import { createRoot } from '../../reactive/root.js';
import { adoptServed, readVectors, servedRange, WITHOUT_WRITE } from './value-rule-vectors.js';

interface NearMissVector { id: string; value: boolean; expected: string }
interface IdiomVector { id: string; ready: boolean; expected: string }
const booleans = readVectors<{ nearMissText: NearMissVector[]; idiom: IdiomVector[] }>('boolean-text.json');

describe('rule 6 vectors: the String(flag) near miss and the idiom', () => {
  it.each(booleans.nearMissText)('$id: String(flag) writes the word, static and reactive; a bare boolean child writes nothing', ({ value, expected }) => {
    expect(h('p', null, String(value)).textContent).toBe(expected);
    createRoot(() => {
      const [flag, setFlag] = createSignal(!value);
      const element = h('p', null, () => String(flag()));
      setFlag(value);
      expect(element.textContent).toBe(expected);
      const bare = h('p', null, flag);
      expect(bare.textContent).toBe('');
    });
    expect(h('p', null, value).textContent).toBe('');
  });

  it.each(booleans.nearMissText)('$id: a served range holding the word adopts String(flag) without a write', async ({ value, expected }) => {
    const doc = document.implementation.createHTMLDocument();
    await expect(adoptServed(servedRange(doc, expected), () => h('p', null, String(value)))).resolves.toEqual(WITHOUT_WRITE);
  });

  it.each(booleans.idiom)('$id: the mixed idiom writes nothing for its boolean and the string otherwise; its served range adopts without a write', async ({ ready, expected }) => {
    createRoot(() => {
      const [flag] = createSignal(ready);
      expect(h('p', null, () => flag() && 'Go').textContent).toBe(expected);
      // A true literal in a ternary branch writes nothing, as the compiler now emits it.
      expect(h('p', null, () => (flag() ? true : 'no')).textContent).toBe(ready ? '' : 'no');
    });
    const doc = document.implementation.createHTMLDocument();
    const host = servedRange(doc, expected);
    const [flag, setFlag] = createSignal(ready);
    await expect(adoptServed(host, () => h('p', null, () => flag() && 'Go'), text => {
      setFlag(!ready);
      expect(host.textContent!.replace(/\u200B/g, '')).toBe(ready ? '' : 'Go');
      setFlag(ready);
      expect(host.childNodes[1]).toBe(text);
      expect(text.data.replace(/\u200B/g, '')).toBe(expected);
    })).resolves.toEqual(WITHOUT_WRITE);
  });
});
