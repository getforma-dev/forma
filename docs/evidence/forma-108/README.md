# FORMA-108 explicit runtime qualification

This record qualifies the explicit per-mount HTML runtime. It does not stand in for the final integrated release's R17, all-seven-package P17, CI or soak. No application repository was accessed.

The source migration removes tierless/automatic/global runtime entry points and exposes exactly nine runtime values. Every mount declares its tier; omitted grants deny DOM escape, network and navigation. Handles retain ownership of detached or moved scopes and dispose their bindings. Original A2 source and probe inventories remain byte-authenticated under `docs/archive/FORMA-108-A2-bridge/`.

## Source and environment

Core build/full-suite source was frozen at `a235733d9bee50f3494336fdec721d1a5532def9`. Later runtime changes only correct source comments/documentation; the production ownership/diagnostic repair remains `5586654841d46235b93b1ad853bfac6fb4899809`. Source and migration commits received independent lead review. Actual packed proof uses clean `6c3448d31807761106016c56c1c3b2ebc12aae78`; changed-probe qualification uses clean `3c3a48b2855160b0e4734a42b1d268861d3c58e9`.

All local gates use Node24.22.0, Vitest at most two workers and Playwright at most two workers. Runtime IIFE SHA-256 is `828ce6ac426cb7d4f996e8175ae8003014519aa431309e22dde4899543594259`; freshly packed `@getforma/core` tar SHA-256 is `8ebf5bf72b9a10636a5cb2e203d8882b852380547f43e8b287e7c884f05d553e`. Raw reports identify actual browser versions and harness/source hashes.

## Actual results and preserved first failures

- Core build and42-artifact verification pass. All five unchanged gzip caps pass: core48,063/48,294B; browser48,209/48,448B; runtime39,140/41,500B; frame38,618/40,000B; hardened37,596/40,500B.
- The full core invocation passed3,272/3,275 in32.94s. Its only failures were three stale documentation-truth assertions; the corrected documentation suite passed19/19 in623ms. Both the original failure and intermediate historical-citation failure remain archived. This is combined coverage, not a claim that the first invocation fully passed. Core typecheck passed at the recorded pre-reporter source; the later integrated Vite configuration still needs its own current-head type gate.
- Actual changed browser suites passed183/186 in33.7s across Chromium, Firefox and WebKit. The only failures were the old one-script count in the CSP fixture after explicit mounting introduced a second external application script. Corrected controls assert the actual response CSP header and both exact external URLs;3/3 passed across all engines in3.5s with the original behavior, errors and violation checks retained.
- The rebuilt frame sandbox/MessageChannel suite passed21/21 across all engines in14.9s, including opaque origin, disposal and zero unexpected connections.
- Fresh packed candidate runtime passed1,686 hostile cases,30 capability controls and9 explicit-mount controls in28.521434292s. Unauthorized executions, outside reads and requests remain zero; documented authority intentionally granted is measured separately. The actual removed-selector guard failed at the observer, and before/corrected controls passed. No checked-in old report was substituted for candidate execution.
- Current committed private expression source completed100,000 cases with seed1290300:87,148 admitted and12,852 correctly refused in both before/corrected runs. Removing the real Array.from cost row failed at case37, charged0 against independent floor42. Source and worker hashes and actual mutant bytes are recorded. No generated no-throw-only test counts as equivalence proof.
- All17 changed/new runtime mutations failed through their named intended assertions; before/corrected each passed15 selected real tests. The actual complete run took16.483265583s, all19 run-level unhandled-error collections were empty, and restored runtime source SHA-256 was verified byte-exact. The original attempt stopped after eight kills because the ninth standard JSON assertion was truncated. That refusal and all raw outputs are preserved under `docs/archive/FORMA-108-mutation-reporting/`. The corrected reporter preserves full assertion text and records actual unhandled errors; it does not weaken assertion signatures.

Current corpus totals252 probes, including147 security probes; all260 original A2 probes and historical93 provenance are authenticated. Fourteen removed-API probes are retired individually and never count as current kills. Three unchanged nested-owner defense controls have no new execution claim. The complete nightly probe campaign and final integrated release gates are separate from this bounded17-control qualification.

## Timing

The unchanged migrated L50 helper is measured separately with five runs at4x CPU throttling for F1–F5, S6 and O3. The context-dependent Greek search residual remains an explicit limitation; this record does not assert a universal50ms task guarantee. The one isolated execution on Apple M1 Pro/Chromium151.0.7922.34 measured these worst-task milliseconds:

| Case | Median | Maximum | Runs at least50ms |
| --- | ---: | ---: | ---: |
| F1 ten bindings |8.8|18.7|0/5|
| F2 twenty bindings |9.9|11.8|0/5|
| F3 mixed sizes |9.5|11.8|0/5|
| F4 400 over-cap bindings |11.4|11.7|0/5|
| F5 400 under-cap bindings |13.8|14.7|0/5|
| S6 reduction,1,150 names |1.9|8.7|0/5|
| O3 Greek search,9,000 records |50.4|60.7|3/5|

O3 rendered900 results and remains a real slow-search residual, not a passed50ms gate. Source stayed clean at3c and runtime hashes matched before/after. `l50-current.log` and metadata preserve the actual machine/load, browser, output, source and harness hash. Historical measurements retain their original classification; this single current run does not replace them.

## Evidence integrity

`manifest.json` authenticates every raw file below this directory. Original failing invocations remain alongside corrected evidence; no original source, report or timing is overwritten. The packed-core adapter proof here is not the all-seven-package P17 release result, which must execute again on the final candidate.
