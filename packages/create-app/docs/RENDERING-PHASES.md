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

1. **A page built out of component tags and JSX-returning helpers may compile
   to almost nothing.** If the compiler cannot follow the call, there is no
   markup to send.
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

**`dashboard` is Phase 1, deliberately.** It is built out of components and
helpers, which is the point of it as a showcase — and that is exactly the shape
the compiler cannot prove. Its `main.rs` asks for `Phase1ClientMount`
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

The templates install **published** versions
(`@getforma/compiler ^0.2.0`, `@getforma/build ^0.1.9`), so what a scaffolded
project gets is whatever npm has — not whatever is in the `forma-tools`
working tree.

That matters right now, because the compiler's treatment of component tags is
changing. Under 0.2.0, `h(Card, …)` — what JSX `<Card/>` compiles to — produces
an **anonymous** island that the client registry can never hydrate. Under the
changes currently in `forma-tools`' `[Unreleased]`, a component tag is
*inlined* when the compiler can resolve and follow it, and becomes an island
under its **real name** when it cannot, with call-site literal props
substituted into the inlined body.

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
