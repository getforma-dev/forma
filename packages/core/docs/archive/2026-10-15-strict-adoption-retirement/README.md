# Strict adoption retirement originals

These 41 files are the exact pre-switch originals, stored as `.txt` so test discovery cannot execute archived suites. `manifest.json` records their original Git commit, path, byte length and SHA-256. No archived expectation is silently treated as a passing control for the replacement.

The new public `hydrateIsland` keeps its signature and caller-owned cleanup, and uses the same strict planner as compiled activation. Matching initial DOM is retained without writes. Initial repair, fallback creation, old marker stripping and the legacy global hydration mode are retired. Later ordinary reactive updates remain supported. Direct callers receive no compiled setter authority.

`migration.json` tracks the remaining test, benchmark and documentation migration. Its pending entries are required work; source removal alone is not upgrade acceptance. New focused facade controls are in `src/dom/__tests__/hydrate-strict.test.ts`. The original precommit revocation failure found during this switch is preserved separately in the review work directory and must pass unchanged after correction.
