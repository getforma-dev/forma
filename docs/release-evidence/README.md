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

## FMIR v3 development integration (FORMA-185)

The source set at `f7d99761ff6fe6e9e76528c09cfd8ced92ced914` packs all seven
`3.0.0-dev` artifacts without publishing. `v3-development-set.json` records their
hashes and the actual v3-development contract. The source templates retain A2 pins.

Three reports are preserved, all with `passed: false`:

- `v3-development-p17-initial.json`: packed crate advisories, isolated CLI install
  and the packed v3 corpus passed; npm signature audit then queried an unpublished
  exact internal dependency and failed with ETARGET.
- `v3-development-p17-projection-guard.json`: the audit-copy graph check caught
  candidate devDependencies becoming active workspace edges. Only that inactive
  development metadata is now omitted from candidate audit copies.
- `v3-development-p17.json`: the corrected verifier authenticated the three local
  candidate archives and audited all 24 installed minimal-template registry package
  locations, plus the packed CLI's three registry dependencies. It records their
  exact versions, locations, URLs and integrity values. The packed v3 writer triple,
  canonical dumps and all ten Rust corpus tests passed; the minimal frontend built.
  Cargo then correctly refused the A2 template requirements against v3 candidates
  with `--locked`. FORMA-144 owns that migration. Full template acceptance, browser
  interaction and corrupt-template-module checks are not claimed for this v3 run.

The final report uses the signature-projection verifier introduced by this change
to replay the already packed f7d9976 artifacts; it is not a claim that the artifact
source and verifier were the same revision. No source template file was changed.

The Codex lead independently ran the real npm signature verifier against a bounded
local HTTP registry. `v3-development-signature-control.json` records that the
unprojected unpublished candidate/peer edge fails, both external versions (root and
nested) are audited after projection, inactive candidate devDependencies are not
activated, and malformed ECDSA signatures still fail with EINTEGRITYSIGNATURE.
This integration control is deliberately outside the unit-test glob because npm
also initializes its TUF client. Reproduce it with Node24.22.0 on PATH:

```sh
node scripts/controls/release-signatures.mjs scripts/audit-release-signatures.mjs /absolute/path/to/control-result.json
```

Ordinary release-helper tests use injected audit responses only for structural and
error-propagation checks; the independent control above uses actual npm cryptographic
verification. Local logs and original reports remain in `work/FORMA-185/` and
`work/review-FORMA-185-production/signature-control/`. The prepublication gate remains
closed (`liveReleaseReady: false`).

## Manifest 2 and compatibility window (FORMA-112)

The distinct `v3-window-set.json` records seven unpublished3.0.0-dev artifacts
packed from `2da1837f6dd6efae6b561e91aca2b368d7c20e43`. The same revision's
verifier passed in39.996seconds (`v3-window-p17.json`), with19 recorded checks:

- Exact packed Cargo locks passed fresh advisory checks, and the packed CLI
  installed outside the checkout from its declared locked runtime closure.
- Registry signature auditing covered3 CLI,64 minimal-template and49 dashboard
  installed registry locations; unpublished candidate archives were authenticated
  by their pinned DS11 hashes. Nested locations are recorded explicitly.
- The packed compiler emitted the unchanged14-case corpus and canonical dumps;
  the packed reader's10 corpus tests passed with all42 binary/dump/HTML hashes
  unchanged and golden regeneration disabled.
- Both packed templates installed/build/served and completed browser interaction.
  Manifest2 app/writer/mode/aliases and final-uncompressed SHA-384 metadata passed.
- Corrupt IR and a valid newer-minor IR were refused before bind. Each template
  refused schema1, missingapp and a newer-minor manifest. Each enabled checked
  worker started for a matching app and refused a mismatched app, naming both.

`v3-window-template-restore.json` proves every source template manifest and lock
was restored byte-for-byte after packing. Staged Cargo requirements now match
candidate locks, and new npm runtime edges come only from the committed workspace
lock; existing external template resolutions remain unchanged. This is a packed
compatibility slice, not completion of FORMA-144's final template API migration.

The set/report `pending` field is the input state before this qualification run;
it still names112's final packed gate. After the recorded passing result, the live
source policy removes only that pending112 entry. All later contracts and
`liveReleaseReady: false` remain. Historical A2 and partial185 JSON is unchanged.
No tag, publication, user-application migration or live service change occurred.

The full local repository gate passed in164seconds at2c667d2. A subsequent
one-line BUILD-815 prefix and main37 ancestry merge passed30 focused build tests;
these are included in the2da1837 artifacts. Independent review found and the tests
caught two real regressions before correction: esbuild could remove the last
browser bundle after an invalid watch rebuild, and a dangling nearer Cargo.lock
link could be skipped for a favorable ancestor. Both now have failing-then-passing
controls, with split/non-split and valid-link/missing-file controls.

`v3-window-renderer-3.1.json` records the isolated production3.1.0-dev renderer
build accepting older/same/patch writers and refusing3.2 module/manifest writers
before OS binding; its Cargo lock hash stayed identical. The recurring command
is `node scripts/test-renderer-window.mjs`. The ordinary replay of the preserved
185 independent corpus passed140/140 with zero changed expectations; all input
hashes are in `v3-window-independent-probes.json`. No new fuzz/input-generation
experiment was performed. The67 frozen fixture bytes and original exact-stage
index remain preserved, with an explicit current-policy overlay accepting the
3.0.1 patch fixture.

Reproduce with the pinned build tools and scriptless workspace install:

```sh
npm run check
node scripts/release-set.mjs pack /absolute/owned/output --dry-run
node scripts/verify-release-set.mjs /absolute/owned/output /absolute/owned/p17.json
```

Local artifacts and logs are retained in `work/FORMA-112/ds11-window-1`,
`p17-window-1.log`, `full-check-112.log`, `renderer-3.1-final/` and
`independent-probes-replay/`. Exact-head hosted CI and independent review are
required separately before merging PR38.
