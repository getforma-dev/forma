/**
 * Canonical key text for keyed SSR rows (FORMA-181, plan section 3).
 *
 * The identity domain this lane owns is a string or a safe integer: `-0` prints as `0`, `"01"`
 * stays distinct from `1`, and a string with an unpaired UTF-16 surrogate is refused before any
 * replacement could lose identity. The string normalization itself (line-ending folding and NUL
 * replacement) is FORMA-182's shared `normalizeDomText` in `./normalize-text`, rule 1 of
 * `docs/parity-rules.md`: a string key passes the surrogate check, then `normalizeDomText`, and
 * nothing else is applied to it. This module does not implement an independent normalizer;
 * `__tests__/key-text.test.ts` asserts that against the source, checks through a mock that the
 * result is `normalizeDomText`'s own, and runs 182's shared vectors
 * (`crates/forma-ir/tests/fixtures/parity/normalization.json`) and 181's key vectors
 * (`keys.json` beside it) through `canonicalKeyText`.
 *
 * Since checkpoint B the native walker computes the same text for every row of a keyed list
 * (`crate::keys::canonical_key_text` in forma-ir, through the shared `crate::text::normalize_text`,
 * on the row's value at the list's key path) and writes it as the row root's `data-forma-key`.
 * Since checkpoint C strict adoption compares the browser's decoded attribute against this text
 * (`listItems` in `./adoption-live-list.ts`). The compiler never computes key text.
 */
import { normalizeDomText } from './normalize-text.js';

/**
 * The canonical text of one key value, or undefined for a value outside the key domain:
 * fractions, infinities, NaN, integers beyond the safe range, strings with an unpaired surrogate,
 * booleans, null, undefined, Date, objects and arrays. Adoption reports FORMA_E_HYDRATE_KEY for
 * undefined; returning it rather than throwing keeps the bundle free of error construction
 * (checkpoint C, under the core size cap).
 */
export function canonicalKeyText(value: unknown): string | undefined {
  // String(-0) is "0", so -0 and 0 are one key.
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : undefined;
  // An unpaired surrogate: under the `u` flag a well-formed pair is one supplementary code point,
  // so only a lone high or low surrogate is a code point of category Cs.
  if (typeof value === 'string' && !/\p{Cs}/u.test(value)) return normalizeDomText(value);
}
