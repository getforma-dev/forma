# Contributing to Forma

## Before your first PR

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). It is long on purpose: it
explains what the four repos do, what crosses each boundary between them, and
why each load-bearing decision was made. Most review comments on a first PR are
questions that document already answers.

If your change touches the emitted bytes, read
[`docs/FMIR-FORMAT.md`](docs/FMIR-FORMAT.md) too. **The FMIR binary layout and
the hydration wire contract are shared byte-for-byte with the TypeScript side
and with downstream consumers** — they are not this repo's to change alone.

## Setup

```bash
git clone https://github.com/getforma-dev/forma.git
cd forma
cargo test --workspace
```

## The gates

CI runs all of these; run them locally before you push.

```bash
cargo test --workspace                                  # unit + integration + doctests
                                                        # (needs Node 18+ on PATH: the retiring
                                                        # service worker runs under node --test)
cargo clippy --workspace --all-targets --all-features   # CI adds -D warnings
cargo fmt --all --check

# Offset arithmetic differs where usize is 32 bits, as on wasm32:
cargo test --workspace --target i686-unknown-linux-gnu

# forma-server has release-only code (cfg(not(debug_assertions))) that the
# commands above never compile:
cargo clippy -p forma-server --all-targets --all-features --release -- -D warnings
cargo test -p forma-server --release

# MSRVs differ per crate, and CI builds at exactly these versions:
cargo +1.71 check -p forma-ir --all-targets
CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo +1.85 generate-lockfile
cargo +1.85 check -p forma-server --all-targets
```

The release workflow has its own check, which CI's `release-workflow` job
runs after actionlint (Ruby and bash come with the runner and with macOS):

```bash
ruby scripts/check-release-workflow.rb --self-test   # SR43: only the publish job holds id-token: write
bash scripts/test-release-artifacts.sh               # a packed file altered between jobs is refused
bash scripts/test-check-published-crate.sh           # after a publish: "differs" fails, "not visible yet" warns
bash scripts/check-forma-ir-requirement.sh           # forma-server requires exactly forma-ir's version
```

`check-forma-ir-requirement.sh` (CI's `patch-is-live` job) fails unless
forma-server's `forma-ir` requirement, normal and dev, equals forma-ir's
version: `[patch.crates-io]` resolves forma-ir from this tree whatever the
requirement says, so a looser one (0.2.2 carried `"0.2.0"` until FORMA-138)
builds green here and in the release workflow's `verify` job while a
consumer's lock may hold a forma-ir that lacks what forma-server calls.

**forma-server on Rust 1.85 to 1.87.** sha2 0.11.1 and later declare Rust
1.88, and a resolve that ignores `rust-version` takes them, so the 1.85 check
fails before it compiles any forma-server code. The `generate-lockfile` line
re-locks with Cargo's MSRV-aware resolver (Cargo 1.84+), which prefers the
versions that fit the members' declared `rust-version` and so holds sha2 at
0.11.0. CI's `msrv (forma-server, 1.85)` leg locks the same way and prints the
sha2 version it built, and the release workflow's `pack` job locks the same
way too, so the `Cargo.lock` inside the published `.crate` builds with
`--locked` on the Rust the crate declares (the SR43 lint's rule K5 keeps the
setting there; A2 audit F7, FORMA-180). `Cargo.lock` is not committed: run
`cargo generate-lockfile` again afterwards to put the other gates back on the
newest versions, as CI's stable jobs are.

Consumers of forma-server on Rust 1.85 to 1.87 need the same, one of:

- the MSRV-aware resolver: `resolver = "3"` (the default for edition 2024),
  `incompatible-rust-versions = "fallback"` under `[resolver]` in
  `.cargo/config.toml`, or `CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback`
  in the environment; it applies when the lock is made, so run `cargo update`
  to re-resolve an existing one;
- or `cargo update -p sha2 --precise 0.11.0`.

Two gates are worth understanding rather than just running:

- **`crates/forma-ir/tests/list_scaling.rs`** fails the build if rendering a
  list stops being linear in row count — it asserts wall-clock time *and*
  allocation count. A list is the SSR workload the whole design rests on, so
  its cost is a tested property rather than a hope. The time half compares
  sizes 32x apart in back-to-back rounds and judges the median, so a loaded
  machine does not fail it (FORMA-167; 16x apart until FORMA-180).
- **`crates/forma-ir/tests/js_emitter_contract.rs`** parses `.ir` files emitted
  by the real TypeScript compiler and diffs the rendered HTML against committed
  goldens. If it fails, the two implementations have diverged; the failure
  message tells you how to regenerate the goldens and reminds you to open the
  paired PR in `forma-tools`. Do not regenerate a golden to make a test pass
  without understanding which side changed.

**Skipped checks that are by design.** On a pull request or a push, a CI job
shows "skipped" only when a job it needs has failed: `test-32bit`,
`test-release` and `msrv` need `test`, so a red `test` skips them, and they run
once it is green. `release.yml` runs only for a release tag (`v*`), never on a pull request. A job skipped for any other reason is a
defect in the workflow (FORMA-179).

## Tests

The testing standard for this repo is
[`docs/TESTING.md`](docs/TESTING.md) — eight rules, a reviewer's checklist, and
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
- Do not copy a number (size, benchmark, test count, version) from one document
  into another without re-running the thing that produces it.
- Do not delete a superseded document — move it to
  [`docs/archive/`](docs/archive/) and add its entry to the index there, saying
  what it was, when it was retired and why.

## Crate structure

- `crates/forma-ir/` — FMIR binary parser, HTML walker, WASM exports
- `crates/forma-server/` — Axum middleware: page rendering, assets, CSP

Each crate has its own README (published to crates.io) and its own CHANGELOG.
The workspace CHANGELOG summarises a release and links to both.

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
