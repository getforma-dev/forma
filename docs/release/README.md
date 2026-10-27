# Release documentation

**Forma 3.2.0 is published**, with eight coordinated packages and
the optional router. The [stable release record](https://github.com/getforma-dev/forma/releases/tag/v3.2.0)
is the publication authority. Read the [publication and acceptance outcome](3.2-PUBLICATION.md).
For application instructions, start with the [scaffolder](../../packages/create-app/README.md)
and [routing guide](../ROUTING.md).

The maintainer approved a [streamlined release](3.2-PERFORMANCE-DECISION.md):
retain source security, core correctness, exact-source audit, ordinary CI,
tagged packed qualification, artifact integrity and trusted publishing. Waive
the extra timing campaign and active soak, without claiming those passed, along
with extra RC publication solely for soak inputs and the staged rollback exercise.
The stable website, current docs, examples and downloads are deployed together
from the published 3.2.0 packages; the [publication outcome](3.2-PUBLICATION.md)
records the actual image identity and live acceptance.

The [router implementation record](../design/router/README.md) preserves the
research, design and qualification evidence. Published
[RC3](https://github.com/getforma-dev/forma/releases/tag/v3.2.0-rc.3), its
[publication outcome](3.2-RC3-PUBLICATION.md), and the
[unpublished RC4 preparation](3.2-RC4-PREPARATION.md) remain historical checkpoints.
RC1's failed record job and RC2's inventory-only recovery remain in the
[incident record](3.2-RECORD-RECOVERY.md). No failed result is rewritten.

## Maintainer procedures

- [Release guide](../RELEASING.md): version preparation, packed verification and trusted publishing.
- [Registry reconciliation](REGISTRY-RECONCILIATION.md): compare published records and registry archives.
- [Support and recall](SUPPORT-AND-RECALL.md): maintenance windows, security fixes and version recall.
- [Packed verification evidence](P17-EVIDENCE.md): evidence structure and validation.
- [RC audit and burn-in](RC-BURN-IN.md): audit identity, active work and later completion verification.

## Historical migration notes

These preserve changes between internal development baselines for maintainers.
New applications start directly with Forma 3.2.0; no upgrade sequence is needed.

- [3.0 migration notes](../UPGRADING-3.0.md) and [template comparison](../../packages/create-app/docs/UPGRADING-3.0.md).
- [3.0 to 3.1 migration notes](../UPGRADING-3.1.md).
- [3.2 migration notes](../UPGRADING-3.2.md).

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
