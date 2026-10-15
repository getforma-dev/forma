# Changelog

## [Unreleased]

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
