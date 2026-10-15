/** Canonical key text for keyed SSR rows (FORMA-181, plan section 3).
 *
 * The identity domain this lane owns is a string or a safe integer. The string normalization
 * (line-ending folding, NUL to the replacement character, unpaired UTF-16 surrogate refusal) is FORMA-182's shared
 * `normalizeDomText`, written in parallel by its own owner with the Rust `normalized_chars`
 * and finite common vectors. This lane does not implement an independent normalizer:
 * `normalizeDomTextSeam` is the seam that 182 wires to the shared helper, and until then it is
 * a trivial identity placeholder. `tests/key-text.test.ts` pins the placeholder on 182's
 * vectors, so wiring the helper in fails that test until its expectations are updated.
 *
 * Nothing at checkpoint A renders a key: this module serves the checkpoint B vectors.
 */

/** FORMA-182 seam. Identity until the shared `normalizeDomText` is supplied. */
export function normalizeDomTextSeam(text: string): string {
  return text;
}

/** The canonical text of one key value, or a thrown RangeError/TypeError for a value outside
 *  the key domain: fractions, infinities, NaN, integers beyond the safe range, booleans, null,
 *  undefined, Date, objects and arrays. `-0` prints as `0`; `"01"` stays distinct from `1`. */
export function canonicalKeyText(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('list key number must be a safe integer');
    return value === 0 ? '0' : String(value);
  }
  if (typeof value === 'string') return normalizeDomTextSeam(value);
  throw new TypeError('list key must be a string or a safe integer');
}
