# Parity rules: the marker vocabulary and the value rules

**Status:** all seven value rules have shared Rust/TypeScript vectors and
finite browser gates. The FORMA-182 qualification follow-up extends rule 1
to ordinary SSR/browser-shell metadata, relocates the frozen namespace vectors
with a real native producer, and adds the seeded three-path campaign in
`e2e/value-rules/`. Its first pilot found and preserved a rule-2 decimal tie
regression. The subsequent [source-qualified campaign](release-evidence/value-rules-qualification.md)
completed seven million comparisons plus 123,118 expected refusals. That result
belongs to its recorded source; [final release evidence](release/V3-AS-BUILT.md)
is separate, and the original failed pilot remains failed.
`renderBoth` is FORMA-184's private harness helper. Namespace-stack/dynamic
SVG-title and native non-boolean `SHOW_IF` refusals remain explicit 3.1
proposals under L-57.

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

The U+200B holder is a property of the wire, not only of the walker: a dynamic
text whose value is empty and one whose value is U+200B are written as the same
bytes, `<!--f:tN-->` U+200B `<!--/f:tN-->`, so a reader of the HTML cannot tell
them apart. The parity harness (FORMA-183) therefore matches a holder against
client text `""` or U+200B and counts every holder it compares as
`holderAmbiguous` in its report (`e2e/parity/README.md`). Whether the walker
should write a U+200B value distinguishably from the holder is open, for rule
5's owner (FORMA-182).

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
text is U+FFFD. A list key is the same: the row's key field stays exact in the
state envelope and in the component's data, and only the key *text*, the
row identity written as `data-forma-key` and compared by adoption, is `N` of a
string key, because the browser parses that attribute under this rule (see
"Keyed rows" below). Trusted raw HTML, `srcdoc`, style objects and CSS strings,
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

**Keyed rows (FORMA-181, DR-8).** A `LIST` named by FMIR section `0x0006` is
keyed: the walker reads each row's value at the key path and writes its
canonical text as the row root's `data-forma-key` (checkpoint B), and core's
strict adoption binds each client item to the served row whose decoded
attribute equals the item's canonical key, in any order and without a write
(checkpoint C). The identity domain is a string or a safe
integer. A string key is `N(s)` of rule 1, applied to the key text (the key
as data in the state envelope stays exact); a number key must be an integer
within ±(2^53 − 1) and prints as its decimal integer, `-0` as `0`. So `1` and
`"1"` are one row, `1` and `"01"` are two, and `"a\r\nb"` and `"a\nb"` are one.
`null`, booleans, arrays, objects, fractions, infinities and NaN are not
identities: the walker refuses the render (`RENDER-503`); core's
`canonicalKeyText` returns undefined for them and adoption refuses the island
(`FORMA_E_HYDRATE_KEY`, as for a key on one side only or a repeated key). The path is read against the row's own fields only (every segment but
the last an object field, the last an identity; missing, repeated or
non-object refuses), and two rows of one list execution with the same
canonical text are duplicates. Rust: `crates/forma-ir/src/keys.rs`
(`canonical_list_key`, through `text::normalize_text`); TypeScript:
`packages/core/src/dom/key-text.ts` (`canonicalKeyText`, through
`normalizeDomText`, plus the unpaired-surrogate refusal a Rust string cannot
express). Shared vectors: `crates/forma-ir/tests/fixtures/parity/keys.json`
(`values`, `collisions`, `paths`), read by `crates/forma-ir/src/keys.rs` tests
and `packages/core/src/dom/__tests__/key-text.test.ts`; each string vector's
`served` markup is pinned against the walker (`walker.rs` >
`every_shared_key_vector_is_written_as_its_served_markup`) and decoded by
Chromium, Firefox and WebKit to its canonical text, then adopted keyed by the
raw value without a write (`packages/core/e2e/keyed-adoption.spec.ts`); the walker's row
guard (one balanced root per row, a registered child's envelope, duplicate
scopes per list execution, the refusals) by `crates/forma-ir/src/walker.rs` >
`keyed_rows`; the actual compiler-to-walker key HTML by
`crates/forma-ir/tests/island_emitter.rs` (`keyed_shapes_*` and the other
keyed fixtures) and the `list-same-source` golden of the js-emitter contract;
adoption by key by `packages/core/src/dom/__tests__/adoption-keyed-list.test.ts`
and the browser spec above.

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

**Document metadata and remaining scope.**

- `forma-server`'s document writer serializes the document title,
  body class and head metadata separately. The qualification follow-up now
  applies the same shared vectors through `escape_dom_html` on both SSR and
  browser-shell writers; nonces, digests, build identity, state and configuration
  JSON keep their existing encoding. `e2e/value-rules/metadata.mjs` parses those
  actual complete documents in each browser engine.
- The walker selects text-only parents by tag spelling in any namespace; a
  contextual namespace mechanism is written as a proposal below ("Namespace
  context for the walker"), with the SVG `title` disagreement it would close.
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
The qualification campaign found an exact shortest-decimal tie where Rust's
`LowerExp` chose `.63` and JavaScript chose `.62`. The formatter now uses
`ryu-js` 1.0.3 for ECMAScript's tie choice as well as exponent thresholds. The
original binary64 bits, seed and observations are retained in
`crates/forma-ir/tests/fixtures/parity/regressions/rule-2-seed1820300-index460.json`;
the shared number vectors include both signs and adjacent binary64 values.

**Vectors.** `crates/forma-ir/tests/fixtures/parity/numbers.json`, section
`values` (`lexeme`, `expected`): zero and −0, integers, fractions, the
`0.1 + 0.2` sum, the fixed/exponent boundaries at 1e-6/1e-7 and 1e20/1e21,
seventeen significant digits, 2^53 and the float that rounds to it, the
smallest subnormal and the largest finite. Consumers: `crates/forma-ir/src/walker.rs`
> `value_rule_vectors` > "rule_2_numbers_are_written_in_ecmascript_formatting_as_text_and_attribute"
and `packages/core/src/dom/__tests__/value-rule-2-numbers.test.ts` (the engine
is the oracle: `String(Number(lexeme))` must equal the vector before any
writer is checked, so the Rust side is held to the engine). In the three
engines, `packages/core/e2e/value-rules.spec.ts` serves each vector's range and
attribute as the walker writes them, and strict adoption of the number, static
and reactive, makes no write; its control serves Rust's `Display` spelling of
`1e21` (twenty-two digits) and adoption refuses it with
`FORMA_E_HYDRATE_VALUE` instead of repairing it.

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
The qualification campaign found an exact shortest-decimal tie where Rust's
`LowerExp` chose `.63` and JavaScript chose `.62`. The formatter now uses
`ryu-js` 1.0.3 for ECMAScript's tie choice as well as exponent thresholds. The
original binary64 bits, seed and observations are retained in
`crates/forma-ir/tests/fixtures/parity/regressions/rule-2-seed1820300-index460.json`;
the shared number vectors include both signs and adjacent binary64 values.

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
`String()` exactly; a refused one is not a safe integer). In the three engines,
`packages/core/e2e/value-rules.spec.ts` serves each admitted integer's digits
and each float origin's rule-2 spelling and adopts the number without a write.

## Rule 4: dates as epoch milliseconds, no `Intl` on the server

**Statement.** A date travels as a signed integer count of milliseconds since
the Unix epoch, truncated toward zero to whole milliseconds, within ±8.64e15
(the range ECMAScript's `TimeClip` accepts); beyond it the render refuses with
`RENDER-403`. The server never formats a date as text: a declared `Date` in a
text or attribute position, bare or through `String()`, is a build error
(`BUILD-610`, "a declared date cannot be used directly as text"), so no
locale, time zone or ICU table on the server can reach the page. Formatting is
the component's, in the browser, from the number.

**Why.** ICU 72 put U+202F into time formats and Firefox patched it back to a
space (Mozilla 1806042): any server-side formatting is a parity break waiting
on a library version. The number is exact on both sides and `new Date(ms)` is
the same instant everywhere.

**Implementation.** Rust: `crates/forma-ir/src/props/value.rs` >
`date_milliseconds` (`SystemTime` to signed milliseconds, the sub-millisecond
part dropped on both sides of the epoch, the bound checked before the cast);
no formatting API exists in the crates (no `Intl`, no `chrono` formatting).
Compiler: `packages/compiler/src/props-bindings.ts` > `propSlot` refuses a
declared `date` as `text` or `attribute`, and `propPath` refuses `String()` of
any declared prop. Client: `new Date(ms)`. No code changed for this rule; the
vectors pin it.

**Vectors.** `crates/forma-ir/tests/fixtures/parity/dates.json`: `epochMs`
(the epoch, one either side, an ordinary instant, both limits, both one-over,
a safe integer past the Date range), `truncation` (`sign`, whole `millis`,
extra `nanos`, `expected`: toward zero on both sides of the epoch, including
−0.999999 ms as `0`), and `compiledText` (a declared Date bare in text,
through `String()`, and as an attribute: each `BUILD-610`). Consumers:
`crates/forma-ir/tests/page_props.rs` > `value_rule_vectors` >
"date_vectors_are_epoch_milliseconds_truncated_toward_zero",
`packages/compiler/tests/value-rule-4-dates.test.ts`, and
`packages/core/src/dom/__tests__/value-rule-4-dates.test.ts` (`new
Date(ms).getTime()` is the oracle: the instant for an admitted vector, NaN
for a refused one, and the truncated value for the fractional ones).

## Rule 5: `null` writes nothing on every side

**Statement.** `null` and `undefined` write nothing. As a text child they
contribute no text: the walker's `DYN_TEXT` range on a `Null` slot holds only
the marker vocabulary's U+200B and shows nothing, `h()` appends nothing, and
strict adoption expects the empty string; a later `null` written into a live
range clears it to empty text, never the word. As an attribute value the
attribute is absent on both sides (the walker omits a `DYN_ATTR` whose slot is
`Null`; `h()`, its `class` writer included, and adoption omit it), and a later
`null` removes it. Inside a text-only parent (`textarea`, `title`) an absent
child contributes the empty string to the composed value. The walker has one
absent value, `Null`; the client treats `undefined` exactly as `null`.

**Why.** v1's adoption wrote the word `null` where the walker and `h()` wrote
nothing (DR-9); that is fixed and now pinned. The vectors found one more
disagreement, in `h()`'s `class` writer: a reactive class getter returning
`null`, `undefined` or `false` threw inside its effect (the rule-1 normalizer
was handed a non-string) and left the previous class standing, so a fresh
element kept `class="x"` in all three engines while the walker omits the
attribute. (A static `class: true` wrote the word `true`; under rule 6's
attribute table that is now what every writer writes.)

**Implementation.** Rust: `crates/forma-ir/src/walker.rs` (`DYN_TEXT` on
`Null` writes the empty holder, `DYN_ATTR` on `Null` writes nothing, a text-only
parent composes the empty string). TypeScript: `h()`'s `appendChild` skips
`null` and `undefined` and a reactive child returning one clears its content;
adoption's text expectation is empty and `prepareAttribute` expects the
attribute absent; `class`/`className`, static and reactive, now follows rule
6's attribute table as every other attribute writer does (`null`, `undefined`
and `false` remove the attribute, anything else, `true` included, its string
under rule 1): the inner `write` of `handleClass` and the class branch of
`applyStaticProp` in `packages/core/src/dom/element.ts`.

**Vectors.** `crates/forma-ir/tests/fixtures/parity/null.json`: `children`
(`null` alone, between, first, last, only `null`s, beside a number; `expected`
the composed text) and `attribute` (`title`, `class`, `data-x`). Consumers:
`crates/forma-ir/src/walker.rs` > `value_rule_vectors` >
"rule_5_null_writes_nothing_as_text_attribute_and_textarea_child" (the exact
ranges, the visible text, no word `null`, the `textarea` value, the omitted
attribute); `packages/core/src/dom/__tests__/value-rule-5-null.test.ts` (each
vector with `null` and again with `undefined`: `h()` children static and
reactive, `childText`, a `textarea`, the attribute static, reactive and on
adoption with a later `null` removing it, and a served empty range adopting a
`null` child without a write whose later `null` clears the retained Text); and
`packages/core/e2e/value-rules.spec.ts` in the three engines (each `children`
vector served as the walker's ranges, as composed static text and as a
`textarea`; each attribute omitted, static and reactive, all adopted without a
write; a later `null` or `undefined` removing the attribute on an adopted and
on a fresh element).

**Not in this rule.** `style` objects, form-control properties (`value`,
`checked`, `selected`) and the raw sinks keep their own typed handling and
are not vectors here.

## Rule 6: a boolean in text is a build error

**Statement.** A text position whose value the compiler can prove is
boolean-typed is a build error, `BUILD-614`: a declared boolean prop
(optional included), a signal whose literal default is a boolean, a closed
boolean (an aggregate or list-row field, a module-level `const` initialized
with `true` or `false`), or an expression whose every result is a boolean
(`!x`, a comparison, `&&`, `||` or a ternary of booleans), read eagerly or
through a getter, as a child or as a `createShow` or ternary branch. Admitted:

- `String(flag)`. On a non-optional declared boolean it binds `DYN_TEXT` to
  the boolean slot itself and the walker writes `true` or `false`, the word
  `String()` gives; on a boolean signal, or on an expression the compiler
  evaluates (`String(!ready())`, also as a ternary branch), it folds to the
  word. On an optional declared boolean it stays `BUILD-610` (the browser
  would write `undefined` where the server writes nothing), and on a closed
  value or a module `const` it is not folded (`BUILD-610`); there a ternary
  writes the word, `() => (flag ? 'yes' : 'no')`. Each `BUILD-614` message
  gives the form that builds for its source, and every refused vector's `fix`
  builds.
- A boolean literal as a child or a branch: nothing on both sides.
- A mixed expression whose boolean result stands for "nothing"
  (`ready() && 'Go'`). Eagerly it folds, to nothing at a boolean; through a
  getter the server writes an empty range when its default is the boolean and
  the string otherwise, and the browser writes the same.

On every client path a boolean text value writes nothing: `h()`, strict
adoption's expectation and adoption's later writes. As an attribute value a
boolean follows the attribute table below.

**The attribute table (findings F2 and F3).** An attribute in the HTML
boolean set (core's `BOOLEAN_ATTRS`: `async`, `autofocus`, `autoplay`,
`checked`, `controls`, `default`, `defer`, `disabled`, `formnovalidate`,
`hidden`, `ismap`, `loop`, `multiple`, `muted`, `nomodule`, `novalidate`,
`open`, `playsinline`, `readonly`, `required`, `reversed`, `selected`) is
presence according to scalar truthiness: `true`, a nonempty string (including
`"false"` and `"0"`), or a nonzero number writes it bare; `false`, `null`,
`undefined`, `""`, `0` and `-0` omit it. Every other
attribute, `data-*`, `aria-*`, `class`, `title` and the rest, is the value's
string: `true` is the word `"true"`, a string is itself, the empty string
included, and `false` and `null` omit it. Names are matched as written,
lower-case. The same on every writer: the walker's `DYN_ATTR`
(`HTML_BOOLEAN_ATTRIBUTES` in `crates/forma-ir/src/walker.rs`), the
compiler's static attributes (`HTML_BOOLEAN_ATTRIBUTES` in
`packages/compiler/src/value-rules.ts`), `h()` static and reactive, and
adoption's expectations and later writes
(`packages/core/src/dom/adoption-attributes.ts`). Before it, a reactive `true`
on `data-live` or `aria-pressed` was bare from the walker and adoption and
`"true"` from `h()`'s reactive writer, and bare again from its static one
(F2; FORMA-188 saw `aria-pressed=""`, which ARIA reads as no value). An
non-boolean attribute whose server value is the empty string is written: a client slot
cannot carry an empty default (zero default bytes are "no default", which the
walker reads as `null`), so the compiler writes such an attribute as a static
`name=""` (a signal created with `''`, or a value that evaluates to `''`);
before, `value: () => query()` over `createSignal('')` was dropped by the
server and written `value=""` by `h()` (F3). `aria-*` `false` omits the
attribute as every non-boolean `false` does; a page that needs ARIA's
`"false"` token writes the word, `() => String(pressed())`.

Vectors: `crates/forma-ir/tests/fixtures/parity/attributes.json`
(`booleanAttributes`, `values` for the slot writers, `compiled` for the
compiler). Consumers: `crates/forma-ir/src/walker.rs` > `value_rule_vectors` >
"rule_6_attribute_values_follow_one_table" (each value as `DYN_ATTR`, and
every boolean name bare beside its `data-` twin as the word),
`packages/compiler/tests/value-rule-6-attributes.test.ts` (each compiled shape
with no diagnostic and its attribute under the defaults; the compiler's set
equals the file's), `packages/core/src/dom/__tests__/value-rule-6-attributes.test.ts`
(`h()` static and reactive, adoption's expectation, later write and a served
attribute adopted without a write), and `packages/core/e2e/value-rules.spec.ts`
(each value served as the walker writes it and adopted without a write, static
and reactive, in the three engines). First failures:
`work/FORMA-182-rules/first-failures/` `forma-ir-f2-f3.log` (26),
`core-f2-f3.log` (30 of 56), `compiler-f2-f3.log` (29 of 39),
`core-e2e-f2-f3.log` (24, every engine). The js-emitter corpus outputs it
regenerates (`dynamic-attrs` `.ir`/`.dump`/`.html`, `jsx-page.html`,
`sub-component-scopes.html`) are archived in
`docs/archive/2026-10-15-pre-attribute-values/` with a before/after ledger.

**Why.** DR-9: a boolean text was `true` or `false` from the walker and
adoption and nothing from `h()`. The vectors found where that reached a
page: a boolean signal, a negation or a comparison read through a getter was
served as the word; the idiom `() => ready() && 'Go'` at `false` was served
as `false`; a `true` literal in a ternary branch was served as `true`; and
core's adoption expected and later wrote the word, so an adopted page showed
`false` where a fresh `h()` showed nothing (first failures in
`work/FORMA-182-rules/first-failures/`: `compiler-rule-6.log`,
`core-rule-6.log`, `core-e2e-rule-6.log`). A declared boolean already wrote
nothing on both sides, which agreed but hid the author's mistake: the text
shows nothing whatever the value. Refusing at build time is what design 4's
decision 2 asks ("rejects … booleans in text").

**Implementation.** Compiler: `packages/compiler/src/value-rules.ts`
(`valueKind`, `moduleBoolean`, `refuseBooleanText`); `props-bindings.ts` >
`emitPropText` (a declared boolean refused after the read's own checks;
`String(flag)` admitted); `closed-bindings.ts` > `emitClosedText`;
`ir-walk.ts` > `emitChild` and `emitBranchContent` (signals, expressions,
module constants, the idiom's empty default, the `true` literal), and
`evalNode` folds `String()` of a boolean. `BUILD-614` is catalogued in
`diagnostics.ts` and `docs/DIAGNOSTICS.md` with its conformance pair
(`packages/compiler/tests/fixtures/conformance/BUILD-614/`: the refused
`() => done()` and its near miss `() => String(done())`). Rust: no change; a
`Bool` slot read as `DYN_TEXT` writes the word, which the near miss relies on.
Core: `packages/core/src/dom/adoption.ts` > `text()` maps a boolean to the
empty string, as it already did `null`.

**Vectors.** `crates/forma-ir/tests/fixtures/parity/boolean-text.json`:
`compiledText` (twenty-seven page shapes, each refused with its code (and, for
`BUILD-614`, a `fix` that builds) or built
with no diagnostic and the visible text `writes` under its defaults),
`nearMissText` (the word for `true` and `false`), `idiom` (`() => ready() &&
'Go'` at each default); its attribute half is `attributes.json` (the table
above). Consumers:
`packages/compiler/tests/value-rule-6-boolean-text.test.ts`, the `BUILD-614`
pair in `packages/compiler/tests/diagnostics-conformance.test.ts`,
`crates/forma-ir/src/walker.rs` > `value_rule_vectors` >
"rule_6_the_string_near_miss_writes_the_boolean_word_and_the_idiom_its_range"
(the word and the idiom's ranges),
`packages/core/src/dom/__tests__/value-rule-6-boolean-text.test.ts`
(`String(flag)` static and reactive, the browser-only drop of a bare boolean,
the idiom fresh and adopted with its later writes), and
`packages/core/e2e/value-rules.spec.ts` in the three engines (the word and the
idiom's ranges adopted without a write; a
control shows the word the walker used to serve for the idiom at `false`
refused). Mutation probes `adoption/boolean-text-word`, and for the attribute
table `el/static-class-true-bare`, `el/static-true-bare` and
`adoption/true-bare-off-boolean-set`, are caught by the core suite.

**Migration.** Breaking: a page that reads a boolean as text no longer
builds; the fix is `String(flag)` or a ternary, as the message says. Rendered
output also changes with no source change: `() => ready() && 'Go'` at `false`
no longer serves the word `false` (an empty range), a `true` ternary branch no
longer serves `true` (nothing), and core's adoption writes nothing for a
boolean text value where it wrote the word. A page server-rendered by an older
compiler and adopted by this core refuses at that idiom
(`FORMA_E_HYDRATE_VALUE`): compiler and core move together in 3.0.0. Two
compiler tests read one
(`tests/props-bindings.test.ts`, `tests/ssr-emission.test.ts`); they were
migrated and their original sources archived in
`docs/archive/2026-10-15-pre-value-rules/`, where
`packages/compiler/tests/value-rules-archive.test.ts` pins each refusal.
Applications are counted with FORMA-192's read-only runs. The FMIR corpus
(`crates/forma-ir/tests/fixtures/js-emitter`) and the declared-props fixtures
are byte-identical.

## Rule 7: conditions are boolean-typed

**Statement.** The condition of a `createShow` and the test of a ternary child
must be boolean-typed. A condition the compiler can prove is of another type is
a build error, `BUILD-615`: a declared prop that is not a boolean, a signal
whose literal default is a number, a string or `null`, a closed value (an
aggregate or list-row field, an aggregate itself, a module-level `const`) of
another type, a non-boolean literal, or an expression whose result is not always
a boolean (`a() && count()`, `name() || 'x'`). Admitted: a declared boolean
(optional included: absent reads as `false` on both sides), a boolean signal, a
closed boolean, a boolean literal, `!x` and `!!x`, a comparison, `Boolean(x)`
(now folded as `!!x` is), and `&&` or `||` of booleans. A scalar signal getter
passed to `createShow` itself (`createShow(open, …)`) is read as its call,
since `createShow` calls it, so a number getter is refused and a boolean one
folds. Anywhere else a getter named without its call (`() => open ? a : b`,
`() => open`, `ready() && open`, `!open`) is the function itself, always truthy
in the browser whatever the signal holds: `BUILD-615`, naming the missing call
(`call it, open()`). A module-level boolean `const` is now folded in a
condition, so the server renders the branch the browser takes (it used to be
`BUILD-302`, the `else` branch whatever the value). A condition the compiler
cannot type at all keeps `BUILD-302`: the server renders the `else` branch
without proof, as before.

**Why.** The walker picks a `SHOW_IF` branch by the slot's boolean; for any
other value it falls back to ECMAScript truthiness, which a number or a string
only imitates what the author meant (React's `{count && …}` printing `0` is the
shape design 4 keeps out). The compiler built every such condition (first
failures: `work/FORMA-182-rules/first-failures/compiler-rule-7.log`, 17 of 28:
the fifteen refusals missing, a module boolean reported `BUILD-302` and rendered
`else` when it was `true`). With the type fixed at build time, the walker's
truthiness fallback is unreachable from a compiled product.

**Implementation.** Compiler: `packages/compiler/src/ir-walk.ts` > `addShowSlot`
(the one place a `createShow` condition and a ternary test become a `SHOW_IF`
slot) checks the declared type (`props-bindings.ts` > `declaredKind`), the closed
values (`value-rules.ts` > `closedKind`) and the expression (`valueKind`), refuses
with `refuseConditionType`, and folds module booleans with `moduleLiteral`.
`BUILD-615` is catalogued in `diagnostics.ts` and `docs/DIAGNOSTICS.md` with its
conformance pair (`packages/compiler/tests/fixtures/conformance/BUILD-615/`:
`() => count()` refused, `() => count() > 0` admitted). Rust and core: no change;
the walker selects by the boolean, `createShow` by the condition's value.

**Vectors.** `crates/forma-ir/tests/fixtures/parity/conditions.json`:
`compiledCondition` (thirty-one shapes, each refused with its code or built as
a `SHOW_IF` on a `TYPE_BOOL` slot with exactly its `diagnostics` and, where
given, the branch `writes` shows under the defaults) and `walker` (the branch a
`Bool` slot selects). Consumers: `packages/compiler/tests/value-rule-7-conditions.test.ts`,
the `BUILD-615` pair in `packages/compiler/tests/diagnostics-conformance.test.ts`,
`crates/forma-ir/src/walker.rs` > `value_rule_vectors` >
"rule_7_a_boolean_condition_selects_the_branch" (the exact `<!--f:sN-->` range
with element branches), `packages/core/src/dom/__tests__/value-rule-7-conditions.test.ts`
(`createShow` on a boolean, static and toggled; the walker's range adopted without
a write and toggled), and `packages/core/e2e/value-rules.spec.ts` in the three
engines (the same range parsed, adopted without a write, toggled and back).

**Migration.** Breaking: a page whose condition is a number, a string, `null`
or an object no longer builds; the fix is an explicit comparison or `!!`. The
common shapes are `createShow(() => count(), …)`, `createShow(count, …)`, a
ternary on a `null`-default signal (`() => user() ? a : b`) and on a string
(`() => name() ? …`), which become `count() > 0`, `user() !== null` and
`name() !== ''`. One compiler test
read a zero-number condition (`tests/ir-walk.test.ts` > "writes false when the
condition evaluates falsy, including a zero number read through !!"); it reads
`!!count()` now, and the original fragments are archived in
`docs/archive/2026-10-15-pre-value-rules/` and pinned as `BUILD-615` by
`packages/compiler/tests/value-rules-archive.test.ts`. The FMIR corpus, the
declared-props fixtures, the create-app templates (the dashboard is
`ssr: false`; the minimal template has no condition) and the SSR e2e cases build
unchanged. Applications are counted with FORMA-192's read-only runs.

## Proposals (not implemented)

Changes the rules point at that need a broader decision than one rule's
vectors; each is written here instead of as code.

### The walker refusing a non-boolean `SHOW_IF` slot

Rule 7 makes the walker's truthiness fallback unreachable from a compiled
product, but the walker still applies it to a hand-assembled module or a server
that sets a show slot to a number through the untyped slot API. Proposed: the
walker refuses a `SHOW_IF` whose slot value is not `Bool` or `Null` (a render
error with its own code) instead of imitating ToBoolean, with a vector per value
kind in `conditions.json`. Not done here: it changes `crates/forma-ir/src/walker.rs`
in the code FORMA-181 checkpoint B is changing, and it needs the render-error
catalogue's owner to name the code.

### Namespace context for the walker

The walker chooses a text-only parent (`title`, `textarea`, `style`, `script`)
and the `pre`/`listing`/`textarea` first-line-feed rule by tag spelling in any
namespace; it has no namespace stack. Static text agrees: FORMA-026's vectors
(`crates/forma-ir/tests/fixtures/parity/namespaces.json`, read by core's
`renderer-contract.test.ts` and `e2e/adoption.spec.ts`) cover an SVG `<title>`
with literal text. A dynamic child does not: adoption treats only the HTML
`title` as text-only (`packages/core/src/dom/adoption.ts` checks its
`namespaceURI`), so inside an SVG `<title>` it expects the `<!--f:tN-->` range
the walker never writes there, and refuses the walker's
`<svg><title>x</title></svg>` for `h('svg', null, h('title', null, () => x))`
with `FORMA_E_HYDRATE_MARKER` (checked while writing this; the same markup with
the range adopts). The same holds for an SVG `style` or `script`, which the
parser builds as ordinary children in foreign content. Proposed:

1. Completed by the qualification follow-up: `namespaces.json` lives in
   `crates/forma-ir/tests/fixtures/parity/`, with a native reader that emits
   FMIR for every frozen tree and compares the real walker output. The six
   admitted cases and the intentional script reference/refusal are preserved.
2. Add a namespace stack to the walker's state: push `svg` at `<svg>`, `mathml`
   at `<math>`, back to `html` inside the integration points (`foreignObject`,
   `desc` and `title` in SVG; `annotation-xml` with an HTML encoding in MathML),
   pop at the matching close; select text-only parents and the line-feed rule only
   in the `html` namespace. FMIR needs no new opcode: the namespace follows from
   the tags.
3. Add vectors for each disagreement before the change (an SVG `title` holding a
   `DYN_TEXT`, an SVG `style`, a `pre` inside `foreignObject`), first-failure logs,
   then the walker change and, where the client chooses by spelling, its matching
   selection, in one pull request.

Order: after FORMA-181 checkpoint B merges, since both change the walker's state.
Until then a dynamic value inside an SVG `title` refuses adoption loudly rather
than rendering wrong; a static one is unaffected.

The namespace-stack and dynamic SVG-title proposals in steps 2–3 remain
explicit 3.1 work under decision L-57. Relocating and replaying the existing
static vectors does not expand admission or silently implement that proposal.

INV1 attribute-name and URL checks are specified in [INV1.md](INV1.md) and share
`inv1.json` beside these value vectors (FORMA-140). A rejected served attribute
refuses strict adoption; initial DOM is never repaired.
