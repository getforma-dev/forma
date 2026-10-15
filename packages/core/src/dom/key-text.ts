/**
 * Canonical key text for keyed SSR rows (FORMA-181, plan section 3).
 *
 * The identity domain this lane owns is a string or a safe integer: `-0` prints as `0`, `"01"`
 * stays distinct from `1`, and a string with an unpaired UTF-16 surrogate is refused before any
 * replacement could lose identity. The string normalization itself (line-ending folding and NUL
 * replacement) is FORMA-182's shared `normalizeDomText` in `./normalize-text`; this lane does not
 * implement an independent normalizer. `normalizeDomTextSeam` is the seam 182 wires to that helper
 * and is a trivial identity placeholder until then. `__tests__/key-text.test.ts` pins the
 * placeholder on 182's vectors, so wiring the helper in fails that test until its expectations
 * are reviewed and updated.
 *
 * Nothing at checkpoint A renders or adopts a key: this module serves the checkpoint B/C vectors
 * and key adoption (the compiler never computes key text).
 */

/** FORMA-182 seam. Identity until the shared `normalizeDomText` is supplied. */
export function normalizeDomTextSeam(text: string): string {
  return text;
}

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
    return normalizeDomTextSeam(value);
  }
  throw new TypeError('list key must be a string or a safe integer');
}
