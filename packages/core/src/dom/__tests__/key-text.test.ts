import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalKeyText } from '../key-text';
import { normalizeDomText } from '../normalize-text';

interface ValueVector { id: string; input: string; expected: string }
const VECTORS = resolve(__dirname, '../../../../../crates/forma-ir/tests/fixtures/parity/normalization.json');
const vectors = JSON.parse(readFileSync(VECTORS, 'utf8')) as { values: ValueVector[] };

describe('FORMA-182 key text seam (FORMA-181)', () => {
  it('runs every string key through the shared normalizeDomText: 182\'s vectors are the key text', () => {
    expect(vectors.values.length).toBeGreaterThan(20);
    for (const { id, input, expected } of vectors.values) {
      expect(canonicalKeyText(input), id).toBe(expected);
      expect(canonicalKeyText(input), id).toBe(normalizeDomText(input));
    }
    // The three vectors checkpoint A pinned as identity, now normalized by the shared helper.
    expect(canonicalKeyText('a\r\nb')).toBe('a\nb');
    expect(canonicalKeyText('a\rb')).toBe('a\nb');
    expect(canonicalKeyText('a\0b')).toBe('a�b');
  });
  it('carries no independent normalizer of its own and imports the shared one', () => {
    const source = readFileSync(resolve(__dirname, '../key-text.ts'), 'utf8');
    expect(source).not.toMatch(/\\r|\\n|FFFD|\.replace\(|normalize\(|isWellFormed|toWellFormed/);
    expect(source).toMatch(/import \{ normalizeDomText \} from '\.\/normalize-text\.js';/);
  });
  it('pins the key domain this lane owns: safe integers print as decimal, -0 as 0, strings normalize, unpaired surrogates refuse', () => {
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
    // Normalization collisions are duplicates within one list: the same canonical text.
    expect(canonicalKeyText('a\r\nb')).toBe(canonicalKeyText('a\nb'));
    expect(canonicalKeyText('\0')).toBe(canonicalKeyText('�'));
    // The surrogate refusal is 181's key-domain rule, checked before the shared helper runs.
    for (const bad of ['\uD800', 'a\uDC00', '\uDBFF\uDBFF', '\uDC00\uD800', '\uD800\r\n']) expect(() => canonicalKeyText(bad), JSON.stringify(bad)).toThrow(RangeError);
  });
});
