# Changelog

## [0.1.5] - unreleased

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
