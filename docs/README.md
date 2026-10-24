# Forma documentation

Forma 3.x is one repository and seven coordinated packages. Version 3.0.0 is
published; current main also contains changes being prepared for 3.1. The
[3.1 upgrade draft](UPGRADING-3.1.md) distinguishes those unreleased changes.
Historical decisions and release evidence are kept separately from the path an
application author should follow.

## Build with Forma

| Need | Start here |
|---|---|
| Understand the rendering choices and tradeoffs | [3.0 architecture](ARCHITECTURE-3.0.md) |
| Start a Rust + TypeScript app | [Scaffolder](../packages/create-app/README.md) and [rendering modes](../packages/create-app/docs/RENDERING-PHASES.md) |
| Build browser UI or a static site | [Core quickstart](../packages/core/README.md) and [API](../packages/core/docs/API.md) |
| Use Rust request data in a page | [Declared props](DECLARED-PROPS.md) and [server API](../crates/forma-server/README.md) |
| Activate server-rendered islands | [Islands and state](../packages/core/docs/ISLANDS.md) |
| Use the explicit HTML runtime | [HTML runtime](../packages/core/docs/HTML-RUNTIME.md) |
| Know what compiles natively | [Admitted subset and build diagnostics](../packages/compiler/docs/subset.md) |
| Configure a build or deployment | [Build package](../packages/build/README.md) |
| Upgrade to published 3.0 | [Upgrade guide](UPGRADING-3.0.md) and [compatibility](compatibility.md) |
| Prepare for 3.1 (unpublished) | [3.0 → 3.1 upgrade draft](UPGRADING-3.1.md) |
| Diagnose a failure | [Diagnostic catalogue](DIAGNOSTICS.md) |

## Contracts and security

- [FMIR v3 format](FMIR-FORMAT.md): binary envelope, sections and reader rules.
- [Native/browser parity](parity-rules.md): names, values, markers and list keys.
- [Response policy and Trusted Types](TRUSTED-TYPES.md): typed responses and raw-HTML trust boundaries.
- [Ownership invariant](INV1.md): isolation and cleanup obligations.
- [Security and support](../SECURITY.md): reporting and supported release lines.

## Contribute and verify

Start with [contributing](../CONTRIBUTING.md) and the [testing policy](TESTING.md).
The [cross-package tests](../e2e/README.md), [parity harness](../e2e/parity/README.md),
[performance protocol](../e2e/performance/README.md) and [native fuzzers](../fuzz/README.md)
explain the checks behind the contracts. The [release guide](RELEASING.md) describes
maintainer procedures; it is not required to build an application.

## Release status and history

- [3.0 as-built summary](release/V3-AS-BUILT.md): actual publication, qualification,
  completed post-release soak and remaining limits.
- [Release records index](release/README.md): current procedures versus dated evidence.
- [Repository/documentation layout](REPOSITORY-LAYOUT.md): public documentation,
  internal work records and older repository maintenance.
- [Historical architecture](ARCHITECTURE.md) and [archive](archive/README.md):
  earlier designs and preserved evidence, not current API instructions.
- [Deferred governance proposal](governance/ROLLOUT.md): implementation and rollout
  are distinguished; the separate identity and external alerts are not enabled
  by documentation.

Document shipped behavior against code and tests. Attach measured claims to their
actual version, producer and scope; a historical result is not a fresh run.
Retain original evidence and failures. Keep operational handoffs and work boards
outside the source tree; use public guides and reproducible records for users.
