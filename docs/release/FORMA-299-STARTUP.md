# FORMA-299: cold adoption startup repair

The RC3 packed rehearsal at `8ae49afa` failed startup acceptance: tenant-login
tasks of 57.260 and 60.373 ms exceeded the 55 ms exception ceiling, with
17.633 ms aggregate excess against 10 ms. That original run remains failed.
The repaired candidate at `9f53f5ef` passes fresh hosted P17 under that unchanged
policy. This is candidate qualification, not publication or whole-release acceptance.

## Selected change

Five private functions in `adoption.ts` become named parenthesized function
expressions: `prepareAdoption`, `construct`, `walk`, `at`, and `visit`.
V8 recognizes this existing syntax as an eager compilation hint. No experimental
browser flags, whole-application compilation banner, benchmark-specific path,
prewarming, scheduler change or weakened validation is used. Correctness does
not depend on the browser honoring the hint.

Independent AST normalization verifies unchanged signatures, defaults, bodies
and other source structure. The declaration-to-initializer change was separately
reviewed: the adoption/activation import cycle has no initialization-time read
of `prepareAdoption`, and private helpers are initialized before their first
reachable invocation. Actual packaged fresh imports and hydration controls
supplement that static analysis. Atomic adoption, early-input ownership,
original-event promotion, refusal checks and disposal remain unchanged.

The current V8 implementation and installed esbuild/Rollup pipeline preserve
these hints. The source mechanism and its costs are described in
[V8's parsing explanation](https://v8.dev/blog/preparser#pife). The newer
[whole-file hint](https://v8.dev/blog/explicit-compile-hints) was used only in a
separate causal diagnostic; it is not shipped by this change.

## Evidence and accepted qualification scope

The fixed local comparison uses the original packed RC3 set and one diagnostic
core-package override, with the other six archives, fixture sources and locked
dependencies unchanged. Both conditions use normally rebuilt native assets,
content hashes, CSP, SRI and Brotli transport. It is not an official release-set
record or a Linux qualification pass.

| Local observation | Original | Five-function candidate |
|---|---:|---:|
| Tenant first drain callback, mean of two | 36.2395 ms | 30.4235 ms |
| Tenant second drain callback, mean of two | 23.242 ms | 25.085 ms |
| Tenant total drain callbacks, mean of two | 59.4815 ms | 55.5085 ms |
| Tenant module evaluation, mean of two | 20.849 ms | 14.867 ms |
| Tenant post-activation used heap, mean of two | 1,632,686 B | 1,634,228 B |
| 100-island total drain callbacks, one visit | 76.477 ms | 83.181 ms |
| 100-island response after paint, one visit | 327.7 ms | 308.7 ms |

The first-task reduction supports testing this narrow candidate in one fresh
hosted qualification. The slower second tenant drain and increased 100-island
total work remain adverse observations. These small samples do not establish
statistical non-regression or repair of the original hosted failure. All six
independent activation observations meet existing limits; one tenant observation
records exactly 50 ms, which the unchanged validator allows. It is not described
as zero long tasks. All earlier/later startup tasks and heap outliers are retained;
trace heap peaks range from 2.735 to 31.000 MB without forced collection. These
are not retained-memory guarantees or measurements of the server's 8 MiB budget.

The distinct whole-file experiment used identity transport through a diagnostic
proxy. Its absolute timings and magnitude of improvement are not substituted for
this normally compressed candidate comparison.

Local source/output validation passes 252 focused tests, type checking, the
50-artifact core build, all 328 unchanged mutation-anchor preflights, five
dist-entry controls and four actual packed fresh-process import/hydration/disposal
controls. Anchor applicability is not execution of the full mutation campaign.
All five package ceilings pass: main 49,845 B against 49,926 B, an increase of
9 B. All three native application route ceilings pass; the tight route is
28,238 B against 28,420 B. Forty emitted PIFE nodes, three source maps and normal
asset/SRI identities were independently checked. The startup attribution
recognizer and all numeric thresholds are unchanged.

## Hosted qualification and remaining release conditions

Packed [run 40239821236](https://github.com/getforma-dev/forma/actions/runs/40239821236)
passes 62/62 checks at `9f53f5ef9bcbd68ff6b5a41c7855b4f5e387d757`.
All twenty cold visits on each of tenant-login and islands-100 require zero
startup exceptions, with zero excess above 50 ms and p95 TBT of zero. All forty
independent activation observations complete without errors or observer long
tasks; maximum response after paint is 198.5 ms and 389.9 ms respectively,
below 500 ms. The complete task and activation policy remains unchanged.
Largest complete source-bound drain tasks are42.186 ms for tenant-login and
40.343 ms for islands-100. The retained pre-application browser-layout tasks
are not misrepresented as zero whole-page long tasks.
The original failed run is not relabelled as passed. Artifact 12616263928 is
60,608,620 B with SHA256
`abaf953d3c0e93e86b98b74c0b9627e22fddf84fc1437225642f29f4785b51b9`.
The original archive, all eleven producer hashes, journal, completion record,
raw policy replay and owned-process cleanup are verified.

All five full engine/parity jobs pass in run 40239823036. CI 40239814838 passes
all nineteen applicable jobs, including both packed scaffold platforms; the
registry scaffold skip is expected before RC3 publication. Its synthetic merge
producer is `cf9ebf84332f8ee5fd5406183b1232489e40b465`, with the same tree as
9f53; it is not relabelled as the manual packed run's source. The fresh Linux
signal costs and original missed targets receive an explicit release-specific
disposition in [the performance decisions](3.1-PERFORMANCE-TRADEOFFS.md).

The full 328-probe campaign 40239819395 passes at 9f53: 326 caught, two counted
threshold survivors and no equivalent/unqualified probes. Both baselines pass
4,294 tests, including 26 ownership regressions. Every raw classification is
independently replayed; unchanged overall/expression 85% floors pass. Frozen Y
e3f90c48 changes only six reviewed factual docs/readiness files, with its own
nineteen passing CI jobs and expected registry scaffold skip. The changed core
CHANGELOG is separately validated; whole-archive equality is not claimed.
Earlier d6 mutation and 8ae engine/P17 records retain their original source
identities. Scoped FMIR, SR14 and corrected native-resource reuse through 9f53
is independently verified; it does not claim whole-package byte equivalence.
Whole-release D14 acceptance, tagged publication, active RC burn-in and final
release gates remain separate requirements. No release pass is asserted here.

Retained evidence is under the local `rc3/pife-five-candidate/` and
`rc3/p17-cpu-diagnostic/pife-subset-run/` directories. The latter report has
SHA256 `e6ecb5fef74e16043ec6eae52d9d805cfca8ab9abb9a8b53978c765d5a218d05`;
its complete manifest is
`73f9269147392280bb24651978057cf6d4fee320670101ca38d68d3ddddac8a4`.
The independent focused source/output review has SHA256
`14949085835a6e352199780c52a78900cac36fef23dd9df0b3520485655af3a9`.

Rollback the five-function source change together. Keep the original failure,
measurement records and unchanged release policy; do not revert to a false pass.
