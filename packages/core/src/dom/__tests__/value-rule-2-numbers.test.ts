/**
 * FORMA-182 rule 2: numbers in ECMAScript formatting. The engine is the
 * oracle: a vector's expected string is what String(n) gives, so the Rust
 * walker's `format_js_number` is held to the engine through this file. Every
 * client writer then writes the same string. Nothing here is generated.
 */
import { describe, expect, it } from 'vitest';
import { h } from '../element.js';
import { childText } from '../form-control.js';
import { prepareAttribute } from '../adoption-attributes.js';
import { createSignal } from '../../reactive/signal.js';
import { createRoot } from '../../reactive/root.js';
import { adoptServed, readVectors, servedRange, WITHOUT_WRITE } from './value-rule-vectors.js';

interface NumberVector { id: string; lexeme: string; expected: string }
const numbers = readVectors<{ values: NumberVector[] }>('numbers.json');

describe('rule 2 vectors: numbers in ECMAScript formatting', () => {
  it.each(numbers.values)('$id: the engine formats the lexeme as the vector expects, and every writer writes it', ({ lexeme, expected }) => {
    const n = Number(lexeme);
    expect(Number.isFinite(n)).toBe(true);
    expect(String(n)).toBe(expected);
    expect(h('p', null, n).textContent).toBe(expected);
    expect(h('span', { title: n }).getAttribute('title')).toBe(expected);
    createRoot(() => {
      const [value, setValue] = createSignal(0.5);
      const text = h('p', null, value);
      const attr = h('span', { title: value });
      setValue(n);
      expect(text.textContent).toBe(expected);
      expect(attr.getAttribute('title')).toBe(expected);
    });
    expect(prepareAttribute(document.createElement('span'), 'title', n).initial).toBe(expected);
    expect(childText([n])).toBe(expected);
  });

  it.each(numbers.values)('$id: a served range holding the formatted number adopts the number without a write', async ({ lexeme, expected }) => {
    const doc = document.implementation.createHTMLDocument();
    expect(await adoptServed(servedRange(doc, expected), () => h('p', null, Number(lexeme)))).toEqual(WITHOUT_WRITE);
  });
});
