# Weekly registry reconciliation

FORMA-135 implements SR2/L-48 as read-only detection after publication. It does
not publish, yank, deprecate, repair release records, or change GitHub settings.

The `Weekly registry reconciliation` workflow runs on Mondays at 08:43 UTC and
can be dispatched manually. It inventories every version of the four npm
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

The record and registry are two independently retrieved representations. This
detects discrepancies between them; it cannot establish integrity if an attacker
can replace both. Immutable tags, trusted publishing, independent review and the
existing release checks remain separate controls.

## Run and triage

Use the Node version in `.node-version`. Local execution needs only Node's
standard library and, for GitHub API quota, a read-only `GH_TOKEN` already present
in the environment. No registry credential is used.

```sh
node scripts/registry-reconcile.mjs --policy scripts/registry-reconcile-policy.json --output /tmp/forma-registry-reconciliation.json
node --test --test-concurrency=2 scripts/registry-reconcile.test.mjs scripts/registry-reconcile-workflow.test.mjs
```

On failure, retain the report and identify the package/version and finding.
Distinguish an unavailable source from a missing record or mismatched bytes.
Investigate the original publication evidence before proposing a separately
reviewed repair. Never overwrite an archive, retag, rewrite an old failed report
or manufacture historical qualification. A rerun after an outage creates new
evidence; it does not make the original run successful.

## Governance boundary

The workflow has `contents: read` only, no OIDC publishing permission, no
persisted checkout credentials and no package installation. Its GitHub token is
used only for approved GitHub API requests, never for registry archive downloads.

**L-60 remains in force.** Separate agent identity, new branch/code-owner
enforcement and the external alert receiver, scheduler and delivery acceptance
remain deferred. An Actions failure, job summary or stored report does not prove
the founder received an external alert. No new notification service or account
configuration is enabled by this checker. Existing Actions notification settings
are unchanged.
