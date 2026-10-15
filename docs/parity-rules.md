# Parity rules: the marker vocabulary and the value rules

**Status:** rule 1 is stated and implemented for the body/DOM slice (FORMA-182,
checkpoint 2); the marker vocabulary below describes what the walker writes
today. Rules 2 to 7 are listed with where their current behaviour lives; this
document does not claim they are qualified, and FORMA-182 is not complete while
they, the namespace-vector relocation, `renderBoth` (FORMA-184) and the ticket's
large-scale qualification remain open.

**Why one document.** Three implementations produce or consume the same tree:
the Rust walker (`crates/forma-ir/src/walker.rs`) writes HTML, `h()` in
`@getforma/core` builds DOM, and strict adoption (`packages/core/src/dom/adoption*.ts`)
compares the two. DR-9 keeps them equal by test, not by a shared runtime. Each
rule is therefore a vector file both suites load, so a value rule has one
source of truth and a vector changed on one side fails the other.

## The marker vocabulary

What the walker writes around dynamic content, and what the client expects to
find. The operands are `u16` decimals without leading zeros
(`packages/core/src/dom/adoption-plan.ts` refuses anything else with
`FORMA_E_HYDRATE_MARKER`).

| Region | Written as | Notes |
|---|---|---|
| Dynamic text (`DYN_TEXT`) | `<!--f:tN-->` *text* `<!--/f:tN-->` | An empty value is held by one U+200B so the browser creates a Text node. |
| Conditional (`SHOW_IF`) | `<!--f:sN-->` … `<!--/f:sN-->` | |
| List (`LIST`) | `<!--f:lN-->` … `<!--/f:lN-->` | Rows carry `data-forma-key` where keyed (FORMA-181). |
| Island | `<!--f:iN-->` … `<!--/f:iN-->` | The host element carries `data-forma-island`, `data-forma-component`, `data-forma-status="pending"`, `data-forma-state`, `data-forma-h`. |
| Inside `textarea`, `title`, `style`, `script` | no marker of any kind, no U+200B | The tokenizer reads these as text, so a marker there would be the control's value. Verified by: `crates/forma-ir/src/walker.rs` > "no_marker_kind_is_written_inside_a_text_only_parent". |

A `textarea` whose content starts with a line feed has it doubled, because the
parser drops the first one. Verified by: `crates/forma-ir/src/walker.rs` >
"a_textarea_doubles_a_leading_line_feed".

## Rule 1: line endings and NUL

**Statement.** Define `N(s)` on a string: replace each CRLF pair with one LF,
each remaining CR with LF, and each NUL with U+FFFD; preserve every other code
point (no trimming, no NFC, no case folding, no surrogate policy). Apply `N`
per authored or bound value, after the permitted value-to-string conversion
and before ordinary DOM text or attribute comparison, escaping or writing.

**Why.** A browser applies this to the HTML it parses: CR and CRLF become LF in
the input stream, and a NUL in body text is dropped while a NUL in an attribute
or RCDATA becomes U+FFFD. A client writing the raw value through DOM APIs would
therefore disagree with the served tree, and strict adoption refuses the
mismatch (the FORMA-104 state-roundtrip fixture failed in all three engines on
a label of `"\0"`: the walker wrote the NUL, the browser dropped it, and the
client expected it).

**Per value, not per stream.** Two separately authored children `['\r', '\n']`
are two line feeds; one authored value `'\r\n'` is one. The walker normalizes
each `TEXT` and `DYN_TEXT` value and each attribute value as it escapes it;
`h()` and `childText` normalize each child before composing. A normalizer over
the concatenated output would fold the first case and is wrong.

**What it never touches.** Declared props, the state envelope, keys as data,
constants, source strings, schema and binding bytes, digests and signal values
stay exact: the component still receives `label === '\0'`; only its rendered
text is U+FFFD. Trusted raw HTML, `srcdoc`, style objects and CSS strings,
script and JSON sinks, DOM `Node` children, and attribute and tag names are not
routed through the helper; their typed guards are unchanged. A scalar URL
attribute is normalized first and then checked by the existing URL policy, so
the string the guard classified is the string written.

**Implementation.**

| Side | Helper | Writers |
|---|---|---|
| Rust | `crate::text::normalized_chars(&str)` (an iterator; crate-private) and `normalize_text(&str) -> Cow<str>` for already-owned strings | `push_escaped_html`, `push_escaped_attr`, `write_text_only` (leading-LF rule on the normalized text), `Prop::control_text`, `SelectBinding`, option-by-text matching, `is_dangerous_url` |
| TypeScript | `normalizeDomText(string)` in `packages/core/src/dom/normalize-text.ts` (not a package export; import `forma/dom/normalize-text` inside the package) | `createText`; `h()` string children on the single, multiple, reactive scalar and reactive array paths; generic, class and `xlink:` attributes, static and dynamic; `writeFormControlProperty` and `childText`; adoption text and attribute expectations and later writes; the control oracle's expected defaults; the materializer |

The output budget counts the bytes actually written: a NUL grows from one byte
to three, so the escapers check each normalized character's encoded length
against the limit. Verified by: `crates/forma-ir/src/walker.rs` >
"the_output_budget_counts_the_normalized_and_escaped_bytes_actually_written".

**Vectors.** `crates/forma-ir/tests/fixtures/parity/normalization.json`, one
finite hand-enumerated file: `values` (helper mapping and every writer),
`children` (per-value composition), `textarea` (server leading-LF protection)
and `unsafeUrlNearMiss`. Consumers: `crates/forma-ir/src/text.rs` tests,
`crates/forma-ir/src/walker.rs` > `normalization_vectors`, and
`packages/core/src/dom/__tests__/normalize-text.test.ts`.

**Not in this slice.**

- The HTML `pre` first-content-token rule (design 4 requires a doubled leading
  LF there too): the walker has no such state yet. The vector file carries no
  `pre` case until it does.
- `forma-server`'s `template.rs::escape_html` serializes the document title,
  body class and head metadata separately; it is not routed through the crate
  helper. Extending rule 1 to it is a separate cross-crate decision.
- The walker selects text-only parents by tag spelling in any namespace; a
  contextual namespace mechanism, if the SVG `title`/`foreignObject`/MathML
  products need one, is a separate proposal.
- `packages/core/src/dom/reconcile.ts` copies DOM values a writer already
  produced and so has no normalizer of its own; the HTML runtime's `data-*`
  binder and `dom-utils/mutate.ts` are outside the plan's table and unchanged.

## Rules 2 to 7: listed, not qualified here

| # | Rule | Where the current behaviour lives |
|---|---|---|
| 2 | Numbers in ECMAScript `Number.prototype.toString` formatting | `crates/forma-ir/src/slot.rs` `format_js_number`; `String(n)` on the client |
| 3 | Integers within ±(2^53 − 1); exact-integer origins refused beyond | `crates/forma-ir/src/props/value.rs` (FORMA-102/103 checked admission) |
| 4 | Dates as epoch milliseconds, no `Intl` on the server | `crates/forma-ir/src/props/value.rs`; the state envelope |
| 5 | `null` writes nothing on every side | Walker `DYN_TEXT` (U+200B holder), `h()`, adoption `text()` |
| 6 | A boolean in text is a build error | Not implemented; codes reserved with FORMA-101 |
| 7 | Conditions are boolean-typed | Not implemented; codes reserved with FORMA-101 |

FORMA-026's SVG and MathML namespace vectors stay at
`packages/core/src/__tests__/vectors/namespaces.json` until their relocation is
coordinated; no Rust reader references that file yet.
