import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalKeyText, normalizeDomTextSeam } from '../key-text';

describe('FORMA-182 key text seam (FORMA-181 checkpoint A)', () => {
  it('is the identity placeholder until the shared normalizeDomText is wired in; update these expectations with FORMA-182', () => {
    // 182's decided vectors. Once normalizeDomTextSeam delegates to ./normalize-text these become
    // 'a\nb', 'a\nb' and 'a�b'; this test then fails on purpose so the seam cannot be wired
    // without reviewing the key vectors. The unpaired surrogate passes the seam unchanged: its
    // refusal is 181's key-domain rule in canonicalKeyText, not 182's helper.
    expect(normalizeDomTextSeam('a\r\nb')).toBe('a\r\nb');
    expect(normalizeDomTextSeam('a\rb')).toBe('a\rb');
    expect(normalizeDomTextSeam('a\0b')).toBe('a\0b');
    expect(normalizeDomTextSeam('\uD800')).toBe('\uD800');
  });
  it('carries no independent normalizer of its own', () => {
    const source = readFileSync(resolve(__dirname, '../key-text.ts'), 'utf8');
    expect(source).not.toMatch(/\\r|\\n|FFFD|\.replace\(|normalize\(|isWellFormed|toWellFormed/);
  });
  it('pins the key domain this lane owns: safe integers print as decimal, -0 as 0, strings pass through the seam, unpaired surrogates refuse', () => {
    expect(canonicalKeyText(1)).toBe('1');
    expect(canonicalKeyText(-0)).toBe('0');
    expect(canonicalKeyText(0)).toBe('0');
    expect(canonicalKeyText(9007199254740991)).toBe('9007199254740991');
    expect(canonicalKeyText(-9007199254740991)).toBe('-9007199254740991');
    for (const bad of [9007199254740992, -9007199254740992, 1.5, NaN, Infinity, -Infinity]) expect(() => canonicalKeyText(bad), String(bad)).toThrow(RangeError);
    for (const bad of [null, undefined, true, false, {}, [], new Date(0)]) expect(() => canonicalKeyText(bad), String(bad)).toThrow(TypeError);
    expect(canonicalKeyText('')).toBe('');
    expect(canonicalKeyText('01')).toBe('01');
    expect(canonicalKeyText('1')).toBe(canonicalKeyText(1));
    expect(canonicalKeyText('\u{1F600}')).toBe('\u{1F600}');
    for (const bad of ['\uD800', 'a\uDC00', '\uDBFF\uDBFF', '\uDC00\uD800']) expect(() => canonicalKeyText(bad), JSON.stringify(bad)).toThrow(RangeError);
  });
});
