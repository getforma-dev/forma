# Contributing to Forma

One repository, two workspaces: the crates (`crates/`, Cargo) and the npm
packages (`packages/`). Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
before your first PR; it explains what each package does, what crosses each
boundary between them and why. If your change touches the emitted bytes, read
[`docs/FMIR-FORMAT.md`](docs/FMIR-FORMAT.md) too: the FMIR layout and the
hydration wire contract are shared byte-for-byte between the compiler, the
walker and the client runtime, and since the merge a change to them is one
pull request here, with its corpus.

## Setup and the gate

```bash
git clone https://github.com/getforma-dev/forma.git
cd forma
npx playwright install chromium   # once
npm run check
```

`npm run check` ([`scripts/check.sh`](scripts/check.sh)) is the gate CI runs
on every push and pull request, and the one command that builds every package
in both languages and runs every test. It uses Node 24.22.0 (the pinned build toolchain in `.node-version`) and a stable
Rust toolchain with `rustfmt` and `clippy`. Its steps, for when you want one of them alone:

| Step | Command |
|---|---|
| Install the npm workspace exactly as the lockfile records it | `npm ci --ignore-scripts` |
| The crates: format, lint, tests, docs | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo test --workspace`, `cargo doc --workspace --no-deps` |
| The npm packages: builds and unit suites | `npm run build`, `npm test --workspaces` (or `-w packages/<name>`) |
| Core's gates: types, size, packaging, probe anchors | `npm run typecheck -w packages/core`, `npm run check:size -w packages/core`, `npm run check:pack -w packages/core`, `cd packages/core && node scripts/run-probes.mjs --check` |
| The packed `forma-raw-lint` bin, as an application installs it | `node packages/build/scripts/test-raw-lint-bin.mjs` |
| The FMIR contract: this compiler emits the corpus forma-ir has committed, and forma-ir reads it | `npm run emit:corpus -- "$PWD/crates/forma-ir/tests/fixtures/js-emitter"`, then `cargo test -p forma-ir --lib js_emitter_contract`; the fixtures must be unchanged |
| The browser lanes (Chromium): the build package's worker upgrade, the full-stack, SSR and preview-frame lanes, core's own suite | `npm run test:browser -w packages/build`, `npm run test:e2e` (see [`e2e/README.md`](e2e/README.md)), `npm run test:e2e -w packages/core` |
| The parity harness's own tests (FORMA-183): state generator, comparison, serializer, server half, `renderBoth` and the suite (Node 24's type stripping); the corpus run itself is CI's non-blocking `parity` job | `npx tsc --noEmit -p e2e/parity`, `node --test "e2e/parity/tests/*.test.mts"`; the corpus: `node e2e/parity/src/run.mts` (see [`e2e/parity/README.md`](e2e/parity/README.md)) |

CI adds, beside that command, what needs another toolchain, target or
operating system: the crates where `usize` is 32 bits, forma-server with the
release profile, each crate at exactly its declared `rust-version` with the
committed lock (`cargo +1.71 check -p forma-ir --all-targets --locked`,
`cargo +1.85 check -p forma-server --all-targets --locked`), cargo-deny, the
compiler and build package and the crates on Windows, the release workflow's
SR43 lint, and create-app's scaffold gate against the published packages. Two
workflows run on their own schedule: core's suite in all three engines
(`e2e-engines.yml`, before a release) and the nightly mutation probes
(`nightly-probes.yml`).

**Skipped checks that are by design.** On a pull request or a push, a CI job
shows "skipped" only when a job it needs has failed, or when `scaffold`'s
`preflight` finds a template pin not yet on npm (a release in progress). A job
skipped for any other reason is a defect in the workflow (FORMA-179).

## Each package's own guide

The gates above are the whole repository's. Each package keeps the guide for
its own code: what to read first, how its tests are shaped, what must not
change. Read the one for the package you touch.

| Package | Guide |
|---|---|
| The crates | [`crates/CONTRIBUTING.md`](crates/CONTRIBUTING.md) |
| `@getforma/core` | [`packages/core/CONTRIBUTING.md`](packages/core/CONTRIBUTING.md) |
| `@getforma/compiler`, `@getforma/build` | Their READMEs; forma-tools' guide is archived at [`docs/archive/`](docs/archive/README.md) |
| `@getforma/create-app` | [`packages/create-app/CONTRIBUTING.md`](packages/create-app/CONTRIBUTING.md) |

## Tests

The testing standard is [`docs/TESTING.md`](docs/TESTING.md): eight rules, a
reviewer's checklist, and the citation contract. The two that get PRs sent
back most often:

- **A test must be able to fail.** Break the thing your test covers and watch
  it go red before you open the PR. Say which edit you made in the PR
  description.
- **A `// Verified by:` comment is a claim, not a decoration.** It cites a test
  *name*, and it is honest only if that specific test fails when the property
  breaks.

## Documentation

Docs describe implemented behavior and cite the owning code/tests. Keep the
[documentation index](docs/README.md) current. New measurements name their source
and environment; when summarizing an existing release, cite its actual retained
producer and scope rather than presenting it as a fresh run.

Preserve historical contracts, source snapshots and verification evidence in the
indexed archives; some are executable test inputs. Internal work boards, quota
notes and agent handoffs belong outside the source checkout. Preserve existing
records before relocating them and update active links without rewriting old
release manifests or Git history. See [documentation placement](docs/REPOSITORY-LAYOUT.md).

## Workspaces and lockfiles

- `Cargo.lock` is committed, for the root workspace and for the e2e lanes'
  (`e2e/Cargo.lock`). The root lock is made with Cargo's MSRV-aware resolver
  (`CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo generate-lockfile`),
  which honours the lowest `rust-version` among the members (forma-ir's 1.71)
  for the whole graph, so each crate builds its declared Rust with `--locked`
  and the lock the release packs is the one CI tests.
- `package-lock.json` is the one npm lockfile; the packages have none of their
  own. `npm ci --ignore-scripts` installs it; `npm install` may resolve anew and rewrite it, so
  run that only when you mean to change a dependency, and say so in the PR.
- Package names and versions are each package's own; do not bump a version in
  a PR. Add CHANGELOG lines under the package's `## [Unreleased]` heading.

## Releasing

All seven packages use one version and one `v*` tag through the merged
repository workflow. See [the release runbook](docs/RELEASING.md) for version
preparation, packed verification, the two publishing environments and partial
release recovery. The current A2 rehearsal cannot publish a live milestone.

## Pull requests

1. Branch from `main`.
2. Add tests that would fail without your change.
3. `npm run check` clean, or the steps of it your change can affect, named in
   the PR.
4. Update the affected package's CHANGELOG under `[Unreleased]`, and any
   document whose claims your change makes untrue.
5. Describe the mutation probe you ran against your new tests.

## Dependency policy (FORMA-117)

Run `bash scripts/install-deps.sh` to install the committed npm graph without lifecycle scripts.
The repository's `.npmrc` keeps ordinary installs scripts-off too. `allowScripts` records the
reviewed esbuild versions; current builds use its locked optional platform binaries without
running any install hook. A new native dependency must prove it builds under this policy.
The templates ship `_npmrc` (npm excludes `.npmrc` from tarballs); scaffolding restores its name.

`bash scripts/check-advisories.sh` audits production npm dependencies for the workspace and both
templates, then the locked Rust graph. It explicitly fetches the advisory DB, so an unavailable
source fails instead of accepting stale data. The CI deny job also checks the e2e graph and all
Cargo license/source rules. `advisories.yml` repeats the check weekly; Dependabot maintains the
GitHub Action SHA pins. cargo-deny 0.20.2 is installed with its published lockfile.

Dependency security updates for active npm projects remain enabled. The root
Vite override selects the patched 7.x line; upgrading to Vite 8/Vitest 5 is a
separate compatibility change, including the benchmark API and matching coverage
provider. Update Vitest and `@vitest/coverage-v8` together when their peer contract
requires it; do not bypass npm's peer resolution.

`docs/archive/**` contains historical dependency snapshots, including files bound
to recorded evidence. Dependabot ignores update PRs for that directory while its
security alerts remain visible. Those files are not current installations; retain
their bytes and update the active dependency graph instead. The archive-only npm
configuration does not disable updates or alerts for active packages/templates.

A CSS build requires a local `@tailwindcss/cli`; builds never fetch it with `npx`. `alien-signals`
is pinned exactly to 3.1.2. The private workspace uses the pinned Node build toolchain while
Node 22/24 compatibility jobs exercise the published packages' Node 22 floor. The dated
policy adds Node 26 on 2026-10-28; maintenance gates continue using `.node-version`.
