# FORMA-187 non-publishing evidence

The A2 report tests the exact seven previously published archives retained by
FORMA-113 in `tmp/a2-tarballs`, `tmp/a2-crates` and the founder-published derive
0.0.0 archive. The accompanying manifest names their hashes. `commit` identifies
merged rehearsal baseline 72c2804, not a claim that the seven old registry archives
were published from one commit. The strengthened P17 implementation is in this PR.

The run passed in 34.419 seconds: fresh advisory checks over each crate's embedded
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
34.736 seconds after the 117 integration, including shipped `_npmrc`
files and all three embedded-lock advisory checks. Its archives differ from historical
A2 by design; `current-source-set.json` records the new candidate hashes.
