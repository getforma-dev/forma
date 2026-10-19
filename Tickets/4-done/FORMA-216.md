# FORMA-216: Reconcile final-version documentation before publication

Status: Done. Merged in PR112 after independent review and exact-head green CI; merged-main CI also passed.
Repository: getforma-dev/forma only. Found in PR112 source b58bc9b3.

## Evidence and root cause

CI39052507411 failed check, Node22 and Node24 with the same four docs-truth assertions: stale rc.1 registry pins, missing 3.0.0 changelog heading, CSP history ending at2.1.0 and no3.0.x support row. This regression came from final-version preparation updating manifests without its related documentation. It is not evidence of a runtime failure. Source b58 security probes39052507419 and both packed scaffold platforms passed.

## Fix and verification

Align root/core README version wording, move prepared changes under a3.0.0 changelog heading, and add explicitly unpublished candidate CSP/support rows. Keep historical2.1.0CDN pins and support intact. No false release date, no test weakening, no gate changes.

Existing docs-truth suite:20/20 PASS with pinned Vitest4.1.12, --maxWorkers=2,658ms. Log:work/codex-release-lead/FINAL-DOCS-REGRESSION-TEST.log. Original hosted failure retained inCI-b58bc9b3-failed.log. An initial npm-exec invocation found no checkout dependencies and failed before tests; npmci installed locked dependencies and the actual passing run used the pinned version. No repository dependency files changed.

## Next

Inspect the new exact-head Actions result once it completes; independent review before merge. No new performance campaign or publisher dispatched. Whole-release audit, active soak and implementation of quota deferrals remain Thursday work. GitHubLatest is stable server-v0.2.2;beta.4is separately published as a prerelease.

## Log

- 2026-10-17T17:39:02.919986+00:00: Founder explicitly resumed bounded work with8%quota. Root diagnosed, corrected and locally verified; saving all work before relying on hosted checks.

- Follow-through: remaining coordinated changelogs now have prepared final entries; actual parser8/8 and release-record tests11/11 pass. Publication pending remains explicit. Final pushed CI/review pending.

- 2026-10-19: Closed after PR112 merge ee7e5751 and successful exact-main CI39056716276. Source integration and applicable checks completed; original source review/negative controls retained. This closure does not claim whole-release audit, soak or final publication.
