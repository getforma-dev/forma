# Changelog

## [Unreleased]

Release A2's bridge (0.2.2): additive (FORMA-120; DR-11, DR-12).

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
