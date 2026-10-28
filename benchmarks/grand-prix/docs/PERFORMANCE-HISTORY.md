# Forma Grand Prix engineering history

Grand Prix findings drove the 3.1.0 work inherited by 3.2.0. This history separates shipped changes, accepted costs, rejected experiments and measurements still needed. Release ancestry does not establish new performance results.

Updated 2026-10-28. Canonical data: [change-ledger.json](../config/change-ledger.json).

## Read the evidence correctly

Every number belongs to its campaign and exact source. Only rows marked as paired provide a before/after comparison; observation-only rows have no invented baseline. Fixed order, small samples and hosted-machine variance limit causal claims. Raw samples and independent audits remain authoritative.

The original programme shipped in 3.1.0 (`9a570afe`); 3.2.0 (`fc76ea85`) inherits that source history. The separate 3.2 packed decoder and CI records below are release observations, not a fresh Grand Prix race.

## GP-H001 — Plain HTML for static native routes

**adopted** · FORMA-257 · Shipped: 3.1.0; inherited by 3.2.0.

Finding: The no-JavaScript benchmark page paid for adoption markers, row keys and empty island state.

Decision: Omit adoption machinery only on native routes without JavaScript or islands; keep island contracts intact.

| Measurement | Before | After / observed | Unit | Campaign | Boundary |
| --- | ---: | ---: | --- | --- | --- |
| 100-row response bytes | 33193 | 17154 | B | 40116668819 | same-campaign; mean; target <= 17500: met |
| Combined SSR Sprint | 2490.69 | 2583.96 | requests/s | 40116668819 | same-campaign; mean |
| Combined SSR Endurance | 262.66 | 262.4 | requests/s | 40116668819 | same-campaign; mean |

**Tradeoffs and limits**

- Smaller bytes did not deliver the estimated 3,300/5,000 requests/s. Combined Sprint improved 3.74%; Endurance was 0.10% lower in this campaign.

**Remaining targets**

- Investigate whole-request costs rather than treating removed bytes as a throughput prediction.

**Guardrails**

- Preserve visible content, CSP/response policy and strict adoption on island routes.
- Do not relabel component measurements as a final 3.1 or 3.2 binary measurement.

**Run another experiment only when**

- A relevant compiler/static-renderer change or a preregistered whole-request hypothesis exists.

**Evidence and source identity**

- [Paired server sections 8–10](../../../benchmarks/grand-prix/evidence/2026-10-24/round-2.json)
- [Original campaign 40116668819](https://github.com/getforma-dev/forma/actions/runs/40116668819)
- [Published 3.1 release scope](../../../CHANGELOG.md)
- Exact source commits: [2006423b](https://github.com/getforma-dev/forma/commit/2006423b21fe0f8dd5a510bd09bfe3b8748327a5), [d00f231a](https://github.com/getforma-dev/forma/commit/d00f231a98dbe6068354fb862134d91e5b276380), [81d1fd81](https://github.com/getforma-dev/forma/commit/81d1fd815d93f274f9b8bec7a6bc584e1273f3c2)

## GP-H002 — Reduce native walker allocation and escaping cost

**adopted** · FORMA-258 · Shipped: 3.1.0; inherited by 3.2.0.

Finding: Profiling found temporary conversion/allocation costs in rendering; HTTP and walker-only clocks measure different work.

Decision: Use reviewed allocation/escaping improvements while preserving emitted content and escaping security controls.

| Measurement | Before | After / observed | Unit | Campaign | Boundary |
| --- | ---: | ---: | --- | --- | --- |
| 100-row instrumented walker | 113.85 | 94.11 | µs | 40116668819 | same-campaign; mean |
| 1000-row instrumented walker | 1211.27 | 968.47 | µs | 40116668819 | same-campaign; mean |
| SSR Sprint | 2490.69 | 2619.51 | requests/s | 40116668819 | same-campaign; mean |
| 1000-row walker cost | — | 2.967 | ns/B | 40116668819 | observation-only; observed; target <= 10: met |

**Tradeoffs and limits**

- HTTP marginal cost remained 11.006 ns/B; the walker-only target is not an HTTP claim. One Endurance tail-ratio sample reached 1.5264 although the frozen mean-based rule passed.

**Remaining targets**

- Keep HTTP and walker clocks separate; profile data preparation/projection/transport for further gains.

**Guardrails**

- Keep exact nodes/list iterations, body parity, escaping mutant controls, and all outliers.

**Run another experiment only when**

- A measured walker path or a specific allocation hypothesis changes; do not rerun unchanged code for a nicer sample.

**Evidence and source identity**

- [Walker cost section 9](../../../benchmarks/grand-prix/evidence/2026-10-24/round-2.json)
- [Original campaign 40116668819](https://github.com/getforma-dev/forma/actions/runs/40116668819)
- [3.1 allocation improvement](../../../CHANGELOG.md)
- Exact source commits: [2006423b](https://github.com/getforma-dev/forma/commit/2006423b21fe0f8dd5a510bd09bfe3b8748327a5), [be029708](https://github.com/getforma-dev/forma/commit/be029708545efc8d771df25ce774362f461718e2)

## GP-H003 — Public-effect gains carry batching and own-engine gaps

**accepted-tradeoff** · FORMA-259 · Shipped: 3.1.0; inherited by 3.2.0.

Finding: Published public effects substantially lagged the exact engine used by Forma; comparisons to a different engine version were insufficient.

Decision: Select the simpler supplied-node effect/lifecycle design with cleanup repair; retain pristine alien-signals 3.1.2 as a separate same-trial control.

| Measurement | Before | After / observed | Unit | Campaign | Boundary |
| --- | ---: | ---: | --- | --- | --- |
| Write with one effect | 5307555 | 9062327 | ops/s | 40140319634 | same-campaign; mean |
| Fan-out to 100 effects | 67273 | 165336 | ops/s | 40140319634 | same-campaign; mean |
| Effect create and dispose | 2194656 | 7710678 | ops/s | 40140319634 | same-campaign; mean |
| Batch of 100 writes | 214962 | 185312 | ops/s | 40140319634 | same-campaign; mean |
| Fan-out / pristine own engine | — | 0.71645 | ratio | 40140319634 | observation-only; observed; target >= 0.8: missed |

**Tradeoffs and limits**

- Batch throughput was 13.79% below published and 6.93% below pre-effect main. The 80% own-engine fan-out goal failed.
- This campaign measures 9ac07a44; later RC3 observations are GP-H010 and supersede claims about the latest candidate.

**Remaining targets**

- Reach at least 80% of the same-trial pristine engine for each effect workload without dropping lifecycle behavior.

**Guardrails**

- Keep synchronous updates, cleanup/disposal, reporting, owned subscriptions and all nine workloads.
- Do not infer island-adoption gains from public-effect gains or aggregate away batching loss.

**Run another experiment only when**

- A scoped effect/batch design hypothesis has changed; retain exact own-engine version and all operations.

**Evidence and source identity**

- [FORMA-259 decisions](../../../docs/release/3.1-PERFORMANCE-TRADEOFFS.md)
- [Final client audit](../../../benchmarks/grand-prix/evidence/2026-10-24/client-final/README.md)
- [Original campaign 40140319634](https://github.com/getforma-dev/forma/actions/runs/40140319634)
- Exact source commits: [2006423b](https://github.com/getforma-dev/forma/commit/2006423b21fe0f8dd5a510bd09bfe3b8748327a5), [f5be8647](https://github.com/getforma-dev/forma/commit/f5be8647439e560c71c27b8c5f4bde26507b8bbb), [9ac07a44](https://github.com/getforma-dev/forma/commit/9ac07a446ebe8aaad407a895fa8aaece189bc69e)

## GP-H004 — Withdraw row optimizations that worsened real operations

**rejected** · FORMA-260 · Shipped: not shipped.

Finding: The first qualified row candidate missed creation acceptance and slowed swap, removal and clear despite a smaller bundle.

Decision: Withdraw unproven list changes in 16862984; retain their failed campaign and compare future proposals against the exact rejected design.

| Measurement | Before | After / observed | Unit | Campaign | Boundary |
| --- | ---: | ---: | --- | --- | --- |
| Create 1000 rows | 25.66 | 31.74 | ms | 40116672499 | same-campaign; mean |
| Swap rows | 1.72 | 2.24 | ms | 40116672499 | same-campaign; mean |
| Remove row | 1.4 | 2.14 | ms | 40116672499 | same-campaign; mean |
| Clear rows | 2.82 | 4.26 | ms | 40116672499 | same-campaign; mean |

**Tradeoffs and limits**

- A lower bundle size did not establish acceptable interaction speed. Fixed-order samples are bounded observations, not a universal causal effect.

**Remaining targets**

- Create 1000 rows at no more than 1.10× same-trial vanilla remains the original target.

**Guardrails**

- Do not remove ownership/listener cleanup or reuse rejected generic-list code without a new reviewed contract.
- Do not pool the failed and rollback VMs or select only favorable operations.

**Run another experiment only when**

- A materially different, explicit template/event or large-list strategy is preregistered with full correctness and cost coverage.

**Evidence and source identity**

- [Withdrawn and rollback sections 13–15](../../../benchmarks/grand-prix/evidence/2026-10-24/round-2.json)
- [Original campaign 40116672499](https://github.com/getforma-dev/forma/actions/runs/40116672499)
- [Original campaign 40118323052](https://github.com/getforma-dev/forma/actions/runs/40118323052)
- [FORMA-260 rejected prototypes](../../../docs/release/3.1-PERFORMANCE-TRADEOFFS.md)
- Exact source commits: [2006423b](https://github.com/getforma-dev/forma/commit/2006423b21fe0f8dd5a510bd09bfe3b8748327a5), [54a836c0](https://github.com/getforma-dev/forma/commit/54a836c06eeba99c345cf294d47e7118b5ad7924), [16862984](https://github.com/getforma-dev/forma/commit/16862984ffdbb6c171af9d63a9eefac2caba843d)

## GP-H005 — Offer response compression as a deliberate opt-in

**accepted-tradeoff** · FORMA-261 · Shipped: 3.1.0; inherited by 3.2.0.

Finding: Rendered HTML was sent uncompressed while its marker-heavy output compressed well; per-request compression adds CPU and security costs.

Decision: Add response-specific Brotli/gzip negotiation through with_compression; leave it off by default.

| Measurement | Before | After / observed | Unit | Campaign | Boundary |
| --- | ---: | ---: | --- | --- | --- |
| Identity → Brotli wire bytes | 33193 | 2491 | B | 40116661885 | same-campaign; mean |
| Identity → Brotli Sprint | 2778.61 | 2055.57 | requests/s | 40116661885 | same-campaign; mean |
| Identity → Brotli Sprint p99 | 27.74 | 37.23 | ms | 40116661885 | same-campaign; mean of per-run p99 |
| Identity → Brotli mean memory peaks | 3.92 | 7.02 | MiB | 40116661885 | same-campaign; mean |

**Tradeoffs and limits**

- Brotli reduced bytes by 92.5% but throughput by 26.0% and increased p99 by 34.2%. gzip also costs CPU/tail latency.
- This pre-static executable does not predict the compression ratio of the final smaller static response.

**Remaining targets**

- Choose compression only for an application workload whose transfer benefit justifies CPU, latency and response-security costs.

**Guardrails**

- Require response-specific BREACH review; preserve CSP/no-store/Vary and decoded-content correctness.

**Run another experiment only when**

- Response data shape, codec version/level, cache policy or deployment constraints materially change.

**Evidence and source identity**

- [Compression section 11](../../../benchmarks/grand-prix/evidence/2026-10-24/round-2.json)
- [Original campaign 40116661885](https://github.com/getforma-dev/forma/actions/runs/40116661885)
- [Opt-in page compression policy](../../../SECURITY.md)
- [Published 3.1 compression scope](../../../CHANGELOG.md)
- Exact source commits: [87ecea92](https://github.com/getforma-dev/forma/commit/87ecea920685694dda3ed8a8d914b03f28ddff9c)

## GP-H006 — Cache release dependencies before changing FMIR delivery

**adopted** · FORMA-262 · Shipped: 3.1.0; inherited by 3.2.0.

Finding: A page edit relinks the embedded Rust application; cold dependencies dominate uncached starter builds.

Decision: Ship locked target caching in generated CI with read-only cache policy outside the default branch. Defer release FMIR-from-disk.

| Measurement | Before | After / observed | Unit | Campaign | Boundary |
| --- | ---: | ---: | --- | --- | --- |
| Minimal Rust release cold → restored cache | 35.84 | 2.87 | s | 40108274094 | separate-runners-cache-pair; mean |
| Dashboard Rust release cold → restored cache | 38.7 | 4.11 | s | 40108274094 | separate-runners-cache-pair; mean |
| Warm registry compilation artifacts | — | 0 | count | 40108274094 | observation-only; observed |

**Tradeoffs and limits**

- One cold/warm pair per starter on separate runners is an example, not a distribution or guaranteed build speed.
- Release disk-loading adds authentication, atomic-update and version-skew obligations; it was evaluated and deferred.

**Remaining targets**

- Keep release build/deploy integrity while reducing repeat compilation work.

**Guardrails**

- Preserve exact lockfile/cache keys and default-branch write policy. Do not call skipped app recompilation an achieved optimization.

**Run another experiment only when**

- Cache keys/toolchains or starter workloads change; disk-loading work must first solve authenticated atomic deployment.

**Evidence and source identity**

- [Cache section 16](../../../benchmarks/grand-prix/evidence/2026-10-24/round-2.json)
- [Original campaign 40108274094](https://github.com/getforma-dev/forma/actions/runs/40108274094)
- [Cache and disk-loading policy](../../../docs/DEPLOYMENT.md)
- [Published starter cache change](../../../CHANGELOG.md)
- Exact source commits: [2006423b](https://github.com/getforma-dev/forma/commit/2006423b21fe0f8dd5a510bd09bfe3b8748327a5), [f66783c9](https://github.com/getforma-dev/forma/commit/f66783c99d357b833238e6a424aaa599c4c78cb5)

## GP-H007 — Isolate tree-shaking gains from effect and row changes

**adopted** · FORMA-263 · Shipped: 3.1.0; inherited by 3.2.0.

Finding: Client-only apps retained unnecessary activation and development-related setup; combined candidates obscured attribution.

Decision: Extract the bundle-only change and measure identical app/dependency builds independently of rejected rows and public effects.

| Measurement | Before | After / observed | Unit | Campaign | Boundary |
| --- | ---: | ---: | --- | --- | --- |
| Production app Brotli 11 | 8654 | 8417 | B | local-bundle-2026-10-24 | controlled-local-build; mean |
| Production app gzip 9 | 9549 | 9267 | B | local-bundle-2026-10-24 | controlled-local-build; mean |
| Production app raw JavaScript | 25876 | 25063 | B | local-bundle-2026-10-24 | controlled-local-build; mean |

**Tradeoffs and limits**

- The isolated 237 B Brotli gain is not the later integrated app size; effect/ownership/compiler changes add separate costs.
- Mapped-module byte totals come from another build; compression savings are not additive by module.

**Remaining targets**

- Keep unused features out of the measured client-only import graph without weakening ownership APIs.

**Guardrails**

- Retain exact app, dependency, bundler and source hashes; keep static byte results separate from timing campaigns.

**Run another experiment only when**

- Reachable import graph, package splitting or emitted production code changes.

**Evidence and source identity**

- [Bundle-only section 20](../../../benchmarks/grand-prix/evidence/2026-10-24/round-2.json)
- [Recompute preserved production bytes](../../../benchmarks/grand-prix/evidence/2026-10-24/local-bundle/verify.mjs)
- [Reviewed isolated extraction](https://github.com/getforma-dev/forma/pull/187)
- Exact source commits: [ea0adee8](https://github.com/getforma-dev/forma/commit/ea0adee8a58772787d6a07f05e83a4b651283289), [8b56026e](https://github.com/getforma-dev/forma/commit/8b56026efbb9ac3c52e7b4382e483f1433509dd3)

## GP-H008 — Keep initial adoption cost separate from public effects

**accepted-tradeoff** · FORMA-259 · Shipped: 3.1.0; inherited by 3.2.0.

Finding: Public-effect improvements did not establish adoption performance; strict adoption uses the raw engine.

Decision: Run a fixed ABBA 1000-binding regression control and explicitly accept the measured adoption cost.

| Measurement | Before | After / observed | Unit | Campaign | Boundary |
| --- | ---: | ---: | --- | --- | --- |
| Initial adoption | 8.5867 | 8.9267 | ms | 40146688695 | same-campaign-ABBA; mean |
| Single-signal update | 1.2467 | 1.14 | ms | 40146688695 | same-campaign-ABBA; mean |

**Tradeoffs and limits**

- Mean adoption rose 0.3400 ms (3.96%); both B-leg means exceeded both A legs. No-adoption-regression was not demonstrated.
- One 7.1 ms A update drives the lower update mean; medians 1.0 → 1.1 ms do not support a clean speedup. Historical error capture was narrower than current harness requirements.

**Remaining targets**

- Improve adoption while retaining zero initial writes and node identity; do not promise equality from overlapping spreads.

**Guardrails**

- Keep every leg, five warmups/15 samples per leg, existing update/disposal checks and explicit source binding.

**Run another experiment only when**

- Adoption path or its emitted graph changes, or a preregistered model warrants a new ABBA control.

**Evidence and source identity**

- [Adoption ABBA decision](../../../docs/release/3.1-PERFORMANCE-TRADEOFFS.md)
- [Original campaign 40146688695](https://github.com/getforma-dev/forma/actions/runs/40146688695)
- Exact source commits: [f5be8647](https://github.com/getforma-dev/forma/commit/f5be8647439e560c71c27b8c5f4bde26507b8bbb), [44835efa](https://github.com/getforma-dev/forma/commit/44835efa2f13d694ff32f0dc56f4e5f0aa413eb3)

## GP-H009 — Adopt compiler-created rows only as explicit opt-in

**accepted-tradeoff** · FORMA-294, FORMA-260 · Shipped: 3.1.0; inherited by 3.2.0.

Finding: Generic row construction remained a weakness; early literal/fresh-event prototypes were insufficient and unsafe to promote broadly.

Decision: Ship reviewed clientTemplates:true for eligible client-created rows, with staged evaluation, delegated callbacks and guaranteed cleanup; default stays off.

| Measurement | Before | After / observed | Unit | Campaign | Boundary |
| --- | ---: | ---: | --- | --- | --- |
| Create 1000 rows | 31.92 | 28.22 | ms | 40226501380 | same-campaign; mean |
| Create 10000 rows | 347.24 | 287.34 | ms | 40226501380 | same-campaign; mean |
| Clear rows | 4.24 | 5.18 | ms | 40226501380 | same-campaign; mean |
| Create 1000 / matched vanilla | — | 1.271 | ratio | 40226501380 | observation-only; observed; target <= 1.1: missed |

**Tradeoffs and limits**

- Clear cost rose 22.17% (+0.94 ms); select/swap also rose. Creation remains above 1.10× vanilla.
- The package graph cap was explicitly raised 49,414 → 49,926 gzip B; unchanged route budgets still reject oversized opted-in native fixtures. Adopted lists do not receive this clone path.

**Remaining targets**

- Improve client-created rows without expanding compiler semantics silently or removing cleanup.

**Guardrails**

- Keep option default-off, unsupported-shape refusals, staged expression order, raw-sink policy and stale-callback revocation.
- Preserve route/startup limits; a package cap increase is not permission to increase route budgets.

**Run another experiment only when**

- A scoped compiler design or shared-chunk packaging hypothesis changes; compare all nine operations and actual opted-in delivery bytes.

**Evidence and source identity**

- [Compiler scope, costs and qualification](../../../docs/release/FORMA-294-COMPILER-CANDIDATE.md)
- [Original campaign 40226501380](https://github.com/getforma-dev/forma/actions/runs/40226501380)
- [Published 3.1 opt-in compiler](../../../CHANGELOG.md)
- Exact source commits: [226f0d8d](https://github.com/getforma-dev/forma/commit/226f0d8d56e0d6e68517d53f52bcc7149ee7e869), [1d204ba4](https://github.com/getforma-dev/forma/commit/1d204ba48ea7861f28a22d9483116b310afb35f2), [ad26d9f8](https://github.com/getforma-dev/forma/commit/ad26d9f8cdf78f6cfd2f22afefa2883cd903187a)

## GP-H010 — Startup repair leaves later client regression debt visible

**accepted-tradeoff** · FORMA-299, FORMA-259, FORMA-260 · Shipped: 3.1.0; inherited by 3.2.0.

Finding: RC3 startup qualification failed source-bound 57.260/60.373 ms tasks; later byte-equivalent DOM programs still showed adverse timing observations.

Decision: Enable eager compilation hints for five private adoption functions without changing bodies or startup bounds; accept bounded client costs explicitly.

| Measurement | Before | After / observed | Unit | Campaign | Boundary |
| --- | ---: | ---: | --- | --- | --- |
| Tenant maximum source-bound drain task | — | 42.186 | ms | 40239821236 | observation-only; observed; target <= 50: met |
| Island maximum source-bound drain task | — | 40.343 | ms | 40239821236 | observation-only; observed; target <= 50: met |
| Fan-out / pristine own engine | — | 0.74507 | ratio | 40240214599 | observation-only; observed; target >= 0.8: missed |
| Effect create-dispose / pristine own engine | — | 0.79463 | ratio | 40240214599 | observation-only; observed; target >= 0.8: missed |
| Create 1000 / matched vanilla | — | 1.563 | ratio | 40240214599 | observation-only; observed; target <= 1.1: missed |
| Reachable app Brotli bytes | — | 9425 | B | 40240214599 | observation-only; observed |

**Tradeoffs and limits**

- Same-campaign current vs 8ae throughput changes: fan-out −13.11%, diamond −11.29%, effect creation −8.79%. Published-relative gains do not erase these losses.
- Current app is 773 B Brotli above published 3.0. The original fan-out, effect-create and row targets remain missed.
- Separate failed and repaired startup campaigns do not form a same-host speed comparison. Byte-identical APIs do not prove compilation, module-layout or collection causes.

**Remaining targets**

- Reach >=80% own-engine fan-out and effect creation and <=1.10× same-trial vanilla creation; retain the 50 ms startup engineering target.

**Guardrails**

- Retain every sample/control, startup source binding, unchanged ownership and size gates; do not rerun solely for favorable values.
- The bounded 55 ms exception policy is explicit, not a replacement for the 50 ms target or a retroactive pass.

**Run another experiment only when**

- Relevant source/emitted graph or a preregistered mechanism changes; otherwise reuse the accepted evidence with exact applicability proof.

**Evidence and source identity**

- [RC3 startup repair and current client costs](../../../docs/release/3.1-PERFORMANCE-TRADEOFFS.md)
- [Original campaign 40240214599](https://github.com/getforma-dev/forma/actions/runs/40240214599)
- [Original campaign 40239821236](https://github.com/getforma-dev/forma/actions/runs/40239821236)
- [Published 3.1 accepted gaps](../../../CHANGELOG.md)
- Exact source commits: [8ae49afa](https://github.com/getforma-dev/forma/commit/8ae49afaf742914a376f2654afa3758a02b38827), [9f53f5ef](https://github.com/getforma-dev/forma/commit/9f53f5ef9bcbd68ff6b5a41c7855b4f5e387d757)

## GP-H011 — Qualify transport and preserve rejected campaign evidence

**adopted** · FORMA-264 · Shipped: 3.1.0; inherited by 3.2.0.

Finding: Probe/load user agents differed; twelve React Router samples had unresolved body-size discrepancies. Original rankings were not qualified.

Decision: Use identical explicit request headers, retain probe bodies and full load-generator output, and run a separate corrected campaign instead of patching historical numbers.

| Measurement | Before | After / observed | Unit | Campaign | Boundary |
| --- | ---: | ---: | --- | --- | --- |
| Audited timed server samples | — | 168 | count | 40123441558 | observation-only; observed |
| Retained probe bodies | — | 112 | count | 40123441558 | observation-only; observed |
| Transport records | — | 294 | count | 40123441558 | observation-only; observed |

**Tradeoffs and limits**

- Aggregate byte equality and retained probes do not prove the content of each timed response. Hosted VMs do not prove exclusive physical hosts.
- Historical unresolved/failed runs stay excluded; changing a harness validator does not upgrade old evidence.

**Remaining targets**

- Preserve fair controlled comparisons and explicit qualification boundaries as adapters evolve.

**Guardrails**

- Use same-campaign ratios and exact lock/source/browser/resource identities; never pool unrelated VMs or crown an overall winner.
- Memory <=8 MiB, readiness remainder <=50 ms and image <=150,000,000 B remain source-specific strength guards.

**Run another experiment only when**

- Headers, transport, dependency/runtime versions, workloads or resource profiles change; replay retained evidence before spending a new race.

**Evidence and source identity**

- [Authenticated campaign boundaries](../../../benchmarks/grand-prix/evidence/2026-10-24/README.md)
- [Original campaign 40123441558](https://github.com/getforma-dev/forma/actions/runs/40123441558)
- [Qualified audit result](../../../benchmarks/grand-prix/evidence/2026-10-24/server-qualified/independent-verification.json)
- Exact source commits: [2006423b](https://github.com/getforma-dev/forma/commit/2006423b21fe0f8dd5a510bd09bfe3b8748327a5), [9a570afe](https://github.com/getforma-dev/forma/commit/9a570afece5eb5091824422f00134a875310e857)

## GP-H012 — Carry 3.1 lessons into 3.2 without inventing a rerace

**accepted-tradeoff** · FORMA-264, FORMA-301 · Shipped: 3.2.0.

Finding: Benchmark-driven improvements shipped in 3.1 and are inherited by 3.2; router release qualification has different clocks and scopes.

Decision: Record release ancestry, current packed decoder observations and explicit timing/soak waivers separately from Grand Prix measurements.

| Measurement | Before | After / observed | Unit | Campaign | Boundary |
| --- | ---: | ---: | --- | --- | --- |
| Packed decoder shape 1 p95 | — | 11.4 | ms | 40553136904 | observation-only; nearest-rank p95; target <= 30: met |
| Packed decoder shape 2 p95 | — | 27.1 | ms | 40553136904 | observation-only; nearest-rank p95; target <= 30: met |
| Full check command duration | — | 577 | s | 40549601525 | observation-only; observed |
| Tag workflow to release acknowledgment | — | 2369.113 | s | 40553136904 | observation-only; observed; target <= 1800: missed |

**Tradeoffs and limits**

- The accepted decoder bound was 30.7 ms but actual tagged p95s also passed original 30 ms. This is not a decoder speedup comparison.
- Additional 20-run N7 campaign and one-hour soak were explicitly waived; 577 s is one observation, not p95. Outer release target missed.
- No fresh full Grand Prix campaign for exact stable 3.2 is established by these release documents. Inherited code is not inherited timing identity.

**Remaining targets**

- Use a new versioned same-host race when a changed measured path needs evaluation; do not repeat waived release work or claim it passed.

**Guardrails**

- Keep security/correctness, cleanup and archive provenance mandatory; preserve original failed reports and decisions.
- Do not compare 3.2 decoder/CI observations to older Grand Prix clocks.

**Run another experiment only when**

- A specific 3.2-or-later change needs measured attribution under a frozen campaign; otherwise retain exact release/evidence boundaries.

**Evidence and source identity**

- [Stable 3.2 publication and actual observations](../../../docs/release/3.2-PUBLICATION.md)
- [Explicit timing limits and waivers](../../../docs/release/3.2-PERFORMANCE-DECISION.md)
- [3.1 and 3.2 shipped scope](../../../CHANGELOG.md)
- [Original campaign 40553136904](https://github.com/getforma-dev/forma/actions/runs/40553136904)
- [Original campaign 40549601525](https://github.com/getforma-dev/forma/actions/runs/40549601525)
- Exact source commits: [9a570afe](https://github.com/getforma-dev/forma/commit/9a570afece5eb5091824422f00134a875310e857), [fc76ea85](https://github.com/getforma-dev/forma/commit/fc76ea8531f0e3a85d0224087384e41f52040e3c)

## Ledger schema and update discipline

`config/change-ledger.json` uses schemaVersion 1. `sources` maps stable source IDs to full Git commits; `releases` binds versions to exact tags and publication evidence. `changes` owns stable GP-H IDs, ticket links, disposition, first-shipped releases, inherited releases, source commits, measurements, evidence, tradeoffs, remaining targets, guardrails and conditions for another experiment.

Each measurement declares a metric, unit, direction, campaign ID, pairing, statistic, sample count (null when not asserted), candidate observation and either a paired baseline or null. Targets retain their original operator/value and an arithmetically checked met flag. Local evidence paths are repository-relative; external evidence uses HTTPS. The schema validator rejects duplicate IDs, unknown sources/releases, unsafe or missing local paths, fabricated baselines on unpaired observations and inconsistent target outcomes.

Add a new stable entry when a finding changes an engineering decision. Update release linkage only with publication/source evidence. Preserve superseded campaigns, rejected options, source identities and missed targets. Do not turn a product acceptance into a numerical pass, a waived task into completed work, or inherited code into a fresh timing result. Before another race, name the changed hypothesis/source, reuse applicable authenticated evidence, and freeze workload, versions, resource profile and analysis rule.
