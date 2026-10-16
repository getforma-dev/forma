# Published RC burn-in and final evidence

L-62 replaces the former seven-day soak with at least 3,600 seconds of actual
continuous stress work in hosted CI after a published RC has passed P17 and its
independent whole-release D14 review. Preparing this workflow does not complete
that requirement. The final release preflight must authenticate its successful
run and retained evidence.

## Audit and release chain

Prepare the coordinated RC version before freezing the product and harness tree
for review. The reviewer uses a different model from the author. Retain the real
review sessions and accepted findings, not just a generated "passed" string:

- `docs/release/d14-report.json`: `d14-whole-release-v1`, exact reviewed commit/tree,
  SHA-256 of the full Git input inventory, author/reviewer model identities and
  session evidence hashes, UTC review time, accepted result, findings with stable
  IDs/severity/disposition, and an empty blocking-findings list.
- `docs/release/d14-input-manifest.json`: `auditInputManifest(reviewedCommit)`'s
  complete path/mode/blob inventory. Its bytes must match the report hash.
- `docs/release/d14-review-evidence.json`: actual referenced review/acceptance
  text and its SHA-256 hashes, using `d14-review-evidence-v1`.

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
It authenticates the actual successful release/P17 workflow attempt and nested
evidence, the DS12/D14 assets, and all seven original npm/crates registry archives
against both DS12 and registry integrity. It neither repacks these archives nor
substitutes workspace `dist` output.

Setup installs pinned tools, extracts the original packages, and builds actual
minimal/dashboard consumers, native fixture applications and the five deployment
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

## Implementation qualification

Finite controls exercise identities, byte bounds, raw result validation, the
3,599/3,600-second boundary, workflow ownership/retention and exact Git diff
binding. Real Linux process controls run in Linux CI. An actual locked nightly
fuzz build and a bounded packed-product setup/replay are still required before
the first full RC campaign; the historical FORMA-185 run does not prove the
repaired current fuzz lock. FORMA-194 tracks that current lock qualification.
