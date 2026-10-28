# Forma documentation

Forma 3.2.0 is the public launch baseline for new applications. It coordinates
eight packages, including the optional router. Start with the
[scaffolder](../packages/create-app/README.md) or the
[browser core quickstart](../packages/core/README.md), then add the capabilities
your application needs. Use matching 3.2.0 package versions and commit both
npm and Cargo lockfiles when using the native stack.
The [release record](https://github.com/getforma-dev/forma/releases/tag/v3.2.0)
records publication; historical decisions and evidence remain in the
[release archive](release/README.md).

## Build with Forma

| Need | Start here |
|---|---|
| Understand the rendering choices and tradeoffs | [Stack architecture](ARCHITECTURE-3.0.md) |
| Start a Rust + TypeScript app | [Scaffolder](../packages/create-app/README.md) and [rendering modes](../packages/create-app/docs/RENDERING-PHASES.md) |
| Build browser UI or a static site | [Core quickstart](../packages/core/README.md) and [API](../packages/core/docs/API.md) |
| Use Rust request data in a page | [Declared props](DECLARED-PROPS.md) and [server API](../crates/forma-server/README.md) |
| Activate server-rendered islands | [Islands and state](../packages/core/docs/ISLANDS.md) |
| Add client navigation and persistent layouts | [Routing guide](ROUTING.md), [router API](../packages/router/README.md) and [native-router starter](../packages/create-app/templates/native-router/README.md) |
| Use the explicit HTML runtime | [HTML runtime](../packages/core/docs/HTML-RUNTIME.md) |
| Know what compiles natively | [Admitted subset and build diagnostics](../packages/compiler/docs/subset.md) |
| Configure a build or deployment | [Build package](../packages/build/README.md) |
| Check package and runtime compatibility | [Compatibility contract](compatibility.md) |
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

The [canvas composition size reference](evidence/forma-246-composition-canvas-size/README.md)
records the exact named native fixture's measured route size and bounded scope.

## Release status and history

- [3.2 publication and router acceptance](release/3.2-PUBLICATION.md): completed
  qualification, actual publication, explicit waivers and website rollout.

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
