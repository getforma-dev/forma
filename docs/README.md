# Forma documentation

This directory is the documentation hub for the whole stack, not just for the
Rust crates. Four repos ship one product; the cross-cutting documents live here
so there is one copy of each and every repo links to it.

## Read in this order

| # | Document | What it answers | Read it when |
|---|---|---|---|
| 1 | [ARCHITECTURE.md](ARCHITECTURE.md) | What the stack is, how the pipeline fits together, and *why* each design decision was made | First. Before your first PR in any of the four repos |
| 2 | [TESTING.md](TESTING.md) | The eight rules a test must satisfy here, the `Verified by:` citation contract, and the reviewer's checklist | Before you write or review a test |
| 3 | [FMIR-FORMAT.md](FMIR-FORMAT.md) | The binary layout and the stability contract — which bytes are frozen forever | When you touch the emitter, the parser, or anything that byte-guards an `.ir` module |
| 4 | [archive/](archive/) | Material that has been retired, with what it was, when it went, and why | When something in a doc contradicts the code and you want to know what happened |

`ARCHITECTURE.md` is deliberately the long one. It separates **evidenced**
claims (which cite a file, a test or a CHANGELOG entry) from reconstructed
reasoning, which is tagged `[INFERENCE]` so a reader can tell a fact from a
plausible story. Correcting an inference is cheap; letting a guess harden into
folklore is not.

## The pipeline, in one line

```
TS/JSX  →  @getforma/compiler  →  FMIR (binary)  →  forma-ir walker (Rust)  →  HTML  →  @getforma/core adopts it in the browser
```

## Which repo holds what

| Repo | Ships | Its own docs |
|---|---|---|
| [`formajs`](https://github.com/getforma-dev/formajs) | `@getforma/core` — signals, `h()`, islands, hydration, the zero-build HTML runtime | `docs/` — API, islands, HTML runtime, performance, security audits |
| [`forma-tools`](https://github.com/getforma-dev/forma-tools) | `@getforma/compiler`, `@getforma/build` — TS/JSX → FMIR and the production build | `docs/`, plus a README per package |
| [`forma`](https://github.com/getforma-dev/forma) (this repo) | `forma-ir`, `forma-server` — FMIR parser, SSR walker, Axum middleware | this directory, plus a README per crate |
| [`create-forma-app`](https://github.com/getforma-dev/create-forma-app) | `@getforma/create-app` — the scaffolder and its templates | `docs/` — template anatomy, and which rendering phase to choose |

## House rules for documents in this stack

These are the rules that produced this restructure, and the ones that keep it
true.

1. **Every claim is traceable.** A documented behaviour cites the test that
   proves it, in the same convention the code uses:
   `Verified by: <repo-relative test path> > "<exact test name>"`. A claim that
   cannot be tested is written as mechanism or rationale, never as a guarantee.
2. **Numbers are re-measured, not copied.** Sizes, benchmarks, test counts and
   versions rot silently. If you move a number between documents, run the thing
   that produces it first, and say when it was measured and against what.
3. **Nothing is deleted, it is archived.** Superseded material moves to
   `docs/archive/` with an index entry saying what it was, when it was retired
   and why — so a reader who finds a stale claim in the wild can discover what
   replaced it.
4. **A README answers four questions and then delegates**: what is this, why
   does it exist, how do I start, where do I go next. Depth belongs in `docs/`.
   The reason is mechanical: a 35 KB README is not re-read, so its claims are
   never re-checked.

## Since the repository merge (2026-10-15, FORMA-113)

The four repositories above are one: `packages/core` (formajs),
`packages/compiler` and `packages/build` (forma-tools), `packages/create-app`
(create-forma-app) and `crates/`. Each package's own `docs/` came with it.
From forma-tools' documents, [DIAGNOSTICS.md](DIAGNOSTICS.md) (every build
diagnostic code, what it means for the page and its fix) and
[HANDOFF-imported-signal-defaults.md](HANDOFF-imported-signal-defaults.md) live
here; its repository-level documents are in [archive/](archive/). The table of
repositories above is history until the docs sweep that follows the merge.
