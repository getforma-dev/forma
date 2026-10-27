# Unified releases

The source workspace prepares 3.2.0-rc.2 with eight coordinated packages,
including the optional `@getforma/router`. **[3.1.0 is published](https://github.com/getforma-dev/forma/releases/tag/v3.1.0)**;
RC.2 qualification and publication remain pending. RC.1's archives were published,
but its release-record job failed; [the recovery record](release/3.2-RECORD-RECOVERY.md)
preserves that partial outcome. Published 3.0 and 3.1 records
retain their original seven-package inventory. The [3.0 as-built summary](release/V3-AS-BUILT.md)
records its qualification and completed post-release verification. This document explains the release
mechanisms and retains historical 3.0 examples. Never reuse an existing tag or
version. For a new release, first prepare its own reviewed contract and evidence.
The checked-in contract record, `scripts/release-contracts.json`, states which
tickets gate which milestone (alpha, beta, rc, final); a tag publishes only when
every gate of its milestone and of the earlier milestones is done, except the
explicit 3.0.0 post-release soak obligation under L-66-QUOTA. That exception
requires an authenticated published RC, its P17 and independent audit, and the
reviewed final source changes; it records deferred status and zero soak credit.
See [the post-release soak path](release/RC-BURN-IN.md). Read the contract
record for the candidate's current readiness; a version string alone does not
authorize publication. See [the milestone gate](#milestone-gate) below and the
historical [alpha runbook](release/ALPHA-RUNBOOK.md). Earlier alpha and A2 results
retain their original scope and do not establish beta, RC or final qualification.

Later version lines use their own reviewed contract, RC audit and completed
pre-final soak. The RC tag and final version must have the same exact major,
minor and patch; 3.0 evidence cannot qualify 3.1. The L-66-QUOTA deferral remains
exclusive to 3.0.0. Version-line support does not close gates or publish packages.

## Prepare and test

Use Node from `.node-version` (24.22.0) and Rust/Cargo 1.93.1. Published runtime
and crate MSRV floors remain independent and retain their CI matrix.

```
# Replace X.Y.Z with the reviewed, unpublished release version.
node scripts/release-set.mjs version X.Y.Z
bash scripts/install-deps.sh
npm run check
```

The version command changes eight manifests, their exact internal requirements,
the workspace locks, npm repository metadata and release template ranges. It
creates neither tags nor commits. A `-dev` version also aligns the current
template source seeds; it names no publishable milestone.
Replace the placeholder with the next unpublished version for the intended milestone. Add its root
CHANGELOG heading (for example `## [3.0.0]`), close only evidenced gates,
review and merge the release PR, and tag the exact main commit after its required
CI and packed qualification are green. Use merge commits and never move a tag.

### Adding the optional router to the coordinated release

The candidate source is prepared as 3.2.0-rc.2. `release-set.mjs version` updates
the router manifest and lock together, including its core peer range. A 3.2-or-later release requires all eight
packages; an eight-package live 3.1 tag is refused. No existing tag is reused.

Feature dry packs declare `packageSet: "forma-router-v1"` and include the router
archive even before the version bump. Authenticated historical 3.0/3.1 records
and RC evidence remain seven-package records. The versioned inventory reader in
`scripts/release-package-inventory.mjs` keeps those records valid while requiring
the new package for subsequent releases. P17 resolves the packed router against
the packed core navigation entry and exercises nested parameter matching. The
source gate builds/tests the router and checks its types and packed exports.
The `native-router` starter opts into the router dependency and Rust navigation feature.
`dashboard` uses the browser adapter for its client routes; `minimal` keeps its
existing dependency graph without the router. Current candidate
qualification includes all three starters; authenticated historical seven-package
records select only their two original starters. The new starter adds five heavy
cases, including native navigation and persistent shell state in all three browser
engines, and a Linux N8 row at the existing 3 MB / 100 ms limits.

Before the first router publication, qualify the candidate and complete the
reviewed bootstrap and monitor preparation in the
[router enrollment procedure](release/ROUTER-REGISTRY-ENROLLMENT.md). npm requires
an existing package before trusted-publisher enrollment. The finite,
founder-authorized first-package exception applies only to the qualified
`@getforma/router@3.2.0-rc.1` archive; it never replaces CI, archive verification,
P17, provenance or D14. Configure the target five-package npm observer and
eight-package registry policy before D14 and the published-RC source freeze;
this source preparation is already present and does not claim live enrollment.
Missing-package 404s remain failures, historical baselines remain unchanged, and
no post-publication source edit or activation switch is needed. After the actual
eight-package publication is verified, remove the bootstrap secret, revoke its
credential, enroll the real router trusted publisher and deploy/run the audited
observers to establish genuine complete monitoring evidence. An existing external
four-package monitor can continue its historical version until then. Those
post-publication obligations remain pending. Do not invent a registry identity,
suppress a 404 or treat local tests as operational enrollment. Historical 3.0/3.1
records retain their seven-package identities.

### Hosted packed rehearsal

After `.github/workflows/packed-qualification.yml` is present on the default
branch, dispatch it on a reviewed immutable preparation ref, for example:

```sh
# Replace both placeholders with the reviewed preparation ref and unpublished version.
gh workflow run packed-qualification.yml --ref '<reviewed-preparation-ref>' -f target_tag='vX.Y.Z-rc.N'
```

The read-only workflow builds and dry-packs all eight source packages from that run's
exact commit, then passes the original candidate artifact to a separate clean
Linux checkout. It checks the producer's DS11 digest, source commit, run,
archive bytes, coordinated versions and Cargo lock before running the unchanged
whole P17 under the existing Linux process owner. Original archives, failed
reports, raw observations and cleanup results are retained as run artifacts.
Its 60-minute job and 45-minute verification step allow setup and cleanup;
P17's independent 1,800-second acceptance limit remains unchanged.

`target_tag` must match all eight prepared versions for the new minor release.
The 3.0/3.1 commands elsewhere in historical runbooks describe their original
seven-package releases; they are not current feature-candidate instructions.
Pending milestone gates remain recorded, so the rehearsal can collect evidence
before they close. The normal baseline reader still requires an actual comparable
DS12 from the newest published predecessor for RC performance. Select that
predecessor through the versioned release tooling, not a copied historical tag.
The workflow has
no publication credentials, never writes DS12 to a Release, and neither closes
gates nor replaces exact-main CI or the tagged release workflow. A failed run
remains failed; another attempt requires an explicit decision.

R17's separate serial indexed-update lane follows
[the L-67 per-run cost contract](release/3.0-GATE-DISPOSITIONS.md#indexed-update-cost-l-67-2026-10-17).
Its all-101 amortized costs, sampled frame guards and across-run summaries do
not measure startup attribution or individual-edit latency p95.
[RC qualification](release/RC-QUALIFICATION.md) keeps exact-source R17, internal
build/rebuild, packed P17 and actual publication clocks separate.

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
and whose entries carry a `done`/`pending` status and a scope (C2), with only the
exact 3.0.0 final soak permitted to carry the checked L-66-QUOTA `deferred`
descriptor; no gate in
two milestones (C3); no global switch (C4); the one release version the gates
are written for, `version`, which the resolver asserts against the tag's base
version so a `v3.1.0-alpha.1` cannot pass 3.0.0's gates (C5). Its self-test
seeds ordinary contract and workflow violations plus ten malformed soak-deferral
cases and one accepted deferral case. Its last line names the
milestones that may publish today. The GitHub Release names the milestone, where
it went on npm (`next` for a pre-release, `latest` for the final) and every gate
still open before the later milestones (`releaseNotes` in
`scripts/release-record.mjs`); DS12 carries the resolved milestone as `milestone`.
A deferred soak is reported separately as an outstanding post-release obligation,
never as a completed burn-in or a fabricated run. Later verification must retain
the immutable release record's original zero-credit statement.

Only tag pushes trigger release.yml. `check` requires the latest readable,
successful main-push CI run for the exact commit, including the executed R17
command and release workflow probes. A skipped required job, failed run, missing
run or API failure refuses the release. It does not silently wait forever;
rerun after CI completes if the tag arrived first.

The credential-free `engines` job also runs the reusable Chromium, Firefox and
WebKit suite on the tagged commit. P17 starts after packing and may overlap the
engine suite. Both publishing jobs and the record job directly require successful
engines and P17, so either failure blocks every release write. This changes only
job ordering; all verification and timing limits remain in force.

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
artifact has been packed. Pack first creates the three crates and four library
npm tarballs, then stages internal package versions, dependency metadata,
registry URLs and checksums into the create-app templates. For the finalized 3.0.x
candidate contract, an authenticated source adapter also stages the reviewed
typed startup API; historical A2 source stays unchanged. Third-party resolutions
remain unchanged. It packs create-app last and restores all source template files,
including after a staging/write failure. Packed template `_npmrc` files are kept
and restored to `.npmrc` by the CLI. DS11 contains eight archives, the exact source
Cargo.lock and release-set.json with commit, run, toolchain, contract versions and
archive hashes. SHA256SUMS covers every file; its own hash travels separately as a
job output, so replacing both an archive and its manifest fails verification.

`verify`, without OIDC permission, checks DS11 and the recorded lock, installs
locked tools with scripts off, checks fresh advisories against the root lock and
each crate archive’s own lock (only internal sources substituted), and checks npm registry signatures,
then runs the packed compiler/reader corpus and every template in the authenticated package set. Before any
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
`crates-publish` for all three crates and `npm-publish` for all five npm packages
in 3.2. The original four npm publishers remain in place; the router's first
publication uses only the finite exception described above before enrollment.
Both environments allow release tags and have **no required reviewer**. This is
the existing environment plan, not an additional approval gate. Current [npm trusted
publisher documentation](https://docs.npmjs.com/trusted-publishers/) allows up to ten
publishers, so retain the maintenance publisher. A new configuration expires unless
it first publishes within two days and defaults to stage-only: explicitly choose
**Allow npm publish**, consistent with the founder's autonomous-release decision.
Saving an entry does not validate it. Schedule its first trusted publish within
that window as part of a qualified release, or replace an expired configuration
before the next qualified release; this is not permission for an extra unqualified
publication. Publisher hookup does not require deleting maintenance access or
prevent the history/code merge. Admin-only v* tag rules still apply.

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
every package version in the authenticated candidate inventory. A present version is skipped only when its registry checksum
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
After that acknowledged write, if valid current-tag metadata is absent from the
complete release inventory, the record writer permits at most three additional
complete inventory reads, two seconds apart, within one 20-second deadline that
includes requests and sleeps. Prior DS12 records are authenticated once; changed
selected history, malformed or unreadable responses, drafts and contradictory
metadata still fail immediately. The writer never invents an inventory entry or
changes `published_at`. Ordinary preflight/history reads do not enable this wait.

The actual beta.4 DS12 records 2,461.377 seconds including its record-only
recovery, above the 1,800-second outer target. Its original P17 invocation
passed separately in 1,165.054 seconds. That release-time miss remains explicit;
the reviewed overlap and visibility changes do not predict the next result.

## Current development integration

Development revisions can use a development prerelease such as `3.2.0-dev`, which names no milestone and cannot
publish. Release preparation aligns all eight source packages, internal requirements,
three Cargo locks (root, e2e and fuzz), template ranges and current version
documentation with the candidate, without changing external resolutions. Keep
historical changelog entries and archived evidence attached to their released
versions. The FMIR v3 contract is independent of the package prerelease suffix;
P17 compares the packed compiler's writer triple and canonical dumps with the
packed reader's actual version and frozen corpus.

The current source templates use the typed startup API; native-router additionally opts into the navigation feature. Their packed locks
still require the candidate's actual archive checksums, as described above; a
source template build does not replace packed template acceptance. A development
dry run is labeled `v3-development-dry-run`, and any template refusal remains a
failed P17 result. Later milestone gates remain `pending` until their evidence is
reviewed. Archived A2 dry runs continue to describe only the original set.

## Local dry run

```
bash scripts/install-deps.sh
npm run build
node scripts/release-set.mjs pack /absolute/path/to/empty-ds11 --dry-run
bash scripts/release-artifacts.sh record /absolute/path/to/empty-ds11
FORMA_PERFORMANCE_TARGET_TAG=v3.0.0-rc.1 node scripts/verify-release-set.mjs /absolute/path/to/empty-ds11 /absolute/path/to/p17.json
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
(recorded, not gated). FORMA-191 adds N1, N3 and N5 rows to the same record. For the
`deploymentSkew: "native-v1"` contract, `scripts/verify-release-set.mjs` calls
`verifyPackedSkew()` before the fixture applications. The drill exercises the packed
deployment identity, retained assets, rollback and inert-or-reload behavior in Chromium,
Firefox and WebKit. Its result is recorded separately; a passing drill does not imply
that the complete P17 run or its performance checks passed.

Rehearse it as the runner sees it: commit, `pack` a dry-run DS11, delete `packages/*/dist`, then run P17.

## Staged response contract (FORMA-109)

The DS11 contract records `trustedTypes: "enforced-v1"`. P17 reads the actual
HTTP and browser-navigation enforcement headers for all selected packed templates,
requires the two intended policy names, and records native Trusted Types support,
all `securitypolicyviolation` events and page errors across positive interaction.
A passing result requires zero events and errors; separate native browser controls
prove enforcement actually refuses a raw sink write. Empty `pageerror` alone is
not evidence of zero CSP reports.

The current `sourceTemplates: "islands-v1"` contract packs the checked-in
Rust and TypeScript template sources unchanged. `stageTemplates()` seals the
twelve dependency manifests/locks against the seven runtime candidates and retains
the three Rust main files in its fifteen-file restoration record. It validates all
three templates before writing and restores the originals after packaging. The older
candidate source adapters belong to historical evidence; they are not the
current source-template path. FORMA-144 slice 2 is accepted by the
[beta qualification](release/BETA-QUALIFICATION.md); final slice 3 remains open.

## Finalized rendering in candidate templates

The `finalized-v1` bound-render contract requires the packed server's external
finalization, budget, typed document-home, browser-mode, panic and topology
snapshot checks. All current source templates finalize before opening a
listener. P17 authenticates the packed source inventory against the exact
source commit and verifies the generated templates. Beta acceptance does not
close FORMA-144's final-version cleanup gate.

### Per-release performance contract (FORMA-191)

P17 `performance: measured-v1` requires20,000 native walks for each of five consumer-shaped pages in the application release profile, N5 allocation/time growth, public one-past budget refusals,20 cold applied-mobile Lighthouse13.5.0 runs on each of the tenant-login and100-island pages, independent actual event-response observations, and the archived founder comparison in all three browser engines. FORMA-103 also measures the shipped public activation decoder: one MiB of ASCII and one MiB containing20,000 multibyte strings, five warmups then forty fresh-document samples each at four-times Chromium CPU slowdown. Registration is outside timing; timing ends at the first component instruction. Under the prospective FORMA-210 correction to L61, each shape’s nearest-rank p95 (the 38th sorted duration among all40 original samples) must be at most30ms. The `public-decoder-p95-v1` profile explicitly identifies this statistic; older every-sample profiles cannot qualify. Retain the minimum, median, maximum and every original duration, and validate all sample correctness and refusal controls before timing acceptance. The actual packed compiler regenerates both original contracts before measurement; raw observations, artifact/compiler hashes, enforced Trusted Types policy and real oversize/malformed refusal controls are recorded. Decoder observations are synchronously flushed beside `p17.json` after each timed sample, and the complete report is saved before threshold validation. Interrupted or refused attempts remain outside disposable fixture directories. The paired mobile controls retain raw host/response observations and the injected110-millisecond interval; the long-task observer must capture that interval, rather than merely any unrelated slow task. New and prior records require the same control evidence. No timing row may be omitted. Native p99 throughput below1,500,000nodes/s or at/below half the prior DS12 rate fails. TBT p95 must be below200ms; responses must complete within500ms of first paint; strict startup qualification requires every application/unattributed task to be at most50ms across each route’s fresh20 runs; p95 is retained as a descriptive measurement, not an outlier allowance. Independent observer tasks all count. Only same-audit trace proof of browser work before the first application script in the committed main renderer can exclude a Lighthouse task: either browser-only layout, or the exact main-document commit/parser/context chain with source-bound pinned audit bootstrap. The exact source-bound Lighthouse idle-check wrapper may also be excluded at any time only with its distinct audit context, same-navigation frame, complete child-event nesting and exact timer stack. Application and mixed tasks count in full. Other unattributed tasks may use the founder-approved L-66 correlation only with readable, source-bound trace evidence and all forty complete independent probes recording zero long tasks, as detailed below. DS12 reports the50ms target miss separately, all per-run maxima and the p95. A pilot cannot qualify. The complete raw Lighthouse reports, bounded compressed traces and configuration, per-walk durations, machine/profile, prior-record digest and client comparisons are embedded in DS12. They are measurements of a lab profile, not a phone claim.

The paragraph above is the strict 3.0 acceptance, which still validates the
published 3.0 records. A 3.1 record must carry the separately versioned
`N3-cold-start-bounded-v2` acceptance. It admits proven cold-start Lighthouse
tasks and, by duration alone (input tasks included), independent observer
tasks up to 55 ms, within one budget per route:
at most two such tasks, in at most two of twenty visits, with at most 10 ms of
total excess. See [the 3.1 performance decisions](release/3.1-PERFORMANCE-TRADEOFFS.md#startup-bounded-exceptions).

Each Lighthouse audit still starts a fresh browser profile. Before tracing,
Lighthouse visits the fixed same-origin `/__forma_performance_blank` fixture
endpoint: a tiny `no-store` document with no application content or resources,
protected by `default-src 'none'`. Lighthouse 13.5.0 then clears origin storage
and browser caches, applies the unchanged mobile throttling, starts tracing and
navigates to the target. This initializes the destination renderer and establishes
an origin connection outside the measurement; it does not prefetch the target
HTML, JavaScript or assets. Here “cold” means first-fetch application resources
and unexecuted application code, not cold renderer or connection startup. This capture
setup avoids creating a destination renderer during tracing, where a retained
failed run lost its initial main-frame events. It is a measurement setup change,
not an application speedup. Missing navigation events still fail the audit;
no timestamp is inferred, failed sample replaced or performance limit relaxed.
The finite capture diagnostic does not qualify a release: a fresh complete P17
campaign against the packed candidate is required.

The Lighthouse browser also receives `--enable-automation`. Chromium 156 uses
this explicit automated-test setting to skip its reading-mode suggestion
heuristic, whose isolated-world script and context initialization caused the
retained 99.342 ms task in the failed `a2e61c77` rehearsal. The source was matched
exactly to that Chromium version. This selects an automated lab browser and also
suppresses password saving/filling UI and infobar animations. The other launcher
defaults, mobile profile, raw-task classifier and timing
limits stay unchanged. The old observation remains failed, and a fresh complete
packed P17 must qualify the changed setup.

A dry-run P17 must set `FORMA_PERFORMANCE_TARGET_TAG` to its intended release (for example `v3.0.0-rc.1`); its result records `rehearsal: true`. Live P17 uses its actual tag and rejects a different override. The reader authenticates the previous unified GitHub Release record by its API SHA256 and validates exact package set, tag/commit, passed P17 and earlier publication. The first published 3.0.0 beta may record the verified absence of a performance contract in its latest published 3.0.0 alpha predecessor and establish the baseline. A beta tag that failed before publication remains immutable; its successor can still be the first published beta. A published beta with missing performance cannot fall back to alpha or bootstrap another beta. RC/final require a comparable prior DS12; failed fetches, corrupt records or incomplete advertised performance never mean absence.


Startup evidence retains the original whole-page TBT/LCP and every raw task.
The trace digest is checked before bounded decompression and parsing, and the
validator recomputes attribution and summaries instead of trusting producer
labels. Each compressed and decoded trace is limited to32MiB. DS12’s128MiB
transport limit accommodates forty complete traces and reports; other release
metadata bounds and product budgets are unchanged. The previous90ms negative
control and all historical failures remain archived. A real110ms injected task
must be observed and refused independently of response latency.
The current policy is `N3-startup-correlated-v1` (L-66). A task over 50 ms may be
classified `browser-internal-unattributed` only if actual trace-derived bundle
and inline-script identities show no application frames or script URLs in that
task, and all forty complete, correct independent input-response observations
have empty long-task arrays. Missing or ambiguous script inventory, unreadable
traces and unresolved execution sources are not absence evidence. Any application
attribution or independent observed long task prevents this new exclusion. The
validator recomputes correlation across both routes and attribution from raw
traces; it does not trust a producer's classification. This records corroboration,
not proof of browser-only implementation. Raw durations, whole-page metrics,
50 ms application and 500 ms response limits remain unchanged.
Document and resource-request URLs are not execution evidence; nested initiator
stacks and executable script URLs still count. Only the already pinned, uniquely
source-bound Lighthouse/Puppeteer bootstrap rundown records are treated as
metadata in the main context. Unknown inline scripts and actual execution of
those bootstrap IDs remain blocking. After structural mobile checks, P17 collects
the unchanged client comparison before final mobile acceptance so a timing
refusal retains the last stage's evidence. Final validation still fails the run
and writes no completion marker.

Do not repeat a full campaign solely for this attribution decision. Retained
complete raw observations may be analyzed under the named rule in separate
outputs without rewriting their original report. Missing stages, missing
observations and changed products still require actual qualification; a mobile
analytical replay is not a whole-P17 pass. See [L-66 and its source-coverage
requirements](release/N3-NATIVE-RESOURCE-ATTRIBUTION.md). The earlier
`N3-startup-strict50-v1` layout-only classifier remains historical evidence.
The retained positive-native-proof branch may also separate a main-document commit task only when
the same trace proves the exact navigation request, committed frame, response,
parser and V8-context chain before the first application script. The request
must precede its response and commit; the commit must contain load, parser and
context creation; and the parser's nested response-body chain must contain the
received bytes, parser-fed bytes and resulting parser subresource requests. The only
admitted script-related records in that chain are source-bound Lighthouse and
Puppeteer new-document bootstrap records; any application execution, unexpected script,
event handler work, foreign identity, mixed or unknown event counts the whole
task. This attribution keeps startup N3 qualification on island activation
without changing its 50 ms limit. Version 3 additionally recognizes the pinned Lighthouse 13.5.0 idle check
with exact source bytes, a context distinct from the application module and
main-world bootstrap, one evaluation span, two microtasks and the exact 150 ms
single-shot timer stack. Only that five-child trace shape is admitted; foreign,
ambiguous or unbound identities and application callbacks count in full. This is
measurement attribution, not a runtime improvement or a new founder latency
waiver. Raw whole-page tasks and `wholePageTargetMiss` remain visible.
Version 4 also permits positively proved parser-requested stylesheet work and
script-disabled SVG-image document work entirely before the observed first
application script. Stylesheet admission requires the complete matching
request/response/data/parse/finish chain. SVG admission additionally requires
the unique blank internal frame's native creation/parser flow and a later
main-document `PaintImage` for the same resource containing that exact frame's
layout. A missing or ambiguous resource/frame/nesting link, any script execution
or any unknown child keeps the whole task counted. This is not a general
pre-script time exemption. See [the native resource proof](release/N3-NATIVE-RESOURCE-ATTRIBUTION.md).
Version 5 removes the internal 1 ms bound on native navigation lifecycle
dispatch. Origin still requires the complete same-navigation causal and pinned
source proof above, without executable, unknown or foreign-frame children, and
the whole task must precede the first application script. Raw duration is
unchanged; the application/unknown 50 ms limit and every independent observer
task remain in force. Historical failures are not reclassified as P17 passes.
Version 6 admits the same native lifecycle records in their thread-scoped
instant form only with the same complete causal proof, exact category, absent
duration and positive safe-integer sample identity. Instant metadata does not
prove zero cost or absent listeners; any executable, unknown, foreign-frame or
post-script task remains counted. A saved-trace replay cannot qualify a release.
Historical L63
75ms p95 /100ms individual acceptance and its original evidence remain history;
they cannot qualify the strict gate. The L63 exception is retired only after
all twenty fresh runs on each original route pass the restored 50 ms limit.
Changing the validator or passing a pilot does not establish that result.
