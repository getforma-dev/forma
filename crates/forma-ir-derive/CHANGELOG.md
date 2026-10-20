# Changelog

## [3.0.0-rc.5] - Prepared; publication pending

- Correct the synthetic packed-qualification prerelease fixture so it cannot inherit a final-only soak deferral. The real guard, runtime, qualification harness and thresholds are unchanged; the regression rejects the original inconsistent fixture and preserves rejection of unnormalized deferrals.
- Published RC.4 remains immutable and qualified. This successor carries the test repair through the existing exact-source audit and final-diff rules; final publication and the actual post-release active soak remain outstanding.
- Coordinate all seven package versions, dependency locks and scaffold source seeds. Require independent review, exact-source CI, packed qualification and trusted publication.

## [3.0.0-rc.4] - Prepared; publication pending

- Bound each background island-load callback to four direct queue entries as well as its existing 12 ms deadline. Preserve whole-island adoption, synchronous input promotion, cancellation and readiness; neither bound can preempt an expensive island or additional promoted work.
- Keep the strict 50 ms mobile-task and 500 ms response gates. RC.3 failed its tagged mobile campaign and remains unpublished and immutable; this candidate requires fresh packed qualification and independent audit before publication.
- Coordinate all seven package versions and source template seeds. The actual same-RC active soak remains outstanding after final publication under L-66-QUOTA.

## [3.0.0-rc.3] - Prepared; publication pending

- Coordinate the seven-package RC.3 set and template source seeds; published RC.2 remains unchanged.
- Correct synthetic release-test fixtures to reconstruct their declared milestone states without carrying live final-soak deferral metadata. Exercise both ordinary and deferred input snapshots; production gate validation remains strict and unchanged.
- Require independent review, exact-source CI and tagged packed qualification before trusted publication. Final publication and the actual post-release active soak remain outstanding.

## [3.0.0-rc.2] - Prepared; publication pending

- Coordinate the seven-package RC.2 set and template source seeds. RC.1 remains published and immutable; no runtime behavior changes in this preparation.
- Correct the release verifier's Actions archive request media type, with a regression test reproducing the observed HTTP 415. Release asset downloads keep their binary media type, and archive identity, provenance and size checks remain enforced.
- Require independent review, exact-source CI and the new tag's packed qualification before trusted publication. Actual post-release soak remains outstanding.

## [Unreleased]

Changes after the prepared 3.0.0-rc.4 set will be recorded here.

## [3.0.0-rc.1] - Prepared; publication pending

Prepared as part of the coordinated seven-package 3.0.0-rc.1 set, including the
changes below and the preceding 3.0 prereleases. This heading does not assert
publication; the release workflow and registry verification establish that.

## [3.0.0-alpha.2] - 2026-10-15

Supersedes `3.0.0-alpha.1`, whose tag never published (its release run stopped in P17, the verification harness, before any publish job: the packed build's optional compiler peer resolved through the unbuilt workspace instead of the packed set; nothing reached the registries). The harness now resolves packed libraries inside the packed set and proves it. Version only; the alpha.1 notes below stand.

## [3.0.0-alpha.1] - 2026-10-15

The first 3.0.0 pre-release (milestone M2), a Cargo pre-release version on crates.io that plain
requirements exclude. Part of the seven-package set 3.0.0-alpha.1 with `forma-ir`, `forma-server`
and the four npm packages; `forma-ir` depends on it at exactly this version. The `PageProps`
derive for named structs and unit enums (FORMA-102) is the crate's content; 0.0.0 was the
founder's placeholder of 2026-10-14 that let the crate's trusted publisher be registered (D2).
See the root CHANGELOG for the set and the pending gates.

## [0.0.0] - 2026-10-14

- Placeholder publication by the founder so the crate exists on crates.io with
  trusted-publishing-only on; no content (D2, L-39 as amended).
