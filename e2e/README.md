# FormaJS Full-Stack E2E Tests

Browser-level verification of the entire Forma pipeline. Tests run in a real Chromium browser via Playwright. Fixtures are **auto-synced** from the FormaJS build — no manual copying.

## What's Tested

| Test Group | Tests | What It Verifies |
|------------|-------|-----------------|
| **HTML Runtime** | 8 | data-text, data-on:click, data-model, data-show, data-class, data-computed, $refs |
| **Programmatic h() API** | 2 | createSignal + h() + mount() renders DOM, signals update reactively |
| **Reviewed template path** | 3 | template(trustedHtml()) + cloneNode() creates working DOM with reactive effects |
| **Cross-cutting** | 2 | No console errors on page load, all three approaches coexist |

## The SSR lane: compiler, forma walker, FormaJS (`e2e/ssr/`)

`e2e/full-stack.spec.ts` exercises FormaJS alone. `e2e/ssr/regressions.spec.ts`
exercises the whole Phase 2 chain, one page per case in `e2e/ssr/cases/`:

1. `e2e/ssr/build-cases.mjs` builds each case with `@getforma/build` (`ssr: true`)
   from this working tree, its one `app.tsx` declared twice as an application
   declares a page in both modes: route `/` server-rendered, and route `/csr`
   an explicit Browser route (`ssr: false`). It fails unless the served `.ir` is
   byte-identical to what `generateRealIr` emits (no silent placeholder), the
   islands are the ones the case declares, a page with islands ships exactly
   its own script and a page with none ships no script.
2. `e2e/ssr/render/` (Rust) renders each page with forma's real walker and page
   template through the typed Pages API: `index.html` (Phase 2, props from the
   case's `slots.json`) and `csr.html` (Phase 1, the `/csr` route's shell, which
   the entry's `mount()` fills from an empty `#app`), each with the response
   headers the server produced.
3. `e2e/ssr/serve.mjs` serves them on port 3458 with those headers (the page's
   own CSP nonce), and Playwright reads the parsed DOM, live control values and
   `FormData` before JavaScript, after activation and after interaction.

The cases are the Forma Stack audit's verified failures (FORMA-001). Each one
that fails today is written as the behaviour v2 requires: the test asserts its
case's preconditions normally, then calls `test.fail()`, with a comment naming
the ticket whose fix flips it, just before the defect assertion. A broken
precondition is therefore a real failure; only the named defect is expected.
When the fix lands, Playwright reports an unexpected pass and the job goes red
until that line is removed. `ledger-arrival` is the positive fixture: Ledger's
pattern of seeding an island's signals from its props before the component runs.

Since 3.0.0 (FORMA-105, DR-6) every entry has the one shape the compiler
accepts (`BUILD-611`, [`docs/DIAGNOSTICS.md`](../docs/DIAGNOSTICS.md)): a
standalone literal `activateIslands({ ... })` and a standalone top-level
`mount()`. The compiler selects the page through the mount and removes it from
the `/` route's browser product, which activates the registered islands alone;
a page with no island loads no JavaScript. `mount()` no longer adopts a
server-marked root (`FORMA_E_MOUNT_SSR`), so each case's interactive subtree is
an island seeded from declared props, and `root-fragment` is a static page. The
`/csr` build of the same entry keeps the mount. Activation is observed as core
documents it ([`ISLANDS.md`](../packages/core/docs/ISLANDS.md), "Strict
activation"): a successful island makes no DOM write, so `data-forma-status`
stays `pending`; the spec waits for the module to run, requires no host in
`error` and no `forma:error` event; that row cannot tell a silent no-op from
success, so each behaviour test exercises the island through a reactive reader
(a text the island's signal drives, or a control it updates). The lane's pre-3.0.0 shape is kept under
[`docs/archive/2026-10-15-islands-only-e2e/`](../docs/archive/2026-10-15-islands-only-e2e/).

| Case | What it pins | Today |
|------|--------------|-------|
| `generic-state` | the server value 7 survives activation of the `Counter` island, and it counts on | passes (FORMA-103) |
| `root-fragment` | a page with no island: the walker renders a root JSX Fragment's children; no script is served and the button is inert (DR-6); client-rendered, the button works | passes |
| `textarea-child`, `title` | no marker text before JavaScript (FORMA-002); live text after the island activates | passes |
| `textarea-value` | value before JavaScript (FORMA-002); live value after activation and client-rendered (FORMA-003) | passes |
| `select` | `b` selected and submitted before JavaScript (FORMA-002), after activation and client-rendered (FORMA-003) | passes |
| `edited-controls` | text, checkbox and option edited before the island activates survive it (DR-5, FORMA-104) | passes |
| `ledger-arrival` | seeded values survive activation; Retry runs | passes |
| `browser-only` | a `browserOnly()` component: the server sends its empty host with its declared props, the browser renders it there and it works; client-rendered it renders as any component (FORMA-119) | passes |

The table "every case is server-rendered and activates" adds the shared
controls for every case: the walker's HTML; island activation, or for a static
page no script referenced or requested; the Phase 1 mount; and no console
error.

The SSR server listens on port 3458, or on `FORMA_SSR_E2E_PORT` when set.
Playwright reuses a server already on that port, which may be another clone's,
so the spec first asks `/__site` which site it serves and refuses to run
unless it is this clone's `e2e/ssr/out/site`, built. The FormaJS-only spec,
`e2e/full-stack.spec.ts`, runs without the SSR site.

## The preview-frame lane: packed core, this build, forma-server (`e2e/frame/`)

`e2e/frame/frame.spec.ts` checks the chain `previewFrame` exists for
(FORMA-175, with FORMA-125's `PageResponse::frame` and FORMA-128's frame
runtime):

1. `e2e/frame/build.sh` packs `@getforma/core` from the FormaJS checkout
   (`npm pack`, so the package's `files` decide what an application gets),
   installs core's dependencies into the fixture application `e2e/frame/app`
   from its lockfile (`npm ci`), then the tarball itself, saved nowhere (a
   lockfile entry for a local tarball lets `npm ci` install a cached copy of
   an earlier core under the same integrity), and builds it with THIS repo's
   `@getforma/build`
   (`e2e/frame/build-app.mjs`): `out/dist-on` with `previewFrame: true`,
   `out/dist-off` without it, and `out/dist-tampered`, dist-on with a
   `</script>` appended to its runtime. The script fails unless the build's
   `forma-runtime.<hash>.js` is core's `dist/formajs-frame.global.js` byte for
   byte, and never core's `dist/forma-runtime.js`.
2. `e2e/frame/server/` (Rust) is a small forma-server application from a
   forma checkout that embeds the three outputs at compile time and, at start,
   calls `PreviewFrame::load` on each as an application does; it serves the
   frame (`PageResponse::frame` from dist-on) and a host page that frames it
   as forma-server's `frame` module docs prescribe.
3. The spec starts the server on a free port (so clones never meet) and checks
   that forma-server accepts dist-on's runtime and hashes core's bytes; that in
   Chromium, under the frame's hash-only policy, the runtime answers `ready`
   and mounts a module sent over the port, in tier (c), with an opaque origin
   and no CSP violation; that dist-off is refused with FRAME-101 and
   dist-tampered with FRAME-103; and that a core whose runtime holds the same
   tampered bytes fails the build with BUILD-806.

The spec fails, naming `build.sh`, when the lane is not built; running
`e2e/full-stack.spec.ts` alone does not need it.

## How to Run

### Locally (auto-syncs FormaJS build)

```bash
npm run test:e2e
```

This automatically:
1. Builds FormaJS from the sibling `../formajs/` directory
2. Copies `formajs-runtime.global.js` and bundles the shipped `forma.esm.js` as
   the `formajs.global.js` IIFE fixture
3. Builds the SSR site (`e2e/ssr/build.sh`: this repo's packages, the cases, and
   the Rust renderer against the sibling `../forma/`; needs cargo)
4. Builds the preview-frame lane (`e2e/frame/build.sh`: core packed from
   `../formajs/`, the fixture application, and the frame server against the
   sibling `../forma/`; needs cargo)
5. Starts the static server on port 3457 and the SSR server on port 3458 (the
   frame spec starts its own server on a free port)
6. Runs the Playwright tests in headless Chromium

The two FormaJS bundles in `e2e/fixtures/` exist only after step 2; git does
not track them. Until 2026-10-15 it did, and the tracked copies predated
`trustedHtml()` (FORMA-126), so `npx playwright test` run without the sync, or
after a `git checkout -- e2e/fixtures`, failed the five template and
cross-cutting cases with `trustedHtml is not a function` while a fresh sync
passed them all. `full-stack.spec.ts` now refuses to run without the bundles
and names the sync script.

### Custom FormaJS or forma path, or another SSR port

```bash
FORMAJS_DIR=/path/to/formajs FORMA_DIR=/path/to/forma npm run test:e2e
FORMA_SSR_E2E_PORT=3468 npm run test:e2e    # e.g. a second clone on the same machine
```

### In CI

The GitHub Actions CI workflow runs E2E automatically on every push to main and every pull request — clones formajs and forma from GitHub at their default branches, builds FormaJS, copies fixtures, builds the SSR site, runs Playwright. On failure, the report is uploaded as an artifact.

## When to Run

- After updating `@getforma/core`
- After updating `@getforma/compiler`
- After changing HTML Runtime directives or magic variables
- After upgrading alien-signals
- Before every release

## File Structure

```
e2e/
├── fixtures/
│   ├── full-stack.html              ← Test page with all three entry points
│   ├── formajs-runtime.global.js    ← Written by sync-fixtures.sh; not tracked (a committed copy is only ever stale)
│   ├── formajs.global.js            ← Written by sync-fixtures.sh; not tracked
│   └── compiled-counter.js          ← Reviewed template/clone reference (the old JSX transform is retired)
├── full-stack.spec.ts               ← 16 Playwright tests (one guards the synced bundles)
├── sync-fixtures.sh                 ← Builds FormaJS and copies dist files
├── ssr/
│   ├── cases/<case>/app.tsx         ← One page per case (+ slots.json)
│   ├── build.sh                     ← Builds the SSR site (FORMAJS_DIR, FORMA_DIR)
│   ├── build-cases.mjs              ← @getforma/build per case, real-IR check
│   ├── render/                      ← Rust: forma_server::render_page per case
│   ├── serve.mjs                    ← Serves out/site with each page's headers
│   ├── origin.ts                    ← The SSR port (FORMA_SSR_E2E_PORT, default 3458)
│   └── regressions.spec.ts          ← The SSR regression fixtures
├── frame/
│   ├── app/                         ← The fixture application (its lockfile pins core's dependencies; core from the packed tarball)
│   ├── build.sh                     ← Builds the lane (FORMAJS_DIR, FORMA_DIR)
│   ├── build-app.mjs                ← @getforma/build with and without previewFrame
│   ├── server/                      ← Rust: forma-server's PreviewFrame::load and PageResponse::frame
│   └── frame.spec.ts                ← The preview frame in Chromium
└── README.md                        ← This file
```

## Adding Tests

1. Add HTML to `fixtures/full-stack.html` with unique IDs
2. Add a `test()` block in `full-stack.spec.ts`
3. Run `npm run test:e2e` to verify

## Troubleshooting

| Error | Fix |
|-------|-----|
| "FormaJS directory not found" | `FORMAJS_DIR=~/path/to/formajs npm run test:e2e` |
| "Cannot find module serve" | `npm install` |
| "Browser not found" | `npx playwright install chromium` |
| "FORMA_DIR not found" | `FORMA_DIR=~/path/to/forma npm run test:e2e` (a getforma-dev/forma checkout) |
| "the SSR site is not built" | `bash e2e/ssr/build.sh` (or `npm run test:e2e`, which runs it) |
| "serves another clone's site" | stop that clone's server, or `FORMA_SSR_E2E_PORT=<free port>` |
| "the lock file needs to be updated" (cargo) | forma's crates changed dependencies: `cargo build --manifest-path e2e/ssr/render/Cargo.toml` once, commit `e2e/ssr/render/Cargo.lock` |
| "the preview-frame lane is not built" | `bash e2e/frame/build.sh` (or `npm run test:e2e`, which runs it) |
| "formajs-frame.global.js not found" | FORMAJS_DIR must be a FormaJS checkout with FORMA-128's frame runtime, built |
| "@getforma/core depends on …, which e2e/frame/app/package-lock.json does not pin" | core gained or moved a dependency: add it to `e2e/frame/app/package.json`, run `npm install --package-lock-only` there, commit both |
| "the lock file needs to be updated" (cargo, frame lane) | `cargo build --manifest-path e2e/frame/server/Cargo.toml` once, commit `e2e/frame/server/Cargo.lock` |

## The fixture applications (`e2e/fixtures/apps/`)

Three consumer-shaped applications (a household finance page, an authentication service's pages, a
controller studio's check screen), each built in strict mode and served by forma-server through a
`#[derive(PageProps)]` handler bound at start (FORMA-188). `e2e/fixtures/apps/build.sh` builds them from
this working tree; `apps.spec.ts` starts each server and checks the values, strict adoption and
behaviour of every page. P17 runs the same sources against the packed set. See
[`fixtures/apps/README.md`](fixtures/apps/README.md).
