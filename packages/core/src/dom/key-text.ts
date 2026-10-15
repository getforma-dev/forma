/**
 * Canonical key text for keyed SSR rows (FORMA-181, plan section 3).
 *
 * The identity domain this lane owns is a string or a safe integer: `-0` prints as `0`, `"01"`
 * stays distinct from `1`, and a string with an unpaired UTF-16 surrogate is refused before any
 * replacement could lose identity. The string normalization itself (line-ending folding and NUL
 * replacement) is FORMA-182's shared `normalizeDomText` in `./normalize-text`, rule 1 of
 * `docs/parity-rules.md`: a string key passes through it after the surrogate check and before
 * nothing else. This module does not implement an independent normalizer;
 * `__tests__/key-text.test.ts` asserts that against the source and runs 182's shared vectors
 * (`crates/forma-ir/tests/fixtures/parity/normalization.json`) through `canonicalKeyText`.
 *
 * The native walker computes the same text (`crate::text::normalize_text` on the row's value at
 * the list's key path) and writes it as the row root's `data-forma-key`; adoption (checkpoint C)
 * compares the browser's decoded attribute against this text. The compiler never computes key
 * text.
 */
import { normalizeDomText } from './normalize-text.js';

/** A high surrogate not followed by a low one, or a low surrogate not preceded by a high one. */
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * The canonical text of one key value, or a thrown RangeError/TypeError for a value outside the
 * key domain: fractions, infinities, NaN, integers beyond the safe range, unpaired surrogates,
 * booleans, null, undefined, Date, objects and arrays.
 */
export function canonicalKeyText(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('list key number must be a safe integer');
    return value === 0 ? '0' : String(value);
  }
  if (typeof value === 'string') {
    if (UNPAIRED_SURROGATE.test(value)) throw new RangeError('list key string has an unpaired surrogate');
    return normalizeDomText(value);
  }
  throw new TypeError('list key must be a string or a safe integer');
}
