# FORMA-259 / 260 / 263 development qualification

Measured 2026-10-24 on an Apple M1 Pro (10 cores), macOS 26.1 arm64.
Candidate: `34f1d6ef` (functional source `5002b7aa`; the final commit only corrects
an element listener comment). All three development agents held CPU-heavy work
for the final measurement window. This is a coordinated local development run,
not the Linux release baseline; raw load averages and browser versions are kept.
The absolute development checkout prefix in JSON paths is replaced with
`<workspace>`; all numbers and samples are unchanged.

The signal baseline is `d727d28e`. Each Node version runs Forma and its exact
installed alien-signals 3.1.2 in separate processes: five warmups, nine samples,
all nine original workloads and fourteen behavioral assertions per adapter.
The baseline was captured earlier in this same development session; it was not
interleaved with the final candidate. Ratios compare each Forma run with its own
raw-engine control.

| Engine | Write + effect | Fanout 100 | Create/dispose | Overall geometric mean |
|---|---:|---:|---:|---:|
| Node 22.21 baseline | 42.3% | 23.4% | 26.5% | 59.1% |
| Node 22.21 candidate | 74.5% | 60.2% | 48.9% | 73.1% |
| Node 24.22 baseline | 40.8% | 31.3% | 26.8% | 61.7% |
| Node 24.22 candidate | 70.1% | 65.7% | 46.8% | 76.6% |

FORMA-259's three 80% effect thresholds and 85% overall threshold are **unmet**.
The compact implementation also makes an explicit tradeoff against the ticket's
requested single-cleanup slot: the first cleanup allocates an array retained
across generations. Plain effects allocate no cleanup array. This is not ticket
completion. The remaining wrapper performs ownership, error, cleanup and
self-write work absent from the raw engine; the benchmark was not changed to
hide that cost.

The client race preserves FORMA-254's original application and nine operations,
with Vite aliasing only the candidate core distribution. Chrome 155.0.8059.85,
Node 24.22, two warmups and five samples per operation. All verification checks
passed and there were no page errors. Create 1,000 rows: **21.68 ±1.82ms** versus
plain JavaScript **16.16 ±2.33ms** (34.2% slower). The earlier baseline was
21.3 ±1.7ms versus 15.9 ±2.3ms. These results do not establish a reliable total
row-creation improvement. FORMA-260's within-10% target remains **unmet**.
Profiling identified layout as roughly 62% of the baseline cost; the retained
changes remove listener controller allocation and unused index signals without
changing row callbacks, DOM shape or the benchmark workload. Native
createElement and engine-state reuse experiments were discarded after measurement.

The strict 1,000-binding island probe uses Chromium 156.0.8078.4, five warmups and
fifteen samples. Candidate adoption mean/median: 4.693/4.5ms; update: 0.560/0.5ms.
The earlier baseline was 4.573/4.4ms and 0.480/0.5ms. Every candidate sample had
zero initial writes; text-node identity, subsequent updates and disposal were
verified. Initial strict planner observers do not use public createEffect, so
this is a regression control and no adoption speedup is claimed.

FORMA-263's isolated pre-audit client baseline is `c7235968` (the list change
already applied). Both byte comparisons use the complete no-source-map Vite
static import graph, gzip level 9 and Brotli quality 11. Candidate:
25,127B raw / 9,305B gzip / **8,490B Brotli**, versus
25,922 / 9,575 / **8,712B**: 222B Brotli saved (2.5%). The before source-map
attribution identified element, list and alien-signals as the largest components;
compression totals are not added across source-map modules. Safety checks, form
support and version-skew checks were retained.

Qualification of the final functional source: 231 test files / 4,149 unit tests;
TypeScript; 156 browser tests across Chromium, Firefox and WebKit; all 17 real
SSR+CSR fixture builds. Package gzip gates: core 48,880/48,902B, runtime
40,774/41,500B, browser ESM 48,510/49,136B, frame 39,513/40,000B, hardened
40,103/40,500B. Tightest keyed-indexed island route: 28,097/28,100B. No budget
or acceptance criterion was raised. Hosted CI and current-main integration remain
separate release checks.

Reproduce from the repository root after building core:

```sh
npm run build -w packages/core
node packages/core/scripts/signals-bench/run.mjs > signals.json
node packages/core/scripts/signals-bench/island.mjs > island.json
npm run test -w packages/core -- --maxWorkers=1
npm run typecheck -w packages/core
npm run check:size -w packages/core
node e2e/ssr/build-cases.mjs
```

For the copied, unchanged FORMA-254 client harness, build its Forma car with
`@getforma/core` aliased to this checkout's `packages/core/dist/index.js`, then:

```sh
node run.mjs --cars forma,vanilla --runs 5 --warmups 2 --out results
```
