# Client-side routing research

Research snapshot: **October 26, 2026**. This project investigates Angular Router,
Astro routing/ClientRouter, and React Router through official documentation,
pinned source, shipped assets analyzed with REA, and focused browser experiments.
It includes a reconstruction blueprint and original executable examples.

## Read this first

1. [Comparison and principal findings](COMPARISON.md) — which model each system
   uses, what the actual docs sites do, and the common mechanisms.
2. [Rebuild blueprint](REBUILD-BLUEPRINT.md) — interfaces, transaction rules,
   lifecycle/history/data decisions, staged implementation and acceptance tests.
3. [Forma implications](FORMA-IMPLICATIONS.md) — the existing portal navigator,
   options for a browser router, and the additional native-island contracts.
4. [Methods and evidence limits](METHODS.md) — provenance, source/REA/browser
   distinctions, reproduction, retained failures and untested areas.

## Framework studies

| Study | Pinned implementation | Report and questions |
| --- | --- | --- |
| Angular | `angular/angular` at `ecaec13db4fde7ceb0104105ee356bf00596f3d6`; site footer v22.2.3+sha-ecaec13 | [Report](research/angular/report.md), [25 questions](research/angular/questions.md), [source index](research/angular/source-index.md), [snippets](research/angular/snippets/) |
| Astro | `astro@7.2.10` at `2fdf731428aa738d5dcf3041b4e78eb9d036968c`; separate docs and Starlight snapshots | [Report](research/astro/report.md), [40 questions](research/astro/questions.md), [sources](research/astro/sources.json), [snippets](research/astro/snippets/) |
| React Router | `react-router@8.5.0` at `4fe4525102870a2b21a4a0568a651d118f5e5dbb`; separate website snapshot | [Report](research/react-router/report.md), [40 questions](research/react-router/questions.md), [sources](research/react-router/sources.json), [snippets](research/react-router/snippets/) |

The ledgers answer 105 framework-specific questions with evidence and explicitly
identify residual uncertainty. The [shared question plan](QUESTIONS.md) covers
the cross-system questions. A source revision, a package version and a live
deployment identity are distinguished throughout.

## Findings that change a reconstruction

- Angular and React Router are fundamentally route/component-tree systems.
  Their documentation apps can display fetched article HTML inside that system.
- Astro ClientRouter is an optional fetched-document navigator with explicit
  head/body/script/persistence and island lifecycle behavior. The **sampled
  Astro documentation link did not enable that router**; it loaded a new document.
- The Angular docs sample used the Navigation API. React Router's sample used
  History calls and a `.data` request. All three selected links worked without JS.
- Correctness depends on navigation ownership and lifecycle, not only URL
  matching or AbortController. POP, stale work, resource disposal, script policy,
  scroll/focus and deployment compatibility each need a contract.
- REA's graphs did not recover complete application route tables. Pinned source,
  inert build manifests, and observed behavior supplied the missing evidence.

These conclusions are developed and cited in the reports; the root comparison
links the precise saved observations rather than treating a site's framework
name as proof of its runtime behavior.

## Run the original examples

Node 22+ runs the pure tests and local demo without an install:

```sh
npm test
npm run demo
```

Open `http://127.0.0.1:4199/demo`. Use `PORT=0 npm run demo` if that port is in
use. [Reference implementation guide](reference-router/README.md) documents the
small API, non-reentrant commit policy, tested invariants and deliberate limits.

For reproducible browser runs, install the pinned harness and an engine only
when needed:

```sh
npm ci --ignore-scripts
npx playwright install chromium
node scripts/run-browser.mjs --reference http://127.0.0.1:4199 \
  --output .local/reference-browser-rerun.json
node scripts/run-browser.mjs --probe angular --output .local/angular-rerun.json
node scripts/run-browser.mjs --probe astro --output .local/astro-rerun.json
node scripts/run-browser.mjs --probe react-router --output .local/react-router-rerun.json
```

The CLI can instead use an existing compatible installation through
`RESEARCH_PLAYWRIGHT_MODULE=/absolute/path/to/playwright`. Browser results saved
here were produced using existing tooling; upstream frameworks were not built
or installed. Public probe reruns are fresh observations, not reproductions of
historical website bytes. `--browser firefox|webkit` supports future checks;
those engines were not qualified in this study.

## REA and evidence

The shared REA 6.8.0 command is `rea`. [The local setup guide](/Users/victorvillacis/dev/tools/REA-SETUP.md)
describes its isolated runtime. [METHODS.md](METHODS.md) explains bounded runs.
Use `scripts/run_rea.py` for a new uniquely named analysis and inspect the exact
input/source selections in existing receipts before repeating it.

- [Shared evidence index](evidence/index.json): REA receipts, input/output hashes,
  browser observations and local-link validation.
- [Reference browser checks](evidence/reference-browser.json): actual DOM,
  history, cancellation, scroll, fallback and no-JS assertions.
- `.local/`: pinned checkouts, captured HTML/JS, full REA graphs and retained
  failures. **This directory is kept locally but ignored by Git.** Preserve it
  with the project if you need the complete evidence archive.
- Each study retains its license notices, attributed excerpts, provenance and
  validation scope. Private Forma source remains under `.local/forma-site`.

Run `npm run check:evidence` to recheck saved bytes and local report links.
The [validation record](VALIDATION.md) distinguishes the checks, review fixes and
remaining limits.
The project is a local Git repository with no remote configured. No application,
framework release, production server or DNS configuration was changed.
