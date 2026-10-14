# Phase 1 or Phase 2 — which rendering mode a template should ask for

**Audience:** whoever adds or changes a template here, and anyone surprised
that the flagship dashboard is client-rendered.

`forma-server` has exactly two rendering modes, and a scaffolded server picks
one per route:

| Mode | What the server sends | What the client does |
|---|---|---|
| `RenderMode::Phase1ClientMount` | `<div id="app"></div>` plus the script and style tags | `mount()` builds the whole tree |
| `RenderMode::Phase2SsrReconcile` | HTML rendered from the page's `.ir` module, with hydration markers | adopts the existing DOM and attaches reactivity |

(`forma-server`, `crates/forma-server/src/types.rs`.)

Phase 2 is not strictly better. It is better *when the page's IR is real*, and
whether it is real is decided by the compiler, not by the server.

## The rule that decides it

**The FMIR compiler walks source; it does not execute it.** It can translate
what it can prove statically — literal JSX/`h()` trees, `createShow`,
`createList`, ternaries inside a function, and a component call it can follow
into and inline. Anything else becomes an *island shell*: an empty
`<div data-forma-island="…">` that renders nothing server-side and only appears
once the client bundle hydrates it.

That is not a silent failure any more — every degradation warns at build time,
naming the file, the construct, and what the page loses. Read the warnings; a
page that *looks* built can be missing its content.

> `IR: component someFunction(...) could not be resolved to a source file —
> emitted as an empty island shell, so it renders nothing server-side and only
> appears once the client bundle hydrates — the compiler follows relative
> imports only; package imports and dynamic references always stay client-side`

The authoritative list of what does and does not translate is *What renders
server-side* in
[`@getforma/compiler`'s README](https://github.com/getforma-dev/forma-tools/blob/main/packages/compiler/README.md).

Two consequences for a template author:

1. **A page whose content depends on data fetched at runtime may compile to
   almost nothing.** Following a component *call* is the easy half, and the
   unreleased compiler does it well (see the re-measurement below). What no
   compiler here can do is evaluate `servers.map(s => <ServerCard s={s}/>)`
   before the fetch that fills `servers` has happened, or inline
   `<StatCard value={m.value}/>` when `m` does not exist until runtime. Those
   are islands, and a page made of them has no markup to send.
2. **Serving empty shells as Phase 2 is worse than Phase 1**, because the
   client then tries to *adopt* them: it walks its component tree against
   placeholder `<div>`s, cannot reconcile, and the page can end up rendering
   nothing at all. Phase 1 always works.

## What each template does, and why

**`minimal` is Phase 2.** Its page shell is literal JSX inside the `mount()`
callback — no component tags — so `npm run build:ssr` emits real IR and the
server sends real markup. Its `main.rs` loads the IR modules *and* passes slot
data; `render_page` falls straight back to Phase 1 unless both are present.

- Verified by: `tests/templates.test.ts` > "keeps its SSR root as literal JSX inside the mount callback"
- Verified by: `tests/templates.test.ts` > "loads IR modules and passes slots, so Phase 2 is reachable"
- Verified by: `tests/scaffold.test.ts` (scaffold E2E) — the built server must serve real server-rendered markup after `build:ssr`

**`dashboard` is Phase 1, deliberately.** Every one of its pages renders data
fetched at runtime from its own `/api/*` routes — `.map()` over a fetched
array, components handed a non-literal prop — and that is the shape no
source-walking compiler can prove. (It is *not* simply "it uses components":
component resolution is fixed in the unreleased compiler and the dashboard is
still 2/16 under Phase 2. The measurement is below.) Its `main.rs` asks for
`Phase1ClientMount`
explicitly, its `build.ts` has no `ssr` flag, and there is no `build:ssr`
script to reach for by mistake. It still installs a `tracing` subscriber, so if
you wire SSR up yourself, `forma-server`'s "falling back to Phase 1" warnings
reach your terminal instead of disappearing.

- Verified by: `tests/templates.test.ts` > "does not configure SSR, and offers no build:ssr script to reach for"
- Verified by: `tests/templates.test.ts` > "asks for Phase 1 explicitly instead of computing a mode it discards"
- Verified by: `tests/templates.test.ts` > "installs a tracing subscriber so forma-server fallbacks are visible"

The measured consequence of turning SSR on for the dashboard — how many bytes
of IR it emits and how many of its Playwright tests then fail — is recorded in
[`templates/dashboard/README.md`](../templates/dashboard/README.md), next to
the decision it justifies. It was measured against the template as shipped;
treat it as a dated measurement, not a constant.

## This rule is version-bound. Check it before you repeat it.

The templates install **published** versions, the ones each template's
lockfile names (`@getforma/compiler` 0.3.5 and `@getforma/build` 0.2.0 as of
2026-10-14), so what a scaffolded project gets is what was published and
locked — not whatever is in the `forma-tools` working tree.

That matters right now, because a large batch of resolver fixes sits in
`forma-tools`' `[Unreleased]` and **is not on npm**. Until it publishes, a
scaffolded app behaves as described above.

What changes when it does publish:

- `h(Card, …)` — what JSX `<Card/>` compiles to — was an **anonymous** island
  the client registry could never hydrate. It is now *inlined* when the
  compiler can resolve and follow it, and an island under its **real name**
  when it cannot, with call-site literal props substituted into the inlined
  body.
- The compiler could not resolve a component out of a `.tsx` file **at all**.
  esbuild rewrites every `export function Card()` into `export { Card }`, and
  the analyzer read only declaration exports — so an SSR root page written in
  JSX produced *placeholder* IR (an empty `<div id="app">`) and every `.tsx`
  island silently lost its named signal slots and their SSR defaults. Export
  specifiers, aliases, `export default` and `index.ts` barrels now all resolve;
  the forms that still do not warn with the file, the construct, and the
  consequence.
- A component imported by a **page** file rather than by the entry point was
  invisible, because one import map was built from the entry and never rebased.
- An inline-mount entry (`mount(() => { … })`) got **zero** named signal slots,
  so nothing on such a page could be injected by name.

### Re-measured on the dashboard against the fixed compiler — 2026-08-06

Fixing all of that is necessary for Phase 2 and **not sufficient**, which is the
point worth carrying away. Scaffolded fresh, pointed at the local fixed
compiler via `file:` dependencies, built with `ssr: true`, and run against the
template's own 16 Playwright tests:

| | Before the fix (forma-tools HEAD) | After the fix |
|---|---|---|
| IR emitted | 12868 B | 14856 B |
| Slots named after a signal | 0 of 63 | 3 of 90 |
| Islands | 48 | 64 |
| …carrying a real component name | few | 27 (`Icon` ×15, `StatCard` ×4, `ProgressBar` ×3, `StatusBadge` ×2, `UserAvatar`, `RequestVolumeChart`, `formatDuration`) |
| …still anonymous `island_<n>` | most | 37 |
| Playwright, Phase 2 | 2 of 16 pass | **2 of 16 pass** |
| Playwright, Phase 1 | 16 of 16 pass | 16 of 16 pass |

The server-rendered chrome is real now — sidebar, top bar, buttons, layout all
arrive as markup instead of an empty div. The page *content* does not, and that
is not a resolver problem: this dashboard's every page body is a `.map()` over
data fetched at runtime from `/api/*`, or a component handed a non-literal prop
(`<StatCard value={m.value}/>`, `<StatusBadge status={d.status}/>`,
`<Icon d={ICON_SEARCH}/>`). The compiler walks source and cannot execute it, so
those stay islands — 37 of them anonymous, from `.map()` calls, bare `&&`
children, unwrapped identifier children and dynamic tags. The client cannot
adopt a DOM whose content is missing, so 14 tests still fail exactly as before.

**The dashboard therefore stays Phase 1.** An honest Phase 1 beats a Phase 2
that claims SSR it does not do.

So: when a new compiler publishes, re-measure before you re-tell this story.
The mechanism above (walks source, cannot execute it) is stable; the *set* of
constructs it can prove is not.

## Choosing for a new template

1. Keep the page shell provable — literal JSX in the entry, components inlined
   from relative imports with literal props — and take Phase 2.
2. Or accept Phase 1, say so in the template's README, and ask for it
   explicitly in `main.rs` rather than computing a mode you discard.
3. Never ship a template whose server claims Phase 2 while its build emits
   island shells. Build it, look at the emitted `.ir`, and read the compiler's
   warnings before you decide.
