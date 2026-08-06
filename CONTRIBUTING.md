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
cargo clippy --workspace --all-targets --all-features   # CI adds -D warnings
cargo fmt --all --check

# Offset arithmetic differs where usize is 32 bits, as on wasm32:
cargo test --workspace --target i686-unknown-linux-gnu

# MSRVs differ per crate, and CI builds at exactly these versions:
cargo +1.71 check -p forma-ir --all-targets
cargo +1.85 check -p forma-server --all-targets
```

Two gates are worth understanding rather than just running:

- **`crates/forma-ir/tests/list_scaling.rs`** fails the build if rendering a
  list stops being linear in row count — it asserts wall-clock time *and*
  allocation count. A list is the SSR workload the whole design rests on, so
  its cost is a tested property rather than a hope.
- **`crates/forma-ir/tests/js_emitter_contract.rs`** parses `.ir` files emitted
  by the real TypeScript compiler and diffs the rendered HTML against committed
  goldens. If it fails, the two implementations have diverged; the failure
  message tells you how to regenerate the goldens and reminds you to open the
  paired PR in `forma-tools`. Do not regenerate a golden to make a test pass
  without understanding which side changed.

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

## Pull requests

1. Branch from `main`.
2. Add tests that would fail without your change.
3. `cargo test --workspace`, `cargo clippy --workspace -- -D warnings`,
   `cargo fmt --all --check` all clean.
4. Update the affected crate's CHANGELOG under `[Unreleased]`, and any document
   whose claims your change makes untrue.
5. Describe the mutation probe you ran against your new tests.
