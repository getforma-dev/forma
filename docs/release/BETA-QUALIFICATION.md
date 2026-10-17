# Beta qualification at a59d432c

The complete seven-package rehearsal passed all **61 P17 checks** on
`a59d432c054873d55d82ab424d85357fbe4de387`, finishing on 2026-10-17 UTC in
**1,199.906 seconds** against the 1,800-second bound. This records beta gate
evidence and satisfies L-64's condition on N2. It is not a tag, registry
publication, RC audit or final acceptance. Merge still requires independent
review and green applicable CI; publication requires successful exact-main CI
and fresh tagged P17/engine checks through trusted publishing.

## Scope and reproducibility

The reference machine was an Apple M1 Pro, arm64, 16 GiB RAM, with Node
24.22.0, npm 11.19.1 and Rust 1.93.1. Seven freshly packed archives were verified
against DS11 `0f865c0890ee23c194699ffe5d96cf0d3effc5ff0e9da3c09f67366eec210e65`.
All four workspace `dist` directories were absent during the rehearsal;
dependency resolution proved that consumers used the packed set. The unmodified
source verifier ran the complete campaign, with one heavy local lane, Cargo
jobs limited to three and browser workers to two. It restored the four original
dist directories and proved cleanup with no remaining owned processes.

Original command, reports, traces and route reports remain under the local
release workspace `work/FORMA-beta1-P17-response-recovery/`:

- `command.json` and `packages/release-set.json`: exact invocation and set.
- `rehearsal/evidence/p17.json`: complete source-bound report, `passed: true`.
- `rehearsal/exit.json` and `rehearsal/owned/launcher-exit.json`: successful
  completion, restoration and process cleanup.
- `rehearsal/evidence/performance-attempt-qYPbo3/`: all mobile observations,
  Lighthouse reports/traces, native results, client results and controls.
- `rehearsal/evidence/decoder-attempt-rbX7wh/`: original decoder observations.
- `routes/summary.json`, route size reports and `route-sizes.log`: the exact
  Counter/indexed recipe using the same built package outputs after restoration.

The report's milestone checklist is the pre-closure snapshot, so it correctly
records ten beta rows pending even though its executed checks passed. This
commit records their evidence-based closure. Later tagged verification creates
its own DS11 and downloadable P17 evidence for its exact source; these local
results must not be relabeled as a hosted or tagged run.

## Mobile activation and size

Lighthouse 13.5.0 used applied mobile throttling, including 4x CPU slowdown.
Each route had 20 cold Lighthouse navigations and 20 independent response
observations, without retries. Every login observation completed both expected
responses, and every island observation completed all 100. There were no page
errors, no independent-observer long tasks, and no counted application, mixed
or unknown task over 50 ms.

| Route | Observations | Response p95 / maximum | Whole-page TBT p95 |
| --- | ---: | ---: | ---: |
| Tenant login | 20 | 184.8 / 185.7 ms | 0 ms |
| 100 islands | 20 | 290.7 / 294.8 ms | 0 ms |

The response bound remains 500 ms. Zero recorded over-limit tasks is not a
claim of zero execution time: the long-task observations do not enumerate
every shorter task. Raw whole-page misses remain explicit. Login recorded two
raw tasks, maximum 63.041 ms: one positively proved pre-application layout and
one navigation/bootstrap task. Islands recorded 19 pre-application layout
tasks, maximum 60.764 ms. All remain in the raw data and
`wholePageTargetMiss: true`. No isolated Lighthouse idle-check exclusion was
needed in this campaign. Attribution follows the independently reviewed
`N3-startup-strict50-v3`; application and unknown work retain the 50 ms limit.

Both deliberate controls worked: disabling activation left 0/100 responses and
was refused; the injected blocking task produced a 120 ms observation and was
refused. The old failed campaigns remain failed. L-63's 75/100 ms startup
exception is retired for this candidate.

| Recipe | SSR Forma gzip -9 | Browser route Forma gzip -9 |
| --- | ---: | ---: |
| Counter | 26,208 B | 25,531 B |
| Indexed list | 28,046 B | 27,403 B |

The indexed SSR result is **54 B below 28,100 B**. Every P17 fixture route also
passed its recorded size ceiling. The five package caps passed separately:
core 48,601/48,902 B; browser ESM 48,789/49,136 B; runtime 39,169/41,500 B;
frame 38,652/40,000 B; hardened 37,596/40,500 B.

## Decoder and remaining performance checks

Both original 1 MiB shapes used five warmups and 40 fresh-document samples at
4x CPU slowdown, with the public activation interval and no retries. ASCII
p95/maximum was 6.4/9.6 ms; the demanding 20,000-string array was
12.7/14.3 ms. Every sample met L-61's 30 ms bound, and oversized/malformed
refusal controls passed. This is full activation with validation, not a claim
that the descriptive raw-parse estimate of 12 ms bounds every sample.

N1 completed 20,000 native walks at each of five shapes. N5 completed all 41
paired rounds and passed its allocation/time limits. Exact-limit rendering
succeeded; one-past output/iteration limits produced RENDER-301/302 without
partial HTML. The client comparison completed Chromium, Firefox and WebKit,
with 12 samples and three warmups per case. These measurements are recorded
without asserting a universal speed advantage. The preceding published DS12
predates this performance contract, so its baseline status remains `bootstrap`.

## Ten beta gate dispositions

| Gate | Evidence |
| --- | --- |
| FORMA-103 | Packed compiler-bound state/props checks; both full decoder shapes and refusal controls. |
| FORMA-104 | Packed zero-write adoption, retained server values, coded refusal and live interaction checks. |
| FORMA-105 | Packed literal-registration/identity checks; generated minimal and static routes, including script-free behavior. |
| FORMA-181 | Reviewed keyed/indexed implementation and browser controls; current packed list behavior and indexed route report. |
| FORMA-182 | Shared-vector and per-rule R17 checks; retained source-bound 7,000,000-comparison campaign, with unchanged value-rule implementation. |
| FORMA-183 | Blocking 28-module, 100-state Chromium parity and applicable Firefox/WebKit parity; empty expected-divergence list. |
| FORMA-184 | Existing five renderBoth controls and absence from public exports, checked by R17. |
| FORMA-144 slice 2 | Both generated packed templates, locked installs, signatures, served behavior and three-engine minimal/static adoption checks. |
| FORMA-188 fixture applications | All internal fixture routes built and served with retained values, zero-write adoption, live behavior and size reports. |
| FORMA-021 ratchet | All five package caps, packed route reports and the same complete strict-N3 campaign satisfying L-64. |

Supporting hosted history is CI
[38973465595](https://github.com/getforma-dev/forma/actions/runs/38973465595)
at `5458180e` and all five engine/parity jobs in
[38971435766](https://github.com/getforma-dev/forma/actions/runs/38971435766)
at `3e6a34a3`. They provide historical support, not exact-current CI coverage.
Intervening activation and public sanitizer changes have focused browser or
public-bundle checks and current packed acceptance; the sanitizer fix also has
failing-before tests. The a59 Node runs passed product tests but failed the stale
documented test count; that one-line count is corrected. Fresh normal CI on the
closure head remains a merge requirement and covers the complete integration.

The six actual SR14 probes passed separately in
[38983089460](https://github.com/getforma-dev/forma/actions/runs/38983089460),
with clean and restored baselines. The full 252-entry mutation campaign is
separate and remains open; neither this record nor the beta gate change
asserts its success. All RC/final gate statuses, the deferred live governance
rollout and the external-app `not-run` dispositions remain unchanged.
