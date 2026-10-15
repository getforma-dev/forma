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


## Declared page props and typed handles (FORMA-102)

The original qualification below is preserved for its source. The reload correction
and current acceptance are recorded in the subsequent section.

`v3-props-set.json` records seven unpublished 3.0.0-dev artifacts from
`7e5f0c966de04ab7c2b4b7d7b50ac467a037f30e`. The same source's verifier passed
in 50.501 seconds (`v3-props-p17.json`), including the new `declared-v1` props
contract. Every packed crate's actual Cargo.lock passed fresh advisories; the
isolated CLI, both locked templates, registry signatures, browser interaction,
manifest/worker checks and corrupt/newer module startup refusals passed.

The packed compiler emitted the three declared-props fixture modules byte-for-byte
as shipped by forma-server. Its six real native typed Pages tests executed:
name-based binding and two lists, branch values, request bounds, pre-listener bind
refusal, route selection, empty local lists and last-good reload with a matching
asset snapshot. The verifier refuses missing, ignored or failing tests, stale
fixture bytes and placeholder compiler output. The new IR→derive runtime edge and
its checksum-pinned external closure are added from the recorded candidate graph;
compatible existing template resolutions stay intact. Both packed templates
compiled with locked candidate dependencies. `v3-props-template-restore.json`
proves all ten source template manifests/locks/main files were restored exactly.

`v3-props-qualification.json` records the 131-second complete local gate, focused
checks, MSRVs, immutable HTML hashes and raw-log hashes. All 14 existing HTML
goldens remain unchanged. The local-list corpus changes only its seven slot source
bits to CLIENT plus the CRC; opcode and string bytes are identical. An initial
browser run reused a parallel checkout's stricter109 runtime on port3456. Its
failure is preserved as infrastructure evidence; the isolated90-test replay and
subsequent full gate passed after fixture servers gained explicit port selection
and refused pre-existing listeners.

The source, compiler, derive, Pages, release closure and verifier slices have
independent review. Hosted exact-head CI is a separate merge gate. Raw logs and
seven original archives remain under `work/FORMA-102/tmp/`. This is ordinary
functional/corpus replay, not a new fuzz or mutation campaign. Final activation,
renderer budgets/finalization and template API migration remain in their assigned
tickets. `liveReleaseReady` remains false; no tag or publication occurred.

## Declared props reload correction and repeated packaging

The reload correction artifacts are `v3-props-reload-set.json` from
`8f7a2aa02398240845681f1c777e4b9dfdcf7eaa`. `v3-props-reload-p17.json` passes
all 20 checks in 62.502 seconds, including all seven real typed Pages controls and
both packed templates. Every archive SHA-256 and packed crate VCS commit matches
that source. All ten template source files were restored and match Git exactly
(`v3-props-reload-template-restore.json`). The original 7e5f0c9 archives and reports
remain unchanged; this acceptance supersedes them for the current source.

Independent review found that invalid or missing manifests could still allow an
edited IR file at the same filename to load under old assets. The new regression
failed before the fix. The cache now freezes the complete previous pair until a
valid manifest returns, including identical original bytes after disappearance.
It also handles an invalid initial disk baseline while retaining caller-added
startup routes. The lead replayed its original failing reproducer unchanged and
all eight independent typed Pages controls passed.

The corrected source passed the full local gate in 162 seconds, MSRV 1.85, release
typed Pages 5/5 and Clippy. A later test-only Windows correction uses Path suffix
semantics without changing native diagnostic paths; all ten props tests passed.
The old-head Windows failure is preserved in the independent review directory;
only new-head hosted CI can qualify the final tree.

The first fresh packing attempt correctly failed: the rebuilt forma-ir archive
was `749a6613d7c96f597a21d434a3ef4c7d6be5611b045a6dbb1aa8ea165f0060ec`,
but Cargo 1.93.1's reused packaging index left the dependent lock checksum at
`19ae3c5ff041656505e3e88bd1a3378202894fdac34f090ed1b54846372cecdc`.
`v3-props-reload-refused-pack.json` records that refusal; its original archives,
index, shipped lock and raw log are retained. Packaging now uses a fresh owned
Cargo target per attempt. It copies archives out and removes only that target.
The verifier never repairs a candidate lock. The 38 release helper tests include
same-source reproducibility and changed-source dependent-checksum/VCS controls.

`v3-props-reload-qualification.json` records source boundaries, raw-log hashes
and unchanged HTML goldens. The known same-file Page entry-selection defect
fails closed and is explicitly assigned to the approved FORMA-103 entry correction;
it does not invalidate imported-entry evidence. No application repository,
package version, tag or live publication changed.


## Portable Date boundary qualification (FORMA-102)

The current exact artifact source is `153972defd480cd6821aa3fbb6d16294550b902f`,
recorded by `v3-props-date-set.json`. Windows cannot construct a SystemTime at
the JavaScript Date limit. The typed-render test now uses checked construction;
a private numeric test exercises the unchanged production conversion on every
platform, including both signs, sub-millisecond truncation, exact limits, one
millisecond beyond, and values beyond i64 before casting. No public API or
accepted value changed. Native source-path assertions also retain portable Path
semantics after the two earlier Windows failures.

All ten props tests, the positive derive control and 23 compile refusals, seven
typed Pages controls, the private Date test (also on Rust1.71) and IR/server
Clippy passed. The
fresh seven-artifact rehearsal passed all 20 checks in 61.524 seconds, including
both templates; all ten source template files were restored. See
`v3-props-date-p17.json`, `v3-props-date-template-restore.json` and
`v3-props-date-qualification.json`. Earlier archives, successful reports and
refused attempts remain unchanged. The full 162-second gate remains explicitly
at its earlier source; this record adds focused and packed checks for the
private refactor. Hosted exact-head CI, including Windows, is still required.


## Typed raw markup and enforced Trusted Types (FORMA-109)

`v3-trusted-types-set.json` records seven unpublished 3.0.0-dev archives from
`1c032095ec072ea8cd41f3b604cd6892024aa048`. Its verifier passed all 22 checks
in 49.08 seconds (`v3-trusted-types-p17.json`). Both packed templates compiled,
served the two enforced Trusted Types directives and completed their positive
browser interactions with native Trusted Types available, zero
`securitypolicyviolation` events and zero page errors. The report preserves both
the actual HTTP policy and the navigation response policy. Separate native tests
prove that the policy is live: Report-Only permits and reports a raw assignment,
while enforcement refuses and reports it. Empty page-error arrays alone are not
the CSP acceptance criterion.

The server removes PageOutput, caller-supplied nonces, config_script and the old
render_page helpers. Core raw markup APIs require trustedHtml, script creation
is refused, and runtime srcdoc bindings emit Forma diagnostics before reaching
a native sink. F2 controls independently update a document binding and reused
list rows, preserving neighboring bindings. The shared forma mint and named frame
policy remain intentional; this does not claim isolation from other page scripts.
See [the migration contract](../TRUSTED-TYPES.md).

`v3-trusted-types-qualification.json` records the 159-second complete local gate,
126 affected browser checks across Chromium/Firefox/WebKit, the six subsequent
F2 updates and nine packed-condition checks across those engines, release helpers
and raw-log hashes. All existing size budgets remain unchanged. The final
Windows-only diagnostic assertions were replayed separately before the final
artifact set. Independent review authenticated every archive, all three internal
crate checksum edges and the source commit. Exact-head hosted CI remains a
separate merge gate; this evidence commit follows the recorded artifact source.

`v3-trusted-types-template-restore.json` proves all ten A2 source template files
were restored exactly. Candidate 3.x staging removes only the known unused
config_script:None field; FORMA-144 replaces this temporary adapter with the final
source templates. The full packed gate also retains the declared-props and
rejected-manifest recovery controls from 102. Fresh per-attempt Cargo packaging
prevents a reused temporary index from recording stale dependent checksums.

Earlier 109 attempts and historical release evidence remain unchanged. Raw logs
and archives are retained under `work/FORMA-109/`. No application migration,
release tag, registry publication, new fuzz campaign or broad payload campaign
was performed. Application and fixture qualification in 152/188, remaining release
contracts and measurements are still separate; liveReleaseReady remains false.


## Portable date boundary follow-up

The current FORMA-109 artifacts are `v3-trusted-types-portable-set.json` from
`2110f01b745b2caea767b277fad39c486fce7aad`. All 22 P17 checks pass in 59.826
seconds, both templates retain enforced policies with native Trusted Types and
zero CSP events/page errors, and all ten source template files restore exactly.
The original 1c032095 artifacts and reports above remain unchanged.

Windows cannot represent the original typed Pages test's out-of-range SystemTime,
so its fixture panicked before testing the renderer. The shared FORMA-102 follow-up
extracts the existing conversion into a private duration helper and tests both
signed numeric boundaries directly on every platform; representable SystemTime
cases retain the public-path tests. The lead reviewed the behavior-preserving
change, and the local private conversion and seven typed Pages controls passed.
Because crate source changed, all seven artifacts and their actual packed tests
were rebuilt. `v3-trusted-types-portable-qualification.json` links the earlier
full FORMA-109 qualification and preserves the new source, hashes and Windows failure
log. Later dependency evidence/documentation commits do not change these packed
production bytes; final-head hosted CI remains required separately.

A later Windows Node run passed the manifest/watch assertions but fixture cleanup
failed with EBUSY after only the watcher's parent had exited. The test harness now
terminates only its owned PID tree on Windows, waits for inherited stdio closure,
and retries the affected fixture's removal with a bounded delay. A real parent/
descendant control also verifies an unrelated fixture remains alive. All52 affected
watch controls pass locally. This is a test-only delta over the recorded production
artifact source2110f01; its Windows hosted run is required before merging.
