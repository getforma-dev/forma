# Published RC burn-in and final evidence

**3.0 completion:** the separate post-release receipt verifies 3,660 active
seconds, 15 complete rounds, zero faults and complete cleanup. See
[the final summary and original receipts](V3-AS-BUILT.md#completed-post-release-soak).
The procedures below explain the original and repaired verification paths;
setup requirements and earlier pending checkpoints are not the current status.
The original publication record retains its then-deferred, zero-credit claim.

L-62 replaces the former seven-day soak with at least 3,600 seconds of actual
continuous stress work in hosted CI after a published RC has passed P17 and its
independent whole-release D14 review. Preparing this workflow does not complete
that requirement. The ordinary final release preflight must authenticate its
successful run and retained evidence. The release-specific L-66-QUOTA scheduling
decision below permits the same work after final publication, with zero credit
until the actual campaign passes.

## Audit and release chain

Before freezing the RC tree, integrate the accepted source, prepare the RC
versions, and close each non-audit RC contract row only with its actual evidence.
The initial 3.0 rollout used a successfully published beta DS12 as its RC
performance baseline. Later releases use the authenticated published predecessor
selected by `readPerformanceBaseline`; the 3.1 candidate uses published 3.0.0.
A local rehearsal or a failed immutable tag cannot provide that baseline. Complete
current packed qualification and the required full mutation campaign before
accepting the whole-release audit. Gate statuses and future evidence stay
pending until those results exist.

Prepare the coordinated RC version before freezing the product and harness tree
for review. Use a different reviewer model, or the founder-authorized L-65
fallback: a separate reviewer initialized with fresh context, including on the
same model, who did not author the implementation. Retain the real review
sessions and accepted findings, not just a generated "passed" string:

- `docs/release/d14-report.json`: `d14-whole-release-v1`, exact reviewed commit/tree,
  SHA-256 of the full Git input inventory, author/reviewer model identities and
  session evidence hashes, UTC review time, accepted result, findings with stable
  IDs/severity/disposition, and an empty blocking-findings list.
- `docs/release/d14-input-manifest.json`: `auditInputManifest(reviewedCommit)`'s
  complete path/mode/blob inventory. Its bytes must match the report hash.
- `docs/release/d14-review-evidence.json`: actual referenced review/acceptance
  text and its SHA-256 hashes, using `d14-review-evidence-v1`.

The L-65 path adds `independence: { method: "fresh-context", decision: "L-65",
initializationEvidenceSha256: "<actual initialization evidence digest>" }` to
the report and includes the actual separate fresh-context initialization in the
existing review-evidence bundle. Record the model/session actually used and
verify the initialization from its tool/session record. Different evidence
digests alone do not prove review independence or software quality. Both paths
require an actual exact-tree whole-release review against the v2 specification
and accepted founder decisions, P17, SR14/SR17/SR33 and release artifacts. L-65
changes the allowed reviewer setup; it does not waive any acceptance gate.

`readRcAudit()` recomputes the actual Git binding. After the audited tree, only
exact audit-status completion, these review records, and independently reviewed
documentation/changelog changes are permitted. Archived executable corpora and
product/harness changes cannot hide in a documentation exception. There is no
version-normalization exception. The record validator checks consistency; the
actual independent review and its acceptance remain necessary.

The release workflow checks this before publishing the RC, then attaches all
four actual audit assets (including generated `d14-rc-binding.json`) to the RC
GitHub Release. DS12 contains their SHA-256 hashes and the successful P17
artifact's run ID, **producer** attempt, artifact name and nested manifest hash.
A record-only workflow retry retains the earlier P17 producer attempt.

## Hosted campaign

Dispatch `rc-burn-in.yml` at the exact published RC tag and supply that same tag
as `rc_tag`. The job has read-only GitHub permissions and no publishing authority.
The ordinary workflow suppresses Python bytecode before ownership imports and
retains before, pre-worker and after source status outside the checkout, including
after failures. Dirty source still fails; it is never ignored or repaired in place.
It authenticates the actual successful release/P17 workflow attempt and nested
evidence, the DS12/D14 assets, and the versioned npm/crates registry archive set
(seven for 3.0/3.1; eight including `@getforma/router` from 3.2)
against both DS12 and registry integrity. It neither repacks these archives nor
substitutes workspace `dist` output.

Setup installs pinned tools, extracts the original packages, and builds actual
minimal/dashboard consumers, plus the native-router starter from 3.2, native
fixture applications and the five deployment
skew products through existing packed-product staging. Four ASan fuzz targets are
compiled against the extracted `forma-ir` and `forma-ir-derive` crate archives with
the committed nightly/Cargo lock. Setup is outside the active-time accounting.

Every round runs, sequentially:

1. All four native decoder fuzz targets with distinct seeds and positive input
   counts. Only whole seconds in a successful libFuzzer `Done` summary count,
   bounded by the observed subprocess interval.
2. The complete current hostile-widget/capability/explicit-mount matrix against
   the original packed runtime, using its existing validator.
3. All eleven existing upgrade/skew/retention/rollback checks in each of
   Chromium, Firefox and WebKit.
4. Every native fixture route/variant and extra control, plus minimal adoption
   and interaction, static-page zero-script behavior, and dashboard interaction.
   From 3.2, dashboard interaction also proves real shared-router links, retained
   layout/same-route chart state, released leaf state, and Back/Forward. The
   native-router starter additionally runs in Chromium, Firefox, and WebKit: typed
   click/Back/Forward responses, retained layout state, fresh returned leaf, no new
   executable script requests, and direct no-JavaScript rendering. The final
   validator derives these required IDs from the authenticated RC version and
   checks every raw outcome. Historical 3.0/3.1 evidence retains its original
   two-starter obligations; it cannot satisfy the 3.2 inventory.

The native starter subset above is repeated every round. The separate complete
90-case packed native fixture campaign remains pre-release qualification; this
subset is not reported as a repeated 90-case campaign. A new 3.2 stable release
requires its own same-line published RC evidence and at least 3,600 credited
active seconds with zero faults. The 3.0 L-66 deferral is not transferable.

A round finishes all its checks even when the active-hour threshold is crossed.
There are no retries, inserted sleeps, or five-second orchestration cutoff.
Normal startup/cleanup is recorded separately and earns no active credit.
Any workload failure, sanitizer finding, unexpected error, incomplete case set,
changed prepared product, or unproved cleanup fails the campaign. It stops at the
first fault and retains the original files; a failed campaign is not resumed.

The Linux child subreaper owns detached descendants too. PID-fd identity guards,
stopping parents before descendant enumeration, bounded termination, and real
Linux orphan/cancellation controls protect cleanup. A live leftover descendant
is a campaign fault even if the final sweep successfully terminates it. The job
bound is 180 minutes; the owned worker bound is 165 minutes, with separate bounded
shutdown. These are orchestration limits, not substitutes for active work.

Retained evidence is bounded to 2 GiB and 16,384 files. Downloaded ZIP bytes and
extracted members share the same budget. Logical reports and subprocess logs have
16 MiB caps; each round reserves its bounded output room before starting. Build
caches and extracted build work live in separate owned scratch. Original archives,
raw reports/logs, tool/product hashes, round summaries, source-derived case
identities and ownership results are retained. Finalization revalidates the actual
per-task files before writing the success record and nested evidence manifest.
Both evidence and ownership artifacts upload after failures as well as success.

## Final release

After the successful hosted run, write the independently reviewed
`docs/release/rc-burn-in.json` pointer (`rc-burn-in-reference-v1`) with the exact RC
tag/commit, run ID/attempt, nested manifest SHA-256, final version `3.0.0`, exact
reviewed RC-to-final changed-file hashes and actual review text/hash. The final
preflight downloads and authenticates the successful hosted run, all raw task
files and the same RC inputs again. A summary JSON alone is insufficient.

Final product/harness bytes must match the RC. Only exact output of the existing
coordinated version-preparation function, final-gate completion, the immutable
pointer, and independently reviewed documentation/changelog changes are allowed.
The final DS12 attaches the exact pointer bytes and hash. This source does not
approve an audit, publish a tag, waive a gate, or claim a completed campaign.

For later releases, the pointer's `finalVersion` names that release (for example
`3.1.0`) and its `rcTag` must name the same version with an `-rc.N` suffix. The
validator projects that exact final version from the authenticated RC source;
it never permits product changes between RC and final. All workload, provenance,
review, source and cleanup checks above still apply. Historical 3.0 post-final
donor workflows and receipts remain specific to their original publication.

### 3.0.0 post-release scheduling (L-66-QUOTA)

The [founder's timing decision](L-66-QUOTA.md) permits the 3,600-second active
soak after final 3.0.0 publication. It does not waive the independently audited,
published RC, its original P17, registry archive authentication, or review of
the canonical RC-to-final delta. This release-code support must be part of the
RC audit and published RC; it cannot be added through the final documentation
allowlist. All other final gates still require `done`.

Only `FORMA-145 soak` in the final 3.0.0 contract may use `status: "deferred"`,
with the exact descriptor
`deferral: { decision: "L-66-QUOTA", finalVersion: "3.0.0", reference: "docs/release/post-release-soak.json" }`.
This is not a general publish switch. No live gate is changed by installing the
validator, and no reference is supplied before the real RC exists.

After that RC is published, prepare the separate
`docs/release/post-release-soak.json` reference, contract
`post-release-soak-reference-v1`. Its fixed fields are `finalVersion: "3.0.0"`,
`gate: "FORMA-145 soak"`, `decision: "L-66-QUOTA"`, `status: "deferred"`,
`activeNanoseconds: "0"`, `requiredActiveNanoseconds: "3600000000000"`, and
`burnInPassed: false`. Bind the actual `rcTag`/`rcCommit`, `ds12Sha256`,
`p17EvidenceSha256`, and `d14EvidenceSha256` returned by RC authentication.
Include the independently reviewed canonical `reviewedChanges` and actual
`reviewEvidence`/`decisionEvidence` objects with `content` and its `sha256`.
Hashes bind those bytes; they do not manufacture approval or authenticity.
The committed reference is the only self-excluded final-diff path. A completed
`rc-burn-in.json` pointer cannot coexist with it; no soak run identity or result
may be invented in the deferred reference.

Final preflight authenticates the immutable RC tag, successful published RC
set, original P17 and D14 evidence again, then requires the three actual proof
digests to match. The same existing final-diff validator still permits only
canonical version preparation, narrowly defined final-gate changes and reviewed
existing documentation. Final DS12 attaches the exact reference bytes and hash
under `postReleaseSoak`, explicitly deferred with zero credit and no pass; it
does not claim an absent burn-in producer. The ordinary completed-soak path and
its hosted evidence verification remain available unchanged.

After final publication, dispatch the unchanged `rc-burn-in.yml` at that exact
RC tag, with the same `rc_tag` input. Its workloads, 3,600 active seconds,
zero-fault rules, original archive authentication and cleanup requirements do
not change. After it completes, check out the exact published `v3.0.0` tag with
its RC tag available locally and run the supported read-only consumer:

```sh
node scripts/release-soak-completion.mjs v3.0.0 FINAL_COMMIT RUN_ID RUN_ATTEMPT MANIFEST_SHA256 /absolute/fresh/output-directory
```

Use the actual final commit and later `rc-burn-in` run ID, attempt and nested
manifest digest from its retained original output. The output directory must
not exist, its parent must exist, and it must be outside the tagged checkout,
including after resolving symlinks. A read-only `GH_TOKEN` may authenticate API
reads; this command has no publishing action. No real run identity is placed in
the immutable deferred reference.

The consumer authenticates the actual final GitHub release and DS12/reference
assets, their exact committed final identity/diff and original zero-credit
disposition. It reauthenticates the same RC archives/P17/D14 and requires a
successful exact hosted soak producer created and started after the final's
original publication time. The existing raw workload validator then requires
all tasks, at least 3,600 active seconds, zero faults and complete cleanup.
The external directory retains the original final assets, RC evidence, hosted
soak provenance and downloaded artifact. On success `verification.json` binds
those identities/digests and records actual active nanoseconds and rounds;
the CLI prints that same receipt. After output initialization, a refusal exits
nonzero and retains `verification-error.json` plus evidence already acquired,
with no successful receipt. Invalid arguments, source or output paths refuse
before creating the output directory. Use a fresh directory for any independently authorized later check;
there is no automatic retry or overwrite.

Never rewrite final DS12's original deferred claim to imply the soak passed
before publication. This separate receipt completes the later obligation only;
a failed campaign remains failed and scheduling earns no evidence credit.

## Implementation qualification

Finite controls exercise identities, byte bounds, raw result validation, the
3,599/3,600-second boundary, workflow ownership/retention and exact Git diff
binding. Real Linux process controls run in Linux CI. An actual locked nightly
fuzz build and a bounded packed-product setup/replay are still required before
the first full RC campaign; the historical FORMA-185 run does not prove the
repaired current fuzz lock. FORMA-194 tracks that current lock qualification.

The `burn-in-setup` CI job rehearses that setup against the existing
`candidate-pack` job's exact current seven dry-pack archives. It checks source,
DS11 and original package hashes, performs all native/consumer staging, and runs
each precompiled ASan target once for 1,000 seed inputs. It starts no browser and
retains explicit `rehearsal: true`, `rcAuthenticated: false`,
`burnInPassed: false`, `releaseAccepted: false`, and zero active-time credit.
Successful setup is distinct from the authenticated published-RC campaign.

### Release verification time budget

The release verification job allows 60 minutes, including setup; its P17 step
allows 45 minutes. The browser installation step retains its five-minute bound.
These orchestration limits do not change samples, performance limits, child
process deadlines, the P17 verifier's hard elapsed-time limit of 1,800 seconds,
or the independent 3,600-second active burn-in requirement. The outer release
time is recorded against its separate G6 target; neither clock measures human
maintainer effort. Beta.4 missed that outer target despite passing P17, as
recorded in [RC qualification](RC-QUALIFICATION.md).

The sizing basis is indicative rather than a completed new full run: the two
current pilot Lighthouse audits took 15.89455 and 15.91504 seconds, so forty
audits imply about 636.2 seconds; independent activation samples imply about
78.5 seconds and controls about 10.8 seconds. The preserved earlier functional
P17 path through decoder took 274.532 seconds, and a separate older-source
native/client continuation took 272.793 seconds. That totals approximately
21 minutes before checkout, tool installation, signatures and browser setup;
the former 25-minute job allowance left too little orchestration margin.

## Post-final orchestration repair (v2)

The first post-final run39368193529 failed the hostile producer's strict
`sourceClean` assertion. Its raw result did not retain dirty paths, so the exact
hosted cause is not proved. An isolated import of the unchanged ownership test
creates `scripts/__pycache__`; suppressing bytecode before that import prevents
this local contamination. The failed run earns zero accepted active credit.

`post-final-soak-v2.yml` is a separate, read-only donor workflow. It preserves
real GitHub run/ref/SHA/workflow identity and checks out published RC5
`12320f4340d87cbb96575b5bb3b7eab42121d477` separately. Python bytecode suppression
is job-wide before ownership imports. External before/pre-worker/after status
records survive success or failure. The donor supplies orchestration; staging,
security producers, fixture/skew checks, browser dependencies and raw workload
validators are loaded from the clean immutable RC checkout. RC archives are
still authenticated from its original publication. The original workload,
source-cleanliness, active-time and cleanup criteria remain unchanged.

The original completion route still accepts only original RC-tag workflow
provenance and rejects donor runs. The new route requires three clean checkouts
(donor, final and RC), original hosted donor provenance, and a separately supplied
independent review pin for the exact donor commit and its full binary Git diff
from final2006423b. That pin is not generated by a worker or treated as a workload
result. It contains `contract: post-final-soak-donor-review-v2`, `baseCommit`,
`donorCommit`, `diffSha256`, and `reviewEvidence: { content, sha256 }` holding the
actual independent review bytes. The diff digest is the SHA-256 of
`git diff --binary --full-index FINAL_COMMIT DONOR_COMMIT --`.

From the reviewed donor checkout, run the read-only consumer with actual values:

```sh
node scripts/release-soak-completion-v2.mjs v3.0.0 FINAL_COMMIT RUN_ID RUN_ATTEMPT MANIFEST_SHA256 ABSOLUTE_FRESH_OUTPUT_DIRECTORY FINAL_ROOT RC_ROOT REVIEW_JSON DONOR_BRANCH
```

Output must be outside all three checkouts. The versioned receipt separately
records donor orchestration and RC payload identities, retains original final
DS12 deferral/zero credit, and delegates complete archive/raw-workload validation
to the immutable RC validator. A reviewed donor or successful finite control
does not certify an actual soak; only the authenticated completed workload can.
