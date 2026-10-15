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
routed through the helper; their typed guards are unchanged.

**URL attributes.** The URL policy classifies the raw value and the normalized
value is written. A NUL anywhere in a URL attribute value refuses the write on
both sides: no author writes one, and the U+FFFD it would become is not a
character the URL parser ignores, so `java\0script:alert(1)` would otherwise be
written as `java�script:alert(1)`, which every engine resolves as a
same-origin relative reference and fetches on an `img` or `iframe` the moment
it is attached (review S1, 2026-10-15). For every other character the policy's
own strip of ASCII whitespace and controls makes the raw and normalized views
agree, so a CR or CRLF inside a scheme is refused as before and an admitted
value such as `/docs/a\r\nb` is written as `/docs/a\nb`. Verified by:
`crates/forma-ir/src/walker.rs` >
"url_attributes_are_checked_as_the_normalized_string_that_is_written" and
`packages/core/src/security/__tests__/url-safety.test.ts` > "refuses a NUL
anywhere in the value, not only in the scheme".

**`pre` and `listing`.** The parser drops a line feed that is the first content
token of a `pre`, `listing` or `textarea`. The walker therefore writes one
extra LF when the first text token after such a start tag begins with a
normalized LF, judged by output position: anything serialized in between (a
marker comment, a child element, a closing tag) is itself the first token and
consumes the boundary, while an empty text or a value-only opcode (`PROP`,
`COALESCE`) writes nothing and leaves it. A dynamic value behind `<!--f:tN-->`
is never doubled. The element is selected by tag spelling in any namespace, as
the text-only tags are: the walker has no namespace stack, and neither SVG nor
MathML defines an element of either name. `h()` and adoption write the value
itself, so the two sides agree on the parsed tree. Verified by:
`crates/forma-ir/src/walker.rs` >
"pre_children_protect_only_an_initial_normalized_line_feed" and
`packages/core/e2e/normalization.spec.ts` (each `pre` vector parsed by the
three engines and strictly adopted without a write, plus the undoubled control
that still refuses).

**Implementation.**

| Side | Helper | Writers |
|---|---|---|
| Rust | `crate::text::normalized_chars(&str)` (an iterator; crate-private) and `normalize_text(&str) -> Cow<str>` for already-owned strings | `push_escaped_html`, `push_escaped_attr`, `write_text_only` (leading-LF rule on the normalized text), the `pre`/`listing` boundary (`WalkState::pre_boundary`), `Prop::control_text`, `SelectBinding`, option-by-text matching; `is_dangerous_url` refuses a raw NUL |
| TypeScript | `normalizeDomText(string)` in `packages/core/src/dom/normalize-text.ts` (not a package export; inside the package import `./normalize-text.js`; its consumer beyond the writers is core's adoption, where FORMA-181's `key-text.ts` builds key text) | `createText`; `h()` string children on the single, multiple, reactive scalar and reactive array paths; generic, class and `xlink:` attributes, static and dynamic; `writeFormControlProperty` and `childText`; adoption text and attribute expectations and later writes; the control oracle's expected defaults; the materializer; `isDangerousUrl` refuses a raw NUL |

The output budget counts the bytes actually written: a NUL grows from one byte
to three, so the escapers check each normalized character's encoded length
against the limit. Verified by: `crates/forma-ir/src/walker.rs` >
"the_output_budget_counts_the_normalized_and_escaped_bytes_actually_written".

**Vectors.** `crates/forma-ir/tests/fixtures/parity/normalization.json`, one
finite hand-enumerated file: `values` (helper mapping and every writer),
`children` (per-value composition), `textarea` and `pre` (server leading-LF
protection, static `html` and marker-separated `htmlDynamic`, and the parsed
`value`) and `unsafeUrlNearMiss` (`attribute` and `tag` default to `href` on
`a`). Consumers: `crates/forma-ir/src/text.rs` tests,
`crates/forma-ir/src/walker.rs` > `normalization_vectors`,
`packages/core/src/dom/__tests__/normalize-text.test.ts`, and
`packages/core/e2e/normalization.spec.ts` in the three engines. A lone
surrogate cannot be a vector: `serde_json` refuses the file, so the Rust reader
panics rather than failing one case.

**Not in this slice.**

- `forma-server`'s `template.rs::escape_html` serializes the document title,
  body class and head metadata separately; it is not routed through the crate
  helper. Extending rule 1 to it is a separate cross-crate decision.
- The walker selects text-only parents by tag spelling in any namespace; a
  contextual namespace mechanism, if the SVG `title`/`foreignObject`/MathML
  products need one, is a separate proposal.
- `packages/core/src/dom/reconcile.ts` copies DOM values a writer already
  produced and so has no normalizer of its own; the HTML runtime's `data-*`
  binder and `dom-utils/mutate.ts` are outside the plan's table and unchanged.

## Rule 2: numbers in ECMAScript formatting

**Statement.** A finite number written as DOM text or as an attribute value
is formatted as `Number.prototype.toString` formats it: the shortest digits
that round-trip; a fixed form when the decimal exponent *n* of the spec's
algorithm satisfies −6 < *n* ≤ 21, otherwise an exponent with an explicit sign
(`1e+21`, `1e-7`); −0 is `0`. The lexeme is parsed as a binary64 on both sides
before formatting, so a lexeme past 2^53 is rounded first; an exact integer
origin beyond ±(2^53 − 1) is rule 3's refusal, not this rule.

**Why.** Adoption compares text nodes byte for byte. Rust's `Display` never
writes an exponent (`1e300` prints as 301 digits) and would write `-0`; the
spec's thresholds give `0.000001`, `1e-7`, `100000000000000000000` and `1e+21`,
which is what `String(n)` writes in the browser.

**What it does not decide.** NaN and the infinities are not formatted on the
server: RENDER-402 refuses a non-finite declared number (rule 3's file). There
is no server-side `toFixed`; a fixed number of digits is the component's, in
the browser. Design 4 names `toFixed`'s ties-away-from-zero rule for a server
that gains one; the walker has no such formatter today.

**Implementation.** Rust: `crates/forma-ir/src/slot.rs` > `format_js_number`,
reached through `SlotValue::to_text` for `DYN_TEXT`, `DYN_ATTR`, control text
and select values. TypeScript: `String(n)` in `h()`'s number children and
attribute writers, `childText`, adoption's `text()` and `prepareAttribute`.
No code changed for this rule; the vectors pin it.

**Vectors.** `crates/forma-ir/tests/fixtures/parity/numbers.json`, section
`values` (`lexeme`, `expected`): zero and −0, integers, fractions, the
`0.1 + 0.2` sum, the fixed/exponent boundaries at 1e-6/1e-7 and 1e20/1e21,
seventeen significant digits, 2^53 and the float that rounds to it, the
smallest subnormal and the largest finite. Consumers: `crates/forma-ir/src/walker.rs`
> `value_rule_vectors` > "rule_2_numbers_are_written_in_ecmascript_formatting_as_text_and_attribute"
and `packages/core/src/dom/__tests__/value-rule-2-numbers.test.ts` (the engine
is the oracle: `String(Number(lexeme))` must equal the vector before any
writer is checked, so the Rust side is held to the engine).

## Rule 3: integers within ±(2^53 − 1), refused beyond

**Statement.** A Rust integer bound for a page (`i8` to `i64`, `u8` to `u64`,
`isize`, `usize`) is compared in the integer domain before any conversion can
round it: inside −(2^53 − 1)..=(2^53 − 1) it is encoded exactly and written
as its decimal digits; beyond, the render refuses with `RENDER-401` instead
of letting a different integer arrive. A finite float keeps its own admission
(`RENDER-402`, finite only): an integer-valued float past 2^53 is admitted and
formatted by rule 2, because its origin carries no exactness claim (design 3,
lines 86 to 92, separates the two origins; the v2 brief's `u64` example is the
exact one).

**Why.** 2^53 + 1 would arrive as 9007199254740992: the id a page shows would
differ from the id the handler had, silently. The client reads the envelope
with `JSON.parse`, so an admitted integer is a safe integer there and
`String()` spells the same digits the server wrote.

**Implementation.** Rust: `crates/forma-ir/src/props/value.rs` (the
`integers!` origins check against `MAX_SAFE` as `i128`; the `floats!` origins
check finiteness only), then `SlotValue::to_text` writes the digits. The
client has no admission of its own: the boundary is the server's, and the
engine's `Number.isSafeInteger` is the oracle the vectors are checked against.
No code changed for this rule; the vectors pin it.

**Vectors.** `crates/forma-ir/tests/fixtures/parity/integers.json`: `exact`
(`kind` the Rust origin, `lexeme` the exact decimal, `admitted`) at zero, an
ordinary id, both limits, both one-over, the `u64` rounding-loss case, `i64`
and `u64` extremes; `floatOrigin` (`lexeme`, `expected`) for 1e20, 2^53, the
float that rounds to it and a fraction. Consumers:
`crates/forma-ir/tests/page_props.rs` > `value_rule_vectors` >
"integer_vectors_are_admitted_or_refused_in_the_integer_domain" (`encode_props`
on the origin), `crates/forma-ir/src/walker.rs` > `value_rule_vectors` >
"rule_3_an_admitted_exact_integer_is_written_as_its_decimal_digits", and
`packages/core/src/dom/__tests__/value-rule-3-integers.test.ts` (the boundary
equals the safe-integer range; an admitted value survives `JSON.parse` and
`String()` exactly; a refused one is not a safe integer).

## Rules 4 to 7: listed, not qualified here

| # | Rule | Where the current behaviour lives |
|---|---|---|
| 4 | Dates as epoch milliseconds, no `Intl` on the server | `crates/forma-ir/src/props/value.rs`; the state envelope |
| 5 | `null` writes nothing on every side | Walker `DYN_TEXT` (U+200B holder), `h()`, adoption `text()` |
| 6 | A boolean in text is a build error | Not implemented; codes reserved with FORMA-101 |
| 7 | Conditions are boolean-typed | Not implemented; codes reserved with FORMA-101 |

FORMA-026's SVG and MathML namespace vectors stay at
`packages/core/src/__tests__/vectors/namespaces.json` until their relocation is
coordinated; no Rust reader references that file yet.
