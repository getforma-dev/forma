# Forma Stack — architecture and design rationale

**Status:** living document. First written 2026-08-05, against `forma`
`fix/hardening-pass`, `formajs` and `forma-tools` `fix/ksx-dogfood-findings`.
The repository inventory and FMIR v2 discussion below describe that historical
baseline. The merged workspace now uses the maintained
[FMIR v3 contract](FMIR-FORMAT.md); use it for current binary layout and loader rules.

**Audience:** an engineer joining tomorrow who will change one of these four
repos. Read §1 and §2 once, then keep §3 open while you work — §3 is the part
that costs money to get wrong.

**Why it exists:** months of design work on signals, the FMIR binary format,
the Rust IR walker, islands and hydration lived only in code comments,
CHANGELOG entries and people's heads. Unwritten reasoning gets re-litigated, or
quietly violated by a change that never learned why the line was drawn there.

---

## How to read this document

Everything here is either **evidenced** or **inferred**, and the two are never
mixed silently.

- Evidenced claims cite a file, a test, a CHANGELOG entry or a research
  artifact. Paths are repo-relative to the repo named in the citation.
- Reconstructed reasoning is tagged **[INFERENCE]**. That means: the *behaviour*
  is real and cited, but the *motive* I attribute to it is my reconstruction
  from the code, not something the authors wrote down. Treat every one as a
  question to the owner. Correcting an inference is cheap; letting a guess
  harden into folklore is not.

### The four repos and one consumer

| Repo | Path | Ships | Language |
|---|---|---|---|
| `formajs` | `C:\Projects\formajs` | `@getforma/core` — signals, `h()`, islands, hydration, the zero-build HTML runtime | TypeScript |
| `forma-tools` | `C:\Projects\forma-tools` | `@getforma/compiler`, `@getforma/build` — TS/JSX → FMIR, the build pipeline | TypeScript |
| `forma` | `C:\Projects\forma` | `forma-ir`, `forma-server` — FMIR parser, SSR walker, Axum middleware | Rust |
| `create-forma-app` | `C:\Projects\create-forma-app` | `@getforma/create-app` — scaffolder + templates | TypeScript |
| *(consumer)* ksx Studio | `C:\Projects\KeyboardSplitterXboxPro` | the first consumer planned for release; none is in production yet (2026-10-14) | Rust + TS |

ksx Studio matters architecturally, not just commercially: it is the only thing
that has ever exercised this stack under real load, and its findings ledger
(`docs/FORMA-DOGFOOD.md`) is the single best record of which contracts are real
and which were aspirational. Several decisions in §4 exist *because* ksx hit
them.

---

## 1. The thesis

**Compile to binary IR. Render in Rust. Hydrate only islands. Fine-grained
signals underneath.**

A conventional JS framework ships the same component code twice — once to a
Node server to produce HTML, once to the browser to produce it again — and then
spends the first seconds of the page's life proving the two agree. Forma
refuses each of those three costs in turn.

**1. The component tree is compiled, not shipped.** `@getforma/compiler` walks
the `h()` call tree of a page at build time and emits FMIR, written as
`<page>.ir`: a self-contained binary module with an opcode stream, an interned
string table, a slot table and an island table. Everything static about the
page — tags, attributes, literal text, structure — is *already decided* and
encoded. Everything dynamic is a numbered **slot**.

**2. The server needs no JavaScript.** `forma-ir` is a Rust crate that walks
that opcode stream, fills the slots from `SlotData` the request handler
populated, and appends HTML to a `String`. There is no DOM, no VDOM, no JS
engine, no Node process. `forma-server` wraps it for Axum: content-hashed
assets, a strict CSP with a per-request nonce, and a page template. A Rust
service can render a Forma page with the same tools it uses to render JSON.

**3. Only islands hydrate.** The walker stamps hydration markers into the HTML
as it goes — `<!--f:t0-->` around a dynamic text node, `<!--f:s0-->` around a
conditional region, `<!--f:l0-->` around a list, `<!--f:i0-->` around an island
— and puts `data-forma-*` attributes on each island's root element. On the
client, `activateIslands()` finds those roots and hydrates *only* them, on the
trigger each one declares (`load`, `visible`, `idle`, `interaction`). Static
page furniture is never hydrated at all, because there is nothing to hydrate:
it is finished HTML.

**4. Underneath it all: fine-grained signals.** `@getforma/core`'s reactivity
(backed by `alien-signals`) has no re-render step. A component function runs
**once**; reading `count()` inside a reactive closure subscribes exactly that
closure. When `count` changes, exactly that text node is written. This is not a
performance footnote — it is what makes the rest of the thesis structurally
possible:

> Because a binding is *one signal to one DOM node*, a binding can be named by
> a **marker in the HTML**. That is the whole hydration protocol. A VDOM
> framework cannot do this: its unit of update is a subtree diff, so the only
> thing it can hand the server is "here is the tree, render it and I will
> re-render it and compare". Fine-grained reactivity is what lets the server
> and the client agree on a *node*, not on a *tree*.

**The payoff, and the price.** The payoff is a page that arrives complete, ships
kilobytes of JS instead of hundreds, and costs a Rust `String` push per node to
render (a 400-row table renders in 0.15 ms — `forma-ir` CHANGELOG 0.2.0). The
price is that a *compile-time* artifact — the FMIR binary and the marker grammar
in the HTML — is now a wire protocol between three codebases in two languages
that ship separately. §3 is the list of promises that protocol makes. Almost
every hard bug in this stack's history has been two halves of it disagreeing.

---

## 2. The pipeline, end to end

### 2.1 The shape

```text
   ┌──────────────────────── BUILD TIME (Node) ───────────────────────┐
   │                                                                  │
   │  src/app.tsx ─┐                                                  │
   │  Page.tsx     ├─► esbuild ────────────────────► app.<hash>.js    │
   │  Island.tsx  ─┘      │                          (browser bundle) │
   │                      │                                           │
   │                      └─► @getforma/compiler                      │
   │                            ComponentAnalyzer  (find mount(), the │
   │                            │                   entry component,  │
   │                            │                   module constants) │
   │                            ▼                                     │
   │                            ir-walk.ts  (12 pattern rules, AST →  │
   │                            │            opcodes + slots + isles; │
   │                            │            pushes a signal-scope    │
   │                            │            frame per inlined scope) │
   │                            ▼                                     │
   │                            ir-emit.ts (IrEmitContext.toBinary)   │
   │                            │                                     │
   │                            ▼                                     │
   │                          app.<hash>.ir   ◄── FMIR v2 binary      │
   │                                                                  │
   │  @getforma/build: content-hash, brotli/gzip, fonts, CSS,         │
   │  islands registry, sw.js, manifest.json                          │
   └──────────────────────────────┬───────────────────────────────────┘
                                  │  dist/ is embedded into the Rust binary
                                  ▼
   ┌──────────────────────── REQUEST TIME (Rust) ─────────────────────┐
   │  startup: load_ir_modules_strict::<Assets>(&manifest)            │
   │           → IrModule::parse (validates EVERYTHING, once)         │
   │           → RenderMode per route                                 │
   │                                                                  │
   │  request: handler builds SlotData (from_json or set-by-name)     │
   │           render_page(PageConfig{ ir_module, slots, … })         │
   │             └─ forma_ir::walk_to_html(module, slots)             │
   │                  opcode stream + slots  ──►  HTML String         │
   │                  + <!--f:tN--> markers                           │
   │                  + data-forma-* on island roots                  │
   │                  + <script id="__forma_islands"> when spilled    │
   │           → PageOutput { html, csp, nonce }                      │
   └──────────────────────────────┬───────────────────────────────────┘
                                  │  HTML + CSP header
                                  ▼
   ┌──────────────────────── BROWSER (@getforma/core) ────────────────┐
   │  app.<hash>.js runs → activateIslands(registry)                  │
   │    for each [data-forma-island]:                                 │
   │      1. loadIslandProps  (data-forma-props, else __forma_islands) │
   │      2. run the island fn WITH those props                       │
   │         → it seeds signals: createSignal(props?.x ?? fallback)    │
   │      3. hydrateIsland → adoptNode walks the SSR DOM against the   │
   │         descriptors h() returned, binding effects to real nodes   │
   │    status: pending → hydrating → active                          │
   └──────────────────────────────────────────────────────────────────┘
```

### 2.2 Stage by stage, with the real artifacts

**TS/JSX source.** A page is an entry file that calls `mount(() => Page(), "#app")`
(several shapes are supported — see `component-analyzer.ts`), plus component
files it imports. JSX is transformed to `h()` calls by esbuild *before* the
compiler parses it, because the IR walker only understands `h()` call trees
(`esbuild-ssr-plugin.ts`, `generateRealIr` step 1b).

**`@getforma/compiler`.** Three files carry the weight:

- `component-analyzer.ts` — finds the entry point, resolves sub-component
  imports, extracts module-level constants and `createSignal` defaults (the
  latter both from the root Page and, since the ksx dogfood pass, from island
  component files).
- `ir-walk.ts` — the actual compiler. 12 numbered pattern rules turn AST into
  opcodes: static `h()` → `OPEN_TAG`/`CLOSE_TAG`, string children → `TEXT`,
  function-valued props → `DYN_ATTR` + a slot, non-ternary arrow children →
  `DYN_TEXT` + a slot + a marker id, `createShow`/ternaries → `SHOW_IF`,
  `createList` → `LIST` + `PROP`, and **rule 11: anything I do not understand
  becomes an island**. That last rule is the compiler's escape hatch and its
  safety property at once — an unrecognised expression degrades to a
  client-rendered region rather than to wrong HTML.
- `ir-emit.ts` — `IrEmitContext`, a buffer. It interns strings, allocates slot
  ids and island ids, and serializes the four sections. It is deliberately not
  a compiler; all AST knowledge lives in `ir-walk.ts`.

**FMIR** (`app.<hash>.ir`). See §3.1 for the exact layout. Roughly: 16-byte
header, 32-byte section table, then `[bytecode][strings][slots][islands]`.

**`@getforma/build`.** Runs esbuild, calls the SSR plugin per entry, writes the
island registry, hashes and compresses assets, generates `sw.js` (served only
for an application that turns its worker on, from forma-server 0.2.2;
elsewhere `/sw.js` is forma-server's retiring worker, DR-25), and emits
`manifest.json` — the route → assets map that `forma-server` deserializes with
serde, byte-for-byte (`forma-spike-1-fmir-compat.md`).

**`forma-ir`.** `IrModule::parse` does *all* validation in one pass at load: every
bound, every cross-table reference, every control-flow region, duplicate ids,
tag/attr name legality, island offsets. The walker then assumes a valid module
and stays cheap. `walk_to_html` produces a whole page; `walk_island` seeks to
one island's `byte_offset` internally. It has no supported public caller since
3.0.0 removed the WASM walker (DR-10). Browser islands re-render with core's `h()`.

**`forma-server`.** `render_page` builds the document around the walker's output
and returns `PageOutput { html, csp, nonce }` — the three are one unit, because
the HTML embeds the nonce the CSP blesses. From 0.2.2 a page is sent as a
`PageResponse` (`PageOutput::into_page_response`), which writes `no-store`, the
policy and the document headers whenever it is sent; a handler extends the
policy with typed `PolicyExtensions` and reaches the HTML apart from its
headers only through `into_parts_unchecked()` (DR-17). Two modes: **Phase 2** (SSR) when a
route has a parsed IR module and slots, **Phase 1** (empty `<div id="app">`,
client mounts from scratch) otherwise or on any walk failure. From 0.2.2 that
fallback is deprecated with `render_page`: `try_render` returns
`Result<PageResponse, RenderError>`, the page with its counts or a coded
error naming route and component, and catches a panic in the walk as
`RenderError::Fault`; `render_browser_shell` serves a route declared
`ssr: false` (DR-11, DR-12; D10 below).

**`@getforma/core` adoption.** `activateIslands` → `hydrateIslandRoot` →
`hydrateIsland` → `adoptNode`. During hydration `h()` returns *descriptors*, not
elements; `adoptNode` walks the descriptor tree against the SSR DOM, attaching
event listeners and reactive effects to nodes that already exist. No elements
are created for matched content.

### 2.3 What crosses each boundary

| Boundary | Crosses | Format | Broken by |
|---|---|---|---|
| compiler → build | FMIR bytes + island list | `Uint8Array`, JS objects | in-process, safe to change |
| build → Rust server | `.ir`, `.js`, `.css`, `manifest.json` | files, embedded via `rust-embed` | FMIR layout (§3.1), manifest schema |
| compiler → Rust server | **slot names** | UTF-8 strings in the string table | slot naming scheme (§3.2) |
| Rust walker → browser | HTML | marker comments + `data-forma-*` (§3.3, §3.4) | either side changing the grammar |
| Rust walker → browser | island props | `data-forma-props` or `__forma_islands` (§3.5) | escaping, precedence, key shape |
| server handler → walker | slot values | `SlotData`, by id or by name | slot naming; first-wins rule |

### 2.4 Where each repo actually sits

`forma-tools` is upstream of everything. `forma` reads what it produces and
never talks back. `formajs` reads what `forma` emits and never talks back. The
graph is a straight line — which is why a change in the middle can break both
ends without any compiler noticing. That asymmetry is the reason §3 exists and
the reason `crates/forma-ir/src/js_emitter_contract.rs` exists: it is the one
test in the stack where the real TS emitter's bytes are fed to the real Rust
consumer.

---

## 3. The load-bearing contracts

For each: what it is, **who depends on it**, and **what breaks if it moves**.
The rule of thumb: anything in this section is shared with code that ships
separately, so "just change both sides" is not available — there is no
deployment in which both sides change at once except a coordinated release.

### 3.1 The FMIR binary layout, and the version rule

**The contract** is published in full at [`docs/FMIR-FORMAT.md`](FMIR-FORMAT.md).
Summary:

*Frozen for all time, any version:* magic `"FMIR"` at offset 0; version as u16
**little-endian** at offset 4; every multi-byte integer little-endian; the file
is self-contained (no external refs, no compression, no relocations).

*v2-scoped:* 16-byte header (magic, version, `flags` u16 **which must be 0**,
`source_hash` u64), then a 32-byte section table of four `(offset u32, size u32)`
descriptors in fixed order — bytecode, strings, slots, islands — then the
section data starting at offset 48.

*The version rule:* `IrHeader::parse` rejects any version but `IR_VERSION`.
There is no compatibility window in either direction. A bump to 3 means every
`.ir` module is recompiled and the compiler, `forma-ir`, `forma-server`
and every embedded module in every consumer ship **together**. A bump is
reserved for changes that cannot be additive. Adding an opcode byte, an enum
value, or a fifth section *appended after* the existing four are all additive and
stay in v2.

*`flags` fails closed.* Any non-zero bit is `IrError::UnsupportedFlags`. So
introducing a flag requires shipping the reader **before** the compiler may emit
it (`format.rs:288-323`).

**Who depends on it:** `forma-ir`'s parser; the compiler's emitter
(`ir-emit.ts:toBinary`, which hardcodes the same 48-byte prologue); ksx Studio,
whose test suite byte-asserts `bytes[0..6] == b"FMIR\x02\x00"` on every IR regen
(dogfood #7 / `forma-spike-1-fmir-compat.md`).

**What breaks if it moves:** a version bump is detectable — the default loader,
`load_ir_modules_strict`, returns it as `LOAD-102` and the server refuses to
start; the deprecated lenient `load_ir_modules` logs and degrades that route to
Phase 1 (`ir_compat.rs`). A
*silent* layout change inside v2 is the dangerous one: it is mis-parsed, not
rejected, and produces wrong HTML. This is exactly why the parser validates
structurally at load rather than lazily during the walk.

**Evidence that the freeze is real, not aspirational:** FMIR v2 held across five
months of npm-side drift — compiler 0.1.8 / core 1.5.0 against Rust crates 0.1.4
compiled in March — with clean parse and correct Phase-2 output
(`forma-spike-1-fmir-compat.md`, dogfood #7).

### 3.2 Slot naming — and why names, not positions

Every dynamic value in a page is a **slot**: a `u16` id, a name, a type hint, a
source (`Server` or `Client`), and default bytes. The server fills slots by
**name**, via `SlotData::from_json` (JSON keys matched against slot names) or
`slot_id_by_name`.

The compiler mints names in five families, all through one page-wide occurrence
scheme (`utils.ts`, `uniqueName`), each family over its own registry:

| Family | Base derivation | Example |
|---|---|---|
| named signal slots | the `createSignal` variable name | `status` |
| `attr:<key>` | the attribute key | `attr:class` |
| `text:<childIndex>` | position in the parent's child list | `text:0` |
| `show:<condition>` | derived from the condition expression | `show:visible` |
| `list:<base>:array` / `:item` / `:<prop>` | derived from the list source, else the map param | `list:todos:array` |

**Occurrence suffixes.** The first occurrence of a base name on a page keeps the
bare spelling; the *N*th gets `#N`. `attr:id`, then `attr:id#2`, `attr:id#3`.
The registries are created **eagerly on the root walk context** and shared by
reference into island subtrees, inlined sub-components, list bodies and show
branches — because a registry created lazily on a spread-copied context dies
with that copy and a later sibling mints a duplicate
(`ir-walk.ts:ensureNameRegistries`; forma-tools CHANGELOG, Unreleased).

**The recent fix.** The `#N` registry originally covered only `list:` and `show:`.
`attr:` and `text:` were left out, so `h('div', { id: () => a() }, h('span', { id: () => b() }))`
emitted two slots both named `attr:id`, and two sibling `<span>`s each with one
dynamic text child emitted two `text:0`. Both families now run the same
page-wide registry (forma-tools CHANGELOG, Unreleased; task N in the work log).
Signals joined the scheme later still, once the compiler started resolving them
per lexical scope: two components can each declare `count`, they are different
signals, and they get `count` / `count#2` — with a build warning, because the
renamed one is invisible in the source and a server injecting `count` would
fill only the first.

**Which signals get a slot** is decided by the WALK, not by a separate pass:
the walk pushes a lexical frame each time it enters a scope it is inlining (a
component's file, then that component's body), so a signal has a named slot
exactly when the code declaring it was inlined into the page
(`forma-tools/packages/compiler/src/signal-scope.ts`). Before that, signal
defaults came from a pre-pass that enumerated scopes by hand and silently
missed every scope nobody had written a method for.

**Why names and not positions.** Positional addressing is what the stack had
before, and its cost is measured, not theoretical:

- Compiler ≤0.1.8 named *every* list slot literally `list:array`. On a two-list
  page only one was reachable and the other silently rendered its compile-time
  default — no warning anywhere (dogfood #2).
- `createShow` slots were all `show:createShow`, so ksx had to inject show state
  through a hand-maintained positional array (`SHOW_ORDER`) that must mirror
  compile order exactly. Sixteen entries deep on one page. Drift = the wrong
  panels render, caught only by ksx's own pinning tests. The ledger calls it
  "our single biggest remaining seam fragility" (dogfood #4).

A name survives a reorder of the page. An index does not. The residual — noted
honestly in dogfood #3 — is that a list with a *literal* source (`() => []`) and
an unnamed map param still falls back to `#N` positional, and reordering the
page renames it.

**Who depends on it:** every server-side handler that injects data by name
(`SlotData::from_json`, `slot_id_by_name`), which in practice means all of ksx
Studio's rendering (`crates/ksx-studio/src/render.rs`).

**What breaks if it moves:** nothing loudly. `SlotData::from_json` **silently
ignores unknown keys** — a stale name fails soft, so an injection just stops
happening and the page renders defaults. That is why the migration notes in the
forma-tools CHANGELOG tell you to read the names out of the emitted `.ir` string
table after upgrading, and why ksx pins exact slot names in layout tests.

**The duplicate-name rule.** Slot names are *not* guaranteed unique — the
compiler derives some per-element — so `forma-ir` fixes the collision rule in
one place: **first entry in slot-table order wins**, identically in
`IrModule::slot_id_by_name`, `SlotData::from_json` and the walker's island-props
builder. They used to disagree three ways (first, last, and last-by-ascending-id),
so setting a value by name filled one slot, left its twin blank, and the island's
props reported a third answer (`parser.rs:slot_id_by_name`, `slot.rs:from_json`,
`walker.rs:build_island_props`; verified by
`crates/forma-ir/src/parser.rs > "duplicate_slot_names_resolve_first_wins_everywhere"`).

> **Cross-repo drift, reconciled (FORMA-009, 2026-10-14).** The compiler's
> CHANGELOG (its 0.3.0 entries), README and comments described the Rust
> name→id map as "last-insert-wins", which was true of `forma-ir` before 0.2.0
> only. They now state the rule above, first wins, and point to
> `IrModule::slot_id_by_name`, where `forma-ir` states it once
> ([forma-tools#13](https://github.com/getforma-dev/forma-tools/pull/13)).

### 3.3 The hydration marker grammar

Exactly four marker kinds. Emitted by the Rust walker, parsed by the client.

| Marker | Wraps | Id is | Emitted at |
|---|---|---|---|
| `<!--f:tN-->` … `<!--/f:tN-->` | a dynamic text node | `marker_id` operand of `DYN_TEXT` | `walker.rs` DynText |
| `<!--f:sN-->` … `<!--/f:sN-->` | a conditional region | the SHOW_IF `slot_id` | `walker.rs` ShowIf |
| `<!--f:lN-->` … `<!--/f:lN-->` | a list region | the LIST array `slot_id` | `walker.rs` List |
| `<!--f:iN-->` … `<!--/f:iN-->` | an island region | `island_id` | `walker.rs` IslandStart/IslandEnd |

Grammar: `f:` + one kind char + **decimal digits, nothing else**. The client
parser (`formajs/src/dom/hydrate.ts:markerIndex`) requires every character after
the kind to be `0-9`, which is exactly what `push_u16` emits. That strictness is
a *parser* narrowing, not a wire change: it exists because the walker passes
authored `COMMENT` opcode text through nearly verbatim, so a template comment
like `<!--f:side note-->` used to be read as a show marker and desync the
adoption cursor for the rest of its parent (HARDENING-AUDIT
`marker-parse-not-digit-anchored`).

**The empty-text rule.** `DYN_TEXT` with an empty value emits a zero-width space
(U+200B) between its markers. Without it, `<!--f:t0--><!--/f:t0-->` produces *no
Text node* in the DOM, and the hydration walker has nothing to bind an effect to
(`walker.rs`, DynText handler). This is a real contract, not a cosmetic choice.
It applies wherever markers are written, so not inside the elements of the
context rule below.

**The context rule.** Inside an element whose tag name is, ASCII
case-insensitively, `textarea`, `title`, `style` or `script`, the walker writes
no marker of any kind (`f:t`, `f:s`, `f:l` or `f:i`). The tokenizer reads those
elements' content as text (RCDATA for `textarea` and `title`, RAWTEXT for
`style`, script data for `script`), so a comment there is not a comment: the
walker used to write `<textarea><!--f:t0-->hello<!--/f:t0--></textarea>`, whose
value before JavaScript, and what a form submitted, was the marker text. Inside
these four:

- `DYN_TEXT` writes its value HTML-escaped (`&`, `<`, `>`), with no markers and
  no zero-width space; an empty value writes nothing. In `style` and `script`
  the parser decodes no references, so a value holding those characters reads as
  the entity until the client writes the element; the escaping is what stops the
  hole closing its element. A hole inside `script` or `style` is still a code
  sink: HTML escaping stops it closing its element but does not make the value
  safe as JavaScript or CSS (and the old leading `<!--` marker, which in a
  classic script happened to comment out an unquoted hole to the end of its
  line, is gone).
- `SHOW_IF` still chooses its branch and `LIST` still repeats its body; neither
  writes markers. The element's content is its `TEXT` and `DYN_TEXT` values, in
  IR order. Marker ids are compiler-assigned and unchanged; the id of a
  `DYN_TEXT` inside one of these elements simply never appears in the HTML.
- In a `textarea`, content whose first byte is a line feed or carriage return
  gets one more line feed in front, because the parser drops one straight after
  `<textarea>`. Without the marker that used to stand there, the first line of
  the value would be lost.

The walker writes no markers in all four elements, but the client adopts by
the element, as a whole, only `textarea` and `title` text (formajs, ticket
FORMA-003). A reactive child of `style` or `script` is not supported for
adoption in 0.2.x: its text is right before JavaScript, but adoption may rewrite
it. A lone hole binds to the element's one text node. Mixed static and dynamic
content gains a second text node at adoption, so `#x{color:red}` becomes
`#x{color:red}red`, and updates write to that node, not to the rule (measured
in Chrome against formajs PR #11). DR-7 makes it a build error in 3.0.0.
Verified by:
`crates/forma-ir/src/walker.rs > "dyn_text_in_a_text_only_parent_is_written_without_markers"`,
`"no_marker_kind_is_written_inside_a_text_only_parent"` and
`"a_textarea_doubles_a_leading_line_feed"`.

The rule covers these four and no other element. The other elements whose
content the parser treats specially either render nothing a reader sees and
hold nothing to hydrate (`iframe`, `noembed`, `noframes`, and `noscript` with
scripting on), parse their content as ordinary markup (`noscript` with
scripting off), or are obsolete (`xmp`, `plaintext`). `pre` keeps its markers:
its content is ordinary markup, so they are real comments, and the leading one
shields a leading line feed from the parser.

**Who depends on it:** the Rust walker emits it; `@getforma/core`'s
`collectMarkers`/`adoptNode` consumes it; ksx renders through the walker and so
inherits it.

**What breaks if it moves:** adoption silently does nothing. Unknown comments
just advance the cursor — no reactive bindings, no warning. That failure mode is
documented from experience: `renderToStringWithHydration` emitted a *second*
dialect (`data-forma-h`, `<!--forma-t:N-->`) that no client code could enter, and
following its docstring produced HTML whose function children were silently
skipped. It was deleted rather than deprecated (HARDENING-AUDIT
`legacy-hydration-renderer-orphaned-grammar`).

**Known hole:** `SWITCH` emits **no marker pair**, because the grammar has no
switch kind. A switched region is server-rendered only — the client cannot locate
it to re-render when the slot changes. This is documented at the opcode
(`walker.rs`, Switch handler) and is a coordinated three-way change, not a
walker-local fix.

### 3.4 The `data-forma-*` attributes

Two disjoint namespaces share the prefix. Do not confuse them.

**A. The compiled/hydration set — shared, byte-for-byte:**

| Attribute | Written by | Read by | Values |
|---|---|---|---|
| `data-forma-ssr` | `forma-server` on `<div id="app">` | `mount()` — chooses hydrate vs CSR | present/absent |
| `data-forma-island` | walker `emit_open_tag` | `activateIslands` selector | island id, decimal |
| `data-forma-component` | walker | registry lookup key | component name |
| `data-forma-status` | walker (`pending`), then client | re-activation guard | `pending`/`hydrating`/`active`/`error`/`disposed` |
| `data-forma-hydrate` | walker | trigger dispatch | `load`/`visible`/`interaction`/`idle` |
| `data-forma-props` | walker (Inline mode) | `loadIslandProps`, first choice | attribute-escaped JSON |
| `data-forma-key` | walker (`LIST_ITEM_KEY`) | list adoption key match | row key |

**B. The zero-build HTML runtime's directive set** — `data-forma-state`,
`data-forma-id`, `data-forma-expr-error`, `data-forma-unsafe-eval`,
`data-forma-leaving`, `data-forma-contain`, … These live entirely inside
`formajs/src/runtime.ts` and never cross into FMIR. They are not part of this
contract and can change freely.

**Who depends on set A:** the Rust walker, `@getforma/core`'s activation and
adoption paths, and ksx.

**What breaks if set A moves:** islands stop being found (`querySelectorAll('[data-forma-island]')`
returns nothing → zero hydration, silently), or props stop loading, or a
re-activation guard stops working and handlers get double-bound. Note the status
values are load-bearing in both directions: `activateIslands` skips an island
whose status is already `active`/`hydrating`/`disposed`/`error`, which is what
makes a second `activateIslands()` call (HMR, SPA re-mount) safe.

**Sharp edge:** an island whose `ISLAND_START` is not followed by an element
would have its attributes leak onto whatever element came next. The walker now
errors (`NestedIslandRoot`) when a second island starts before the first has a
root, and drops-with-warning at `ISLAND_END` (`walker.rs`; forma-ir CHANGELOG
0.2.0). *Only one element can carry the set* — that is why the compiler owes
every island a shell element (`ir-walk.ts:emitIsland`).

### 3.5 The `__forma_islands` props protocol

Island props reach the client through exactly one of two channels, never both:

1. **Inline** — `data-forma-props='{"initial":5}'` on the island root,
   attribute-escaped.
2. **Shared block** — one `<script id="__forma_islands" type="application/json">`
   for the whole page, an object keyed by island id **as a decimal string**:
   `{"0": {...}, "3": {...}}`.

**Precedence:** the client reads `data-forma-props` first and falls back to the
shared block (`activate.ts:loadIslandProps`). The walker emits exactly one
channel per island so precedence never has two answers to choose between
(`walker.rs`, IslandStart).

**The spill.** Inline props over `INLINE_PROPS_MAX_BYTES` (1024, measured on the
JSON before HTML escaping) move to the shared block automatically. A *fragment*
render (`walk_island`) never spills — it cannot legally emit a second block, and
an injected duplicate `__forma_islands` id would shadow the SSR one for every
other island on the page.

**The escaping rule.** The block's JSON has every `<` and `>` written as
`\u003c` / `\u003e` (plus U+2028/9). Consumers **MUST** decode with `JSON.parse`
and **MUST NOT** string-match the raw script text. The previous `</` → `<\/`
escape was insufficient: a props value containing `<!--` followed later by
`<script` drives a spec-compliant tokenizer into the *script-data-double-escaped*
state, where the walker's own `</script>` is consumed as text and the entire
rest of the page — config script, module tag, `</body>` — is
swallowed. The page renders completely inert, driven purely by user-controlled
slot data (`walker.rs:push_json_script_body`; forma-ir CHANGELOG 0.2.0,
Security). The parsed *values* are unchanged, so this was not a coordinated
change.

**Client-side robustness rules, learned the hard way:** the block is located as
`script#__forma_islands` (not `getElementById`, which matched any element with
that id — a user-controlled node earlier in the document could supply props to
every island on the page) and parsed inside a try/catch (one malformed or empty
block used to abort activation for *every* island, including islands with inline
props or none) — HARDENING-AUDIT `island-shared-props-parse-unguarded`.

**Sanitization is shallow by default** on both channels: top-level `__proto__` /
`constructor` / `prototype` are deleted; nested ones are not. `sanitizePropsDeep`
is the opt-in. RPC arguments *are* stripped recursively — the asymmetry is
deliberate and documented (README, SECURITY.md, HARDENING-AUDIT
`island-props-vs-rpc-sanitization-not-equivalent`).

**Who depends on it:** the walker emits it; `@getforma/core` consumes it; ksx
Studio *hand-emitted* the block server-side for a year because the compiler
registered every island with empty `slot_ids` (dogfood #8) — that is now fixed
upstream, and ksx's layout test asserting `slot_ids.is_empty()` is the tripwire
that tells them to migrate to the native path.

### 3.6 Contract enforcement — where the tests actually are

| Contract | Enforced by |
|---|---|
| FMIR frozen bytes | `forma/crates/forma-ir/tests/fmir_contract.rs` (reads raw bytes as a consumer would) |
| Real emitter → real consumer | `forma/crates/forma-ir/src/js_emitter_contract.rs` + `forma-tools/packages/compiler/tests/fixtures/ir-corpus/` |
| Slot-name uniqueness | `forma-tools/packages/compiler/tests/ir-walk.test.ts` |
| First-wins duplicate rule | `forma/crates/forma-ir/src/parser.rs > "duplicate_slot_names_resolve_first_wins_everywhere"` |
| Marker parsing strictness | `formajs/src/dom/__tests__/hydrate.test.ts` |
| Island isolation & props | `formajs/src/dom/__tests__/activate-isolation.test.ts` |
| LIST stays O(rows) | `forma/crates/forma-ir/tests/list_scaling.rs` |

The cross-implementation corpus deserves a note: measured over 32 binary
mutation probes, the compiler's own JS test suite killed 22 and a Rust reader
lane killed 22 — but the **union** killed 27. Five defect classes were invisible
to the JS suite because its FMIR readers were written from the same mental model
as the emitter, so they agreed with it *by construction*, including where both
were wrong (`js_emitter_contract.rs` module docs). That is the argument for the
corpus in one paragraph: a test written by the author of the thing under test
cannot find a shared misconception.

---

## 4. Design decisions and their reasoning

Format: **Context → Decision → Rejected → Cost → Evidence.** Where I am
reconstructing motive rather than reporting it, the line is tagged
**[INFERENCE]**.

### D1 — Fine-grained signals, not a virtual DOM

**Context.** Every reactive UI library must decide what its unit of update is.

**Decision.** One signal ↔ one binding ↔ one DOM node. Components run **once**;
reading a signal inside a reactive closure subscribes exactly that closure.
Backed by `alien-signals`. (`formajs` README; `src/reactive/`.)

**Rejected.** A virtual DOM with re-render + diff. Also rejected: dependency
arrays / manual memoization (the React model), which move the correctness burden
onto the app author.

**Cost.** Reactivity is *invisible in the type system*: passing `count()` where
you meant `count` silently reads once and never updates. The library leans on
dev warnings and convention. Effects are also individually cheap but numerous —
a large list is a lot of small subscriptions, which is why list reconciliation
and row disposal got so much hardening attention (HARDENING-AUDIT
`hydrated-list-row-effects-never-disposed`, `islands-inside-removed-list-rows-never-deactivated`).

**Why it is load-bearing for the whole stack.** **[INFERENCE]** — the codebase
never states this connection, but it falls out of the design: because a binding
is one node, the server can name it with a comment marker, and the client can
adopt it without re-rendering anything. A VDOM's unit is a subtree, so its only
hydration story is "re-render and compare". Every other decision in this
document — markers, islands, adoption, the slot table — depends on the unit of
update being a node. If someone ever proposes a diffing layer "for
convenience", this is the paragraph to re-read.

### D2 — A binary IR, not JSON and not template strings

**Context.** Something must carry the compiled page from the Node build to the
Rust server.

**Decision.** A self-contained little-endian binary module: opcode stream +
interned string table + slot table + island table, with a section table so each
part can be located in O(1).

**Rejected.**
- *JSON.* Would have worked and would have been debuggable. **[INFERENCE]** on
  the reasons against: (a) a JSON document has no stable byte offsets, and
  `IslandEntry.byte_offset` is what lets `walk_island` seek directly to one
  island and render just that fragment — with JSON you would need a parallel
  index or a re-walk; (b) fixed-width `u16`/`u32` operands mean the walker reads
  operands without allocating, which is what keeps the walk linear; (c) string
  interning deduplicates every repeated tag name in the page.
- *Template strings / an HTML template language.* Would put a parser on the
  hot path per request and would not carry slot typing or island structure.

**Cost.** Debuggability — hence `forma_ir::dump::dump_ir` behind a feature flag,
which since 0.2.0 prints the slot and island tables (before that it printed only
counts, so diagnosing the very drift it exists for required writing a throwaway
program). And the cost documented all through §3: the format is now a wire
contract between separately-shipped codebases.

**Evidence.** `docs/FMIR-FORMAT.md`; `format.rs`; `ir-emit.ts:toBinary`;
`walker.rs:walk_island` (the byte-offset seek).

### D3 — Render in Rust, not in Node

**Context.** SSR conventionally means running your component code on a Node
server.

**Decision.** The server is Rust. It parses FMIR and walks it. No JS runtime is
involved in producing HTML. (`forma` README: "your server never needs a
JavaScript runtime".)

**Rejected.** Node SSR (`renderToString`) — which `@getforma/core` still ships
for apps that want it (`src/ssr/`), but it is not the primary path.

**Cost.** The stack is now bilingual, and the compiler's understanding of your
components is *partial*: anything `ir-walk.ts` cannot pattern-match becomes an
island instead of server-rendered HTML. Every capability gap between "what
`h()` can express" and "what the 12 rules recognise" shows up as a
client-rendered region. That is a real, permanent tax on this decision.

**Also a cost: performance is not free just because it is Rust.** The walker was
once *slower than the JS `renderToString` it exists to replace* — `walk_to_html`
deep-cloned the entire `SlotData` inside the per-row loop, so a 400-row table
took 31.5 ms and 1.1 M allocations to emit 61 KB of HTML. Fixed by making
`SlotValue::Array`/`Object` `Arc`-backed and journalling the row's item binding
instead of cloning: 400 rows now 0.147 ms, 2,412 allocations, **byte-identical
output** across a 21-case corpus, with `tests/list_scaling.rs` as a committed
gate that fails the build if the cost stops being linear (forma-ir CHANGELOG
0.2.0). The lesson worth keeping: this decision only pays off if someone
measures it.

### D4 — Islands, not whole-page hydration

**Context.** A hydrated page pays to re-establish, in JS, everything the server
already rendered.

**Decision.** Interactive regions are explicit islands. The compiler marks them
(`ISLAND_START`/`ISLAND_END` + an island-table entry), the walker stamps
`data-forma-*` on each island's root, and the client hydrates only those, on the
trigger each declares: `load`, `visible` (IntersectionObserver, 200px
rootMargin), `idle` (`requestIdleCallback`, 200 ms `setTimeout` fallback), or
`interaction` (`pointerdown`/`focusin`, capture, once).

**Rejected.** Whole-page hydration.

**Cost, and it is the sharp one:** *isolation must be engineered, not assumed.*
Each island runs in its own `createUnownedRoot` with try/catch, and the promise
"a broken island never takes down its siblings" required several distinct fixes
before it was true: the shared props block aborting all activation
(`islands-script-parse-not-isolated`), a throwing binding aborting the
alien-signals flush across islands (`throwing-binding-aborts-flush-cross-island`),
and a mid-hydration throw leaving undisposable zombie effects
(`hydrate-error-path-zombie-effects`). Deferred triggers add teardown surface —
observers, timers and listeners all have to be cancellable by
`deactivateIsland`, or an island torn down before it ever intersects leaks, and
a stray event re-hydrates a disposed island.

**Evidence.** `formajs/src/dom/activate.ts`; HARDENING-AUDIT (the findings
named above); `format.rs:IslandTrigger`.

### D5 — Seed island signals from props **before** adoption

**This is the most important decision in the stack, and the least obvious.**

**Context.** A server-rendered page has real data in its HTML. The client's
signals start at their defaults.

**The concrete failure it prevents.** Adoption binds SSR DOM to client signal
state. A text binding is `internalEffect(() => textNode.data = String(child()))`
— and an effect's **first run** writes the current signal value over the
server's text. List adoption is worse: it reads `untrack(() => child.items())`
and **removes SSR rows whose keys are absent from the client array**
(console: `removing extra SSR list item`). Net effect: *any* server-data page
visibly reverts to client defaults the moment it mounts. ksx Studio hit exactly
this and recorded it as dogfood #5.

**Decision.** Props reach the island **before** its component function runs.
`activateIslands` → `loadIslandProps` → `hydrateFn(root, props)` → the island
seeds `createSignal(props?.x ?? fallback)` → *then* `hydrateIsland`/`adoptNode`
attaches effects. When the first effects run they write the same values the
server rendered, so nothing visibly changes. Live updates afterwards flow
through the same signals with no clobber.

**Rejected.** Making `hydrate()` adopt DOM state as initial signal values —
i.e. reading the server's text back into the signal. Proposed by ksx as the
ideal fix (dogfood #5, "Ask"); not implemented. **[INFERENCE]** on why: it would
require the client to parse rendered text back into typed values (numbers,
booleans, arrays), which is lossy and type-unsafe in a way `data-forma-props`
is not. If someone proposes this, that is the objection to answer.

**Cost.** The mechanism was **undocumented for a long time** — discoverable only
by reading `@getforma/core` internals, which is precisely what ksx had to do.
Every island author must remember it; a bare `createSignal([])` silently erases
server data. It is now written up (`formajs` README > *SSR with Server Data*),
with the dev-console warnings to grep for, and dogfood #5 is marked
ADOPTED-in-production with the docs ask closed.

**Evidence.** `formajs/src/dom/activate.ts:hydrateIslandRoot` (props loaded, then
the component runs, then adoption); `formajs` README lines ~835-940; dogfood #5.

### D6 — Address slots by name, not by position

Covered mechanically in §3.2; the decision itself:

**Decision.** Slot names are derived from the source binding (`list:todos:array`,
`show:visible`, `attr:class`) and made page-unique with `#N` occurrence
suffixes.

**Rejected.** Positional/ordinal addressing (`list:#3:array`) — which is still
the *fallback* when nothing nameable can be derived, and is honestly flagged as
a residual (dogfood #3).

**Cost.** Name derivation is a heuristic over an AST: arrows, calls, member
access and `!` unwrap; a `function` expression unwraps; `_` params are ignored.
It will always have holes, and when it falls back the name is document-order
dependent. Renaming a variable in a component renames a slot — so server
injection code is coupled to client variable names. That is a real, permanent
coupling this decision buys.

**Why it was worth it.** ksx maintained a 16-entry positional `SHOW_ORDER` array
that had to mirror compile order exactly, with drift caught only by their own
pinning tests (dogfood #4). Multiply that by every page.

### D7 — CSP-safe by default, not CSP-safe by option

**Context.** The zero-build HTML runtime evaluates expressions written in
attributes (`data-text="{count}"`). The easy implementation is `new Function`.

**Decision.** Every build ships with the `new Function()` fallback **off**. A
hand-written CSP-safe expression parser handles the supported grammar; an
expression outside it is **not evaluated** — it logs, fires a
`formajs:diagnostic` event, appears in `getDiagnostics()`, and marks its element
with `data-forma-expr-error`. Opt in explicitly via `setUnsafeEval(true)`,
`data-forma-unsafe-eval="true"`, or `__FORMA_RUNTIME_CONFIG`. A build define
chooses whether eval *can* be enabled (`mutable`) or is compiled out
(`locked-off`) — never whether it *is* on.

**Rejected.** The prior state, which is instructive: the standard build shipped
with the fallback **enabled**, used it silently for anything the parser could
not handle, and under the strict CSP the docs themselves recommended, `new
Function` threw `EvalError`, the catch swallowed it, and the expression
evaluated to `undefined` — the page rendered wrong with only a console message.
Four separate docs claimed the opposite (HARDENING-AUDIT
`csp-safe-by-default-is-false-in-shipped-standard-build`, the audit's single
Critical finding).

**Cost.** The grammar is a **real constraint**, and it bit the project's own
front page: the README's flagship showcase used arrow functions inside
`data-computed`/`data-list`, which the parser rejects — the example presented as
proof of the CSP-safe story actually disproved it. It was rewritten to stay
inside the grammar, and the arrow-function version kept as a *negative* test
(`readme-showcase-example-cannot-run-on-hardened-build`). Closing the remaining
grammar gap is still open work (work log item K).

**Related, server side.** `forma-server`'s CSP is nonce + `'strict-dynamic'`,
with `worker-src 'self'` stated explicitly (strict-dynamic does not cover
workers) and `object-src 'none'` as defence in depth. One hard-won directive:
**`style-src-attr 'unsafe-inline'`**. Per CSP, a nonce in `style-src` disables
`unsafe-inline` semantics, and a nonce cannot be attached to an *attribute* — so
the nonce-only policy silently killed every `style=""` attribute, **including the
ones the framework's own compiler emits** for `style:` bindings. In ksx's mapper
this collapsed 25 positioned hit-areas into a 2-px pile at the stage's top-left
and froze a countdown bar (dogfood #13a). `style-src-elem` still falls back to
the nonce-locked `style-src`, so `<style>` blocks stay strict; older engines
ignore the unknown directive and fail closed to the previous behaviour
(`crates/forma-server/src/csp.rs`).

### D8 — Ship a zero-build HTML runtime alongside the compiled path

**Context.** The compiled path needs Node, a build step, and a Rust server.

**Decision.** `formajs/src/runtime.ts` is a second, complete front end: declarative
`data-*` directives on plain HTML, one `<script>` tag from a CDN, no build step.
It is a deliberate monolith (~3,650 lines, with a written justification in its
own header: shared mutable state, no circular imports, one IIFE for CDN).

**Rejected.** **[INFERENCE]** — nothing in the repo argues the alternative, but
the alternative was clearly "compiled path only". The runtime's inspirations are
listed in its header (Alpine's directive model, Solid's signals, Qwik's deferred
triggers, Astro's islands, Hotwire, Lit), which reads as a deliberate bid for the
progressive-enhancement audience the compiled path cannot serve.

**Cost.** It is a second surface with its own security posture (D7 exists almost
entirely because of it), its own `data-forma-*` namespace that shares a prefix
with the hydration contract (§3.4 — a genuine source of confusion), and its own
bundle to keep under a size gate. It also creates the *module-duplication*
hazard: `runtime-hardened` is built with `splitting:false`, so an app importing
both `@getforma/core` and `@getforma/core/runtime-hardened` gets two private
copies of the reactive graph. Fixed by **detection** (an instance marker on
`globalThis` warns once in dev) rather than prevention — the shipped module
topology still permits two copies, and the audit says so in those words
(`dual-package-and-hardened-state-duplication`).

### D9 — Validate everything once at load; fail closed; budget the walk

**Context.** The walker reads attacker-influenceable bytes (an `.ir` file, plus
`SlotData` built from request JSON) and must not produce wrong HTML or die.

**Decision.** Three layers:

1. **One-shot structural validation at parse.** `IrModule::parse` → `validate()`
   checks every cross-table reference, duplicate ids, island `byte_offset`s
   pointing at their own `ISLAND_START`, and that control-flow regions *tile
   exactly*. O(n) once at load, so the walker stays cheap and malformed IR fails
   at startup rather than rendering mystery HTML on some later request.
2. **Fail closed on the unknown.** Unknown opcode → error, never a guess.
   Unknown enum value → error, never a default. Non-zero `flags` → error.
3. **Per-render budgets.** `WalkLimits`: 8 MiB output, 50,000 total LIST
   iterations across all depths (nesting depth alone does not bound volume —
   four LISTs over the same array give n⁴ body walks from one small module and
   one large request array). Over budget = a rejected render that degrades to
   Phase 1, not a `handle_alloc_error` process abort that kills every in-flight
   request.

**Rejected.** Lazy validation during the walk; tolerating unknown values.

**Cost.** "Validation may get stricter" is explicitly *not* treated as a
compatibility break (`FMIR-FORMAT.md` §3.5): a future patch may reject a file an
earlier one accepted, when accepting it produced silently wrong output.
Well-formed compiler output is unaffected. Accept this trade or the alternative
is shipping pages that are quietly wrong.

**Evidence.** `parser.rs:validate`; `walker.rs:WalkLimits`, `bounded_offset`,
`push_checked`; `format.rs:IrError` (the error list *is* the fail-closed
inventory).

### D10 — Phase 1 is always available as a floor

**Being reversed (DR-11, from 0.2.2).** `try_render` returns every failure
below as a coded `RenderError` the handler answers, and `render_page`, which
keeps this floor, is deprecated and goes in 3.0.0. At start, the strict loader
is the default and the lenient `load_ir_modules` is deprecated: a bad module
for a server-rendered route stops the server before its port binds. The
section records the 0.2.x decision as it was made.

**Decision.** Every route can render as Phase 1 — an empty `<div id="app">` that
the client mounts from scratch. Phase 2 (SSR) is attempted when a route has a
parsed IR module and slots, and **any** failure falls back: missing module,
version mismatch, walk error, budget exceeded, a manifest declaring an `.ir`
that is not embedded.

**Cost.** Silent degradation. A Phase-1 page still *works*; it just lost its
fast first paint and its no-JS rendering. That is why the failures are logged,
why `load_ir_modules_strict` exists (an app can fail startup on a build/embed
skew rather than quietly shipping without SSR), and why the manifest-declares-
but-not-embedded case was promoted from a silent fall-through to a logged error
with an explicit `Phase1ClientMount` entry — it used to be literally
indistinguishable from a route that never had IR (`ir_compat.rs`; forma-server
CHANGELOG 0.2.0).

**[INFERENCE]** the reason to prefer degradation over a hard failure: this is a
*rendering* stack, and a slow-but-correct page beats a 500. The code never says
so; the original inference used `load_ir_modules`, `render_page_phase2` and the
now-removed WASM path. See the archived pre-removal architecture for that history.

### D11 — A fragment render is self-contained

**Decision.** `walk_island` returns the island's **root element carrying its full
`data-forma-*` set** — not its inner HTML. Clients swap it in with
`replaceWith`/`outerHTML`, never `innerHTML` (that would discard exactly the
attributes the runtime selects on). The `<!--f:iN-->` markers are deliberately
**not** re-emitted: they live outside the root and survive an `outerHTML` swap,
so re-emitting would duplicate them. Props are always inlined on the root even
for a `ScriptTag` island, because a fragment cannot legally emit a second
`__forma_islands` block — an injected copy precedes the SSR one in document
order and would shadow it for every other island on the page.

**Evidence.** `walker.rs:walk_island` doc comment and `force_inline_props`;
`lib.rs:render_island`.

---

## 5. Where the bodies are buried

Known sharp edges. Each is real today unless marked otherwise.

### Compiler / FMIR

| # | Sharp edge | Consequence | Tracked |
|---|---|---|---|
| B1 | **6 of 18 opcodes are never emitted by the compiler**: `SWITCH`, `TRY_START`, `FALLBACK`, `PRELOAD`, `COMMENT`, `LIST_ITEM_KEY` (`ir-walk.ts` constants list vs `format.rs:Opcode`). | Walker code paths for them are exercised only by hand-built modules and tests. `PropsMode::ScriptTag` and `Deferred` are likewise never emitted; `Deferred` is not implemented on *either* side and is indistinguishable from "no props". | Documented at `format.rs:PropsMode`; **not otherwise tracked — worth an explicit "dormant surface" note** |
| B2 | **Compiled lists carry no `data-forma-key`.** `LIST_ITEM_KEY` is never emitted, and its operand is a *static* string index anyway — so every row would get the same key. | Client list adoption falls back to **index-based matching** for every compiled page (`hydrate.ts:useIndexFallback`). Fine for lists that never reorder; a reorder mis-adopts. | LIMITATION documented at `format.rs:Opcode::ListItemKey`; per-item keys need a v-bump |
| B3 | `SWITCH` emits no hydration marker. | A switched region is server-rendered only; the client cannot re-render it. Also no default case — a non-matching value renders nothing. | Documented at `walker.rs`, Switch handler |
| B4 | Literal-source lists still fall back to document-order positional names. | Reordering the page silently renames the slot; injection misses, no warning. | dogfood #3 (MOSTLY RESOLVED / residual ask) |
| B5 | `SlotData::from_json` **silently ignores unknown keys**. | Every slot-name change fails soft. A stale injection key just stops working. | `slot.rs:from_json`; migration notes in forma-tools CHANGELOG |
| B6 | Cross-repo prose drift on duplicate-name resolution (first-wins in `forma-ir` 0.2.0; forma-tools CHANGELOG said last-insert-wins). | A reader following the compiler CHANGELOG's migration advice against a current `forma-ir` got the wrong slot. | §3.2 of this document; **fixed in FORMA-009**: the compiler's prose now states first-wins ([forma-tools#13](https://github.com/getforma-dev/forma-tools/pull/13)) |
| B7 | `PRELOAD` emits a `<link rel=preload>` with **no CSP nonce**. | Under `script-src 'strict-dynamic'` an `as="script"` preload hint is dropped. Degradation, not breakage; latent because the compiler never emits `PRELOAD`. | NOTE at `walker.rs`, Preload handler |
| B8 | `source_hash` in the FMIR header is written as `0` and never verified. | No integrity or staleness check on the module. | `format.rs:IrHeader`; `FMIR-FORMAT.md` §2.1 |
| B9 | Stale internal comment: `format.rs` §"Opcode enum (16 opcodes, 0x01–0x10)" — there are 18, through `0x12`. | Cosmetic, but this repo's own convention is that a comment asserting a fact must be true. | Found while writing this doc; **not fixed here** (code untouched by design) |

### Runtime / hydration

| # | Sharp edge | Consequence | Tracked |
|---|---|---|---|
| B10 | **Islands must seed signals from props** (D5). A bare `createSignal([])` erases server data on mount. | Silent, visible data loss on first paint. | `formajs` README > SSR with Server Data; dogfood #5 (ADOPTED) |
| B11 | Adoption-path `setupShowEffect` used to materialise branches inside its own effect run, so branch bindings were disposed on the next toggle. | Stale modal prompts on reopen, empty flash boxes, a conflict dialog that never renders. ksx shipped a **build-time patch** rewriting the compiled seam (`__ksxShowBranch`) to work around it. | dogfood #13b (worked around locally, OURS-TO-SEND); fixed upstream per HARDENING-AUDIT `show-adoption-cached-branch-goes-stale` — **ksx's patch should now be retired; confirm before removing** |
| B12 | Event handlers in `createList` row bodies did not attach to adopted SSR rows. | Silent dead `onClick` until a row is re-created. | HARDENING-AUDIT `adopted-rows-never-rebound` — FIXED by running `renderFn` in hydration mode per adopted row |
| B13 | A duplicate `data-forma-key` used to leave a ghost row the reconciler never tracked. | Permanent orphan row between the markers. | HARDENING-AUDIT `duplicate-forma-key-ghost-row` — FIXED (first-wins + dev warning) |
| B14 | Two copies of the module graph are still *possible* (mixing `import`/`require`, or root entry + `runtime-hardened`). | Two independent reactive graphs; signals invisible across them. | HARDENING-AUDIT `dual-package-and-hardened-state-duplication` — **deliberate residual**: detection, not prevention |
| B15 | `__DEV__` guard sites that cross a code-splitting chunk boundary survive in the bundle. | Dead bytes; cannot execute. | HARDENING-AUDIT `dev-flag-define-is-inert-in-dist` — **deliberate residual** |

### Server

| # | Sharp edge | Consequence | Tracked |
|---|---|---|---|
| B16 | `PageConfig::config_script` and `body_prefix` are **raw, trusted escape hatches**. `</script`/`<!--` are neutralised so the value cannot break *out*, but that is not the same as safe: a `"` or `\` from untrusted data still yields nonce-blessed script execution in your own page. | Use `config_json` (serde-escaped, `window.__FORMA_CONFIG__`) for anything derived from user input. Pass `body_prefix` a `RawHtml` (`RawHtml::trusted`, the one raw constructor, so review and CI find every use); preloads and head links have typed homes on `RenderCtx` (0.2.2, DR-19). | `types.rs:PageConfig` doc comments; `raw.rs`; `tests/raw_html.rs` |
| B17 | `PageOutput`'s HTML and CSP are one unit — the HTML embeds a per-request nonce. Caching the HTML across requests either kills every script (fresh policy, stale body) or ships one static publicly-known nonce to every user. | Send it as a `PageResponse`, which writes `no-store` itself. (`render_page_with_nonce`, the re-stamping path, is deprecated in 0.2.2: from 3.0.0 the render draws every nonce.) | `types.rs:PageOutput`; `response.rs:PageResponse`; `csp.rs:CspNonce` |
| B18 | MSRV differs per crate: `forma-ir` 1.71, `forma-server` 1.85 (rust-embed 8 → sha2 0.11). Deliberately not unified. | A workspace-wide MSRV assumption is wrong. | forma-server CHANGELOG 0.2.0; CI pins both |
| B19 | ksx runs a local `relax_style_src` rewrite of the CSP header. | May now be unnecessary — `style-src-attr 'unsafe-inline'` landed upstream (D7). | dogfood #13a; **confirm and retire the workaround** |

### Process

| # | Sharp edge |
|---|---|
| B20 | Island byproduct cleanup (`*.islands.js`) must be repeated **per entry point** in multi-route builds, and `#N` occurrence suffixes are **per page, not per build** — each page's IR names are independent (dogfood #12; no bug, undocumented upstream). |
| B21 | The dogfood ledger's own process note is the healthiest thing in it: findings #1 and #2 were found in production on a Tuesday and fixed-and-adopted upstream on Wednesday. **The loop works; keep feeding it.** |

---

## 6. Appendix

### 6.1 Opcode inventory (FMIR v2)

| Byte | Opcode | Operands | Emitted by compiler? |
|---|---|---|---|
| `0x01` | `OPEN_TAG` | `str_idx u32`, `attr_count u16`, `[(key u32, val u32)]` | yes |
| `0x02` | `CLOSE_TAG` | `str_idx u32` | yes |
| `0x03` | `VOID_TAG` | as `OPEN_TAG` | yes |
| `0x04` | `TEXT` | `str_idx u32` | yes |
| `0x05` | `DYN_TEXT` | `slot_id u16`, `marker_id u16` | yes |
| `0x06` | `DYN_ATTR` | `attr_str_idx u32`, `slot_id u16` | yes |
| `0x07` | `SHOW_IF` | `slot_id u16`, `then_len u32`, `else_len u32` | yes |
| `0x08` | `SHOW_ELSE` | — (separator) | yes |
| `0x09` | `SWITCH` | `slot_id u16`, `case_count u16`, then `(val u32, len u32)` × n | **no** |
| `0x0A` | `LIST` | `slot_id u16`, `item_slot_id u16`, `body_len u32` | yes |
| `0x0B` | `ISLAND_START` | `island_id u16` | yes |
| `0x0C` | `ISLAND_END` | `island_id u16` | yes |
| `0x0D` | `TRY_START` | `fallback_len u32` | **no** |
| `0x0E` | `FALLBACK` | — (separator) | **no** |
| `0x0F` | `PRELOAD` | `resource_type u8`, `url_str_idx u32` | **no** |
| `0x10` | `COMMENT` | `str_idx u32` | **no** |
| `0x11` | `LIST_ITEM_KEY` | `key_str_idx u32` | **no** |
| `0x12` | `PROP` | `src_slot u16`, `prop_str_idx u32`, `target_slot u16` | yes |

`SlotType`: 1 Text, 2 Bool, 3 Number, 4 Array, 5 Object.
`SlotSource`: 0 Server, 1 Client.
`IslandTrigger`: 1 Load, 2 Visible, 3 Interaction, 4 Idle.
`PropsMode`: 1 Inline, 2 ScriptTag, 3 Deferred *(2 and 3 never emitted; 3 not implemented)*.

### 6.2 Cross-renderer parity rules

The Rust walker and the JS renderer must produce the **same bytes** for the same
value, or hydration reconciles a difference that is not really there. The rules
that took work to get right (all in forma-ir 0.2.0, all "may change emitted
bytes on purpose"):

- **Numbers** follow ECMAScript `Number::toString` exactly, including the
  exponent rule and `-0` → `"0"`. Rust's `Display` never uses exponential form,
  so the general path is rebuilt from `LowerExp` (`slot.rs:format_js_number`).
- **Boolean attributes**: `true` → bare name, `false`/null → omitted. The walker
  used to write `disabled="false"`, and an HTML boolean attribute is ON whenever
  present — SSR shipped a disabled control that only un-broke itself after
  hydration, and never for a `visible`/`idle` island the user never reached.
- **Empty string is a value, not an absence**: `value=""` / `alt=""` render.
- **Truthiness follows `ToBoolean`**: an empty array is **truthy**. The server
  used to call it falsy, so a `SHOW_IF` bound to a list slot hid its block during
  SSR and un-hid it the instant the client evaluated the same condition — a
  guaranteed visible flip on the empty-list case, which is the state a fresh page
  starts in.
- **`to_text` follows `String(value)`**: arrays join with `,` (nesting flattens),
  objects render `[object Object]`.
- **URL/attribute safety mirrors formajs exactly** — same `URL_ATTRS` list, same
  `IMAGE_CONTEXT_TAGS`, same control-character normalisation before scheme
  testing, same `[A-Za-z_:][-A-Za-z0-9_:.]*` name charset. Making the Rust side
  *stricter* than the JS side is itself a hydration divergence.
- **Form-control values are written as HTML reads them.** HTML ignores a `value`
  attribute on a `textarea` and on a `select`, so the walker writes neither: a
  textarea's `value` (static or `DYN_ATTR`) becomes its text content, under the
  leading line-feed rule of 3.3, and wins over any children; a select's `value`
  becomes a bare `selected` on the matching option. Matching follows the
  client's `writeFormControlProperty` (`@getforma/core`, checkpoint `042e353`):
  `null` is `''` and anything else is `String(value)`; a single select takes the
  *first* option with that value (a second `selected` would win in the parser);
  a select with a written `multiple` attribute (a `DYN_ATTR multiple` that is
  `false` writes none) and an array value takes every option whose value is in
  `value.map(String)`, so a `null` member is `"null"`. An option's value is its
  first `value` attribute, as the parser keeps it, or its text stripped and
  collapsed when it has none; that text ends at `</option>` or, when that is
  left out, at the next `<option>` or `<optgroup>`. Inside a bound select, an
  authored `selected` on an option is dropped, because the binding decides. A
  value no option has selects nothing; the browser then shows the first option,
  since HTML cannot write `selectedIndex = -1`. Verified by
  `crates/forma-ir/src/walker.rs > "a_select_value_binding_selects_the_matching_option"`
  and `"a_textarea_value_binding_is_written_as_its_text"`.
- **No markers inside `textarea`, `title`, `style` or `script`** (3.3, the
  context rule).

> The separate Node renderer and its form-control parity gap were removed in
> FORMA-110. Native Rust SSR remains the supported server rendering path.

### 6.3 Glossary

- **FMIR** — Forma Module IR. The binary compiled form of a page. `.ir` on disk.
- **Slot** — a numbered, named, typed hole in the compiled page that a value is
  substituted into at render time.
- **Island** — a region of the page that hydrates on the client, identified by
  `data-forma-island` on its root element.
- **Marker** — an HTML comment (`<!--f:t0-->`) delimiting a hydratable region.
- **Adoption** — binding client effects onto existing SSR DOM without creating
  elements. `adoptNode` in `formajs/src/dom/hydrate.ts`.
- **Phase 1 / Phase 2** — client-mount-from-scratch vs server-rendered-then-hydrate.
- **The walk** — one pass of `walk_to_html` over the opcode stream.

### 6.4 Where to read next

| To understand | Read |
|---|---|
| the binary format, exactly | `forma/docs/FMIR-FORMAT.md` |
| what the walker does with each opcode | `forma/crates/forma-ir/src/walker.rs` (`walk_range_impl`) |
| what validation runs at load | `forma/crates/forma-ir/src/parser.rs` (`IrModule::validate`) |
| how AST becomes opcodes | `forma-tools/packages/compiler/src/ir-walk.ts` (the 12 rules) |
| how islands hydrate | `formajs/src/dom/activate.ts` then `src/dom/hydrate.ts` |
| what production actually hit | `KeyboardSplitterXboxPro/docs/FORMA-DOGFOOD.md` |
| what was audited and fixed | `formajs/docs/HARDENING-AUDIT.md` |
| whether the format really is stable | `KeyboardSplitterXboxPro/docs/research/forma-spike-1-fmir-compat.md` |

---

## Open questions for the owner

Listed so they get answered rather than absorbed:

1. **B6** — which repo's prose about duplicate-name resolution should change?
   *Answered (FORMA-009):* the compiler's. `forma-ir`'s first-wins is the rule;
   the compiler CHANGELOG, README and comments now say so.
2. **D2's rejected alternatives** are my reconstruction. Were JSON and template
   strings actually considered, and were the reasons the ones I list?
3. **D5's rejected alternative** — was "adopt DOM state as initial signal values"
   turned down for the reason I give (lossy text→typed-value parsing), or for a
   different one?
4. **D8** — is the zero-build runtime a permanent second front end, or a bridge?
   The answer changes how much the D7 grammar gap is worth closing.
5. **B1** — should the six never-emitted opcodes and the two never-emitted
   `PropsMode` values be marked as a dormant surface in `FMIR-FORMAT.md`, kept
   as reserved wire space, or removed at the next version bump?
6. **B11 / B19** — ksx carries two local workarounds whose upstream fixes have
   landed. Who confirms and retires them?
