# The parity harness (FORMA-183, DR-9)

One tree, three implementations: the Rust walker writes HTML, `h()` in `@getforma/core` builds
DOM, strict adoption compares them. This lane keeps them equal by test: for every corpus module
and generated state, the server's HTML parsed by a real browser against core's render of the same
state (P1), adoption making zero mutation records (P2), a transition equal to a fresh server
render (P3). It runs non-blocking in CI and is ratcheted up; this file says what is here
now and the rules it runs by.

## What is here

| File | What |
|---|---|
| `src/generate.mts` | A props schema (FMIR section `0x0005`, the closed set) and a seed give a state, deterministically, edge-first: `generate(schema, seed, index)`. Also the typed path's refusal table. |
| `src/compare.mts` | The canonical tree, `stripTransport`, `compareTrees`, the structural class, the report and its one-line summary. |
| `src/dom-canon.mts` | The browser-side serializer, evaluated in the page. |
| `src/server.mts` | Drives `crates/forma-server/examples/parity_render.rs` (built once by cargo, then run directly): `describe`, the low-level `render`, and `typed`, the application's path for a batch of modules. |
| `src/manifest.mts` | A schema-2 manifest around one module, with the boot as the route's script and SHA-384 integrity for both. |
| `src/bundle.mts` | The twin (the page function) and the production entry (`app.ts` through the compiler's `formaSsrPlugin`, as `@getforma/build` builds a page); the entry's `.ir` must be the committed module. |
| `src/boot.mts` | The one script the served document loads: serializes the served root, runs P2, moves the page with the module's setter and serializes it again (P3), renders and serializes the twin. |
| `src/island-emitter.mts` | Rebuilds the island-emitter family's sources from the compiler's own test (its syntax tree, never executed). |
| `src/browser.mts` | One page in Chromium, Firefox or WebKit, a fresh Document per state, every URL fulfilled by `page.route` (no port). |
| `src/suite.mts` | The pipeline: prepare, serve, browse, report. |
| `src/expected.mts`, `expected-divergent.json` | Known divergences as data, and the unexpected-pass rule. |
| `src/run.mts` | The suite over the corpus: totals, structural classes, wall time by phase, the verdict. |
| `src/render-both.mts` | `renderBoth` and its CLI: one module at one state by the same pipeline. Forma-internal; FORMA-184 owns the public form. |
| `corpus.json` | Step 0: the 14 js-emitter modules; step 1: the props-contract page, the P3 fixture and the island-emitter family. |
| `fixtures/transition/` | The P3 fixture: one island seeded from declared props, whose module exports the setter. |
| `tests/` | `node --test`: the generator, the comparison and the expected list on hand-written cases; the serializer against Chromium's parser; the server half, including the typed path and its refusal table; `renderBoth` and the suite end to end, including seeded server changes that P1 and P2 must report; step 1, the family's exact rebuild, P3 equal state after state and P3 failing on a wrong setter (`tests/fixtures/transition-off-by-one/`). |

## Run

```bash
# the harness's own tests, as scripts/check.sh runs them (needs `npm run build`, cargo and
# Playwright's Chromium)
npx tsc --noEmit -p e2e/parity
node --test "e2e/parity/tests/*.test.mts"

# the suite over the corpus, as CI's non-blocking `parity` job runs it; exit 0 when every
# difference is expected and every expected difference occurred
node e2e/parity/src/run.mts [--step 1] [--states 10] [--seed forma-183] [--module nested-islands ...]
                            [--browser chromium|firefox|webkit] [--low-level] [--report out.jsonl]

# one module at one state: P1, and P2 for a page with islands; exit 0 equal, 1 different,
# 2 refused or harness error
node e2e/parity/src/render-both.mts --module nested-islands --state 3 [--json] [--emit-vector v.json]
```

The `.mts` files run directly on Node 24 (`.node-version`) by type stripping; `scripts/check.sh`
checks for it before anything else and stops, naming the Node it found, rather than skipping the
step. `CARGO_TARGET_DIR` is honoured.

## One state, end to end

1. **Prepare.** `parity_render describe` gives the module's declared schema; `generate` gives the
   state. The twin bundle is the page function; the production entry is the module's `app.ts`
   through `formaSsrPlugin`, whose evaluation is `activateIslands` with the compiled registrations
   (`__islandRegistration(component, {h, schema, mode})`). Its `.ir` must equal the committed
   module, or the module is an error: the browser entry and the served module would not be a pair.
2. **Serve.** `parity_render typed` loads a synthesized manifest through `load_ir_modules`, binds
   `DynProps` (a harness `PageProps` whose Rust schema is the module's own, and whose value is the
   state projected by the declared types, handed to the crate's own `PropValue` implementations
   wherever they are public: `Option`, `bool`, `String`, `f64` (`RENDER-402` a non-finite number),
   `Vec` (the crate's row paths and depth limit), enums through `EncodeContext::enumeration`
   (`RENDER-404` an undeclared literal); the harness keeps a wrong JSON kind or a missing value
   (`RENDER-404`), dates (`RENDER-403`, mirrored: `SystemTime` cannot reach the ±8.64e15 bounds on
   every platform) and the derive's object projection. `RENDER-401`, an integer origin beyond
   ±(2^53 − 1), cannot occur: every JSON number is an f64. It finalizes and renders each state. The
   result is the server's own document and headers: its nonce, `strict-dynamic` and Trusted Types
   policy, the root's `data-forma-build` (FORMA-186), and the boot as the route's integrity-checked
   module. A module the typed path refuses (a load or bind code) fails the run with a
   `server-refused` report naming the codes, unless corpus.json declares `serverPath: "low-level"`
   for it; it is then rendered by the walker alone (`SlotData::from_json` +
   `walk_to_html_counted`) in a minimal document with as strict a script policy. The summary
   prints `server paths: typed N modules, walker-only M (module: codes)`.
3. **Browse.** The boot serializes the served root (`[data-forma-ssr]`) before any script touches
   it. For a page with islands it arms a MutationObserver over that root, imports the production
   entry and drains records through a microtask and a macrotask. Hosts whose `data-forma-hydrate`
   defers them are activated by driving the trigger, never skipped: `interaction` a pointerdown on
   the host, `visible` the host scrolled into view and two frames, `idle` an idle callback (work a
   page schedules beyond that is outside the drain). Then the positive control runs on that same
   observer while it is still connected: an attribute, a childList and a characterData write to
   the served root, each of which the observer's own records must contain; those three are set
   aside by identity and every other record counts. Then it renders core's twin in a fresh host.
   Console errors, uncaught errors and policy violations are recorded with the step they happened
   in. A state whose boot does not finish (a blocked script, an early throw) is that state's
   `error`, and the run goes on.
4. **Report.** P1 compares the two trees (below). P2 is equal when activation made no mutation
   record, dispatched no `forma:error` and logged no error, the control was seen, and every island
   host holds core's disposer afterwards: a host that never activated is an `error` naming it and
   its trigger (zero records over it would prove nothing; a state with no host has nothing to
   activate). A P2 difference names the record (`mutation` at its DOM path, old and new value) or
   the activation error (`FORMA_E_HYDRATE_VALUE` at `/node[0]/node[3]`).

## Generated states

A generated state is one value assignment for a declared props schema (FORMA-102's closed set:
`boolean`, `string`, `number`, `date`, `enum`, `array`, `optional`, `object`), and nothing else.

- **Deterministic.** splitmix32 seeded by FNV-1a over `<seed>:<module>:<index>`; no `Math.random`,
  no clock. The seed and index are in every report line and are what `renderBoth` takes to
  reproduce one state. A golden sequence and a golden state are pinned by the tests.
- **Edge-first, one rotation per field.** Each type has an ordered edge list, and each field a
  rank among the same-typed fields of the schema, in schema order. A field takes its edge rotated
  by its rank inside the list's priority block (its first ten edges) for the first ten states, and
  over the rest of the list after, so every field meets every priority edge within ten states (step
  1 runs ten), two same-typed fields never hold the same edge in the list's first `n` states (a
  value routed into another prop's slot cannot pass), and each field visits every edge once. The
  rank comes from the schema, not the state, so an absent optional or a shorter array never
  shifts another field. Past the list a coin picks an edge or a random draw. Strings (each once,
  the priority block first): empty, one character, 2,048 characters, `</script>`, a marker's
  spelling, the escapable five, NUL, CRLF, CR, a leading line feed; then astral, combining,
  U+200B, `"null"`, `"true"`, `"0"`, whitespace, and every input of the shared rule-1 vectors
  (`crates/forma-ir/tests/fixtures/parity/normalization.json`: a vector added there joins the
  domain without a code change); never a lone surrogate. Numbers: `0`, `±1`, `±(2^53 - 1)`,
  `2^53`, `1e21`, `1e-7`, fractions, `MAX_VALUE`, the subnormal; never NaN or an infinity (the
  server refuses them, and a refusal is not a parity case; they are in the typed path's refusal
  table) and not `-0` (every path the harness drives carries numbers as JSON, which writes `-0` as
  `0`). Dates: epoch `0`, `±1`, `±8.64e15`, a fixed 2026 instant. Booleans alternate; enums take
  every variant in order; arrays take lengths 0, 1, 2, 3 and 32 first.
- **Optionals.** An optional's presence follows bit `rank` of the state index: the first optional
  alternates every state, the second every two, so `k` optionals reach all `2^k` present/absent
  combinations within `2^k` states (all present at state 0). Its inner value advances once per
  presence, so the first optional's inner value visits five edges in ten states.
- **List keys.** A keyed list (FMIR section `0x0006`, FORMA-181) refuses a row key that is not a
  string or a safe integer, or that repeats (RENDER-503). Every generated array of objects holding
  one of the module's key paths gets unique identities there: integers stepping by one from a base
  (`0`, `±1`, `±(2^53 - 1)`, `42`, away from the bound), or an edge string suffixed with the row's
  position. Unique values are valid wherever the array is keyed or not, so the rule needs no map
  from a LIST to the declared field it iterates.
- **Wire JSON.** An absent optional field is an omitted key, an absent optional element is `null`,
  a date is epoch milliseconds; the browser side revives dates by the schema.

## What parity compares

Transport is removed and nothing else, and only on the side where it is transport:

- **Both sides:** the walker's `<!--f:tN-->`, `f:sN`, `f:lN`, `f:iN` marker pairs and core's
  `forma-show` and `forma-list-*` anchors (any other comment is content and stays).
- **Server side only:** the `data-forma-island`, `-component`, `-status`, `-hydrate`, `-state`,
  `-h` attributes, and `data-forma-key`, lifted into a side table checked against the expected key
  text. The client twin never writes them, so on the client they are ordinary attributes: a twin
  that writes one is an `attribute-extra`.
- **Server side only, the U+200B holder.** An empty dynamic text is held open by one U+200B
  between its `f:t` markers, and the walker writes the same bytes for a dynamic text whose value
  is U+200B: the wire cannot tell them apart. So a holder matches client text `""` or `"\u200B"`,
  and every holder compared is counted in the report as `holderAmbiguous` (and in its summary
  line), never silently. A U+200B anywhere else is text. Whether the walker should write a U+200B
  value distinguishably is an open question for rule 5 (FORMA-182; `docs/parity-rules.md`).

Adjacent text nodes are joined and empty ones dropped. Text and attribute values are compared code
unit for code unit as the browser holds them after its own parse: the harness trims nothing,
rewrites no line ending or NUL and folds no case (rule 1 is the writers' job on both sides; the
tests pin each of these as a difference). Attributes are a list of (qualified name, namespace,
value), so no name meets an object's prototype (`__proto__` is an attribute like any other) and an
XLink `xlink:href` is not a plain attribute spelled alike: the same name in another namespace is an
`attribute-namespace` difference. A `<template>`'s inert content is compared under a `#content`
pseudo-child, so a template filled live differs from a parsed one.

A difference names its kind (`tag`, `namespace`, `attribute-missing`, `attribute-extra`,
`missing`, `extra` are structural; `attribute-value`, `attribute-namespace`, `text`, `comment`,
`key` are values; P2 adds `mutation` and `activation-error`), its path from the compared root
(`page > main:nth-child(1) > div:nth-child(1) > span:nth-child(2)[title]`, where `nth-child` counts
element siblings as CSS does, so the path selects the node in DevTools) and both values. The report
carries the module, the seed, the state index, the verdict (`equal`, `different`,
`expected-divergent`, `server-refused`, `error`), the server path, the first difference, the
counts, the holder count, both canonical trees, the server's document and, when P1 is not equal,
the compiler's diagnostics for the page (BUILD-206 often explains an attribute the server omits).
The suite's summary totals the holder count over the run. A page error, console error or policy
violation during the render, or a twin core cannot build, is an `error`, never a pass and never a
throw. Its error test renders the archived pre-F1 `list-same-source` page through the
`renderBoth` page seam; the current corpus uses a function source under BUILD-616.

## Expected divergence

`expected-divergent.json` lists the divergences known today, each with the ticket that clears it
(FORMA-181 checkpoint B and FORMA-182 rules 2 to 7 add theirs as they land) or, for a divergence
the harness found that has no ticket yet, `finding F<n>`. An entry matches by module, state (or
`*`), check, kind, path and a pattern over both values (`server → client`), or for an `error` a
pattern over its message. Every entry must be pinned, and the list is refused on load otherwise:
a state index, or `*` only with a path (an error is pinned by its message); a message pattern for
an error and a value pattern for every other kind, so a changed value is never swallowed. A
report is `expected-divergent` only when every difference in it is matched. The harness never
skips (TESTING.md P7): an entry that matches nothing in a run that covered its module fails the
run as an unexpected pass, so the entry is removed the day its fix lands.

The entries today (F1 to F4 found at step 0, F2's step-1 cases, F5 and F6 found at step 1; each assigned by the lead):

| | Case | Kind | Clears it |
|---|---|---|---|
| F2 | `jsx-page` `span[data-live]`, `sub-component-scopes` `article[data-ready]`, and at step 1 `nullish` and `closed-nullish` `p[data-ready]`: a reactive `true`, bare from the walker, `"true"` from core | P1 attribute value | FORMA-182: the walker writes HTML-boolean presence only for the HTML boolean attribute set |
| F3 | `dynamic-attrs` `input[value]`: a client signal created with `''` decodes as Null on the server, so the walker omits `value=""` | P1 structural | FORMA-182: an empty string is not null |
| F4 | `dynamic-attrs` `a[href]`: `href: () => docsHref()` cannot be evaluated at build | P1 structural | FORMA-101 (DR-1, release B) |

F4 can never become equal: the server has no value to write. In warning mode the compiler reports
BUILD-206 and omits the attribute from the server HTML, which then appears only on activation
(`docs/DIAGNOSTICS.md`; DR-1's release-A bridge). DR-1 makes strict the only mode in release B
(3.0.0, FORMA-101), where BUILD-206 is a build error. The difference then ends because the page no
longer compiles, not because the trees agree; the corpus fixture has to move the attribute behind
`browserOnly()` or drop it, and the entry fails the run as an unexpected pass.

Checkpoint C resolves F6: the merged integration run on 2026-10-15 observed both canonical-key adoption entries as unexpected passes, with all 99 P2 checks equal. The two resolved entries were removed; the original failure report is preserved in the release work evidence.

## The corpus and its ratchet

| Step | Modules | States each | When |
|---|---|---|---|
| 0 | the 14 js-emitter modules | 10 for `nested-islands`, the one module with declared page props; 1 for the other 13 (their source state) | now, non-blocking |
| 1 | + the props-contract page (nine fields, every type), the 12 island-emitter fixtures (all but `browser`, a browserOnly island whose server host is empty by design) and the P3 fixture: 28 modules | 10 (Firefox and WebKit, per release); 100 (Chromium, per merge, measured) | now, non-blocking |
| 2 | the same | 100 | after the switch |
| 3 | + FORMA-188's fixture applications and consumer-shaped pages, as they land (nothing is copied out of an application repository: L-54, DR-34) | 100 | FORMA-188 |

The corpus sources are read where they are (`packages/compiler/tests/fixtures/ir-corpus/`);
nothing is copied. A slot table is not a props schema: the thirteen modules without declared
props are rendered at their source state on both sides, not "generated". Each step's module
count, states per module, measured wall time, P1/P2/P3 counts and expected-divergent entries are
recorded in the ticket, and the step in force at a release in its GitHub Release.

**Step 0, 2026-10-15:** 14 modules, 23 states; P1 19 equal and 4 expected-divergent (F1 to F4,
below), P2 14 equal over the 5 island pages (every host activated, zero records); 2 structural
classes (both in `dynamic-attrs`); 0 holder-ambiguous positions. On CI's `parity` job the run takes
4.3 s with a warm Rust cache and 14.5 s cold (building the example dominates); the whole job,
installs and builds included, took 1m22s.

**Step 1, 2026-10-15:** 28 modules. At 10 states (118 states): P1 104 equal and 14
expected-divergent, P2 98 equal and 1 expected-divergent, P3 10 equal (the fixture's transitions)
and 27 `no-setter`; the same in Firefox and WebKit. At 100 states (1,018 states): P1 908 equal and
110 expected-divergent, P2 877 and 32, P3 100 equal and 27 `no-setter`; 2 structural classes; 314
holder-ambiguous positions; every module on the typed path. Locally 72 s for the 1,018 states in
Chromium (about 70 ms a state); on CI's `e2e-engines` jobs step 1 at 10 states runs in 34 s in
Firefox and in WebKit. CI's figure for the per-merge job at 100 states is in the ticket. The new entries: F2's case in
`nullish` and `closed-nullish`; F5, `props-contract`'s `createShow` branch that returns a string
(core throws, the walker renders the text; FORMA-016); F6, `aggregate-fallback`'s keys that hold CR
or NUL (adoption compares the raw key, not the rule-1 key text; FORMA-181 checkpoint C).

## The stop rule

A **structural class** is the set of structural differences sharing (module, path without its
`:nth-child` positions, kind): a hundred states dropping the same element are one class. Every
run prints the classes over all P1 differences, expected or not. Once FORMA-182's rules 2 to 7,
FORMA-181's checkpoints B and C and the first walker and core fixes from this harness have landed,
more than **five** structural classes on step 1's corpus sends DR-9's deferred template cloning to
the founder as a decision rather than being absorbed; at five or fewer, each class is a ticket
against the walker or core.

## Not here yet

The key check against the expected key text (`data-forma-key` is lifted from the server tree; the
expected text per row is FORMA-181's `canonicalKeyText` once rows are mapped to their list), the
switch to blocking (when step 1's expected list is empty for P1 and P2), and step 3's fixture
applications (FORMA-188).

FORMA-016 verification on the expanded corpus removes F5 only after an actual unexpected pass: all 28 typed modules and 118 states complete, with props-contract text branches agreeing. Historical step-1 findings above remain the discovery record.
