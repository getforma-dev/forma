# Repository and documentation layout

## Current source

[getforma-dev/forma](https://github.com/getforma-dev/forma) owns all seven 3.x
packages. `packages/` contains the four npm packages, `crates/` the three Rust
crates, `e2e/` the cross-package fixtures, and `scripts/` the verification and
release tooling. Package/crate READMEs are the entry points for their APIs.

## Public documentation and internal records

| Material | Location and policy |
|---|---|
| Application guides and contracts | `docs/` and package/crate docs; keep them current with code. |
| Security, compatibility and maintenance commitments | Root security/contributor guides and `docs/release/`; keep public. |
| Reproducible tests, fixtures and release evidence | Keep beside their producers or in the indexed evidence directories. Preserve original bytes and failed results. |
| Superseded technical rationale and source snapshots | `docs/archive/` and package archives; clearly historical. Some are inputs to tests and evidence checks, so do not prune them as unused prose. |
| Maintainer tickets, agent handoffs, quota notes and workstation recovery state | Keep outside the public source checkout, alongside the maintainer work board/build workspace. Do not package them as user documentation. |

The internal `Tickets/` snapshot, imported-signal-defaults handoff and
`docs/release/quota-handoff/` were preserved externally before removal from the
current tree. Their original public copies remain in
[the preceding Git snapshot](https://github.com/getforma-dev/forma/tree/4d521384dd89319aea2ccfe4efbb603815cecc8c).
This organization change does not erase public history. The original D14 input
manifest still describes its original audited commit; it must not be rewritten
to describe today's paths. A future release must qualify its own source delta.

The historical [repository-merge bundle](repository-merge/README.md) remains
public because its input pins, rewrite tools, commit maps and verification
records explain how source history was preserved. It is not the application
quickstart. [Release decisions](release/3.0-GATE-DISPOSITIONS.md) also remain
public: they explain the scope of the actual evidence, including deferrals.

## Earlier repositories

| Repository | 3.x home | Current disposition |
|---|---|---|
| [formajs](https://github.com/getforma-dev/formajs) | `packages/core` | Main development moved; retain `maint/2.x` and its maintenance publishing path. |
| [forma-tools](https://github.com/getforma-dev/forma-tools) | `packages/compiler`, `packages/build` | Main development moved; retain `maint/0.3.x` and its maintenance publishing path. |
| [create-forma-app](https://github.com/getforma-dev/create-forma-app) | `packages/create-app` | Main development moved; retain `maint/0.6.x` and its maintenance publishing path. |

The original [cut policy](repository-merge/CUT.md) retained writable maintenance
repositories. On **2026-10-21**, the owner authorized archiving these three
repositories after this documentation update passes CI and merges. This changes
their operational availability, not the [support commitment](../SECURITY.md)
through **2027-04-20**. Archival preserves branches, tags, releases and history as
read-only records; it does not relocate or verify a replacement publisher.

Before a supported legacy fix, the owner must unarchive the affected repository,
restore and verify its existing maintenance workflow and trusted publisher, and
complete the reviewed fix and release. Alternatively, separately authorize and
verify a replacement maintenance route. Report security issues through the
[security contact](../SECURITY.md#reporting-vulnerabilities), not a new issue in
an archived repository. The framework and separate application repositories
remain active.

Historical imported tags use `formajs/<tag>`, `forma-tools/<tag>` and
`create-forma-app/<tag>`; original Rust tags retain their names. Other repositories
in the organization are separate projects. A framework release does not migrate
or retire their applications.
