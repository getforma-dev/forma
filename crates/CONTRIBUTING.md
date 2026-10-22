# Contributing to Forma

## Before your first PR

Read [the 3.0 architecture](../docs/ARCHITECTURE-3.0.md) and, for emitted
bytes, [the FMIR format](../docs/FMIR-FORMAT.md). The Rust crates and TypeScript
packages share the format, declared-props and browser-adoption contracts in one
repository. A contract change must update each affected layer together.

## Setup and checks

Use the toolchain pinned in the repository's `.node-version` for workspace
commands and Rust 1.85 or newer for the full crate workspace. From the root:

```bash
git clone https://github.com/getforma-dev/forma.git
cd forma
npm ci --ignore-scripts
npm run build
cargo test --locked --workspace
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo fmt --all --check
```

`npm run check` runs the integrated R17 source checks. The
[testing guide](../docs/TESTING.md) documents focused lanes, prerequisites and
the distinction between source checks and packed release qualification.

The crate floors differ: `forma-ir` and `forma-ir-derive` declare Rust 1.71;
`forma-server` declares Rust 1.85. CI checks each with the committed
`Cargo.lock` and `--locked`, and separately checks fresh MSRV-aware resolution.
Do not regenerate the workspace lock as part of an ordinary test run.

```bash
cargo +1.71 check -p forma-ir --all-targets --locked
cargo +1.71 check -p forma-ir-derive --all-targets --locked
cargo +1.85 check -p forma-server --all-targets --locked
cargo clippy --locked -p forma-server --all-targets --all-features --release -- -D warnings
cargo test --locked -p forma-server --release
```

CI also exercises 32-bit offset arithmetic on `i686-unknown-linux-gnu`.
Release-only server checks matter because debug builds do not compile the
embedded-snapshot path. The coordinated release workflow and its control
scripts are documented in [the release runbook](../docs/RELEASING.md).

Two contract checks deserve care:

- `crates/forma-ir/tests/list_scaling.rs` compares time and allocation growth
  across row counts. It is a regression control for the tested workload, not a
  universal latency bound.
- `crates/forma-ir/src/js_emitter_contract.rs` reads real compiler output and
  compares HTML with committed goldens. Investigate any difference in both
  `packages/compiler` and `crates/forma-ir` before regenerating fixtures.

## Tests

The testing standard for this repo is
[the testing policy](../docs/TESTING.md) — eight rules, a reviewer's checklist, and
the citation contract. The two that get PRs sent back most often:

- **A test must be able to fail.** Break the thing your test covers and watch
  it go red before you open the PR. Say which edit you made in the PR
  description.
- **A `// Verified by:` comment is a claim, not a decoration.** It cites a test
  *name*, and it is honest only if that specific test fails when the property
  breaks. A citation pointing at a test that cannot fail is worse than no
  comment, because it converts a reviewer's suspicion into confidence.

## Documentation

Docs are held to the same standard as code, for the same reason: an untrue
comment stops the next reader checking.

- Cite the test that proves a claimed behaviour. If a claim cannot be tested,
  write it as mechanism or rationale, not as a guarantee.
- Tie measured numbers to their actual source, environment and producer. A cited
  historical release result is not a new measurement of current source.
- Preserve superseded technical records and test evidence. Internal work boards
  and session notes belong outside the checkout after preservation; follow the
  [root documentation policy](../CONTRIBUTING.md#documentation).

## Crate structure

- `crates/forma-ir/` — FMIR binary parser and native HTML walker
- `crates/forma-ir-derive/` — `PageProps` metadata derive
- `crates/forma-server/` — Axum middleware: page rendering, assets, CSP

Each crate has its own README (published to crates.io) and its own CHANGELOG.
The workspace CHANGELOG summarises the coordinated release.

## Releasing

All crates and npm packages release together through the merged repository.
See [the release runbook](../docs/RELEASING.md). The `ir-v*` and `server-v*`
procedures survive only in the historical maintenance branches.

## Pull requests

1. Branch from `main`.
2. Add tests that would fail without your change.
3. `cargo test --workspace`, `cargo clippy --workspace -- -D warnings`,
   `cargo fmt --all --check` all clean.
4. Update the affected crate's CHANGELOG under `[Unreleased]`, and any document
   whose claims your change makes untrue.
5. Describe the mutation probe you ran against your new tests.
