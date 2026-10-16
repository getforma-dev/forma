# Unified releases

FORMA-187 prepares the merged repository for one release of seven packages.
The checked-in contract record, `scripts/release-contracts.json`, states which
tickets gate which milestone (alpha, beta, rc, final); a tag publishes only when
every gate of its milestone and of the earlier milestones is done. Today the
alpha's gates are done and the later milestones' are open, so `v3.0.0-alpha.N`
may publish and `v3.0.0-beta.1`, `v3.0.0-rc.1` and `v3.0.0` are refused. See
[the milestone gate](#milestone-gate) below and, for the alpha day itself,
[docs/release/ALPHA-RUNBOOK.md](release/ALPHA-RUNBOOK.md). A2 dry runs
establish the pipeline; they do not assert that the later milestones' contracts
exist.

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

## Milestone gate

A tag names its milestone: `-alpha.N`, `-beta.N`, `-rc.N`, or none for the
final; `-dev` versions name no milestone and never publish. The contract file
lists the four milestones in order, each with its plan milestone (`M2` to `M5`)
and its gates, keyed by ticket (plus a slice or step when one ticket spans
milestones, such as `FORMA-144 slice 1`), each gate `done` or `pending` with a
one-line scope. A milestone inherits every earlier milestone's gates. The resolver
in `scripts/release-set.mjs` (`releaseMilestone`, `assertMilestoneReady`) is
enforced four times on a live tag, each time from the contract the pack job
recorded into DS11: `pack` refuses before packing, P17 refuses before passing,
both publish jobs refuse before uploading, and `record` refuses before writing
DS12. A dry run resolves the milestone unenforced and records it (null for a
`-dev` set). Advancing a milestone is a reviewed pull request that flips its
gates to `done` with the evidence named in the ticket; there is no global switch,
and the lint rejects one (`liveReleaseReady` or a top-level `pending` list).

The lint (`ruby scripts/check-release-workflow.rb --self-test`) checks the
contract's shape beside the workflow: exactly `alpha`, `beta`, `rc`, `final` in
order (C1); each with a plan milestone and non-empty gates whose keys are tickets
and whose entries carry a `done`/`pending` status and a scope (C2); no gate in
two milestones (C3); no global switch (C4); the one release version the gates
are written for, `version`, which the resolver asserts against the tag's base
version so a `v3.1.0-alpha.1` cannot pass 3.0.0's gates (C5). Its self-test
seeds thirteen contract violations beside the thirty-two workflow ones, and its
last line names the
milestones that may publish today. The GitHub Release names the milestone, where
it went on npm (`next` for a pre-release, `latest` for the final) and every gate
still open before the later milestones (`releaseNotes` in
`scripts/release-record.mjs`); DS12 carries the resolved milestone as `milestone`.

Only tag pushes trigger release.yml. `check` requires the latest readable,
successful main-push CI run for the exact commit, including the executed R17
command and release workflow probes. A skipped required job, failed run, missing
run or API failure refuses the release. It does not silently wait forever;
rerun after CI completes if the tag arrived first.

The credential-free `engines` job also runs the reusable Chromium, Firefox and
WebKit suite on the tagged commit. P17 depends on all three engines succeeding;
both publishing jobs depend on P17, so an engine failure blocks publication.

## Packed set and template locks

`pack` installs the committed dependency graph with scripts off, builds, then
packages every crate with `cargo package --workspace --no-verify --locked` and
packs all npm packages with `--ignore-scripts`. Cargo 1.90 stabilized workspace
packaging/publishing of unpublished interdependent crates; the pinned 1.93.1
behavior is also exercised by an offline two-crate test that packages twice and
compares bytes and the unchanged lock. See the [Rust 1.90 release notes](https://blog.rust-lang.org/2025/09/18/Rust-1.90.0/). Each packaging
attempt uses its own fresh `--target-dir` and removes only that owned directory
after copying the archives. Reusing Cargo's temporary packaging registry after a
source change can retain a predecessor's old checksum even at the same version.
The changed-source regression checks every dependent lock against its actual new
predecessor archive and verifies the packed source-commit metadata; shared build
targets and failed release artifacts remain untouched.

Source template locks cannot contain a future registry checksum before that
artifact has been packed. Pack first creates the three crates and three library
npm tarballs, then stages internal package versions, dependency metadata,
registry URLs and checksums into the create-app templates. For the finalized 3.0.x
candidate contract, an authenticated source adapter also stages the reviewed
typed startup API; historical A2 source stays unchanged. Third-party resolutions
remain unchanged. It packs create-app last and restores all source template files,
including after a staging/write failure. Packed template `_npmrc` files are kept
and restored to `.npmrc` by the CLI. DS11 contains seven archives, the exact source
Cargo.lock and release-set.json with commit, run, toolchain, contract versions and
archive hashes. SHA256SUMS covers every file; its own hash travels separately as a
job output, so replacing both an archive and its manifest fails verification.

`verify`, without OIDC permission, checks DS11 and the recorded lock, installs
locked tools with scripts off, checks fresh advisories against the root lock and
each crate archive’s own lock (only internal sources substituted), and checks npm registry signatures,
then runs the packed compiler/reader corpus and both packed templates. Before any
packed code runs, P17 writes a `node_modules/@getforma` beside the unpacked libraries,
linking each packed one, and proves with Node's resolver that every bare `@getforma/*`
specifier in every packed dist resolves inside the packed set
(`scripts/release-packed-resolution.mjs`): the packed build imports its optional
compiler peer by name, the `verify` job never builds `packages/*`, and the checkout's
root `node_modules` holds workspace links, so without the links the import failed on a
tag (`v3.0.0-alpha.1`) and silently used the workspace build on a built workstation. For local
installation it substitutes DS11 file URLs and extracted crate paths for internal
packages only. It checks locked installation, build, serve, browser interaction,
no pending island and refusal of corrupt IR before binding. These are explicit
local substitutions; the shipped template uses registry URLs/checksums.
Unpublished candidates have no registry signatures yet: DS11 SHA-256 authenticates
their bytes, while `npm audit signatures` checks their registry dependencies.

npm determines signature eligibility from each dependency's requirement, so an exact
peer requirement can make an unpublished local candidate look like a registry package.
P17 therefore audits a separate copy of the installed tree: only candidates authenticated
against DS11 become local npm workspaces. Their inactive development dependencies are
omitted from that audit copy so workspace semantics cannot invent new dependency edges.
Runtime, peer and optional requirements stay unchanged. The helper compares the complete
external package inventory, dependency edges and manifest bytes before auditing it, then
runs npm's normal signature verifier. Every registry error remains a failure. The report
lists each audited external location, version, URL and integrity, plus each candidate's
DS11 digest. The original installation and lock used for build/browser tests are unchanged.
Future contract owners extend this same P17 job; they must not weaken exact version
checks to make the A2 skeleton pass.

Before those substitutions, P17 validates each shipped internal dependency's
version, registry URL, checksum and dependency metadata against DS11. It never
repairs a malformed shipped lock. The packed CLI runs outside the source checkout,
with only the runtime dependencies declared by its packed manifest, installed
scripts-off from the recorded lock graph. A missing packaged dependency therefore
fails the same CLI execution that a consumer would run.

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

## Current development integration

Between releases `main` carries the next version with the `-dev` suffix: the current
seven-package set is staged at `3.0.0-dev` again after `v3.0.0-alpha.2` published
(2026-10-15), by the post-release pull request that runs
`node scripts/release-set.mjs version 3.0.0-dev`; the released sections stay in every
changelog under a fresh `## [Unreleased]`, and the crate READMEs keep naming the last
published pre-release, which is what crates.io shows. A `-dev` version names no
milestone and never publishes. The contract record names
FMIR v3. P17 compares the packed compiler's writer triple and canonical dumps with
the packed reader's actual version and frozen corpus. Version preparation updates
all three Cargo locks (root, e2e and fuzz) without changing external resolutions.

The source templates still carry their A2 Cargo requirements and API usage; FORMA-144
owns their milestone migration. Packing may stage candidate checksums, but that does
not make those source requirements compatible with v3. A current-development dry run
is labeled `v3-development-dry-run`, and a template refusal remains a failed P17 result.
Do not weaken its locked checks or describe that result as complete template acceptance.
The later milestones' gates stay `pending` in the contract until their tickets close.
The archived A2 dry-run evidence continues to describe the original published set.

## Local dry run

```
bash scripts/install-deps.sh
npm run build
node scripts/release-set.mjs pack /absolute/path/to/empty-ds11 --dry-run
bash scripts/release-artifacts.sh record /absolute/path/to/empty-ds11
FORMA_PERFORMANCE_TARGET_TAG=v3.0.0-beta.1 node scripts/verify-release-set.mjs /absolute/path/to/empty-ds11 /absolute/path/to/p17.json
ruby scripts/check-release-workflow.rb --self-test
bash scripts/test-release-artifacts.sh
```

The dry-run marker is rejected by the publication helper regardless of environment.
A run over the previously published A2 archives is recorded separately from newly
packed merged-tree candidates; the latter include 117's scripts-off policy changes
and are not claimed byte-identical to the old release. Neither dry run publishes.

## Fixture applications and the measurement step (FORMA-188)

The contract record carries `fixtureApps: "declared-v1"`. For such a set P17 also runs the fixture
applications of `e2e/fixtures/apps/` against DS11, after the templates:

1. The project is staged in `os.tmpdir()`, outside the checkout, from the committed sources (each file is
   compared with `git show <commit>:` so a dirty tree cannot be what a tag verified). The three libraries
   install from DS11's tarballs by `npm ci --ignore-scripts` on a lock built from the tagged tree's own
   `package-lock.json` (the same staging as the templates, `stageNpmLock`); the signatures are audited as
   for the templates; and every `@getforma/*` import of the installed libraries is proved to resolve inside
   the install, never to a workspace link of the checkout (the alpha.1 failure).
2. Every application is built with the **packed** `build()` in strict mode: anything above a note fails.
3. The Rust servers build from DS11's crates (`[patch.crates-io]` to the extracted archives, as for the
   templates) on a lock pruned from `e2e/Cargo.lock` to the crate's graph, third-party versions and
   checksums untouched, `cargo build --locked`.
4. Each packed server is started and judged by the same `lib/verify-page.mjs` and `lib/behaviours.mjs` the
   source lane's `apps.spec.ts` uses: the server's values before any script, strict adoption that writes
   nothing, the islands working afterwards; the extra checks (a hostile tenant name, an unknown tenant, the
   other branches); the packed compiler's refusal of the shapes `negative/` holds; and the admitted keyed-list island in `positive/`, whose size report is retained.

The measurement step (`scripts/release-measurements.mjs`) then fails P17 naming a figure and both numbers
when P17's wall time passes G6's 1,800 s, when Forma's code on any fixture route passes N2's ceiling
(read from each build's emitted `size-report.json`, including the route class's ceiling and both Forma and total-JavaScript verdicts; gzip -9; L-58; the build refuses excess too, BUILD-819), or when a fixture route has no figure; and records,
with the machine and profile, in `report.measurements` (which `release-record.mjs` embeds in DS12 and
summarises in one line of the Release's notes): P17's time, N2 per route in gzip and Brotli beside the
application's own bytes, and the walker's node, byte and list counts of the consumer-shaped pages
(recorded, not gated). FORMA-191 adds N1, N3 and N5 rows to the same record. The skew drill is not called
yet: it is FORMA-186's lane, and `stageFixtureProject()` returns what its call will take.

Rehearse it as the runner sees it: commit, `pack` a dry-run DS11, delete `packages/*/dist`, then run P17.

## Staged response contract (FORMA-109)

The DS11 contract records `trustedTypes: "enforced-v1"`. P17 reads the actual
HTTP and browser-navigation enforcement headers for both packed templates,
requires the two intended policy names, and records native Trusted Types support,
all `securitypolicyviolation` events and page errors across positive interaction.
A passing result requires zero events and errors; separate native browser controls
prove enforcement actually refuses a raw sink write. Empty `pageerror` alone is
not evidence of zero CSP reports.

Until FORMA-144 migrates the source templates, packing candidate 3.x removes
exactly the known `config_script: None,` field from each template's `src/main.rs`.
Unexpected source or a future major fails before writes. A2 packing leaves source
untouched; candidate packing restores both source files plus all eight manifests
and locks on success or failure. This adapter does not migrate applications or
claim FORMA-144 complete. The recurring restoration test and a new actual packed
rehearsal document this stage; historical A2 and earlier P17 reports stay unchanged.
FORMA-144's later slices remain `pending` gates of the beta and the final.

## Finalized rendering in candidate templates

The `finalized-v1` bound-render contract additionally requires the packed server's external finalization, budget, typed document-home, browser-mode, panic and topology snapshot checks. The candidate-only 3.0.x source adapter authenticates whole A2 source hashes and stages the reviewable files in `scripts/fixtures/candidate-templates`; any source drift or unsupported version fails. All ten original source/manifests/locks are restored after packing, including failure. Both candidates finalize before opening a listener. The source templates' later slices (FORMA-144 slices 2 and 3) remain pending gates of the beta and the final.

### Per-release performance contract (FORMA-191)

P17 `performance: measured-v1` requires20,000 native walks for each of five consumer-shaped pages in the application release profile, N5 allocation/time growth, public one-past budget refusals,20 cold applied-mobile Lighthouse13.5.0 runs on each of the tenant-login and100-island pages, independent actual event-response observations, and the archived founder comparison in all three browser engines. No timing row may be omitted. Native p99 throughput below1,500,000nodes/s or at/below half the prior DS12 rate fails. TBT p95 must be below200ms; responses must complete within500ms of first paint; no task may exceed50ms. The complete raw Lighthouse reports and configuration, per-walk durations, machine/profile, prior-record digest and client comparisons are embedded in DS12. They are measurements of a lab profile, not a phone claim.

A dry-run P17 must set `FORMA_PERFORMANCE_TARGET_TAG` to its intended release (initially `v3.0.0-beta.1`); its result records `rehearsal: true`. Live P17 uses its actual tag and rejects a different override. The reader authenticates the previous unified GitHub Release record by its API SHA256 and validates exact package set, tag/commit, passed P17 and earlier publication. The first beta may record the verified absence of a performance contract in alpha.2 and establish the baseline. RC/final require a comparable prior DS12; failed fetches, corrupt records or incomplete advertised performance never mean absence.
