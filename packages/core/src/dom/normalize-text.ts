/**
 * Rule 1 of the value rules (FORMA-182, docs/parity-rules.md): the text
 * normalization every ordinary DOM text and attribute writer applies, so a
 * value `h()` writes, a value strict adoption expects, and the value the Rust
 * walker served agree byte for byte after the browser has parsed the HTML.
 *
 * N(s): each CRLF pair becomes one LF, each remaining CR becomes LF, each NUL
 * becomes U+FFFD; every other code unit is preserved (no trimming, no NFC,
 * no case folding, no surrogate policy). It runs per authored or bound value,
 * after the permitted value-to-string conversion and before comparison or
 * writing. It is never applied to transport: declared props, the state
 * envelope, keys as data, source strings and digests stay exact. Trusted raw
 * HTML, srcdoc, style objects and DOM Nodes keep their own typed sinks.
 *
 * The shared vectors are crates/forma-ir/tests/fixtures/parity/normalization.json;
 * forma-ir's `normalized_chars` is the paired implementation.
 *
 * Not a public package export. Inside this package import it from
 * `forma/dom/normalize-text` (FORMA-181's keyed-row work uses it; it must not
 * grow a second normalizer).
 */
export function normalizeDomText(value: string): string {
  // Same string back when nothing changes: the common case allocates nothing,
  // and writers that cache the previous value see identity for unchanged text.
  if (value.indexOf('\r') === -1 && value.indexOf('\0') === -1) return value;
  return value.replace(/\r\n?|\0/g, match => (match === '\0' ? '�' : '\n'));
}
