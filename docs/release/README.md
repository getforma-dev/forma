# Release documentation

**3.0.0 is published, and its deferred post-release soak is complete.** Read
[the as-built summary](V3-AS-BUILT.md) for the actual source, producers and limits.
The original publication record correctly retains its then-deferred soak status;
the later completion receipt supplies the result without rewriting history.

## Maintainer procedures

- [Release guide](../RELEASING.md): version preparation, packed verification and trusted publishing.
- [Registry reconciliation](REGISTRY-RECONCILIATION.md): compare published records and registry archives.
- [Support and recall](SUPPORT-AND-RECALL.md): maintenance windows, security fixes and version recall.
- [Packed verification evidence](P17-EVIDENCE.md): evidence structure and validation.
- [RC audit and burn-in](RC-BURN-IN.md): audit identity, active work and later completion verification.

## Dated 3.0 records

[Gate dispositions](3.0-GATE-DISPOSITIONS.md), [alpha](ALPHA-RUNBOOK.md),
[beta](BETA-QUALIFICATION.md), [RC qualification](RC-QUALIFICATION.md),
[RC4 input protocol](RC4-INPUT-PROTOCOL.md) and the
[quota scheduling decision](L-66-QUOTA.md) retain the decisions and evidence at
those stages. Pending work described in a dated checkpoint is not the current
release status. Earlier failures remain failures.

The D14 JSON records and `post-release-soak.json` bind specific historical
commits, reviewed deltas and the original deferral. Preserve their bytes. The
[final release](https://github.com/getforma-dev/forma/releases/tag/v3.0.0) carries
publication, P17 and separate post-release completion/review assets.

[Native-resource attribution](N3-NATIVE-RESOURCE-ATTRIBUTION.md) explains the
measurement policy; it is not permission to suppress a new application failure.
Application migrations and the deferred live governance rollout remain separate
work. Maintainer work-board/session snapshots are outside the source checkout;
see [documentation placement](../REPOSITORY-LAYOUT.md).
