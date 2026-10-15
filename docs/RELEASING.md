# Unified releases

FORMA-187 prepares the merged repository for one release of seven packages.
The checked-in contract record deliberately has `liveReleaseReady: false`.
A2 dry runs establish the pipeline; they do not assert that FMIR v3, manifest 2,
props, the version window, milestone templates or fixture measurements exist.
Those ticket owners must add their failing tests and update
`scripts/release-contracts.json` before the first `v3.0.0-alpha.1` tag.

## Prepare and test

Use Node from `.node-version` (24.22.0) and Rust/Cargo 1.93.1. Published runtime
and crate MSRV floors remain independent and retain their CI matrix.

```
node scripts/release-set.mjs version 3.0.0-alpha.1
bash scripts/install-deps.sh
npm run check
```

The version command changes seven manifests, their exact internal requirements,
the workspace locks, npm repository metadata and release template ranges. It
creates neither tags nor commits. A `3.0.0-dev` version aligns only the packages
and workspace locks, preserving A2 template pins until FORMA-144 migrates them.
Add a root CHANGELOG entry headed `## [3.0.0-alpha.1]`, review and commit the
release PR, and tag the green main commit with `v3.0.0-alpha.1`.

Only tag pushes trigger release.yml. `check` requires the latest readable,
successful main-push CI run for the exact commit, including the executed R17
command and release workflow probes. A skipped required job, failed run, missing
run or API failure refuses the release. It does not silently wait forever;
rerun after CI completes if the tag arrived first.

## Packed set and template locks

`pack` installs the committed dependency graph with scripts off, builds, then
packages every crate with `cargo package --workspace --no-verify --locked` and
packs all npm packages with `--ignore-scripts`. Cargo 1.90 stabilized workspace
packaging/publishing of unpublished interdependent crates; the pinned 1.93.1
behavior is also exercised by an offline two-crate test that packages twice and
compares bytes and the unchanged lock. See the [Rust 1.90 release notes](https://blog.rust-lang.org/2025/09/18/Rust-1.90.0/).

Source template locks cannot contain a future registry checksum before that
artifact has been packed. Pack first creates the three crates and three library
npm tarballs, then stages **only** internal package versions, dependency metadata,
registry URLs and checksums into the create-app templates. Third-party resolutions
remain unchanged. It packs create-app last and restores all source template files,
including after a staging/write failure. Packed template `_npmrc` files are kept
and restored to `.npmrc` by the CLI. DS11 contains seven archives, the exact source
Cargo.lock and release-set.json with commit, run, toolchain, contract versions and
archive hashes. SHA256SUMS covers every file; its own hash travels separately as a
job output, so replacing both an archive and its manifest fails verification.

`verify`, without OIDC permission, checks DS11 and the recorded lock, installs
locked tools with scripts off, checks fresh advisories against the root lock and
each crate archive’s own lock (only internal sources substituted), and checks npm registry signatures,
then runs the packed compiler/reader corpus and both packed templates. For local
installation it substitutes DS11 file URLs and extracted crate paths for internal
packages only. It checks locked installation, build, serve, browser interaction,
no pending island and refusal of corrupt IR before binding. These are explicit
local substitutions; the shipped template uses registry URLs/checksums.
Unpublished candidates have no registry signatures yet: DS11 SHA-256 authenticates
their bytes, while `npm audit signatures` checks their registry dependencies.
Future contract owners extend this same P17 job; they must not weaken exact version
checks to make the A2 skeleton pass.

## Publication and retry

Configure trusted publishers for `release.yml` in getforma-dev/forma, with
`crates-publish` for all three crates and `npm-publish` for all four npm packages.
Both environments allow release tags and have **no required reviewer**. This is
the existing environment plan, not an additional approval gate. Current [npm trusted
publisher documentation](https://docs.npmjs.com/trusted-publishers/) allows up to ten
publishers, so retain the maintenance publisher. A new configuration expires unless
it first publishes within two days and defaults to stage-only: explicitly choose
**Allow npm publish**, consistent with the founder's autonomous-release decision.
Create the new entries just before the first live alpha, not weeks before it. Publisher
hookup gates the first live publish; it does not require deleting maintenance access
or prevent the history/code merge. Admin-only v* tag rules still apply.

Two sequential minimal jobs hold OIDC permission. Each downloads only this run's
DS11 and verifies its independently anchored hash before publication. Neither
installs dependencies, restores a cache nor executes dependency code. Crates run
first. Cargo cannot upload a supplied .crate directly: the job uses the identical
source commit, source lock and pinned toolchain, repacks with no verification build,
and requires byte equality with P17's archives before invoking workspace publish
with `--no-verify --locked`. No temporary registry config or staging manifest is
introduced in that checkout, preserving Cargo VCS metadata. npm uploads the exact
DS11 tarballs with `--ignore-scripts --provenance`; prereleases use `next`.

Two registries are not transactional. Before uploading anything, each job queries
all seven versions. A present version is skipped only when its registry checksum
matches DS11 exactly (and a crate is not yanked); a mismatch, unreadable response
or failure after upload stops the run. Only HTTP 404 means absent. Crate publication
must be visible before npm starts. Polling has a bounded deadline including requests
and sleeps. Retry the same tag/run after a transient partial failure; matching
versions are skipped and missing ones are published. Never retag or rebuild different
bytes under the same version. If bytes differ, investigate and prepare a new version.

`record` alone has contents-write permission. It creates/updates the GitHub Release
with the changelog, compatibility versions, DS11 checksums and P17 measurements,
then uploads the JSON record; a missing record fails the job. G6's measurement starts
at GitHub's tag-triggered workflow `created_at` (including queue time) and ends after
GitHub acknowledges the release write. Actions does not expose exact tag-push
network ingestion latency; the recorded timing basis states this limitation.

## Local dry run

```
bash scripts/install-deps.sh
npm run build
node scripts/release-set.mjs pack /absolute/path/to/empty-ds11 --dry-run
bash scripts/release-artifacts.sh record /absolute/path/to/empty-ds11
node scripts/verify-release-set.mjs /absolute/path/to/empty-ds11 /absolute/path/to/p17.json
ruby scripts/check-release-workflow.rb --self-test
bash scripts/test-release-artifacts.sh
```

The dry-run marker is rejected by the publication helper regardless of environment.
A run over the previously published A2 archives is recorded separately from newly
packed merged-tree candidates; the latter include 117's scripts-off policy changes
and are not claimed byte-identical to the old release. Neither dry run publishes.
