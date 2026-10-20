# Changelog

## [3.0.0-rc.5] - Prepared; publication pending

- Correct the synthetic packed-qualification prerelease fixture so it cannot inherit a final-only soak deferral. The real guard, runtime, qualification harness and thresholds are unchanged; the regression rejects the original inconsistent fixture and preserves rejection of unnormalized deferrals.
- Published RC.4 remains immutable and qualified. This successor carries the test repair through the existing exact-source audit and final-diff rules; final publication and the actual post-release active soak remain outstanding.
- Coordinate all seven package versions, dependency locks and scaffold source seeds. Require independent review, exact-source CI, packed qualification and trusted publication.

## [3.0.0-rc.4] - Prepared; publication pending

- Bound each background island-load callback to four direct queue entries as well as its existing 12 ms deadline. Preserve whole-island adoption, synchronous input promotion, cancellation and readiness; neither bound can preempt an expensive island or additional promoted work.
- Keep the strict 50 ms mobile-task and 500 ms response gates. RC.3 failed its tagged mobile campaign and remains unpublished and immutable; this candidate requires fresh packed qualification and independent audit before publication.
- Coordinate all seven package versions and source template seeds. The actual same-RC active soak remains outstanding after final publication under L-66-QUOTA.

## [3.0.0-rc.3] - Prepared; publication pending

- Coordinate the seven-package RC.3 set and template source seeds; published RC.2 remains unchanged.
- Correct synthetic release-test fixtures to reconstruct their declared milestone states without carrying live final-soak deferral metadata. Exercise both ordinary and deferred input snapshots; production gate validation remains strict and unchanged.
- Require independent review, exact-source CI and tagged packed qualification before trusted publication. Final publication and the actual post-release active soak remain outstanding.

## [3.0.0-rc.2] - Prepared; publication pending

- Coordinate the seven-package RC.2 set and template source seeds. RC.1 remains published and immutable; no runtime behavior changes in this preparation.
- Correct the release verifier's Actions archive request media type, with a regression test reproducing the observed HTTP 415. Release asset downloads keep their binary media type, and archive identity, provenance and size checks remain enforced.
- Require independent review, exact-source CI and the new tag's packed qualification before trusted publication. Actual post-release soak remains outstanding.

## [Unreleased]

Changes after the prepared 3.0.0-rc.4 set will be recorded here.

## [3.0.0-rc.1] - Prepared; publication pending

Prepared as part of the coordinated seven-package 3.0.0-rc.1 set, including the
changes below and the preceding 3.0 prereleases. This heading does not assert
publication; the release workflow and registry verification establish that.

- FORMA-182 qualification: use `ryu-js` 1.0.3 for ECMAScript number formatting.
  Rust's `LowerExp` chose the wrong shortest decimal at exact ties: binary64
  `c2eeb5cf467752d4` rendered as `-270129723325078.63` instead of JavaScript's
  `-270129723325078.62`. Shared vectors retain the seeded counterexample,
  its positive counterpart and adjacent binary64 values. Negative zero,
  exponent thresholds and non-finite spellings retain their existing contract.
  The dependency has no default runtime dependencies, supports Rust 1.71,
  and is licensed Apache-2.0 OR BSL-1.0.
- FORMA-182 qualification: the frozen FORMA-026 namespace vectors now live in
  `tests/fixtures/parity/namespaces.json`; a native test builds FMIR from each
  tree and checks the real walker's output. The script reference remains a
  client construction refusal. This adds no namespace-stack policy.

- FORMA-181 checkpoint C (review follow-ups of B): `ListKeyViolation` is `#[non_exhaustive]`
  with a constructor, `ListKeyViolation::new`; a key path segment holding a dot or a bracket,
  or an empty one, is quoted in the diagnostic (`["user.id"]`); a row's key is held once (one
  `Rc<str>` shared by the duplicate set and the row's guard). `keys.json` string vectors carry
  the `served` markup the walker writes, pinned by a walker test and decoded by the three
  browser engines in core's `keyed-adoption.spec.ts`.

### Shared attribute-name and URL policy — FORMA-140

- Native rendering and core now run one INV1 vector table for names, URL values and ordinary output payloads. Fresh core and strict adoption apply the native ASCII name rule: rejected names are omitted, and a served rejected attribute refuses that island with `FORMA_E_HYDRATE_VALUE` without repair. Existing URL, typed raw-content and event-listener policies remain explicit in `docs/INV1.md`.

- FORMA-182 review: HTML boolean attributes consistently use scalar truthiness. Empty strings and numeric zero (including -0) are omitted; nonempty strings and nonzero numbers are bare. This preserves the existing browser behavior and prevents an empty signal default from unexpectedly enabling `disabled`, `hidden` or `checked` in served HTML. Compiler defaults, the native writer, strict attribute adoption and the checked/selected control oracle share the expanded vectors. Empty strings on ordinary attributes remain present.

- FORMA-182, rule 6's attribute table (finding F2), **rendered output changes with no source
  change**: a `DYN_ATTR` over a `true` slot writes the bare name only for an HTML boolean
  attribute (`HTML_BOOLEAN_ATTRIBUTES`, the same list as core's `BOOLEAN_ATTRS`); on any other
  attribute it writes the word, `data-live="true"`, `aria-pressed="true"`, `class="true"`, as
  `h()` does. `false` and `Null` still omit the attribute. Shared vectors
  `tests/fixtures/parity/attributes.json`; test `walker.rs > value_rule_vectors >
  rule_6_attribute_values_follow_one_table`; the js-emitter goldens `jsx-page.html` and
  `sub-component-scopes.html` regenerated, originals archived with a ledger in
  `docs/archive/2026-10-15-pre-attribute-values/`.

- FORMA-181 checkpoint C (review follow-ups of B): `ListKeyViolation` is `#[non_exhaustive]`
  with a constructor, `ListKeyViolation::new`; a key path segment holding a dot or a bracket,
  or an empty one, is quoted in the diagnostic (`["user.id"]`); a row's key is held once (one
  `Rc<str>` shared by the duplicate set and the row's guard). `keys.json` string vectors carry
  the `served` markup the walker writes, pinned by a walker test and decoded by the three
  browser engines in core's `keyed-adoption.spec.ts`.
- FORMA-181 checkpoint B (DR-8, L-7): the walker reads FMIR section `0x0006`. For each
  `LIST` it names, every row's value at the key path becomes the row root's
  `data-forma-key`, as canonical text: a string under value rule 1, a safe integer in
  decimal (`-0` as `0`). A row whose value at the path is missing, declared twice, behind a
  non-object, or not a string or safe integer, two rows of one list execution sharing a key
  (each execution of a LIST is its own scope), a row without exactly one balanced root
  element at its own level (a registered child's island envelope may wholly enclose it), or
  an authored `data-forma-key` on that root refuse the whole render with the new
  `IrError::InvalidListKey` (`ListKeyViolation`: LIST offset, zero-based row, path,
  `ListKeyReason`; displayed as `RENDER-503`; a duplicate names both rows, never the key).
  The key path is resolved once per LIST execution; a string key is charged to the output
  budget before it is built; the slot journal, the keyed-row guard and the list depth are
  restored before any error propagates. A `LIST` without an entry writes no key and renders
  byte-identically to before. New crate-private `keys` module; shared vectors
  `tests/fixtures/parity/keys.json` (read by core's `key-text.test.ts` too); the
  js-emitter contract feeds every keyed list the identity its module declares and the
  `list-same-source` golden now carries the keys (original archived under
  `docs/archive/2026-10-15-pre-native-keys/`). The legacy `pending_list_key` field, set
  by nothing since `LIST_ITEM_KEY` was never emitted, is gone.
- FORMA-182: the walker writes ordinary text and attribute values under value rule 1
  (`docs/parity-rules.md`): CRLF and CR become LF and NUL becomes U+FFFD, per value, as
  the browser parses them; `textarea`, `pre` and `listing` double only an initial
  normalized LF of their first content token (a marker comment or child consumes that
  boundary); a bound select or textarea value and an option's value or text are
  compared normalized; the URL guard classifies the raw value and refuses a NUL
  anywhere in a URL attribute. The output budget now counts
  each normalized character's encoded length, so a three-byte U+FFFD or a four-byte
  astral character can no longer overshoot the limit. Crate-private `text::normalized_chars`;
  shared vectors in `tests/fixtures/parity/normalization.json`. The state envelope and
  declared props stay byte-exact.

## [3.0.0-alpha.2] - 2026-10-15

Supersedes `3.0.0-alpha.1`, whose tag never published (its release run stopped in P17, the verification harness, before any publish job: the packed build's optional compiler peer resolved through the unbuilt workspace instead of the packed set; nothing reached the registries). The harness now resolves packed libraries inside the packed set and proves it. Version only; the alpha.1 notes below stand.

## [3.0.0-alpha.1] - 2026-10-15

The first 3.0.0 pre-release (milestone M2), a Cargo pre-release version on crates.io that plain requirements exclude. Part of the seven-package set 3.0.0-alpha.1; the FMIR v3 reader with its seeded-bug qualification (FORMA-185), the compatibility window (FORMA-112), `PageProps` (FORMA-102) and the removals (FORMA-110) below are the alpha's gates. The conformance and hostile corpora (FORMA-139, 108) are pending before the rc. See the root CHANGELOG for the set and the pending gates.

- FORMA-102: re-export `PageProps` derive for named structs/unit enums, compare the
  actual FMIR schema by name, and retain a checked module in `props::BoundProps`.
  Projection omits absent object fields, preserves array positions and excludes
  extra Rust fields. Checked values enforce safe integers before conversion,
  finite floats and signed valid-Date milliseconds with route/path diagnostics.


### Compatibility — FORMA-112

- Broaden FMIR reader acceptance to same-major, writer-minor-at-most-reader-minor compatibility; patch is ignored. Preserve historical exact-stage fixtures and add an explicit current expectation table. Shared version pairs exercise the actual header parser.

### Removed — FORMA-110

- Removed the `wasm` feature, its `render`/`render_island` JavaScript exports, wasm-bindgen dependency and wasm-pack metadata. The native parser and page walker remain supported.
- Made `walk_island` and `walk_island_with_limits` crate-internal (DR-10). Their unchanged page/fragment corpus runs in a private unit-test module; no feature exposes a fragment renderer.


### FMIR v3 (FORMA-185)

- Added the seeded-bug qualification regressions (`fuzz/regressions/*/seeded-*`) and the stable test `seeded_decoder_defects_are_caught_deterministically` that asserts the CRC, section-table bound and string-length guarantees on every pull request.

- Replace the v2 container with the reviewed 24-byte header and CRC over all bytes except the
  stored CRC field; enforce exact Cargo base-version triples and a 16 MiB module ceiling.
- Parse variable sections, bounded acyclic props schemas, island schema/digest fields, list key
  paths and optional source positions. Validate every string index during load and expose
  non-exhaustive `IrError::code()` diagnostics. V2 inputs return a rebuild error.
- Remove the six reserved opcode variants and PropsMode. Preserve the compiler corpus's HTML.
- Share generated constants with the TypeScript writer. Canonical dumps retain every section's
  bytes; reviewed fixtures, boundary tests and stable fuzz replay pin the contract.


### Changed
- **The list-walk time gate (`tests/list_scaling.rs`) compares 100 and 3,200
  rows, bounded at 64x** (A2 audit F17b, FORMA-180): it compared 100 and
  1,600 at 32x, where a walker that only scans the list once per row sat at
  34.9x. Linear is 32x; the same walker measures 110x to 125x, and the
  unmutated one 32.1x to 32.3x under load. Tests only; the walker is
  unchanged.

## [0.2.2] - 2026-10-14

Release A2's bridge (0.2.2): additive (FORMA-120; DR-11, DR-12).

### Upgrading from 0.2.1: what an application may meet
- **The same HTML.** Every walk writes 0.2.1's bytes; `walk_to_html_counted`
  is new beside the existing functions.
- **A list past the iteration budget fails before its first row,** with
  `ListBudgetExceeded`, ahead of any error its rows would have raised first
  (under Changed). Whether an input fails is unchanged.
- **The `wasm` feature warns.** A build that turns it on and calls `render`
  or `render_island` gets deprecation warnings, and fails under
  `-D warnings` until it moves to `@getforma/core`'s `h()` or allows
  `deprecated` at the call.
- **forma-server 0.2.2 requires this version;** forma-ir 0.2.2 itself
  requires nothing new.

### Added
- **`walk_to_html_counted`**: the same HTML as `walk_to_html_with_limits`,
  byte for byte, plus what the walk wrote (`WalkOutput { html, counts }`,
  `WalkCounts { nodes, bytes, list_iterations }`). On failure it returns a
  `WalkFailure` with the error, the counts reached (SR22) and the component
  path: the islands open where the walk stopped, outermost first. It catches a
  panic inside the walk and returns it as the new `IrError::Panicked`, with the
  same path and counts (DR-12); under `panic = "abort"` there is nothing to
  catch. Tests: `walker::tests` >
  `counted_walk_writes_what_walk_to_html_writes_and_counts_it`,
  `counted_walk_returns_the_counts_reached_when_a_budget_stops_it`,
  `counted_walk_names_no_component_for_a_failure_outside_every_island`,
  `counted_walk_names_every_island_around_a_failure_outermost_first`,
  `counted_walk_catches_a_panic_and_names_its_island`.
- `fault_injection::FAULT_TRIGGER`, behind a new internal feature,
  `__fault-injection` (`#[doc(hidden)]`, outside the semver promise): a
  DYN_TEXT value that makes the walk panic, the stand-in for a component that
  panics (SR44). Only `walk_to_html_counted`, which catches it, ever arms it;
  `walk_to_html` renders the value as text. Only the two crates' own
  dev-dependencies enable the feature, and `test-helpers` does not imply it,
  so no 0.2.1 user can have it on (review of FORMA-120). Tests:
  `walker::tests::the_fault_trigger_is_armed_only_by_the_counted_walk`;
  `tests/feature_isolation.rs` >
  `test_helpers_alone_does_not_compile_the_fault_trigger_in` (a scratch
  edition-2018 consumer with `test-helpers` on fails to compile a reference
  to the trigger, and compiles one to the encoders).

### Changed
- **A list longer than the remaining iteration budget fails before its first
  row** (FORMA-122; DR-13, SR38). The walker compares the list's length with
  what is left of `max_list_iterations` and returns `ListBudgetExceeded` at
  once, instead of walking up to the budget first: a hostile 60,000-row list
  under the default 50,000 costs one comparison, not 50,000 rows (at 0.2.1,
  23.6 to 24.9 ms to the error in a release build). Whether an input fails is
  unchanged, but which error it reports can change: a list past the budget now
  reports `ListBudgetExceeded` before any error its rows would have raised
  first (`OutputLimitExceeded`, or a malformed row's `StringIndexOutOfBounds`),
  so a malformed module behind an over-budget list shows as RENDER-302 until
  the list fits. The per-row check stays for rows that nested lists spend
  after a list was let in. Defaults unchanged. Tests:
  `walker::tests` > `a_list_longer_than_the_remaining_budget_fails_before_its_first_row`,
  `a_list_exactly_at_the_remaining_budget_still_renders`,
  `a_nested_list_is_checked_against_what_its_parents_left`,
  `the_per_row_check_still_stops_a_list_whose_nested_rows_spend_the_budget`.
  `examples/list_corpus` output is byte-identical, and `examples/list_scaling`
  is unchanged at 400 rows.
- **No `unwrap`, `expect` or `panic!` in the shipped code** (DR-12, SR44):
  Clippy denies them outside tests (`#![cfg_attr(not(test), deny(...))]`).
  The parser's fixed-width reads index the bounds-checked slice instead of
  `try_into().unwrap()`; `dump_ir` writes through `fmt::Result`; the walker's
  marker-id write has no `expect`. Behaviour is unchanged. The `wasm` exports
  keep their panic, which wasm-bindgen turns into the JS exception the client
  loader catches, under a scoped `allow`; `test_helpers` likewise.
- `ListBudgetExceeded` is now raised before the over-budget row is counted, so
  the count reported with it is the rows actually walked. The same input fails
  at the same row with the same error.

### Deprecated

| Deprecated in 0.2.2 | Use instead (3.0.0's form) |
|---|---|
| the `wasm` feature, `render`, `render_island` (the browser's WASM walker) | none in forma-ir: islands re-render in the browser with `@getforma/core`'s `h()` |

- **The `wasm` feature and its exports, `render` and `render_island`, are
  deprecated and are removed in 3.0.0** (FORMA-131; DR-23). They are the
  browser's WASM walker, loaded by `@getforma/core/wasm`, which core 2.1.0
  deprecates with them; islands re-render with `@getforma/core`'s `h()`. Both
  exports carry `#[deprecated(since = "0.2.2")]`, so a caller's build warns,
  and still build and behave as at 0.2.1: CI's wasm32 build of the feature is
  unchanged. Each export also carries `#[allow(deprecated)]` so that
  wasm-bindgen's generated call to it stays quiet; it does not reach a caller.
  The crate docs, the README and the feature's line in `Cargo.toml` say the
  feature is deprecated. Deprecation is not a breaking change:
  `cargo semver-checks` against 0.2.1 passes. Tests: the doctest pairs in
  `src/deprecations.rs` (`WasmRender`, `WasmRenderIsland`; built by
  `cargo test -p forma-ir --doc --features wasm`, a new CI step): the 0.2.1
  call compiles under `allow(deprecated)` and fails under `deny(deprecated)`.
  The public deprecation text names no decision record (FORMA-131's review).

### Fixed (documentation only)
- `IrHeader`'s doc comment calls the module a `.ir` file, the name the
  compiler writes, not `.fmir` (FORMA-009).

## [0.2.1] - 2026-10-14

### Fixed — server HTML in its parsing context (changes emitted bytes on purpose)
- **No hydration markers inside `textarea`, `title`, `style` or `script`.**
  The tokenizer reads their content as text, so a marker comment there was
  literal text: a reactive textarea's value before JavaScript, and what a form
  submitted, was `<!--f:t0-->hello<!--/f:t0-->`, and a title showed the same.
  Inside these four (tag matched case-insensitively) the walker now writes no
  `f:` marker of any kind; dynamic text is written HTML-escaped, with no
  zero-width space for an empty value, and `SHOW_IF`/`LIST` render without
  markers. A textarea whose content starts with a line break gets one more,
  because the parser drops one after `<textarea>`. The client adopts
  `textarea` and `title` text by the element (formajs, FORMA-003), so this
  ships with that change. A reactive child of `style` or `script` is not
  supported for adoption in 0.2.x (its text is right before JavaScript;
  adoption may rewrite it) and becomes a build error in 3.0.0 (DR-7). A hole
  there is a code sink: the escaping stops it closing its element, not running
  as JavaScript or CSS. See ARCHITECTURE.md 3.3, "The context rule".
- **A `textarea`'s `value` is written as its text**, not as a `value`
  attribute, which a textarea ignores: the server shipped an empty control. The
  text is `value == null ? '' : String(value)`, as the client writes it, and it
  wins over any children.
- **A `select`'s `value` is written as `selected` on the matching option**, not
  as a `value` attribute, which a select ignores: the server shipped, and a form
  submitted, the first option. A single select selects the first option whose
  value is `String(value)`; a `multiple` select given an array selects every
  member (a `null` member is `"null"`, as `String(null)` is); `multiple` counts
  only when the attribute is written; an option's first `value` attribute is
  its value, and without one it is matched by its stripped and collapsed text,
  up to the next `<option>` or `<optgroup>` when `</option>` is left out; an
  authored `selected` inside a bound select is dropped. Unbound selects are
  unchanged.
- Tests: 21 walker tests under "Parsing context" in `src/walker.rs`, each
  two-sided (TESTING.md P3): the affected element with an unaffected sibling,
  or both outcomes of the rule; each of 30 mutation probes of the new code
  turns at least one of them red.
- Intended for a patch release (0.2.1): the FMIR format is unchanged.
- Not changed: the JS renderer (`renderToString` in formajs) still writes
  `value=` on these controls; ARCHITECTURE.md 6.2 records the gap.

### Changed
- **Cross-implementation corpus refreshed for the compiler's signal-scope fix**
  (`@getforma/compiler`, unreleased). No code in this crate changed; the
  `.ir` inputs and their goldens did, because the emitter now resolves signals
  in every scope its walk inlines. Six goldens moved, and every changed byte is
  the emitter finding something it previously lost:

  | Case | What moved |
  |---|---|
  | `dynamic-text` | four anonymous `text:*` slots became `headline`/`subhead`/`count`/`badge`; the `@page defaults` render went from four zero-width spaces to the real text, including a numeric `0` |
  | `dynamic-attrs` | `busy`/`tone`/`query` appear, `attr:value` disappears (that binding reuses `query`), and `@page defaults` gains `class="row"` / `class="calm row"` where both divs previously had no class at all |
  | `create-show` | the two condition signals prepend, shifting `SHOW_IF` slot ids; `@page defaults` renders the branches the CLIENT renders instead of ELSE everywhere |
  | `ternary-asymmetric` | same shape: ids shift, and the `compact` ternary now renders its THEN branch under defaults |
  | `nested-islands` | slot IDS only — `badgeLabel` is minted when the walk enters `inner-badge.ts` rather than up front. Names, types and defaults are unchanged |
  | `sub-component-scopes` | **new case**: signals in the four scopes the compiler's old extractors did not read, the same-name collision rule, and a `createShow` whose condition defaults to `true` |

  Slot ids reordering is safe for the wire contract and always was: the client
  matches hydration markers positionally and `DYN_TEXT` carries an independent
  `marker_id`. Slot NAMES are the injection contract, and the ones that changed
  are listed above.

## [0.2.0] - 2026-08-06

### Performance
- **A list now renders in O(rows). It was O(rows²).** `walk_to_html` cloned the
  entire `SlotData` inside the per-row loop, and because `SlotValue::Array`
  owned its payload, every row deep-copied the whole N-element array. A
  3-column table page cost 4x more for every doubling of rows: 1.6 µs at 1 row,
  2,106 µs at 100, 31,486 µs at 400 — 400 rows took 1,134,414 allocations and
  42 MB to emit 61 KB of HTML, which made the Rust walker slower than the
  JavaScript `renderToString` it exists to replace.

  The per-row clone is gone. `SlotValue::Array`/`Object` are `Arc`-backed, and
  the row's item binding (plus any PROP the body extracts from it) is now
  swapped in and journalled, then unwound at the end of the row — same scoping
  guarantee, no copying of state the row does not own. Marker ids are also
  written without allocating.

  | rows | before | after | |
  |-----:|-------:|------:|-|
  | 100 | 2,106 µs | 36 µs | 58x |
  | 400 | 31,486 µs | 147 µs | 214x |
  | 400 (allocations) | 1,134,414 | 2,412 | 470x |

  **Output is byte-identical** across the whole list corpus in
  `examples/list_corpus.rs` (21 cases covering PROP restore, sibling lists,
  nested lists, per-row islands, item/list slot aliasing). `tests/list_scaling.rs`
  is the regression gate: it fails the build if either time or allocation count
  grows more than 6x for a 4x increase in rows.

### Changed — cross-stack parity (may change emitted bytes)
- **DYN_ATTR boolean values follow `renderAttr`.** `true` now emits the bare
  attribute name and `false`/null omit it entirely. The walker used to write
  `disabled="false"` — and an HTML boolean attribute is ON whenever it is
  present, so SSR shipped a disabled/hidden/checked control that only un-broke
  itself after hydration, and never at all for a `visible`/`idle`/`interaction`
  island the user had not reached, or with JS off.
- **DYN_ATTR treats an empty string as a value.** `value=""` / `alt=""` now
  render as `attr=""` instead of being dropped, matching what the client's
  `setAttribute` produces for the same slot.
- **`SlotValue::as_bool` follows ECMAScript `ToBoolean`.** An empty array is
  now truthy (`!![]` is `true` in JS). A SHOW_IF bound straight to a list slot
  used to hide its block server-side and un-hide it the instant the client
  evaluated the same condition — a guaranteed visible flip on the empty-list
  case, which is the state a fresh page starts in. NaN is falsy.
- **`SlotValue::to_text` follows `String(value)` for containers.** Arrays join
  with `,` (nesting flattens, null/undefined become empty) and objects render
  `[object Object]`, replacing the invented `[Array]`/`[Object]`.
- **SWITCH stops at the first matching case.** Two cases carrying the same
  value used to render both bodies concatenated. (SWITCH still emits no
  hydration marker — the wire contract has no switch marker — and still has no
  default case; both are now documented at the opcode.)

### Fixed
- **Nested islands with no root element are an error, not a silent loss.** An
  ISLAND_START while another island is still waiting for its root element now
  returns `IrError::NestedIslandRoot`. Only one element can carry a
  `data-forma-island` set, so the outer island's identity was being dropped —
  it never hydrated, never disposed, and `activateIslands` could not find it.
- **An ISLAND_START naming an island the table does not declare is rejected at
  load** (`IrError::UnknownIslandId`). It used to render its markers with no
  `data-forma-*` attributes: an island that silently never hydrates.
- **A stray FALLBACK, and a TRY_START with no FALLBACK, are rejected at load**
  (`IrError::MalformedControlFlow`). A FALLBACK with no open TRY_START in its
  range made the walker render the *fallback* body as though it were main
  content.
- **Duplicate slot names resolve the same way everywhere.** Slot names are not
  unique (the compiler derives some per-element), and the three consumers
  disagreed: `slot_id_by_name` took the first, `SlotData::from_json` the last,
  and island props the last in ascending slot-id order. Setting a value by name
  filled one slot and left its twin blank while the island's props reported a
  third answer. **First in slot-table order wins**, in all three.
- **Inline island props above 1 KiB spill to the shared `__forma_islands`
  block.** `INLINE_PROPS_MAX_BYTES` existed and documented this behaviour but
  was never wired to anything, so an Inline island produced an unbounded
  attribute-escaped `data-forma-props`. Exactly one channel is used per island,
  so the client's inline-wins precedence never has two answers. A *fragment*
  render never spills — it cannot legally emit a second block.

### Added
- **`docs/FMIR-FORMAT.md`** — the published binary layout and stability
  contract: what is frozen across all versions (magic at 0, u16 LE version at
  4), what v2 guarantees, and what a version bump requires. `tests/fmir_contract.rs`
  asserts every frozen claim from the consumer's side, reading raw bytes.
- **`SlotData::replace`** — set a slot and get the previous value back. This is
  the primitive the LIST loop's scoped binding is built on.
- **`dump_ir` prints the slot and island tables** — id, name, type, source,
  default; and trigger, props mode, byte offset, `slot_ids`. It printed only
  counts, so diagnosing the props/slot-name drift it exists for required
  writing a throwaway program.
- **`test-helpers` feature.** The byte-exact FMIR encoders are no longer
  compiled into consumers' release builds, and their length casts now panic
  instead of silently truncating a >65,535-entry table into a corrupt file.
- **MSRV is real and tested.** `rust-version` is 1.71 (verified in CI at
  exactly 1.71); `wasm-bindgen` raises it to 1.77 with the `wasm` feature.
- **`#![forbid(unsafe_code)]`** — the README's "zero unsafe" is now a compile
  error rather than a claim. Every public item is documented
  (`#![warn(missing_docs)]` via the workspace lint table).

### Security
- **Island props JSON escaping is now total.** The `__forma_islands` block only
  escaped `</`. A props value containing `<!--` followed later by `<script`
  drives a spec-compliant HTML tokenizer into the *script-data-double-escaped*
  state, where the walker's own closing `</script>` is consumed as text — so
  everything after the block (the config script, the page module, the WASM
  bootstrap, `</body></html>`) is swallowed and the page renders completely
  inert, driven purely by user-controlled slot data. Now every `<` and `>` is
  emitted as `<`/`>` (plus U+2028/U+2029 as defence in depth). The
  trigger to record is `<!--<script`, not `</script>` — the old escaping handled
  the latter correctly, which is why the hole went unnoticed.
  **Wire note:** no coordinated JS change. The element id, `type`, `{islandId:
  props}` shape and the *parsed* values are unchanged; only the serialisation
  differs, and the client reads it with `JSON.parse`. Consumers must not
  string-match the raw script text.
- **Tag and attribute names are validated** against `[A-Za-z_:][-A-Za-z0-9_:.]*`
  before being written to the output stream. Only attribute *values* were ever
  escaped, so a string-table entry used as a tag name (`div onload="…"`) or as an
  attribute key (`x"><script`) was direct markup injection. Invalid tag name →
  error; invalid attribute name → dropped.
- **URL-bearing attributes are scheme-checked** and `on*` event-handler
  attributes dropped, on both the static and dynamic paths. Mirrors
  `@getforma/core`'s `url-safety` module byte for byte (including stripping the
  C0/C1 characters browsers ignore when resolving a scheme, so `java\tscript:`
  is caught) — the server now emits exactly what the client would have produced,
  which *converges* SSR and CSR rather than diverging them.
- **HTML comments cannot self-close.** A leading `>` or `->` closes a comment
  immediately per the tokenizer, spilling the rest into the document as markup.

### Fixed
- **Output-size budget (default 8 MiB, `WalkLimits`).** A small, structurally
  valid module could force a multi-gigabyte `String` allocation inside one
  request handler, and Rust answers allocation failure with `handle_alloc_error`
  → process abort, killing every in-flight request. Note the check had to be at
  the append, not once per opcode: one OPEN_TAG accepts 65,535 attributes whose
  values escape 5x, so a single iteration can emit ~21 GB.
- **LIST iteration budget (default 50,000, `WalkLimits`).** `MAX_LIST_DEPTH`
  bounds nesting but not volume — four LISTs over the same request-supplied
  array is n^4 body walks. Reported as a distinct `ListBudgetExceeded`, because
  logging "nested LIST depth exceeded maximum of 4" for this case sends an
  operator after the wrong thing.
- **`walk_island` returns a usable fragment.** It seeked past the ISLAND_START
  opcode, so the island root came back with none of `data-forma-island` /
  `-component` / `-status` / `-hydrate` — and the doc told clients to swap it in
  with `outerHTML`, which destroyed exactly the attributes the runtime selects
  on. Props are now always inlined on the root, even for a `ScriptTag` island: a
  second `__forma_islands` element would duplicate a DOM id and, sitting earlier
  in document order than the SSR one, would shadow it for every other island.
- **Offset arithmetic is checked and range-bounded** in SHOW_IF, SWITCH, LIST and
  TRY/FALLBACK. Plain `+` on `usize` cannot wrap on 64-bit but can on wasm32,
  which this crate ships a build for. The SHOW_ELSE marker byte is now verified
  rather than assumed.
- **Structural validation at parse time.** The opcode stream is decoded once and
  every control-flow region must tile exactly; island `byte_offset`s must point
  at their own ISLAND_START; slot and island ids must be unique and declared.
- **ECMAScript number semantics.** `to_text` now implements `Number::toString`,
  so an SSR text node matches what the client renders (`1e16` →
  `"10000000000000000"`, `1e21` → `"1e+21"`, `±Infinity` → `"Infinity"`). Both
  `to_text` and `to_json` previously used `n as i64`, which saturates and
  silently corrupted every value at or above 2^63. `-0.0` deliberately stays on
  the integer path so it prints `"0"` like `String(-0)`. Non-finite values remain
  `null` in props JSON — that is exact parity, since `JSON.stringify(Infinity)`
  is `null` too.
- **Parser allocation guards.** Declared table counts are checked against the
  true minimum on-disk entry size before reserving. A string costs 2 bytes on
  disk but 24 in the reservation, so the old `count > data.len()` guard allowed a
  12x blow-up — and `Vec::with_capacity` OOM aborts rather than returning an
  error. This rejects impossible counts; it does not cap expansion (a 100 MB
  section legitimately reserving ~1.1 GB still parses).
- **TRY/FALLBACK stack is range-local.** A FALLBACK inside a nested range popped
  the entry pushed by an outer TRY_START and skipped that many bytes of the wrong
  region.
- **Pending island / list-key state is cleared at its owning boundary** (ISLAND_END
  and the LIST item loop), so identity attributes cannot land on an element
  outside the island or after the list. Deliberately NOT cleared at range end:
  that would wipe the attributes of a legitimate ISLAND_START → SHOW_IF →
  OPEN_TAG stream and the island would never hydrate.
- `SlotData::set` grows instead of silently no-op'ing past the end, which used to
  make every row of a mis-compiled LIST render identically with no error.
- Reserved header `flags` must be 0 — a future extension bit now fails closed
  instead of being ignored and mis-parsed.
- O(1) slot and island lookups (dense id indices built at parse) replace a linear
  table scan per opcode. The island scan in particular was not feature-gated, so
  it cost in every build configuration.
- Capped pre-reservations in `walk_to_html` and `dump_ir` (`saturating_mul`
  matters on wasm32; the `.min` is what actually bounds the allocation).

### Changed (breaking)
- `SlotValue::Array`/`Object` payloads are `Arc`-backed. The walker clones the
  whole `SlotData` per LIST item so each row renders from its own scope; a deep
  copy of the payload per row is what made nested lists super-quartic. Use
  `SlotValue::array(vec![…])` / `SlotValue::object(vec![…])` to construct.
- `IrError` is `#[non_exhaustive]` and has new variants (`OutputLimitExceeded`,
  `ListBudgetExceeded`, `UnsupportedFlags`, `InvalidName`, `DuplicateSlotId`,
  `DuplicateIslandId`, `IslandOffsetMismatch`, `UnknownSlotId`,
  `MalformedControlFlow`). `IrModule` is `#[non_exhaustive]`.
- Modules with out-of-range LIST/SWITCH/TRY_START lengths returned `Ok` on 64-bit
  (rendering garbage HTML) and now return `Err` — a real server behavior change,
  not only a wasm one. SHOW_IF already errored on 64-bit, so that one is
  wasm-only. On wasm this surfaces as the already-documented JS exception from
  `render`/`render_island`, so the client takes its existing Phase 1 fallback.
- Invalid opcode bytes are now rejected by `IrModule::parse` rather than at walk
  time — errors move from per-request to load time.
- New `walk_to_html_with_limits` / `walk_island_with_limits` / `WalkLimits`.

### Known residual
An *under*-long control-flow length whose orphaned bytes still decode as a legal
sibling sequence (`else_len = 0`, `body_len = 0`) is structurally
indistinguishable from a legitimate module, so no length check can reject it.
The FMIR header already reserves `source_hash` at bytes 8..16 and the compiler
writes zero; populating and verifying it would close the class and needs a
coordinated compiler + runtime change (no layout change). Filed separately.

## [0.1.3] - 2026-03-17

### Security
- Added `MAX_RECURSION_DEPTH = 64` for SHOW_IF/SWITCH — prevents stack overflow from malicious IR
- Added `</script>` escaping test for script tag props

### Changed
- Walker refactored: `walk_range` and `walk_range_until_island_end` merged into single `walk_range_impl` with `WalkMode` enum — eliminates 322 lines of duplicated opcode handling

### Added
- README for crates.io with full documentation

## [0.1.1] - 2026-03-14

### Fixed
- Made `serde_json` a required dependency (was optional)
- Removed `cdylib` from default crate-type

## [0.1.0] - 2026-03-13

### Added
- Initial release: FMIR binary format parser, walker, slots, WASM exports
- HTML generation with XSS-safe escaping
- Hydration marker emission for FormaJS
- 124 tests
