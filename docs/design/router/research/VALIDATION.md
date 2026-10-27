# Validation record

Completed on 2026-10-26. This document describes the checks actually performed,
with evidence retained in this project. It is not an upstream framework release
qualification or a production Forma acceptance report.

| Check | Outcome | Evidence |
| --- | --- | --- |
| Original reference kernel | 13 passing tests | [Combined TAP](evidence/reference-node.tap), [test source](reference-router/kernel.test.mjs) |
| Original React Router-inspired concurrency example | 4 passing tests | Same combined TAP; [example](research/react-router/snippets/README.md) |
| Reference browser adapter | 10 passing scenarios in Chromium 155.0.8059.85 | [Browser record](evidence/reference-browser.json) |
| Portable browser CLI wrapper | Same 10 scenarios passed in Chromium 156.0.8078.4 using an existing Playwright installation | [CLI record](evidence/reference-cli-browser.json) |
| Public docs interactions | Selected click/Back with JS on/off for all three sites; current records have no probe failure | [Shared index](evidence/index.json) |
| REA campaigns | 7 runs retained: 6 exit successfully, 1 provider timeout with partial evidence | Shared index and full `.local/rea` receipts |
| Successful REA parsing | 16 selected JavaScript files parsed across successful runs, zero syntax parse failures there | Per-run statistics; graph completeness is separately limited |
| Shared integrity | Every recorded input/output digest and local Markdown target passes | `npm run check:evidence`, shared index |
| Per-study provenance | Source/assets/excerpts/line references checked within each study's recorded scope | [Angular](research/angular/validation.json), [React Router](research/react-router/validation.json), [Astro sources](research/astro/sources.json) |
| Helper syntax | Python compilation and JavaScript syntax checks passed | `scripts/run_rea.py`, `scripts/check_evidence.py`, `scripts/run-browser.mjs` |

## Independent review corrections

- Clarified that Angular candidate fallback involves `canMatch`; a failed
  activation/deactivation guard is not a request to try the next route.
- Corrected a browser probe that captured a React Router Back URL before its
  heading settled. The original record is retained, and the final probe waits
  for both the next heading and the original Back heading.
- Fixed an original-kernel cancellation gap between preparation resolution and
  its awaiting continuation. An exactly-once candidate lease and a reproducing
  microtask regression now cover it.
- Defined and enforced the example's synchronous, non-reentrant commit policy;
  nested navigate/cancel/dispose operations are refused. This is a scoped
  example contract, not a claim of full component lifecycle support.
- Restored the browser's previous scroll-restoration mode during explicit
  teardown. The browser check asserts this alongside active-owner cleanup.
- Used a null-prototype parameter dictionary and tested prototype-like names
  as ordinary parameter data. This final pure-matcher change was checked in
  Node; it did not require another complete browser campaign.

## Limits preserved

REA's successful runs can still have selected-source exclusions, semantic-node
truncation, alias bounds and unresolved relationships. The React Router entry
timeout is not a successful complete analysis. Astro's initial certificate
preflight failed before REA started and remains separately recorded.

The browser campaigns did not test Firefox/WebKit, every upstream route,
assistive technology, all lifecycle/failure combinations, or runtime performance.
No upstream test suite/build was run. The source reports and blueprint list
additional acceptance cases without claiming they passed.

The prototype server was temporary and is stopped after validation. No production
application, framework release, hosting configuration, DNS or live site was changed.
