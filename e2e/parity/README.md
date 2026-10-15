# The parity harness (FORMA-183, DR-9)

One tree, three implementations: the Rust walker writes HTML, `h()` in `@getforma/core` builds
DOM, strict adoption compares them. This lane keeps them equal by test: for every corpus module
and generated state, the server's HTML parsed by a real browser against core's render of the same
state (P1), adoption making zero mutation records (P2), a transition equal to a fresh server
render (P3). It lands non-blocking and is ratcheted up; this file says what is here now and the
rules it runs by.

## What is here (first slice)

| File | What |
|---|---|
| `src/generate.mts` | A props schema (FMIR section `0x0005`, the closed set) and a seed give a state, deterministically, edge-first: `generate(schema, seed, index)`. |
| `src/compare.mts` | The canonical tree, `stripTransport`, `compareTrees`, the structural class, the report and its one-line summary. |
| `src/dom-canon.mts` | The browser-side serializer, evaluated in the page. |
| `src/server.mts` | Drives `crates/forma-server/examples/parity_render.rs`: `describe` (the module's schema, islands and slots) and `render` (states through the real walker). |
| `src/browser.mts` | Chromium (Firefox, WebKit by flag): the served page under a strict script policy with Trusted Types enforced, core's twin built in the same Document, both trees serialized. No port is opened: every URL is fulfilled by `page.route`. |
| `src/render-both.mts` | `renderBoth` and its CLI: one module at one state through both sides, the P1 report. Forma-internal; FORMA-184 owns the public form. |
| `corpus.json` | Step 0: the 14 js-emitter modules. |
| `tests/` | `node --test`: the generator and the comparison on hand-written pairs; the serializer against Chromium's parser; the server half over committed modules; `renderBoth` end to end, including a walker output with one attribute altered, which must fail P1 naming the module, the state and the node. |

## Run

```bash
# what scripts/check.sh runs (needs `npm run build`, cargo and Playwright's Chromium)
npx tsc --noEmit -p e2e/parity
node --test "e2e/parity/tests/*.test.mts"

# one module at one state; exit 0 equal, 1 different, 2 refused or harness error
node e2e/parity/src/render-both.mts --module nested-islands --state 3
node e2e/parity/src/render-both.mts --module create-show --json
node e2e/parity/src/render-both.mts --module nested-islands --state 3 --emit-vector /tmp/v.json
```

The `.mts` files run directly on Node 24 (`.node-version`) by type stripping; `scripts/check.sh`
checks for it before anything else and stops, naming the Node it found, rather than skipping the
step. `CARGO_TARGET_DIR` is honoured for the Rust side.

## Generated states

A generated state is one value assignment for a declared props schema (FORMA-102's closed set:
`boolean`, `string`, `number`, `date`, `enum`, `array`, `optional`, `object`), and nothing else.

- **Deterministic.** splitmix32 seeded by FNV-1a over `<seed>:<module>:<index>`; no `Math.random`,
  no clock. The seed and index are in every report line and are what `renderBoth` takes to
  reproduce one state. A golden sequence and a golden state are pinned by the tests.
- **Edge-first, one rotation per field.** Each type has an ordered edge list, and each field a
  rotation into it: its rank among the same-typed fields of the schema, in schema order. State `i`
  takes edge `(i + rank) mod n`, so a field visits every edge of its type once in its first `n`
  states, two same-typed fields never hold the same edge in those states (a value routed into
  another prop's slot cannot pass), and the first fields meet the priority edges within ten states.
  The rank comes from the schema, not the state, so an absent optional or a shorter array never
  shifts another field. Past the list a coin picks an edge or a random draw. Strings (each once):
  empty, one character, 2,048 characters, `</script>`, a marker's spelling, the escapable five,
  NUL, CRLF, CR, a leading line feed, astral, combining, U+200B, `"null"`, `"true"`, `"0"`,
  whitespace, then every input of the shared rule-1 vectors
  (`crates/forma-ir/tests/fixtures/parity/normalization.json`: a vector added there joins the
  domain without a code change); never a lone surrogate. Numbers: `0`, `±1`, `±(2^53 - 1)`,
  `2^53`, `1e21`, `1e-7`, fractions, `MAX_VALUE`, the subnormal; never NaN or an infinity (the
  server refuses them, and a refusal is not a parity case) and not `-0` (every path the harness
  drives carries numbers as JSON, which writes `-0` as `0`). Dates: epoch `0`, `±1`, `±8.64e15`, a
  fixed 2026 instant. Booleans alternate; enums take every variant in order; an optional is present
  and absent on alternate states, so its inner value visits half as many edges as a plain field;
  arrays take lengths 0, 1, 2, 3 and 32 first.
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
`key` are values), its path from the compared root
(`page > main:nth-child(1) > div:nth-child(1) > span:nth-child(2)[title]`, where `nth-child` counts
element siblings as CSS does, so the path selects the node in DevTools) and both values. The report
carries the module, the seed, the state index, the verdict (`equal`, `different`,
`expected-divergent`, `server-refused`, `error`), the first difference, the counts, the holder
count, both canonical trees and the server's HTML. A page error or console error during the
render, or a twin core cannot build, is an `error`, never a pass and never a throw. (Its test
renders the archived pre-F1 `list-same-source` page, whose list source core cannot call, through
`renderBoth`'s `page` seam; the corpus page itself passes a function since BUILD-614.)

## The corpus and its ratchet

| Step | Modules | States each | When |
|---|---|---|---|
| 0 | the 14 js-emitter modules | 10 for `nested-islands`, the one module with declared page props; 1 for the other 13 (their source state) | this ticket, non-blocking |
| 1 | + the props-contract page (nine fields, every type) and the 11 island-emitter fixtures | 10 | before the switch to blocking |
| 2 | the same | 100 | after the switch, measured |
| 3 | + FORMA-188's fixture applications and consumer-shaped pages, as they land (nothing is copied out of an application repository: L-54, DR-34) | 100 | FORMA-188 |

The corpus sources are read where they are (`packages/compiler/tests/fixtures/ir-corpus/`);
nothing is copied. A slot table is not a props schema: the thirteen modules without declared
props are rendered at their source state on both sides, not "generated". Each step's module
count, states per module, measured wall time, P1/P2/P3 counts and expected-divergent entries are
recorded in the ticket, and the step in force at a release in its GitHub Release.

## The stop rule

A **structural class** is the set of structural differences sharing (module, path without its
`:nth-child` positions, kind): a hundred states dropping the same element are one class. Once
FORMA-182's rules 2 to 7, FORMA-181's checkpoints B and C and the first walker and core fixes from
this harness have landed, more than **five** structural classes on step 1's corpus sends DR-9's
deferred template cloning to the founder as a decision rather than being absorbed; at five or
fewer, each class is a ticket against the walker or core.

## Not here yet

The typed server path (`Pages::bind` with a harness `PageProps` built from the module's own
schema) and the manifest it needs, P2 and P3, the suite over the corpus (`run.mts`),
`expected-divergent.json`, the non-blocking CI job and the measured time.
