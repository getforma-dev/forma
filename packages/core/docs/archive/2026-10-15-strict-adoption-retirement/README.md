# Strict adoption retirement originals

The archive contains 51 exact originals (the initial 41 pre-switch files plus nine state/activation suites and the original probe corpus), stored as `.txt` so test discovery cannot execute archived suites. `manifest.json` records their original Git commit, path, byte length and SHA-256. No archived expectation is silently treated as a passing control for the replacement.

The new public `hydrateIsland` keeps its signature and caller-owned cleanup, and uses the same strict planner as compiled activation. Matching initial DOM is retained without writes. Initial repair, fallback creation, old marker stripping and the legacy global hydration mode are retired. Later ordinary reactive updates remain supported. Direct callers receive no compiled setter authority.

`migration.json` tracks the remaining test, benchmark and documentation migration. Its pending entries are required work; source removal alone is not upgrade acceptance. New focused facade controls are in `src/dom/__tests__/hydrate-strict.test.ts`. The original precommit revocation failure found during this switch is preserved separately in the review work directory and must pass unchanged after correction.

The native case mapping in `browser-case-mapping.json` retains all 21 original cases and identifies the added readonly/literal boundary case. Independent validation and its limits are recorded per entry. The archive currently authenticates 1,092,243 bytes; 255 applicable probe definitions remain unchanged, while all 54 removed-implementation definitions are retained verbatim in the explicit retirement ledger. No new mutation score is claimed.
