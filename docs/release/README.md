# Release documentation

**[3.1.0](https://github.com/getforma-dev/forma/releases/tag/v3.1.0) remains the latest stable release.**
**[3.2.0-rc.3](https://github.com/getforma-dev/forma/releases/tag/v3.2.0-rc.3) is published** with the optional router and eight
authenticated registry archives. Its [dated publication outcome](3.2-RC3-PUBLICATION.md)
records the actual attempts, normal release record and finite inventory-only npm
placeholder receipt. The [preparation record](3.2-RC3-PREPARATION.md) retains its
earlier observations. Prerelease publication does not complete stable, device,
production rollback or soak acceptance.

RC1's eight archives were published before its record job failed. RC2 now hosts
the separate inventory-only receipt. The [incident record and dated follow-up](3.2-RECORD-RECOVERY.md)
preserve the failed original outcome without granting RC1 qualification or soak credit.

## 3.2 router preparation

The [router implementation record](../design/router/README.md) preserves the
research and design decisions. Its [qualification ledger](../design/router/qualification.md)
distinguishes source and packed evidence from the remaining stable-release
scenarios, manual accessibility/device review and live website acceptance.
The [registry enrollment procedure](ROUTER-REGISTRY-ENROLLMENT.md) records the
finite first-package bootstrap exception and subsequent trusted-publisher and
monitoring obligations. The current gates are in `scripts/release-contracts.json`;
RC qualification does not complete the stable gates or hosted soak.

The [3.1 performance decisions](3.1-PERFORMANCE-TRADEOFFS.md),
[3.1 qualification](3.1-QUALIFICATION.md) and [3.1 upgrade guide](../UPGRADING-3.1.md)
retain that release's tradeoffs, evidence and migration advice. Earlier RC
failures and superseded qualification records retain their original status.

## Maintainer procedures

- [Release guide](../RELEASING.md): version preparation, packed verification and trusted publishing.
- [Registry reconciliation](REGISTRY-RECONCILIATION.md): compare published records and registry archives.
- [Support and recall](SUPPORT-AND-RECALL.md): maintenance windows, security fixes and version recall.
- [Packed verification evidence](P17-EVIDENCE.md): evidence structure and validation.
- [RC audit and burn-in](RC-BURN-IN.md): audit identity, active work and later completion verification.

## Dated 3.0 records

3.0.0 is published, and its deferred post-release soak is complete. Read
[the as-built summary](V3-AS-BUILT.md) for the actual source, producers and limits.
The original publication record retains its then-deferred soak status; the later
completion receipt supplies the result without rewriting history.

[Gate dispositions](3.0-GATE-DISPOSITIONS.md), [alpha](ALPHA-RUNBOOK.md),
[beta](BETA-QUALIFICATION.md), [RC qualification](RC-QUALIFICATION.md),
[RC4 input protocol](RC4-INPUT-PROTOCOL.md) and the
[quota scheduling decision](L-66-QUOTA.md) retain the decisions and evidence at
those stages. Pending work described in a dated checkpoint is not the current
release status. Earlier failures remain failures.

The published 3.0 D14 assets and `post-release-soak.json` bind specific historical
commits, reviewed deltas and the original deferral. Preserve those historical
receipts. The current D14 source files advance only with a new actual review;
their earlier versions remain in Git and the published assets. The
[final release](https://github.com/getforma-dev/forma/releases/tag/v3.0.0) carries
publication, P17 and separate post-release completion/review assets.

[Native-resource attribution](N3-NATIVE-RESOURCE-ATTRIBUTION.md) explains the
measurement policy; it is not permission to suppress a new application failure.
Application migrations and the deferred live governance rollout remain separate
work. Maintainer work-board/session snapshots are outside the source checkout;
see [documentation placement](../REPOSITORY-LAYOUT.md).
