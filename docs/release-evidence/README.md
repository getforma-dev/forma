# FORMA-187 non-publishing evidence

The A2 report tests the exact seven previously published archives retained by
FORMA-113 in `tmp/a2-tarballs`, `tmp/a2-crates` and the founder-published derive
0.0.0 archive. The accompanying manifest names their hashes. `commit` identifies
merged rehearsal baseline 72c2804, not a claim that the seven old registry archives
were published from one commit. The strengthened P17 implementation is in this PR.

The run passed in 29.561 seconds: fresh advisory checks over each crate's embedded
lock (internal DS11 path substitutions only), packed compiler's 14-case corpus,
packed reader's nine contract tests, both templates' locked script-disabled npm
installs, registry signatures, frontend/Rust builds, served pages and browser
interaction, plus corrupt IR refusal before binding. P17 records the original and
substituted lock hashes. No artifact was published or tagged.

Live publication is disabled by release-contracts.json until future contract
owners add their required tests. This dry run cannot establish a future milestone's
manifest/version-window/props guarantees or G6's hosted release timing.

The combined113+117+187 checkout passed `npm run check` in 172 seconds
(145 Chromium checks included), 27 seeded SR13/SR43 workflow violations,
11 release-helper tests and 21 artifact-integrity cases. Actionlint and the 117
source policy also passed. Local logs remain in `work/FORMA-187/tmp/`.

The separate current-source candidate at `bd01d9de517183788dee693f271116d99342e474` also passed P17 in
29.18 seconds after the 117 integration, including shipped `_npmrc`
files and all three embedded-lock advisory checks. Its archives differ from historical
A2 by design; `current-source-set.json` records the new candidate hashes.

Both final replays check the actual `data-forma-status` marker and inject a real
pending DOM island to prove the gate rejects it before cleanup. Browser failures
fail immediately; only the initial HTTP readiness request is retried.

## Independent review and corrected replay

The original current-source P17 report above is **superseded and invalid as
acceptance evidence**. Its same-version 0.2.2 rebuild puts a published-registry IR
checksum inside the server crate, which differs from the newly packed DS11 IR
archive. The earlier local adapter silently repaired that mismatch. The original
JSON is retained for traceability; `current-source-replay-status.json` records
the correction. Do not relax checksum validation or publish rebuilt old versions.

The stricter verifier passes the exact published A2 set in 33.558 seconds
(`a2-published-p17-after-review.json`). It rejects both independently prepared
negative controls: a shipped template with a wrong npm checksum,
and a packed CLI missing its runtime dependency. The CLI now installs outside the
checkout using only its own declared runtime dependencies and the recorded lock
graph. Internal npm and Cargo lock fields are validated before local substitution.

A fresh unpublished two-crate fixture proves the dependent packed Cargo.lock
checksum equals the newly packed predecessor's SHA-256. This relationship is now
a release-helper regression assertion. Fresh-version rehearsals are distinct from
rebuilding already published A2 versions.

The release workflow also gates P17/publication on Chromium, Firefox and WebKit.
Development, alpha and stable version preparation pass the internal dependency
guard; changelog extraction retains the complete exact-version body in both the
GitHub notes and JSON record. The combined helper suite passes 18 tests, the
workflow lint rejects 32 seeded violations, and the dependency guard passes 12
cases. Live publication remains disabled.

After integrating the reviewed corrections and the server fixture port fix, the
full repository gate passed in 127 seconds. Generated browser bundles were saved
in local evidence and restored; they are reproducible test outputs, not source
changes for this release-workflow PR. Final-head hosted CI is checked separately.
