# Weekly registry reconciliation

FORMA-135 implements SR2/L-48 as read-only detection after publication. It does
not publish, yank, deprecate, repair release records, or change GitHub settings.

The `Weekly registry reconciliation` workflow runs on Mondays at 08:43 UTC and
can be dispatched manually. It inventories every version of the five npm
packages and three crates, including prereleases and yanked crates. Each covered
version must have an unambiguous record in an approved GitHub release, and the
actual registry archive must match that record's SHA-256. Downloads are read as
bytes; package contents are never installed or executed.

The checker reports missing records and archive mismatches together. Unreadable
registries, GitHub failures, malformed data and ambiguous records fail the run;
they are not interpreted as empty inventories or successful verification.
The machine-readable report is retained as the `registry-reconciliation`
artifact even when the check fails. An interrupted run or a missing report is
not a pass. Ordinary PR CI runs the offline failure controls and workflow tests.

## Coverage and historical versions

`scripts/registry-reconcile-policy.json` names the package set, official release
repositories and exact historical versions predating recorded archive hashes.
An exemption must identify the historical reason and evidence. Never generate
exemptions from whichever versions happen to lack records, use a broad version
range, or add an exception merely to make a run green. A2 and later versions
remain covered. Legacy releases may retain their archive digest in the release
body rather than an attached unified `release-record.json`; the checker validates
that format separately.

## Inventory-only publication recovery

A finite, audited recovery plan may bind an earlier publication to a later normal
release record. The original publication is not made into a successful release
run. For the planned RC1 recovery, the normal RC2 `release-record.json` must carry
its `publicationRecoveries` pointer, and the same GitHub release must contain the
named inventory receipt and linked proof asset. A receipt on another host release,
an unplanned pointer, or a missing planned pointer is a failure.

Before admitting recovered claims, reconciliation authenticates the host record,
receipt and proof against GitHub's asset SHA-256 and byte length. It also checks
the DS12 pointer's exact asset names, hashes and lengths. The shared strict
validator binds the receipt to the actual host tag, commit and recorder run, and
to the audited original publication tuple and complete eight-package inventory.
The receipt must declare `inventory-only`, with performance-baseline and soak
eligibility both false. After authenticating the proof bytes, the shared proof
validator also checks its original failure/provider tuple, DS11/D14 bindings,
bounded P17 description and complete registry inventory. Matching asset hashes
alone do not admit a wrong-schema or incomplete proof. The receipt contributes
no partial package set if any linked asset or semantic contract fails validation.

Recovered packages then undergo the same registry inventory and archive-download
checks as ordinary recorded packages. Missing versions, unreadable sources and
altered bytes still fail. Another record claiming the same package/version still
produces `AMBIGUOUS_RECORD`; recovery does not replace or silently deduplicate it.
No historical baseline or policy exemption is added. A failure on an existing
original release is not suppressed by finding a later receipt.

Only registry reconciliation reads these recovery assets. They establish an
audited archive claim for inventory comparison, not successful original CI,
performance qualification, support eligibility, soak or release approval. Those
readers retain their existing contracts and ignore the recovery asset.

The record and registry are two independently retrieved representations. This
detects discrepancies between them; it cannot establish integrity if an attacker
can replace both. Immutable tags, trusted publishing, independent review and the
existing release checks remain separate controls.

## One npm provider holding artifact

A public `@getforma/router@0.0.0-stage` holding artifact with `stub:true` was
observed during the original router publication. npm [documents this placeholder
version](https://docs.npmjs.com/staged-publishing/) for newly staged packages.
The original RC1 workflow log shows ordinary `npm publish`, and the placeholder's
registry timestamp falls inside that publication interval. This association does
not establish an explicit staging command or npm's internal backend mechanism.
The actual 364-byte archive contains only package metadata and a holding README;
it contains no router implementation. Its two regular files total 338 bytes.

`docs/release/npm-provider-placeholder-router.json` is a closed, reviewed plan
for this exact identity, timestamp, metadata and archive. It pins the original
publication evidence, all three archive digests and the inspected members. It
does not add a historical exemption: router `baseline` remains empty. Under the
literal L-48 contract, the plan alone cannot satisfy the missing release record.

The prospective `v3.2.0-rc.3` release first authenticates live metadata and archive
bytes in its check job, then transfers the bounded observation with the existing
evidence manifest. The record job verifies that transfer, the tagged plan and
its actual current run before generating the inventory-only receipt. It may use
an earlier successful check attempt in the same run. The receipt claims no
success for its still-running recorder. Ordinary DS12 `packages` remains the
eight product packages. A separate `providerPlaceholders` pointer names the
attached `npm-provider-placeholder-router-0.0.0-stage.json` asset, byte length
and SHA256.

The receipt durably retains the exact canonical `prepared.json` and its one-file
evidence manifest. Their contents, byte lengths, file digest and manifest digest
are recomputed by the reader; a merely well-formed hash is insufficient. The
reader authenticates the original check attempt and its successful named prepare
and upload steps, including execution intervals and upload-before-record ordering.
The observation time must fall inside preparation, with less than one second of
endpoint allowance for GitHub's timestamp precision. A check can have succeeded
in an overall failed earlier attempt. The active recorder can also consume a
completed check in the same still-running attempt. Neither case invents an overall
success. Long-term verification does not depend on retaining Actions artifacts.

On later reconciliation the host DS12 and receipt must match their GitHub asset
digests and lengths. The receipt must match the finite source plan, pointer,
actual annotated RC3 tag and commit, plan bytes retrieved from that commit, and
the completed successful original recorder attempt/job/step. A copied
earlier job interval cannot establish a new recorder execution. Only after these
checks does the receipt contribute its single archive claim. Every reconciliation
then downloads the live archive and checks its length and SHA256/SHA1/SHA512,
canonical URL, publication timestamp and exact stub metadata again.

The latest run must still identify the same source/tag and an equal or later
attempt. A later attempt's actual status and conclusion remain separate report
fields; they neither replace nor relabel the original successful recorder.

The report separates `verifiedProviderPlaceholders` and each package's
`providerPlaceholders` count from ordinary verified product archives. The receipt
is ineligible for qualification, support, performance baselines and soak. Existing
publish, baseline and support readers do not consume it. Later releases discover
the original RC3 attachment; they cannot generate a second claim. Missing
planned pointers, unavailable providers, replaced source or bytes, other
`stub:true` identities, extra claims and attempts to list the artifact as an
ordinary product package all fail. No registry artifact is unpublished or
rewritten. The immutable RC2 source is unchanged, and strict SR2 remains open
until an actual successful successor DS12 and attachment exist.

## Run and triage

Use the Node version in `.node-version`. Local execution needs only Node's
standard library and, for GitHub API quota, a read-only `GH_TOKEN` already present
in the environment. No registry credential is used.

```sh
node scripts/registry-reconcile.mjs --policy scripts/registry-reconcile-policy.json --output /tmp/forma-registry-reconciliation.json
node --test --test-concurrency=2 scripts/registry-reconcile.test.mjs scripts/registry-reconcile-workflow.test.mjs scripts/release-provider-placeholder.test.mjs
```

On failure, retain the report and identify the package/version and finding.
Distinguish an unavailable source from a missing record or mismatched bytes.
Investigate the original publication evidence before proposing a separately
reviewed repair. Never overwrite an archive, retag, rewrite an old failed report
or manufacture historical qualification. A rerun after an outage creates new
evidence; it does not make the original run successful.

## Governance boundary

The workflow has `contents: read` and `actions: read`, no OIDC publishing permission, no
persisted checkout credentials and no package installation. Its GitHub token is
used only for approved GitHub API requests, never for registry archive downloads.

**L-60 remains in force.** Separate agent identity, new branch/code-owner
enforcement and the external alert receiver, scheduler and delivery acceptance
remain deferred. An Actions failure, job summary or stored report does not prove
the founder received an external alert. No new notification service or account
configuration is enabled by this checker. Existing Actions notification settings
are unchanged.
