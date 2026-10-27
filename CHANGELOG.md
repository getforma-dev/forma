# Changelog

## [3.2.0] - 2026-10-27

- Add optional `@getforma/router` for browser routes, generated HTML and typed
  native SSR navigation, with persistent layouts, owned cleanup and enhanced
  actions. Native islands retain their selective activation and ownership.
- Ship the connected `native-router` starter and browser-routed dashboard in the
  eight-package coordinated release. Ordinary SSR and core-only applications
  remain supported.
- Guard router links with core's URL policy, avoid duplicate uncertain-submission
  announcements, and recover source edits made during refused native watch builds.
- Preserve source security, packed correctness, artifact integrity and trusted
  publishing. The maintainer waived the extra N7 campaign and active soak for
  this release; they are not passing measurements. See the
  [release decision](docs/release/3.2-PERFORMANCE-DECISION.md).

## Historical preparation checkpoints

## [Unreleased]

- Guard router-created links with core's existing URL policy, including
  obfuscated executable schemes, while preserving caller-supplied documents.
- Announce uncertain submission outcomes once and remove the unused
  `PreparedView.focus` declaration.
- Clarify that native islands and client navigation work together, with explicit
  document boundaries between rendering profiles. Correct current publication
  pointers and the research-map link.

RC3 publication completed on 2026-10-27; its
[dated outcome](docs/release/3.2-RC3-PUBLICATION.md) supplements the unchanged
preparation entries below. New changes in this section are not in that release.

## [3.2.0-rc.4] - Preparation checkpoint

- Prepare the eight coordinated versions and source template seeds for the
  reviewed Link URL-policy and uncertain-outcome wording fixes, unused type-field
  removal, and islands/navigation documentation clarification.
- Recover source edits made during a native watch compilation, including a
  refused compilation. Queue a fresh coherent generation without requiring
  another edit, while retaining the last valid output and avoiding retries of
  unchanged invalid source.
- Integrate a maintained R17 schedule with shared stage implementations, explicit
  resource admission, a complete serial fallback before work begins, and owned
  parallel cleanup. No test, resource threshold or sampling requirement is removed.
- Require fresh source/platform/packed qualification, native paired-size proof
  and independent whole-release review. The previous N7 failure and both scheduler
  development pilots retain their original scopes. Preparation is not publication
  or stable acceptance. See [RC4 preparation](docs/release/3.2-RC4-PREPARATION.md).

## [3.2.0-rc.3] - Prepared; publication pending

- Prepare all eight coordinated versions and starter locks/seeds. Stable 3.1.0
  remains available; [3.2.0-rc.2](https://github.com/getforma-dev/forma/releases/tag/v3.2.0-rc.2)
  is published with authenticated registry archives, DS12, D14 and second-attempt
  75/75 P17. Preserve its first failed P17 attempt and missed outer release clock.
- Add a finite inventory-only record for npm's exact router `0.0.0-stage`
  placeholder, attached only through RC3's actual future DS12. Authenticate
  preparation/recording provenance and registry bytes; keep historical baselines,
  ordinary product inventory, support/performance/soak readers and refusal rules.
- Remove duplicate positive TypeScript compilations and the duplicate native
  fixture build without removing checks or changing thresholds. Fresh source
  review/qualification remains required; no measured timing saving is claimed.
- Update router installation, scaffold and release documentation. Full SR2 still
  fails for the router placeholder and inherited FORMA-224 bootstrap record;
  current N7, site/device, stable acceptance and hosted soak remain outstanding.
  See [RC3 preparation](docs/release/3.2-RC3-PREPARATION.md). Historical entries
  below retain their original preparation wording and measured evidence.

## [3.2.0-rc.2] - Prepared; publication pending

This successor requires coordinated version preparation, fresh independent review,
exact-source CI and its own tagged packed qualification before publication. RC.1's
registry versions and original failed record attempt remain immutable.

- FORMA-301: add optional `@getforma/router` for browser routes, verified
  generated HTML and typed native SSR navigation. Compatible nested layouts
  retain their DOM/state while departing owners dispose and destination islands
  adopt fresh server HTML. Include bounded cancellation/history, typed actions,
  mutation uncertainty, context revocation and explicit document fallbacks.
- Add optional core native-owner APIs, compiler/build navigation groups and the
  `native-router` starter to the eight-package coordinated 3.2 inventory. Preserve
  published 3.1.0 versions, existing non-router size limits, reverse-engineering
  studies, negative controls and the
  [qualification ledger](docs/design/router/qualification-3.2.md).
- D14-3.2-010: require a nonempty changelog entry for the exact tag before either
  publisher. Preflight and DS12 generation use the same parser. Missing, empty,
  neighboring-version and uncommitted-only entries cannot qualify; original
  preflight failure controls and the corrected checks remain distinct.

## [3.2.0-rc.1] - Registry publication completed; release record failed

[Release run 40433276229](https://github.com/getforma-dev/forma/actions/runs/40433276229)
qualified the packed candidate and published all five npm packages and three
crates from immutable tag `v3.2.0-rc.1`, commit
`6e5e2e4937e5ed9dc60e6669cb4887508ccdbdb8`. Its record job then failed because
that tagged root changelog had no exact `3.2.0-rc.1` entry. This is a partial
release: registry publication and successful P17 do not establish successful
workflow completion, a DS12 release record or hosted burn-in acceptance.
The original tag, published archive identities and failed run are retained.
Any separately authenticated archival record recovery must disclose that later
recovery and cannot turn the failed original job into a successful one.

## [3.1.0] - 2026-10-26

[Published release](https://github.com/getforma-dev/forma/releases/tag/v3.1.0).

A coordinated minor update to all seven Forma packages. Upgrade the renderer
before deploying 3.1-generated output, and rebuild the browser/native deployment
together. FMIR stays at version 3 and manifests at schema 2. See the
[3.0 → 3.1 upgrade guide](docs/UPGRADING-3.1.md).

- Render native routes without JavaScript or islands as plain HTML, omitting
  hydration markers, injected row keys and empty island state. Native routes
  with islands retain their adoption contract. Reduce temporary allocations in the server
  walker and cache locked Cargo builds in generated-template CI.
- Add opt-in rendered-response compression through
  `PageResponse::with_compression`, preserving CSP and `no-store`. Compression
  remains off by default; review the
  [BREACH policy](SECURITY.md#opt-in-page-compression-forma-261) before enabling it.
- Consolidate public-effect graph and lifecycle state while preserving cleanup,
  synchronous updates, adoption and error reporting. The recorded gains have
  workload-specific costs: original fan-out, effect-creation and row-creation
  targets remain unmet. Use the
  [current performance decision](docs/release/3.1-PERFORMANCE-TRADEOFFS.md#rc3-startup-repair-and-current-client-costs),
  rather than historical RC measurements, for the accepted limits and results.
- FORMA-290: match `NaN` keys consistently and track each component-list row's
  owner by its actual node. Repeated updates preserve identity; removal,
  rerendering, clear and parent disposal retire the corresponding effects and
  compiled handlers. Stable unique keys remain recommended. This does not make
  multi-row rendering transactional; the upgrade guide records the remaining
  recovery limitation after a renderer throws.
- FORMA-294: offer `clientTemplates: true` for eligible inline client-created
  list rows. It is off by default; unsupported shapes and server-adopted lists,
  including later insertions, keep ordinary JSX construction. Compiled clicks
  use delegation with owner cleanup. Creation gains carry bundle and clear
  costs; opted-in routes still have to pass unchanged route budgets. See the
  [compiler scope and evidence](docs/release/FORMA-294-COMPILER-CANDIDATE.md).
  Also drain later bindings when root setup disposes itself and then throws.
- FORMA-299: enable eager compilation of five private adoption functions in
  supporting engines. Function bodies, atomic adoption, scheduling and startup
  limits are unchanged; the current decision records both startup improvement
  and adverse client observations.
- Keep nested HTML-runtime host values opaque while preserving supported
  operations and grants. Report invalid runtime declarations with coded
  diagnostics, refuse same-scope computed/state name collisions, and bound
  `data-list` passes by the 24,000 row-weight cap. These directive-runtime
  limits do not apply to component `createList` rows.
- Harden build output and diagnostics paths, including refusing symbolic-link
  `outputDir` values before writes. Retain explicit package-size tradeoffs;
  optional compiler delivery does not raise route-size or startup limits.

The dated release record establishes publication of this package set. Earlier
candidate headings below retain their original preparation status and evidence.

## [3.1.0-rc.3] - Prepared; publication pending

A fresh candidate includes the following reviewed changes and requires renewed
whole-release qualification.

- FORMA-299: hint eager compilation for five private adoption functions to
  reduce cold island startup work. Function bodies, atomic adoption and all
  startup limits are unchanged. Fresh packed qualification passes 62/62 with
  no startup exceptions across twenty visits per route. Core adds 9 B gzip
  within its existing limit. Retain and explicitly accept the measured signal
  costs in the [current performance decision](docs/release/3.1-PERFORMANCE-TRADEOFFS.md#rc3-startup-repair-and-current-client-costs).

- FORMA-290: use the same key equality for small and large component lists,
  retaining `NaN` rows through repeated updates. Track each row owner by its
  actual node so duplicate keys cannot overwrite another row's cleanup.
  Removal, clear and root disposal now retire those effects and compiled
  handlers. The historical RC1/RC2 known-issue entry below is superseded.

- FORMA-294: add opt-in compiler templates for eligible client-created list
  rows (`clientTemplates: true`). One qualified Linux comparison against RC2
  improves creation of 1,000 rows by 11.6%, 10,000 rows by 17.3%, and the
  nine-operation geomean by 5.6%. Clear costs 0.94 ms more; select/swap are
  slightly slower and the 1.10× vanilla creation target still fails. The
  benchmark app adds 936 B Brotli. Adopted lists keep their original JSX path,
  including newly inserted rows; this is not an adopted-list speedup.
  See the [scope, evidence and accepted costs](docs/release/FORMA-294-COMPILER-CANDIDATE.md).
- Accept the optional entry's package transport cost: main ESM graph grows
  49,212 → 49,796 B gzip, mainly from a shared chunk split. Its cap increases
  49,414 → 49,926 B; other package caps, route budgets, startup limits and
  compiler opt-in route refusals are unchanged. The original failures remain
  recorded. Fix root setup that disposes, creates later bindings, then throws:
  drain the engine scope before rethrowing the original value.

## [3.1.0-rc.2] - 2026-10-25

- Preserve seed rejection tests across the final version transition and verify
  native error reporting without Chromium-specific assumptions in other engines.
  Product behavior and the recorded performance tradeoffs are unchanged.
- RC1 was stopped before publication; its tag and failed/cancelled evidence are
  retained. RC2 passed its own review and tagged release qualification before publication.

## [3.1.0-rc.1] - Superseded before publication

Forma 3.1 is a minor release of all seven coordinated packages. The upgrade
guide is [docs/UPGRADING-3.1.md](docs/UPGRADING-3.1.md); measured costs and
accepted tradeoffs are in
[the 3.1 performance decisions](docs/release/3.1-PERFORMANCE-TRADEOFFS.md).
Package-level details are in each package's CHANGELOG.

- Keep HTML-runtime host values opaque: a host nested in data that is
  serialized, enumerated or weighed now appears only as its public label, and
  passing a host directly is still refused. Supported dispatch, coercion and
  grants are unchanged. Upgrading is recommended.
- Effects (FORMA-259): on the same Linux VM, writes are 70.74% faster, fan-out
  145.77% faster and effect creation/disposal 251.34% faster than published
  3.0.0. Batches of writes are 13.79% slower, and 1,000-binding island
  adoption averaged 0.34 ms (3.96%) slower in its before/after comparison. The
  original fan-out target (80% of the pinned alien-signals engine) is still
  missed and recorded as a miss.
- Rows (FORMA-260): default row semantics are unchanged. Creating 1,000 rows
  takes 1.70× vanilla DOM against an original 1.10× target, an explicit 3.1
  limitation; update-every-tenth (+14.33%) and clear (+30.43%) costs against
  the previous main are accepted and documented.
- Known issue (FORMA-290): public component lists with `NaN` keys can retain
  effects after row removal and root disposal on the small-list path. The same
  defect is reproduced in published 3.0.0; it is not repaired here. Validate
  stable unique string or finite numeric keys as described in the
  [upgrade guide](docs/UPGRADING-3.1.md#repaired-nan-keys-in-component-lists).
- Server walker (FORMA-258): dynamic text and attributes no longer build
  temporary scalar strings, about 19% less render time and 42% fewer
  allocations in the walker benchmark. This is a walker measurement, not an
  HTTP throughput claim.
- Opt-in rendered-response compression (FORMA-261) through
  `PageResponse::with_compression`: Brotli/gzip/identity negotiation with
  unchanged document policy and no-store headers. Off by default; read the
  BREACH note before enabling it on pages that mix secrets with reflected input.
- Generated-template CI and release workflows cache locked Cargo builds
  (FORMA-262): in one recorded cold/warm pair per template, a page-only build
  took 35.84 s cold and 2.87 s warm (minimal), and 38.70 s and 4.11 s
  (dashboard).
- Bundle (FORMA-263): unused adoption-specific bytes removed; the combined
  benchmark application is 8,498 B Brotli, 154 B below published 3.0.0.
- HTML runtime refusals now report coded diagnostics instead of throwing out of
  `mountMarkup` (FORMA-268, FORMA-271, FORMA-272), `data-list` passes are
  bounded by a 24,000 row-weight cap (FORMA-172, FORMA-289), and over-heavy
  bindings no longer build one long task (FORMA-178, FORMA-249). See
  `packages/core/CHANGELOG.md`.
- `@getforma/build` refuses a symbolic-link `outputDir` with `BUILD-824`
  before writing (FORMA-170) and hardens diagnostics report paths (FORMA-245).
- Release qualification keeps the 50 ms startup target with a narrow allowance:
  at most 55 ms, at most two tasks in two of each route's twenty visits, total
  excess at most 10 ms. Lighthouse tasks need positive cold-start proof;
  independent activation-observer tasks are bounded by duration and share the
  same budget. Historical strict failures stay failed.

- Consolidate public-effect graph and lifecycle state (FORMA-259), preserving
  adoption, cleanup, error reporting and disposal contracts. Dispose an initial
  subscription if startup escapes through a throwing error reporter. Retain the
  simpler implementation; the native-bootstrap experiment is excluded.
- Explicitly accept the effects delivery tradeoff: core ESM graph 49,212 B gzip
  against a revised 49,414 B ceiling (previously 48,902 B), and indexed-route
  Forma allocation 28,304 B against 28,420 B (previously 28,100 B). Other package
  gates and total route JavaScript budgets are unchanged. The original fan-out
  target and row-creation target remain recorded misses; final qualification
  and the [3.1 performance decisions](docs/release/3.1-PERFORMANCE-TRADEOFFS.md)
  determine release acceptance.

- Add a separate [3.0 → 3.1 upgrade draft](docs/UPGRADING-3.1.md), covering
  renderer-first version ordering, plain static output, opt-in compression and
  explicit HTML-runtime declarations. Preserve the published 3.0 output contract
  in its existing guide. Version 3.1 remains unpublished and gated by qualification.

- Render no-JavaScript native routes as plain HTML (FORMA-257): omit hydration
  comments, injected row keys, empty island state, and the root build/SSR
  attributes when the route has `js: []` and no islands. Scrapers of those
  attributes should use authored attributes instead. JavaScript routes keep
  byte-identical adoption markup; key validation, value rules and response
  policy are unchanged.

- Reconcile public guides with shipped 3.0 APIs and final release/soak evidence;
  organize application, contributor and historical documentation, and relocate
  internal work-board/session snapshots outside the source tree while preserving
  original Git history and verification evidence.


- Patch the development Vite dependency to 7.3.7 while retaining the compatible
  Vitest 4/coverage and benchmark APIs. Avoid the unrelated Vitest 5 migration
  proposed by the grouped security update.
- Measure N8 in CI (FORMA-164): the scaffold gate builds each template's release binary on Linux, compares its
  size and its start with a minimal Axum baseline from the same lock, reports both differences, and fails when
  Forma adds more than 3 MB or 100 ms. Tests and CI only; no shipped package changes.
- Explain scaffold-gate timeouts (FORMA-252): time every scaffold CLI call, owned-server start and browser
  engine into the scaffold report with a one-line summary per run; on a timeout, report the elapsed time
  against its budget, how far the scaffold got, a host process snapshot, the engine and its page timeline,
  and a fresh probe of the owned server with its output. No budget or assertion changed; tests and CI only.
- Exclude historical dependency snapshots under `docs/archive/**` from Dependabot
  update PRs without suppressing their alerts or changing active-project updates.
- Move the `dtolnay/rust-toolchain` pins taken from its rebuilt `stable` branch to a
  commit in its master history; each step names its toolchain explicitly and keeps the
  one it had (`stable`, or `'1.99.1'` in `n7-build-loop.yml`). Name `Swatinem/rust-cache`'s
  exact release, reject YAML aliases and merge keys in workflows, and run the
  supply-chain lint before the advisory checks (FORMA-251).
  CI and documentation only; no shipped package changes.
- Require the full three-part `# vX.Y.Z` release in action-pin comments and test that the
  CI deny job runs the supply-chain lint, unconditionally and in the default shell, before
  the Rust toolchain or any cargo-deny or advisory step (FORMA-256).
  CI and documentation only; no shipped package changes.

## [3.0.0] - Prepared; publication pending

- Prepare coordinated final versions, dependency locks and template source seeds from published RC.5 at12320f43, including the reviewed packed-qualification test-fixture repair. Preserve its product, tests and qualification harness unchanged.
- RC.5 passed its independent whole-release audit, exact-main CI and tagged61/61 P17, then published all seven verified packages through trusted publishing. Bind the final preparation to those actual RC.5 records. Final-delta review, exact final CI and trusted final publication remain required; the L-66-QUOTA post-final soak remains deferred with zero active credit until a separate authenticated completion receipt.

## [3.0.0-rc.5] - Prepared; publication pending

- Correct the synthetic packed-qualification prerelease fixture so it cannot inherit a final-only soak deferral. The real guard, runtime, qualification harness and thresholds are unchanged; the regression rejects the original inconsistent fixture and preserves rejection of unnormalized deferrals.
- Published RC.4 remains immutable and qualified. This successor carries the test repair through the existing exact-source audit and final-diff rules; final publication and the actual post-release active soak remain outstanding.
- Coordinate all seven package versions, dependency locks and scaffold source seeds. Require independent review, exact-source CI, packed qualification and trusted publication.

## [3.0.0-rc.4] - Prepared; publication pending

- Bound each background island-load callback to four direct queue entries as well as its existing 12 ms deadline. Preserve whole-island adoption, synchronous input promotion, cancellation and readiness; neither bound can preempt an expensive island or additional promoted work.
- Keep the strict 50 ms mobile-task and 500 ms response gates. RC.3 failed its tagged mobile campaign and remains unpublished and immutable; this candidate requires fresh packed qualification and independent audit before publication.
- Coordinate all seven package versions and source template seeds. The actual same-RC active soak remains outstanding after final publication under L-66-QUOTA.

## [3.0.0-rc.3] - Prepared; publication pending

- Coordinate the seven-package RC.3 set and template source seeds; published RC.2 remains unchanged.
- Correct synthetic release-test fixtures to reconstruct their declared milestone states without carrying live final-soak deferral metadata. Exercise both ordinary and deferred input snapshots; production gate validation remains strict and unchanged.
- Require independent review, exact-source CI and tagged packed qualification before trusted publication. Final publication and the actual post-release active soak remain outstanding.

## [3.0.0-rc.2] - Prepared; publication pending

- Coordinate the seven-package RC.2 set and template source seeds. RC.1 remains published and immutable; no runtime behavior changes in this preparation.
- Correct the release verifier's Actions archive request media type, with a regression test reproducing the observed HTTP 415. Release asset downloads keep their binary media type, and archive identity, provenance and size checks remain enforced.
- Require independent review, exact-source CI and the new tag's packed qualification before trusted publication. Actual post-release soak remains outstanding.

## [3.0.0-beta.4] — qualification pending

- Coordinate all seven packages and both template source seeds for the next beta verification, and update maintained installation examples. Beta.1, beta.2 and beta.3 remain immutable unpublished tags.
- Give the indexed-update timing collector a bounded 300-second test deadline so its unchanged 101 paired observations can complete with coarse browser clocks. Retain bounded progress outside measured intervals, including partial records on failure; preserve the 512-tick/32-ms precision target and the 10% ratio and 16 ms single-update limits.
- Keep Node-only control suites in their existing Node runner and explicitly discover the root Playwright browser suites by their `.spec.ts` inventory.
- Full current-source qualification and trusted publication remain pending.

## [3.0.0-beta.3] — verification failed; unpublished

- Coordinate all seven packages and both template source seeds for the next beta verification. Beta.1 and beta.2 tags remain immutable and unpublished.
- Retain failed Lighthouse reports and traces before refusing P17. Failed captures never become timing samples and are not automatically retried.
- Determine native navigation lifecycle origin from the existing complete trace proof, without the internal 1 ms event-duration heuristic. Preserve the 50 ms application/unknown and independent-observer limits, every raw task and the requirement for a fresh twenty-run campaign per route.
- FORMA-210 corrects the lead-added every-sample decoder rule to the founder’s p95 criterion: each exact one-MiB shape requires nearest-rank p95 at or below 30 ms from all forty original public-activation durations. Retain maximum/raw observations and every correctness/refusal check; a new policy identity rejects older reports. Earlier failed campaigns remain failed.
- Exact-main CI and the full normal packed rehearsal passed. The tagged release then failed the Firefox and WebKit indexed timing collector's 60-second deadline after functional checks passed; tagged P17 and both publishers were skipped. Original failed results remain retained; the tag is unchanged.

## [3.0.0-beta.2] — verification failed; unpublished

- Refuse oversized default sorts from their existing length-only cost bound before scanning elements. Preserve the 50 ms SR33 limit and all admitted-sort charges.
- Coordinate all seven packages and both template source seeds at beta.2. The immutable beta.1 tag failed its Firefox SR33 timing gate before any package publication; its original evidence remains retained.
- Return typed errors from the canonical asset, manifest and nonce helpers. Callers of `assets::asset`, `assets::load_manifest`, `CspNonce::generate` and `generate_csp_nonce` must now propagate or handle their `Result`; the existing `try_*` aliases remain fallible.
- Dispose registered resources when component setup or initial explicit runtime mounting fails, including retained listeners, effects, permitted requests and queued list-row enter animations. Preserve the original setup error and successful ownership behavior; already written DOM is not rolled back.
- Allow the first published beta to establish the performance baseline from the authenticated latest alpha record even when an earlier beta tag never published. Published beta records cannot fall back to alpha; RC/final still require comparable performance evidence.
- Tagged browser suites passed. P17 stopped at Lighthouse `NO_NAVSTART` on login measurement 9; the partial evidence also retained a 66.737 ms document-navigation task counted by the then-current attribution guard. Publishing was skipped. The immutable tag and failed report remain unchanged.

## Unreleased — typed keyed row product coverage (FORMA-181 D)

- Add a compiler → typed Rust `Pages` → emitted browser island fixture for keyed row movement. Its three-engine checks retain the native rows, focus, backward selection and listeners through activation and a minimal move. A reproducible evidence script records actual source, native state/dump, registration and served asset hashes. The SSR build harness can select the release renderer for production CSP behavior. This slice adds coverage; indexed row replacement and N3 remain separate.

## Unreleased — the client list fixture is admitted (FORMA-188, L-58)

- Move the client-list island fixture to the positive corpus after the accepted N2 increase. Its strict build must emit one island route with positive Forma/JavaScript byte counts below the report's own ceilings and an empty exceeded verdict; the obsolete BUILD-819 wording assertion is removed.

## [3.0.0-rc.1] - Prepared; publication pending

Prepared as part of the coordinated seven-package 3.0.0-rc.1 set, including the
changes below and the preceding 3.0 prereleases. This heading does not assert
publication; the release workflow and registry verification establish that.

- N3 startup attribution v3 keeps the unchanged 50 ms application/activation limit
  and v2's exact pre-application layout/navigation proofs. It additionally
  separates the pinned Lighthouse idle check only with complete source, isolated
  context, same-frame, nesting and timer-stack evidence. This is measurement-only;
  unknown, mixed, application and independent observer tasks still count, all raw
  costs remain visible, and earlier failed reports remain failed.

- Restore strict mobile startup qualification: every application/unattributed task and every independent observer task must be at most50ms across all twenty cold runs per route. Keep conservative pre-application layout attribution, descriptive p95, raw whole-page measurements and the existing response/TBT requirements. Historical L63 results remain historical; exception retirement requires a fresh complete pass.

- Await real module evaluation before closing packed template and fixture adoption observations; native bootstraps await cooperative load completion without reactivating islands (FORMA-199).

- FORMA-197: mutation kills require structured Vitest assertion evidence from a previously passing test. Clean before/restored baselines, explicit test-failure bail tracking and retained raw reports prevent compiler, collection, timeout and generic process failures from inflating the unchanged detection floors; workspace-hoisted Vitest is resolved normally.

- Keep dashboard chart tooltip API values in persistent text nodes under enforced Trusted Types; packed template checks cover ordinary hover and hostile API text in all three engines.
- FORMA-196: refuse native script elements with BUILD-623 and unrepresentable srcdoc markup with BUILD-624, matching core's existing Trusted Types and bundle-only boundaries. Preserve literal style, absent null/false srcdoc and explicit Browser typed raw APIs; retain the superseded FORMA-139 source/product evidence.

- Add a read-only hosted RC burn-in against all seven original published archives, with at least 3,600 completed positive-input native fuzz seconds plus every hostile, three-engine deployment and fixture check per round. Authenticate actual D14/P17 provenance before the RC/final release, retain bounded raw evidence and verify owned cleanup; implementation is not a completed campaign.
- Repair the separate fuzz workspace lock to include the existing exact `ryu-js` 1.0.3 dependency; current locked ASan qualification is tracked by FORMA-194.

- Historical L63 introduced a conditional startup exception of75ms p95 and
  100ms individual tasks. The strict50ms gate above supersedes that acceptance;
  historical results remain evidence, not qualification for the new gate.
  Only same-trace proved pre-application browser layout is attributed separately;
  all raw tasks and compressed traces remain authenticated in bounded DS12 evidence.


- Update the workspace browser runner to Playwright 1.64.1, whose official Firefox transport assigns a unique channel identity after COOP browsing-context replacement. Preserve the deployment drill's response headers, navigation assertions and timeouts; the dashboard template keeps its existing separate 1.64.1 lock.

- Maintenance CI, release browser checks and nightly qualification now use the declared Node build pin. Parsed policy controls reject maintenance selector and private engine drift while retaining the published packages’ dated compatibility matrix.

- Authenticate the complete nested P17 evidence tree with a dedicated manifest, preserving the flat DS11 artifact contract. Run the existing packed deployment drill before mandatory performance checks so a measurement failure retains all earlier functional results.

- Watch tests wait for every initial nonsplit entry context before editing files, preventing another context's initial build from satisfying the requested rebuild. A real three-entry barrier control preserves the failure; watch deadlines and production behavior are unchanged.

- P17 keeps completed native, mobile and client measurements in one bounded, byte-authenticated attempt journal outside disposable fixtures. A killed or failing producer retains completed evidence; completion requires unchanged performance validators, verified record hashes and all final metadata. Measurement intervals and acceptance thresholds are unchanged.

- FORMA-183: the integrated P1/P2/P3 corpus now blocks R17 at step 1 with 100 generated states per declared schema. Firefox and WebKit parity block release at 10 states. Every gate requires an empty expected-divergent list and retains the actual counts and timing report.

### Packed release measurements — FORMA-191

- P17 records the five consumer-shaped native N1 pages, N5 time/allocation growth, public output/iteration boundary refusals, actual Lighthouse mobile and island response measurements, and the restored three-engine founder client comparison. An authenticated prior DS12 supplies the N1 regression baseline. Missing or invalid declared figures refuse the release.
- FORMA-103 public decoder timing is mandatory in DS12, including both exact one-MiB payload shapes, candidate compiler regeneration, forty raw samples per shape at four-times CPU slowdown, and oversize/malformed refusal controls. L61 treats the original 12 ms raw-parse estimate as descriptive. The historical every-sample 30 ms rule was corrected prospectively by FORMA-210 to the founder's nearest-rank p95 criterion; all raw observations and maxima remain required, and earlier failed campaigns remain failed.
- Lighthouse13.5.0 and the historical comparison libraries are exact-pinned development tools; no runtime dependency changes. The fixture HTTP server and measurement binary now share their unchanged typed input constructors.


### Explicit HTML runtime mounts — FORMA-108

- HTML bindings now require `mountMarkup(root, trustedHtml(markup), { tier, grants, config })` and the returned update/unmount handle. Removed auto scanning, the body observer, tierless lifecycle calls and global configuration setters. Omitted grants refuse fetch and activation and confine DOM traversal to the handed root; every fetch keeps the grant's method/path/cookie/timeout policy and treats non-2xx responses as errors.
- A handle captures its scopes, so unmount also disposes a scope the application detached or moved. Unreviewed refusals retain distinct mount names, tiers and counts. The obsolete manual attribute produces one development-only migration hint; it has no binding authority.
- Monorepo fixtures and measurement helpers use actual explicit mounts. Byte-exact A2 sources and all260 old mutation records remain archived with per-ID dispositions; current qualification and its nine extra explicit-mount controls are reported separately from historical results. FMIR remains restricted to modules from the application's own build; external module admission requires the deferred M9 boundary.

- FORMA-145: reconcile the main upgrade, compatibility and declared-props guides with the seven-package release, typed Pages startup, island adoption, explicit runtime ownership, strict native subset and current asset/skew policy. Preserve the prior staged guides and link the template migration. Release qualification and publication remain separate gates.

### Final template packaging — FORMA-144

- Resolve the E2E fixture bundler from the selected core package, including workspace-hoisted installations.

- Match core test and benchmark JSX configuration to the locked Vite 7 transform, and typecheck every Vitest configuration.
- Stable template manifests use coordinated caret requirements; prereleases and source seeds remain exact. Packed lockfiles still authenticate the exact candidate archives, and failed packaging restores all template source files. Both templates now declare the approved Node 22 floor.
- Update and deduplicate the workspace test dependencies to patched Vitest 4.1.12 and compatible transitive fixes. The separate dashboard watcher advisory remains documented; its locked graph is not covered by the workspace’s zero-finding audit.
- Add the 0.6.x template migration guide and record the deliberate retention of both authenticated template esbuild copies. Final packed template, size and release qualification remain required.

### Lexical JSX SVG namespaces — FORMA-171

- Compiled JSX creates SVG `a`, `title`, `style`, `font` and `script` in their lexical namespace. Properties and children still evaluate once, before creation; HTML integration points and the existing script construction refusal remain intact. The private build-time factory adds no core code.
- Compiler and build loaders share the original source snapshot with adoption hooks and SSR/Browser entry ownership. Handwritten `h`, separate component bodies, custom JSX factories and the deferred dynamic SVG title adoption boundary keep their existing contracts.

- FORMA-139: refuse the finite parser/interactive-content nesting conflicts (BUILD-618), component HTML title (619), dynamic style/script children (620), and SSR island roots lacking one stable owned Element (621). Preserve transparent one-Element Fragments and helpers; keep ranges inside their host. Exact original source/products and canonical admitted near misses are retained. SVG title, browserOnly client bodies, and the existing keyed-row613 proof keep their separate contracts.
- FORMA-182 release qualification: the e2e locked graph now carries the same pinned `ryu-js` formatter as the native workspace. Packed template runtime additions are placed in Cargo package order, preserving existing external versions and checksums, so a fresh scaffold does not rewrite `Cargo.lock` on its first Cargo command.

### Native LIST sources must carry real rows — FORMA-101

- A callable source is insufficient for native emission: BUILD-610 requires a declared array prop or closed literal-default signal through a getter binding or callback. BUILD-616 continues to mean only a provably non-callable source. Unsupported getters/derived filters no longer publish empty native rows.
- Migrated the list-same-source corpus and conformance near misses to real two-row signal defaults. The original source/IR/dump/HTML/state and prior tests are archived with hash ledgers. The real Rust consumer asserts four keyed rows across both projections, and typed browser parity agrees; all thirteen other corpus modules are byte-identical.

### Shared attribute-name and URL policy — FORMA-140

- Native rendering and core now run one INV1 vector table for names, URL values and ordinary output payloads. Fresh core and strict adoption apply the native ASCII name rule: rejected names are omitted, and a served rejected attribute refuses that island with `FORMA_E_HYDRATE_VALUE` without repair. Existing URL, typed raw-content and event-listener policies remain explicit in `docs/INV1.md`.

- FORMA-182 review: HTML boolean attributes consistently use scalar truthiness. Empty strings and numeric zero (including -0) are omitted; nonempty strings and nonzero numbers are bare. This preserves the existing browser behavior and prevents an empty signal default from unexpectedly enabling `disabled`, `hidden` or `checked` in served HTML. Compiler defaults, the native writer, strict attribute adoption and the checked/selected control oracle share the expanded vectors. Empty strings on ordinary attributes remain present.
- FORMA-184: the repository-only `renderBoth(component, state)` test helper renders an explicit JSON state through the typed native renderer and core, returning both canonical trees and the P1 report. It shares the parity pipeline, preserves refusal/difference evidence, and adds no public package export.

### Native LIST sources must carry real rows — FORMA-101

- A callable source is insufficient for native emission: BUILD-610 requires a declared array prop or closed literal-default signal through a getter binding or callback. BUILD-616 continues to mean only a provably non-callable source. Unsupported getters/derived filters no longer publish empty native rows.
- Migrated the list-same-source corpus and conformance near misses to real two-row signal defaults. The original source/IR/dump/HTML/state and prior tests are archived with hash ledgers. The real Rust consumer asserts four keyed rows across both projections, and typed browser parity agrees; all thirteen other corpus modules are byte-identical.


### Strict server-renderable subset — FORMA-101

- SSR builds and the direct plugin now refuse every unsupported native construct, including default builds and legacy `strict:false`/`FORMA_STRICT=0`. The build reports every entry's available diagnostics and retains prior output on failure. Removed the obsolete placeholder helper; original guides and tests remain archived.
- Published `packages/compiler/docs/subset.md` as the admission contract and diagnostic catalogue. BUILD-617 refuses an independently registered option/optgroup island beneath another owner's value-bound select; unregistered helpers within the select owner and unbound selects remain admitted.
- Callable LIST sources now also need declared array props or closed literal-default signals (BUILD-610). The preserved list-same-source corpus is migrated to real two-row local defaults, with native rendering assertions; BUILD-616 retains its separate non-callable meaning. Island-own-root and finite parser-repair proof remain the FORMA-139 gate.
- The corpus emitter now rejects error diagnostics. The original unknown href getter and duplicate signal-name page remain authenticated BUILD-206/503 publication negatives; live examples use a real closed href and `panelCount`. Their regenerated products carry a before/after ledger, preserve all other corpus modules, and remove F4 only after native/browser equality proves the old exception an unexpected pass.


### Value rules 2 to 7 — FORMA-182

- Rule 2, numbers in ECMAScript formatting: stated in `docs/parity-rules.md` with the shared vector file `crates/forma-ir/tests/fixtures/parity/numbers.json` (29 lexemes with their `Number.prototype.toString` spelling), read by forma-ir's walker suite and by core's, where the engine is the oracle. No code changed: the walker's `format_js_number` already agrees on every vector.
- Rule 3, integers within ±(2^53 − 1): stated with `crates/forma-ir/tests/fixtures/parity/integers.json` (exact origins `i64`/`u64` at the limits, one over, the rounding-loss case and the extremes; float origins admitted whatever their magnitude), read by forma-ir's props-admission suite (`encode_props`), the walker suite and core's (`Number.isSafeInteger` and `BigInt` as the oracle). No code changed: FORMA-102's checked admission already agrees.
- Rules 2 and 3 in the three engines: `packages/core/e2e/value-rules.spec.ts` serves each number and admitted-integer vector as the walker writes it (a dynamic text range and an attribute), and strict adoption of the number, static and reactive, makes no write in Chromium, Firefox and WebKit; a control shows Rust's `Display` spelling of `1e21` refused with `FORMA_E_HYDRATE_VALUE`.
- Rule 4, dates as epoch milliseconds, no `Intl` on the server: stated with `crates/forma-ir/tests/fixtures/parity/dates.json` (the TimeClip range and its one-over cases; truncation toward zero with sub-millisecond parts; a declared `Date` in text, through `String()` or as an attribute refused at build), read by forma-ir's props-admission suite, the compiler's and core's (`new Date(ms).getTime()` as the oracle). No code changed.
- Rule 5, `null` writes nothing on every side: stated with `crates/forma-ir/tests/fixtures/parity/null.json` (`null` children alone, between, first, last and beside a number; `title`, `class` and `data-*` attributes), read by forma-ir's walker suite (the exact empty-holder ranges, the `textarea` value, the omitted attribute), core's suite (`null` and `undefined` through `h()`, `childText`, adoption and later writes) and the three-engine replay. **Rendered output changes with no source change:** `@getforma/core`'s reactive class getter returning `null`, `undefined` or `false` wrote `class="null"`/`"undefined"`/`"false"` in `3.0.0-alpha.2` and earlier and now removes the attribute, and a static `class: true` writes the bare attribute instead of `class="true"`, as the walker does.
- Rule 6, a boolean in text is a build error. **Breaking:** `BUILD-614` in `@getforma/compiler` refuses a text position whose value is provably boolean (a declared boolean prop, a boolean signal, a closed boolean or module `const`, a negation or comparison, eager or through a getter, as a child or a branch), with or without `--strict`; the message names the fix that builds for its source (`String(flag)` on a non-optional declared boolean, a boolean signal or an evaluable expression; a ternary, `() => (flag ? 'yes' : 'no')`, on an optional prop, a closed value or a module `const`). A boolean literal writes nothing. **Rendered output changes with no source change:** the idiom `() => ready() && 'Go'` at `false` no longer serves the word `false`, a `true` ternary branch no longer serves `true`, and `@getforma/core`'s adoption writes nothing for a boolean text value as `h()` does (a page compiled by an earlier compiler is refused at that idiom: compiler and core move together). Stated with `crates/forma-ir/tests/fixtures/parity/boolean-text.json`, read by the compiler's, forma-ir's and core's suites and the three-engine replay; two compiler test sources migrated, originals archived in `docs/archive/2026-10-15-pre-value-rules/`.
- Rule 7, conditions are boolean-typed. **Breaking:** `BUILD-615` in `@getforma/compiler` refuses a `createShow` condition or a ternary test it can prove is not a boolean, with or without `--strict`: the common shapes are `createShow(() => count(), …)`, `createShow(count, …)`, and a ternary on a `null`-default or string signal (`() => user() ? a : b`, `() => name() ? …`); the fix is an explicit comparison (`count() > 0`, `user() !== null`, `name() !== ''`) or `!!x`. An untyped condition keeps `BUILD-302`; a module-level boolean `const`, `Boolean(x)` and a boolean getter passed itself now fold, so the server renders the branch the browser takes. `@getforma/build` labels `BUILD-614` and `BUILD-615` errors in its report without `--strict`, as it does `BUILD-610` to `BUILD-613`. Stated with `crates/forma-ir/tests/fixtures/parity/conditions.json`, read by the compiler's, forma-ir's and core's suites and the three-engine replay; one compiler test migrated, its original archived. `docs/parity-rules.md` also carries three written proposals, not code: ARIA states as `"true"`/`"false"`, the walker refusing a non-boolean `SHOW_IF` slot, and a namespace stack for the walker (a dynamic child inside an SVG `title` is refused by adoption today, `FORMA_E_HYDRATE_MARKER`).

### Rule 6's attribute table: findings F2 and F3 — FORMA-182

- **Rendered output changes with no source change.** One rule for a value bound to an attribute, on every writer (the walker, the compiler's static attributes, `h()` static and reactive, adoption): presence only for the HTML boolean set (`disabled`, `hidden`, `checked`, … as `BOOLEAN_ATTRS`), `true` the word `"true"` on every other attribute, the empty string a value, `false` and `null` omitting it. F2: a reactive `true` on `data-live`/`aria-pressed` was bare from the walker and adoption and `"true"` from `h()` (FORMA-188 saw `aria-pressed=""`); now `"true"` everywhere, and a static `data-x: true`/`class: true` is `"true"` too. F3: an attribute whose server value is `""` (`value: () => query()` over `createSignal('')`) was dropped by the server; the compiler now writes it as a static `value=""`. Shared vectors `crates/forma-ir/tests/fixtures/parity/attributes.json`, read by forma-ir's, the compiler's and core's suites and the three-engine replay; js-emitter corpus outputs regenerated with an archived ledger (`docs/archive/2026-10-15-pre-attribute-values/`). When this lands, FORMA-183's expected-divergent entries for F2 (`jsx-page` `data-live`, `sub-component-scopes` `data-ready`) and F3 (`dynamic-attrs` `input[value]`) pass and are removed.

### The parity harness (FORMA-183)

- `e2e/parity/` holds the harness that keeps the walker and `@getforma/core` equal by test (DR-9): a deterministic, edge-first state generator over a declared props schema, each field rotated into its type's edge list (inside the priority block first) so same-typed fields never share an edge in the first states and every field meets the priority edges within ten, optionals present by one bit of the index each, and list-key fields given unique identities (the shared rule-1 vectors are in its string domain); a comparison of the browser's parse of the server HTML against core's render of the same state, with transport removed only where it is transport (marker comments and core's anchors on both sides; the activation attributes, `data-forma-key` and the U+200B holder on the server side only, a holder matching client `""` or U+200B and counted as `holderAmbiguous`, since the wire cannot tell them apart) and nothing else normalized, attributes compared with their namespace; a one-line report naming the module, the state and the node; and `renderBoth`, which renders one corpus module at one state through both sides. `crates/forma-server/examples/parity_render.rs` is its server half (the walker's low-level path); `e2e/parity/corpus.json` names the 14 corpus modules. Tooling only: no package, crate API or emitted byte changes.
- `scripts/check.sh` runs the harness's own tests (type check and `node --test`) and, before anything else, stops on a Node without type stripping rather than skipping the step; the root `playwright.config.ts` ignores `e2e/parity/`, whose `*.test.mts` files are `node --test` suites.
- The suite over the corpus (`e2e/parity/src/run.mts`): each module's states through the application's path (a synthesized manifest, `load_ir_modules`, `Pages::bind` with a harness `PageProps` mirroring the module's own schema, `PageHandle::render`), the server's own document and headers served in Chromium, P1, and P2: the module's production entry, built through `formaSsrPlugin`, activates its islands while a MutationObserver records every DOM write, which must be none. Known divergences are data (`e2e/parity/expected-divergent.json`), and one that stops occurring fails the run. CI runs it as the non-blocking `parity` job and uploads the report. P2 requires every island host activated (deferred `interaction`, `idle` and `visible` triggers are driven in the page; a host that never activates is an error naming it) and runs its positive control (an attribute, a childList and a characterData write) on its own connected observer; a typed-path refusal fails the run unless corpus.json declares the module walker-only; every expected entry must be pinned (a state, or `*` with a path, and a value or message pattern) or the list is refused; a state whose boot does not finish is that state's error. Step 0, 14 modules and 23 states: P1 19 equal, 4 expected-divergent (each naming the ticket that clears it: FORMA-181, FORMA-182 twice, FORMA-101), P2 14 equal; 2 structural classes. P3 and the switch to blocking are the next slices.
- Step 1 and P3: the corpus gains the props-contract page, the island-emitter family (rebuilt from the compiler's own test and proved exact against each committed `.ir`) and a P3 fixture, 28 modules; P3 moves an activated page to the next state through a module-exported setter and compares it with that state's fresh server render (`no-setter` for a module without one). CI's `parity` job runs step 1 at 100 states (1,018 states); `--browser firefox|webkit` runs it in the other engines, per release, as a non-blocking job of `e2e-engines.yml`. New divergences: F2's case in two more modules, F5 (core's `createShow` and a string branch, FORMA-016) and F6 (adoption by raw key, FORMA-181 checkpoint C).

### Fixture applications (FORMA-188)

- P17 runs the fixture applications against the packed set (`scripts/release-fixture-apps.mjs`, the contract `fixtureApps: "declared-v1"`): an isolated locked install of DS11's three libraries, strict builds with the packed `build()`, Rust servers built from DS11's crates on a lock pruned from `e2e/Cargo.lock`, and the same page checks as the source lane (`lib/verify-page.mjs`, `lib/behaviours.mjs`).
- P17 reads each packed build's emitted `size-report.json`: its route class, Forma and JavaScript ceilings, byte counts and both verdicts must agree. It builds and records the admitted `positive/list-island` fixture too. Policy is never parsed out of bundled JavaScript.
- P17's measurement step (`scripts/release-measurements.mjs`): P17's time against G6's 1,800 s, Forma's code per fixture route against the packed size report's N2 ceiling (L-58: 27,500 B gzip -9), and the walker's counts of the consumer-shaped pages, with the machine and profile, in `report.measurements` (DS12) and one line of the Release's notes. A figure over its limit or missing fails P17 naming it.
- `e2e/fixtures/apps/`: three applications shaped after consumers' pages (neutral, synthetic labels and values; nothing is taken from an application) (a household arrival island, an authentication service's tenant login, get-started and results pages, a controller studio's button-check screen), each a 3.0.0 page set: TypeScript props types, `#[derive(PageProps)]` handlers bound at start, islands with declared props. They build under `strict: true` with nothing above a note and are served by forma-server. `e2e/fixtures/apps/build.sh` is part of `scripts/check.sh`; `apps.spec.ts` checks, per page, the server's values with JavaScript off, the state envelope against the handler's values, adoption that writes nothing (the island module held, then released, a positive control on the observer) and the page's behaviour.
- `bench/`: the consumers' heaviest pages as synthetic data for FORMA-191's measurements (design.md A4): about 300, 1,500, 10,000, 15,000 and 20,000 nodes by the walker's own count (298, 1,497, 9,995, 15,053 and 19,961) with 2, 10, 5, 50 and 5 islands, and a page of 100 islands whose first two are seeded 7 and 1001. The server reports the walker's counts in an `x-fixture-counts` header.
- `negative/` holds the shapes the contract refuses: a props type outside the closed type set (BUILD-610 with file, line and column), and a condition the compiler would have to evaluate (BUILD-610). L-58 moves the client-side keyed-list reproducer to `positive/list-island`; the controller chips and authentication results now live inside islands, with server-state, adoption and keyed-reorder checks. P17 records the positive build's emitted size report and reads all route ceilings and verdicts from those reports.

### Value rule 1: line endings and NUL — FORMA-182

- `docs/parity-rules.md` states the marker vocabulary and rule 1 (CRLF and CR to LF, NUL to U+FFFD, per value, before ordinary DOM text and attribute writes) and lists rules 2 to 7 with where their behaviour lives today. One shared vector file, `crates/forma-ir/tests/fixtures/parity/normalization.json`, is read by forma-ir's and core's suites. The walker and `@getforma/core` apply the rule in their ordinary writers; transport (props, state, keys) stays exact. The `textarea`, `pre` and `listing` first-token line feed is protected by the walker and the URL guards refuse a NUL anywhere in a URL attribute. Document-head metadata in forma-server and the broader value rules remain open.

### SSR e2e lane on the 3.0.0 entry contract (FORMA-105)

- The SSR e2e cases (`e2e/ssr/cases/`) use the one entry shape `BUILD-611` accepts: a standalone literal registry and a standalone top-level `mount()`. Their conditional entries (`if (islands) activateIslands(...) else mount(...)`) were the pre-3.0.0 shape and refused compilation once the entry policy landed; `mount()` no longer adopts a server-marked root, so each case's interactive subtree is an island seeded from declared props and `root-fragment` is a static page that serves no script (DR-6).
- `e2e/ssr/build-cases.mjs` declares each case twice, as an application does: route `/` server-rendered and route `/csr` an explicit Browser route (`ssr: false`) of the same entry, which keeps the mount for the client-rendered comparison; it also checks that a page with islands ships exactly its own script and a page with none ships no script. The Rust renderer renders `/csr` from the real manifest.
- `e2e/ssr/regressions.spec.ts` observes activation as core documents it since strict activation (FORMA-104): no DOM write on success, so no host in `error`, no `forma:error` event, then behaviour. The pre-3.0.0 lane is archived under `docs/archive/2026-10-15-islands-only-e2e/`.

### Fixed — FORMA-105 (full-stack e2e lane)

- `e2e/fixtures/formajs-runtime.global.js` and `e2e/fixtures/formajs.global.js` are no longer tracked; `e2e/sync-fixtures.sh` writes them from `packages/core/dist` and `scripts/check.sh` runs it first. The committed copies predated `trustedHtml()` and failed five cases of `e2e/full-stack.spec.ts` whenever the lane ran without a fresh sync. The spec now refuses to run without the bundles, naming the sync script, and the sync script prints core's build output when that build fails instead of exiting silently. Verified by `e2e/full-stack.spec.ts` > `the bundles are the fresh sync, not a stale copy`.

## [3.0.0-rc.1]

- Prepare the coordinated release-candidate versions, internal requirements and template lock seeds for all seven packages, preserving external dependency resolutions. Current installation examples select this explicit prerelease.
- RC qualification and publication remain pending. The release requires a fresh packed-set rehearsal against the published beta performance baseline, independent whole-release audit, green exact-main CI and trusted tag verification. The subsequent automated RC burn-in remains a final-release gate.

## [3.0.0-beta.1]

Changes since `3.0.0-alpha.2`. The [beta qualification record](docs/release/BETA-QUALIFICATION.md) documents the packed acceptance; publication separately requires green exact-main CI and the trusted tag workflow.

- **Checked island adoption.** Native islands use declared props and one bounded, inert state envelope. Activation validates the served nodes before attaching behavior, preserves those nodes without initial repair, and refuses mismatched islands while valid siblings remain eligible. Calling `mount()` on marked SSR content now throws `FORMA_E_MOUNT_SSR`; register islands with `activateIslands({ Counter })` instead.
- **Activation readiness.** `activateIslands()` returns `Promise<void>` and can schedule load activation across browser tasks. Await it before work that depends on load islands being ready. Deferred triggers settle readiness when armed; the promise does not mean every deferred island has activated.
- **Keyed rows.** Native rows carry stable keys, and adoption matches rows by canonical key. `createKeyedRows(initial, keyFn)` with `createList(rows, renderRow)` supports replacing retained item values without rerunning row factories. Invalid or duplicate canonical keys are refused; retained rows keep their owned effects and listeners.
- **Strict native compilation.** Unsupported SSR source now fails even without `--strict`. Native islands and list rows need one stable Element root, and list sources need declared rows or admitted literal defaults. Boolean text needs an explicit textual representation; conditions must be boolean. Use declared presentation props, `browserOnly` islands or explicit Browser routes for unsupported shapes. See the [native subset](packages/compiler/docs/subset.md).
- **Consistent rendered values.** Ordinary text and attributes normalize line endings and NUL consistently. Nullish values and `false` remove class attributes; `true` on a non-boolean attribute becomes the string `"true"`. Use strings for ARIA's `"false"` token. These rules can change output without a source edit; rebuild compiler and runtime products together. See [parity rules](docs/parity-rules.md).
- **Explicit HTML-runtime ownership.** Replace automatic scanning and tierless lifecycle/configuration calls with `mountMarkup(root, trustedHtml(markup), { tier, grants, config })`, then use its update/unmount handle. Omitted grants allow no fetch or outside-root traversal. Removing a root alone does not dispose its handle.
- **Deployment continuity.** Build identity checks before `mount()` and `activateIslands()` detect mismatched HTML and bundles, emit `forma:skew`, and use a bounded reload policy. `previousDist` can retain one prior deployment's hashed assets; `security: true` disables retention. Deploy native modules, manifest and assets together.
- **Static routes and templates.** Static SSR routes omit browser entries and reject contradictory island, preload or executable-config declarations. Browser routes remain explicit with `ssr: false`. Both templates require Node 22+ and Rust 1.85+; prerelease dependencies remain exact.

Upgrade the coordinated seven-package set and its matching dependency closure together, keep both npm and Cargo lockfiles, and rebuild assets and server. Follow the [3.0 upgrade guide](docs/UPGRADING-3.0.md) and [template migration guide](packages/create-app/docs/UPGRADING-3.0.md).

## [3.0.0-alpha.2] - 2026-10-15

The tag `v3.0.0-alpha.1` on `8ba2930` never published: its release run (38764599499) passed
`check`, the three engines and `pack`, then `verify` failed in P17 before the publish jobs,
which were skipped; nothing reached crates.io or npm. The cause was the verification harness,
not the packages: the packed `@getforma/build` imports its optional compiler peer by name, and
P17 ran the packed libraries from a scratch directory whose upward module search reached the
checkout's root `node_modules`, where the workspace link `@getforma/compiler` points at
`packages/compiler`, which the `verify` job never builds (`ERR_MODULE_NOT_FOUND` on
`packages/compiler/dist/index.js`). On a built workstation the same search had silently used
the workspace build instead of the packed bytes, which is why every local dry run passed.

P17 now writes a `node_modules/@getforma` beside the unpacked packages, linking each packed
library, and proves with Node's own resolver that every bare `@getforma/*` specifier in every
packed dist resolves inside the packed set (`scripts/release-packed-resolution.mjs`, a new P17
check before any packed code runs, and `release-packed-resolution.test.mjs`, which reproduces
the tag's failure in an unbuilt checkout and refuses a built workspace standing in). Since a
version is never retagged, this alpha is `3.0.0-alpha.2`: the seven packages at the new
version, their bytes otherwise identical to alpha.1's, and the alpha.1 notes below stand.

## [3.0.0-alpha.1] - 2026-10-15

The first pre-release of 3.0.0: milestone M2 of PLAN-merge-and-3.0.0 (FORMA-145 step 2,
FORMA-187's M2 exit), published from this repository by the unified release workflow as one
seven-package set. On crates.io: `forma-ir`, `forma-ir-derive` and `forma-server` 3.0.0-alpha.1
(Cargo pre-release versions; plain requirements exclude them). On npm: `@getforma/core`,
`@getforma/compiler`, `@getforma/build` and `@getforma/create-app` 3.0.0-alpha.1 under the
`next` dist-tag; `latest` stays at the 2.x and 0.x lines, so `npm install` does not pick the
alpha up (L-41). No application takes a pre-release (L-54). The GitHub Release names the
milestone, the pending gates and every artefact's SHA-256; the release is timed against G6.

This alpha carries the breaking changes listed below, the gates of the alpha in
`scripts/release-contracts.json`: FORMA-110, 185, 112, 102, 107, 109, 111 and 144 slice 1.
Pending before the beta (M3), not in this alpha: FORMA-103, 104, 105, 181, 182, 183, 184,
144 slice 2, 188's fixture applications and 021's ratchet; that work is on the integration
branch `codex/forma-upgrade-review`. N2 is restated per L-55 (D6 taken, DR-35's fallback):
at most 25,500 B gzip of Forma code per route (26,000 if the safe cuts slip), Brotli reported
beside it, with the core and browser-ESM package caps ratcheting to 46,500 B after the safe
cuts C1 to C3 (naming FORMA-103 and 104). Neither the restated ceiling nor the ratcheted caps
nor the cuts are on `main`: this alpha ships under the previous caps (core 30,000 and browser
ESM 29,000 B gzip), which its gate passes; the restated figures arrive with the beta.

Release mechanics of this pull request, beside the version script's seven manifests, three
Cargo locks, npm lock and template seeds: core's documentation-truth test treats a pre-release
like `-dev` (the CDN snippets, CSP history and support table keep naming the last stable
release, 2.1.0, which is what `latest` serves); the compiler's supported-surface test computes
the core peer from the package version (`^3.0.0 || =3.0.0-alpha.1`, the window the version
script writes); the `forma-ir` and `forma-server` READMEs, which ship inside the crates, name
`=3.0.0-alpha.1`. The post-release pull request returns `main` to `3.0.0-dev`.


### Removed — FORMA-110

- Removed core's server functions, Node SSR and WASM entry points; the compiler's Vite plugins and their standalone transforms; and the WASM walker feature, build step, manifest field and server bootstrap. Browser islands continue to use `h()` and native Rust SSR remains supported.
- `@getforma/build` rejects `"use server"` directives with `BUILD-808`, including imported modules and watch rebuilds. Move server-side work to authenticated Rust routes called with `fetch`.
- `walk_island` remains internal. The pre-removal API guides are retained under `docs/archive/2026-10-15-legacy-apis/` and `packages/core/docs/archive/2026-10-15-legacy-apis/`.


### FMIR v3 development staging (FORMA-185)

- Seeded-bug qualification of the decoder fuzzing: three deliberate reader defects (CRC check skipped, section-table bound off by one, string length unchecked) were each found by the nightly targets within seconds; the minimised inputs are committed under `fuzz/regressions/` and replayed on every pull request by `seeded_decoder_defects_are_caught_deterministically` (`docs/FMIR-FORMAT.md` §11.4).

The seven package versions are aligned at `3.0.0-dev` so the compiler and Rust reader can
compare their exact base version `3.0.0`; nothing is tagged or published. Templates retain
their audited A2 pins until their own migration ticket. FORMA-112 owns the full release contract.

The v3 writer and reader land together: a 24-byte signature/version/length/CRC header,
variable sections, typed props schema/key-path/source-position metadata, shared generated
constants, stable load codes and lossless canonical dumps. Six unused opcode values and
PropsMode are removed. All bytecode string references fail at load. V2 modules require a
rebuild. The fourteen HTML goldens are unchanged; real emission, independent fault fixtures,
loader-before-bind checks, stable fuzz replay and a pinned nightly fuzz workflow cover the change.

### Unified release workflow (FORMA-187)

- FORMA-187: prepare the unified seven-package release pipeline, exact-commit CI
  gate, packed template/corpus verification, two minimal publishing jobs and
  compatibility record. A2 dry runs remain non-publishing; milestone contract
  hooks must be completed before the first `v3.0.0-alpha.1` release.
- FORMA-187 (first alpha): the live gate is milestone-aware. `scripts/release-contracts.json`
  states which tickets gate the alpha, beta, rc and final; a tag publishes only when every
  gate of its milestone and the earlier ones is done, checked in pack, P17, both publish jobs
  and the record. The alpha's gates (110, 185, 112, 102, 107, 109, 111, 144 slice 1) are done;
  the later milestones' are pending. The GitHub Release names the milestone and the pending
  list; the contract's `version` (3.0.0) is asserted against the tag's base version. The SR43
  lint checks the contract's shape with thirteen seeded violations. Pre-releases
  publish on npm `next` and as Cargo pre-release versions (`npmPublishArgs`, `cargoPublishArgs`,
  tested). `docs/release/ALPHA-RUNBOOK.md` is the alpha day's ordered runbook.

### The repository merge (FORMA-113)

formajs, forma-tools and create-forma-app were merged into this repository
with their histories: `@getforma/core` is `packages/core`, `@getforma/compiler`
and `@getforma/build` are `packages/compiler` and `packages/build`,
`@getforma/create-app` is `packages/create-app`, beside the crates in
`crates/`. Their tags carry the prefixes `formajs/`, `forma-tools/` and
`create-forma-app/`. A root npm workspace and the root Cargo workspace (now
with `forma-ir-derive`, whose published 0.0.0 placeholder is its source) are
built and tested by one command, `npm run check`, which one CI workflow runs.
Package names and versions did not change; nothing here is a release.


A2 whole-release audit follow-ups (FORMA-180, PR group 2). Tests, scripts and
workflows only: no crate code, no version.

- **The published `.crate` builds `--locked` on the Rust it declares (audit
  F7).** The release workflow's `pack` job locks with Cargo's MSRV-aware
  resolver (`CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS: fallback`), as CI's
  `msrv (forma-server, 1.85)` leg does, so the `Cargo.lock` inside the packed
  forma-server holds sha2 0.11.0 (Rust 1.85), not 0.11.1 (1.88); 0.2.2's
  packed lock failed `cargo build --locked` on 1.85 to 1.87, which no
  consumer's own lock does. The SR43 lint (`scripts/check-release-workflow.rb`)
  gains rule K5 for the setting, with three seeded violations (self-test 60 to
  63). The crates' file lists are unchanged.
- **forma-server's `forma-ir` requirement must equal forma-ir's version
  (audit F8).** `scripts/check-forma-ir-requirement.sh`, run by CI's
  `patch-is-live` job with its tests (`scripts/test-check-forma-ir-requirement.sh`),
  fails unless the requirement, normal and dev, is forma-ir's version:
  `[patch.crates-io]` and the release `verify` job both built green while
  0.2.2 carried `"0.2.0"` (fixed by FORMA-138). FORMA-112 replaces it with
  the one-version rule.
- **The list-walk time gate measures 100 against 3,200 rows, bounded at 64x
  (audit F17b).** `crates/forma-ir/tests/list_scaling.rs` compared 100 and
  1,600 rows at 32x; a walker that only scans the list once per row measured
  34.9x there, too close to the bound. Linear is now 32x; the same walker
  measures 110x to 125x, and the unmutated one 32.1x to 32.3x under a load
  average of 22 to 34.

## [0.2.2] - 2026-10-14

Release A2, the bridge to 3.0.0: additive, with deprecations. See
[crates/forma-ir/CHANGELOG.md](crates/forma-ir/CHANGELOG.md) and
[crates/forma-server/CHANGELOG.md](crates/forma-server/CHANGELOG.md) for the
itemised lists: each crate's "Upgrading from 0.2.1" names what an application
may meet, and its "Deprecated" names each deprecation's 3.0.0 replacement.

- **forma-server 0.2.2 requires forma-ir 0.2.2** (`forma-ir = "0.2.2"`,
  normal and dev; FORMA-138). forma-server calls `walk_to_html_counted`,
  `WalkCounts` and `IrError::Panicked`, which forma-ir 0.2.1 lacks, so the
  0.2.0 requirement it carried while both were unreleased would have let a
  lockfile holding forma-ir 0.2.1 fail to build it (E0425, E0599). Publish
  order: `ir-v0.2.2`, then `server-v0.2.2` once that run has published
  (CONTRIBUTING, "Releasing").
- **Public text names no internal decision records (FORMA-138, after
  FORMA-131).** forma-server's and forma-ir's rustdoc, `#[deprecated]` notes,
  development-build log lines, the retiring service worker's comment and
  `SECURITY.md` no longer cite decision-record, requirement or threat ids
  (`DR-`, `L-`, `SR`, `TH` and the like), which mean nothing to a reader of
  docs.rs; the allowlist they cited is named as `forma-raw-lint`'s. Internal
  `//` comments, private items' docs, tests and the CHANGELOGs keep them.
  Wording only: no item, signature or behaviour changed.
- **The install snippets name 0.2.2** (README and both crate READMEs, shown
  on crates.io): they said `"0.1"`, which resolves to 0.1.x and none of
  0.2's API.

- **The preview frame (FORMA-125, DR-14 tier (c), L-52).** forma-server's
  `PageResponse::frame` writes the document for content nobody reviewed: an
  opaque origin (`sandbox allow-scripts`), framed only by the application's
  origin, the runtime inline and allowed by its hash, and its requests
  closed (`connect-src`, `img-src`, `style-src`, `font-src`, `worker-src`,
  `form-action`), save the residuals its docs name: WebRTC, and navigations
  the host's own `frame-src` admits. Link hints and `srcdoc`, which no CSP
  directive governs and which connected in WebKit, are closed by core 2.1.0's
  frame runtime (its unreviewed mount removes them; formajs#35). The runtime is read and hashed at start
  from the build's `forma-runtime.js` (`PreviewFrame::load`; a missing
  runtime is a coded error). The host's side is documented in
  forma-server's `frame` module.

- **Trusted Types, reported (FORMA-127, DR-20).** forma-server sends
  `require-trusted-types-for 'script'; trusted-types forma forma-runtime` in
  `Content-Security-Policy-Report-Only` beside the unchanged enforced policy
  when the application names a reporting endpoint, and with no endpoint in
  development builds only (released, it would report to nobody and WebKit
  logs an error for it on every page); 3.0.0 enforces it. `PolicyExtensions` gains
  `report_to` (an endpoint the application runs, written into both policies;
  `report_uri` for pages served over plain HTTP)
  and `relax_trusted_types` (a named, logged per-route relaxation).

- **One named raw-HTML type, and typed homes for the rest (FORMA-126,
  DR-19).** forma-server's `RawHtml::trusted(..)` is the one way to say a
  string is markup to write unescaped; `body_prefix` takes it bound first,
  `let raw = RawHtml::trusted(..);` then `Some(&raw)`, and a plain string
  there still works and warns once per process in debug builds
  (`RAW-101`). What applications put in `body_prefix` that is not their own
  markup gets a typed home through `RenderCtx`: the
  route's `modulepreload` links, read from the build's manifest and nonced by
  forma-server (`with_module_preloads`), and head links (`with_head_link`);
  data keeps `config_json`. `render_page` writes 0.2.1's document.

- **A page edited under watch mode is served without a restart (FORMA-166,
  L-31, N7).** forma-server's `IrModules` loads through the strict loader
  and, in debug builds only, rereads a page's module on the next request
  after `forma-build --watch` rewrites it; a module that fails to load keeps
  the previous one and logs its `LOAD-1xx` code. Release builds read nothing
  after start.

- **forma-ir's `wasm` feature is deprecated (FORMA-131, DR-23).** Its exports,
  `render` and `render_island`, the browser's WASM walker, are
  `#[deprecated]` and are removed in 3.0.0 with the feature; islands
  re-render with `@getforma/core`'s `h()`. They still build and behave as at
  0.2.1. forma-server's `AssetManifest::wasm` and `WasmAssets` are deprecated
  with them, and the `window.__FORMA_WASM__` script they add to a page goes
  in 3.0.0.

- **The service worker is opt-in (FORMA-130, DR-25).** forma-server registers
  `/sw.js` only for an application that turns it on
  (`sw::configure(ServiceWorker::for_app(..)?.enabled())`); elsewhere `/sw.js`
  is a retiring worker that deletes Forma's v1 caches and the application's
  own, never another application's, and unregisters. `cargo test` now needs
  Node 18+ for the retiring worker's test.

- **The strict module loader is the default (FORMA-121, DR-11).** Call
  `load_ir_modules_strict` at start and refuse to start on its errors, each
  naming route, file and a `LOAD-1xx` code; the lenient `load_ir_modules`,
  which serves a corrupt module's route as an empty shell, is deprecated.
- **A list over budget fails before its first row (FORMA-122, DR-13).**
  forma-ir compares a list's length with the remaining iteration budget before
  walking it: a 60,000-row list under the default 50,000 fails in a
  comparison, not after 50,000 rows.
- **A render that returns its failure (FORMA-120, DR-11, DR-12).**
  forma-server's `try_render` returns `Result<PageResponse, RenderError>`: the
  page with its counts, or a coded error naming route and component, a caught
  panic included; `render_browser_shell` serves a route declared
  `ssr: false`. `render_page` (and its Phase 1 fallback) and
  `assets::load_manifest` are deprecated. forma-ir adds
  `walk_to_html_counted`. Both crates deny `unwrap`, `expect` and `panic!`
  outside tests.

- **A page response that carries its own headers (FORMA-124, DR-17).**
  forma-server's `PageResponse` always writes `no-store`, the strict policy and
  the document headers; handlers extend the policy through typed
  `PolicyExtensions`, never as text. `PageOutput`'s public fields and
  `headers()`, `PageConfig::config_script` and `render_page_with_nonce` are
  deprecated (removed in 3.0.0). Additive: every 0.2.1 call still compiles.
- **CI: actions pinned to commits, every job declares its token (DR-32,
  SR21, FORMA-010; no crate changed).** Each `uses:` names the commit its tag
  or branch pointed to on 2026-10-14, with the ref in a comment, so moving a
  tag no longer changes what runs. Every job in `ci.yml` declares
  `contents: read`; `release.yml` keeps its workflow-level `contents: read`
  and `id-token: write`.
- **CI: only the release's publish job can mint the publish token (SR43,
  L-34, L-42, FORMA-134; no crate changed).** `release.yml` splits into
  `check`, `pack`, `verify` and `publish`, and the workflow-level
  `id-token: write` is gone. `pack` restores no cache and compiles nothing:
  it locks the graph, runs `cargo package --no-verify` and records the
  `.crate`, its file list and the `Cargo.lock` with their SHA-256. `verify`
  builds the crate unpacked from that `.crate`. `publish`, the only job
  holding `id-token: write`, restores no cache and compiles nothing: cargo
  cannot upload a prebuilt `.crate`, so it checks the artefact against the
  record (whose own hash travels as a job output), re-packages from the
  tagged source with the recorded lock, publishes with
  `cargo publish --no-verify --locked` only if the `.crate` and its file list
  are byte-identical to the recorded ones, and then compares crates.io's
  checksum with the record. The tags stay the only trigger. CI's new
  `release-workflow` job runs actionlint (binary checked against a pinned
  SHA-256), `scripts/check-release-workflow.rb --self-test` and
  `scripts/test-release-artifacts.sh`.
  The lint also refuses a publish job that could go on after a failed check
  (`continue-on-error`, an `if:` on a step up to the publish, `always()`,
  `failure()` or `cancelled()` in the job's `if`, a check line that can
  swallow its failure, a shell without errexit), `container:` or `services:`
  on the publish or pack job, and a checkout of another repository or ref;
  every rule has a seed in `--self-test`, which fails if one does not. The
  artefact test flips a byte instead of writing one that may already be there.
  After the upload, `scripts/check-published-crate.sh` reads the version's
  checksum from crates.io's API for up to 15 minutes: a checksum that differs
  from the record fails and points to crates.io's web page to yank it; a
  version not visible yet only warns. CONTRIBUTING's new "Releasing" section
  says to push `server-v*` only after the `ir-v*` run has published.
- **Documentation matches the code (FORMA-009; no code changed).** The
  compiler writes FMIR modules as `.ir` files, so `docs/FMIR-FORMAT.md`,
  `docs/ARCHITECTURE.md`, `docs/README.md`, the README and two doc comments no
  longer call them `.fmir`. `SECURITY.md` supports 0.2.x, not 0.1.x.
  `docs/TESTING.md` no longer claims coverage in all four repositories: only
  `formajs` collects it. ksx Studio is the first consumer planned for release,
  not a production one (`ci.yml`, the README, `docs/ARCHITECTURE.md`).
  `docs/ARCHITECTURE.md` marks B6, the compiler's last-insert-wins wording,
  reconciled with forma-tools#13.
- **The list-walk timing gate holds on a loaded machine (FORMA-167,
  FORMA-179; no code changed).** `list_walk_time_is_linear_in_row_count` took
  the best of nine samples at 100 and 400 rows and failed above 6x; under load
  it measured 11.8x and failed. It now times 100 and 1,600 rows (linear about
  16x, the quadratic walker it replaced about 256x) as back-to-back batches of
  equal work, and judges the median of up to 41 such rounds against 32x. The
  allocation gate beside it is unchanged. CONTRIBUTING says which skipped CI
  jobs are by design.
- **The release's artefact upload can be re-run (A2 audit S7, FORMA-179; no
  code changed).** The release's `pack` job uploads `release-packed` with
  `overwrite: true`, so re-running all jobs after a failure replaces the
  earlier attempt's artefact instead of failing on its name (A2 audit S7);
  `publish` still checks every file against the record whose hash `pack`
  passes as a job output. The SR43 lint's new rule K4 requires it, with two
  seeds in `--self-test`.

## [0.2.1] - 2026-10-14

A patch release of both crates. See
[crates/forma-ir/CHANGELOG.md](crates/forma-ir/CHANGELOG.md) and
[crates/forma-server/CHANGELOG.md](crates/forma-server/CHANGELOG.md) for the
itemised lists.

- **forma-server on Rust 1.85 to 1.87: lock with the MSRV-aware resolver.**
  sha2 0.11.1 (2026-10-12) declares Rust 1.88, and a resolve that ignores
  `rust-version` takes it, so a fresh build of forma-server on 1.85 to 1.87
  fails before compiling any of its code. The declared floor stays 1.85.
  Consumers on those toolchains lock with Cargo's MSRV-aware resolver
  (`resolver = "3"`, or `incompatible-rust-versions = "fallback"`) or run
  `cargo update -p sha2 --precise 0.11.0`; [CONTRIBUTING.md](CONTRIBUTING.md)
  has the details. CI's `msrv (forma-server, 1.85)` leg now locks that way and
  prints the sha2 version it built. No crate code changed.

## [0.2.0] - 2026-08-06

Security and robustness hardening pass across both crates. See
[crates/forma-ir/CHANGELOG.md](crates/forma-ir/CHANGELOG.md) and
[crates/forma-server/CHANGELOG.md](crates/forma-server/CHANGELOG.md) for the
itemised list, including the breaking changes and the one removed API
(`check_ir_compatibility`).

Highlights:
- **A list renders in O(rows), not O(rows²).** The walker deep-cloned the whole
  `SlotData` — including the list's own array — once per row, so a 400-row
  table took 31.5 ms and 1.1 M allocations to emit 61 KB of HTML. It now takes
  0.15 ms and 2,412 allocations, byte-identically, with a committed regression
  gate (`crates/forma-ir/tests/list_scaling.rs`) that fails the build if the
  cost stops being linear
- **The FMIR binary layout and its stability contract are published**
  ([docs/FMIR-FORMAT.md](docs/FMIR-FORMAT.md)) — consumers were already
  byte-guarding a format that was documented nowhere
- **This repo is now the documentation hub for the stack.**
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the entry point every repo
  links to, [docs/TESTING.md](docs/TESTING.md) is the testing policy and
  `Verified by:` citation contract all four repos are held to (derived from the
  mutation-probe audit, not from generic advice), [docs/README.md](docs/README.md)
  indexes the whole doc set, and [docs/archive/](docs/archive/) records what has
  been retired and why. `CONTRIBUTING.md` was rewritten to point at them
- Cross-stack parity fixes that change emitted bytes on purpose: boolean
  DYN_ATTR values (`disabled="false"` meant *disabled*), empty-string
  attributes, ECMAScript truthiness for empty arrays, `String(value)` for
  array/object slots, and first-match-wins SWITCH
- More load-time validation: islands the table does not declare, stray
  FALLBACK, unterminated TRY_START, and one consistent duplicate-slot-name rule
  across all three resolvers
- MSRV corrected (forma-server claimed 1.70 and has never built below 1.85) and
  pinned in CI; `#![forbid(unsafe_code)]`, `missing_docs`, a Windows runner, a
  cargo-deny job, and a guard that `[patch.crates-io]` has not silently
  fallen back to the published crate
- Island props JSON escaping made total (`<!--<script` breakout), tag/attribute
  names validated, URL attributes scheme-checked, `on*` handlers dropped
- Per-render output and LIST-iteration budgets so malformed or hostile input
  degrades to Phase 1 instead of aborting the process
- Checked offset arithmetic and one-shot structural validation of the opcode
  stream; a 32-bit test job added to CI because `usize` is 32 bits on wasm32
- `</style>` and `</script` breakouts actually closed in the server templates
  (the 0.1.3 `</style>` claim was never true), plus `'strict-dynamic'`,
  `style-src-attr`, `worker-src` and `object-src` in the CSP
- Correct `Accept-Encoding` qvalue handling, content-hash-gated `immutable`
  caching with ETag/304, a wider case-insensitive MIME table, and zero-copy
  asset bodies

## [0.1.0] - 2026-03-13

### forma-ir
- Binary IR format (FMIR v2): 16-byte header, section table, bytecode/strings/slots/islands
- Parser: IrModule, StringTable, SlotTable, IslandTableParsed
- Walker: walk_to_html(), walk_island() for SSR rendering
- Slot system: SlotData, SlotValue, JSON-to-slot conversion
- WASM exports: render(), render_island() (behind `wasm` feature)
- Dump module for IR debugging (behind `dump` feature)

### forma-server
- Types: PageConfig, PageOutput, RenderMode, AssetManifest
- CSP: generate_csp_nonce(), build_csp_header() with strict policy
- Asset serving: serve_asset<A>() with brotli/gzip content negotiation
- Service worker: serve_sw<A>() with no-cache headers
- IR loading: load_ir_modules<A>() with Phase 1 fallback
- Template rendering: render_page() with Phase 1 (empty shell) and Phase 2 (SSR) paths
