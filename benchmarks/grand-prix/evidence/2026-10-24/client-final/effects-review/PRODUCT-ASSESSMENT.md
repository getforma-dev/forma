# Independent final-candidate product assessment

I recommend keeping the selected effects implementation for the explicitly authorized 3.1 product tradeoff, conditional on green final CI and the separate release/P17 qualification. This is a recommendation to accept known limitations, not a claim that the original performance targets all passed. Public write, fan-out and effect creation improve substantially over both published 3.0.0 and green main. The observed batching decline and remaining row cost should be disclosed and tracked; no more candidate variations or latency runs were performed for this assessment.

Measured source is `9ac07a446ebe8aaad407a895fa8aaece189bc69e`; its later CI repair `90ff7f65ceee1641cbd89e3c7350738ed04a3672` changes only `packages/core/README.md`. Every other tracked Git blob, including runtime, build/harness and locks, is identical. `source-provenance.json` binds the relevant source files independently. The README now quotes the actual size policy; the test that caught it was left intact. Both Node 22.21 and 24.22 passed 29 docs/package controls and 13 route-budget controls each.

## Evidence and scope

Campaign 40140319634 ran one fixed published → f5be main → 9ac sequence on the same AMD EPYC 7763 runner with qualified gha-4-v1 resources. Node 22.23.4 signals used one pinned CPU and 1 GiB; Chromium 156 DOM used CPUs 1–3. Each trial includes its own unchanged alien-signals3.1.2 control and vanilla DOM control. Original official five signal cars remain unchanged; 3.1.2 is separately unscored. All resource/campaign identities, correctness flags, operation sets and lock hashes agree.

The provider-authenticated ZIP SHA256 is `b1c5d2493248a7607dda7105a948a8b57158db41f6e367b233fe2b4268ce8a2c`, 138,657 bytes. I independently verified its digest, CRC and every extracted member byte. There are **50 files**, not the 53 mentioned in the task handoff; `AUTHENTICATED.json` itself lists the same 50. The initial script's stricter incorrect count refusal is preserved in `count-correction.txt` and the initial script copy. All 18 signal/control records (810 samples), 11 DOM records (495 samples) and 11 bundle records were recomputed without importing the other reviewer's arithmetic. Means, sample SDs and geometric means agree with the original records. No sample is omitted or selected by outcome.

This is one sequential campaign, not a randomized causal experiment. Dispersion and endpoint drift limit precision; overlapping SDs do not prove equivalence or disprove regression. Earlier numerical fan-out passes and failures remain separate. No averages across hosts, rerun selection or transfer of frozen 5e34 measurements to 9ac is used.

## Original targets and delivered tradeoff

Own 3.1.2 throughput ratios are 86.030% write, 71.645% fan-out, 85.206% create/dispose and 86.621% nine-workload geometric mean. The 80% fan-out target **fails**; the other two 80% targets and 85% overall target pass in this campaign. Compared with published Forma, selected mean throughput improves 70.74% write,145.77% fan-out and251.34% create/dispose. Compared with green main, the gains are 85.26%,147.73% and258.17%. These are substantial specific public-effect improvements, not a claim that all DOM bindings use the public fast path.

Row creation remains 44.56±4.11ms against same-trial vanilla 26.14±2.40ms, 1.7047× rather than the required ≤1.1×. It is essentially the same point estimate as published 44.82ms and 2.48% slower than main 43.48ms. FORMA-260 is not solved by the effects change. The 1k creation work remains a meaningful interaction cost, and the 10k benchmark remains 464.16ms; neither should be marketed as a fast bulk-rendering result.

The actual application is 25,347 raw /9,316 gzip /8,498 Brotli, versus published 25,821/9,525/8,652 and main 25,063/9,267/8,417. Thus it delivers 154 fewer Brotli bytes than published and 81 more than main. The accepted package/route costs are independently measured 49,212/28,304gzip against explicitly revised 49,414/28,420 ceilings. Those measurements exceeded the historical 48,902/28,100 ceilings, and those failures remain retained. All other package and total-JavaScript gates stay unchanged.

## Regression assessment

**Batching is a material adverse point estimate, not a dismissed outlier.** Selected 185,312±23,095 batches/s is 13.79% below published 214,962±48,257 and 6.93% below main 199,100±25,842. Four of five selected samples cluster around 195k while four published samples cluster around 236k, so the decline is not solely one slow selected sample. The same-trial own-engine ratio also drops from 1.0555 published and 1.0152 main to 0.8315 selected; the raw control gets faster in the selected trial. That direction warrants retaining a regression follow-up despite broad SDs and fixed ordering. A reciprocal-rate illustration is 5.40 µs per selected 100-write batch versus 4.65 µs published and 5.02 µs main; this is a conversion of the benchmark rate, not a real-application latency guarantee.

The batch implementation, signal setter, computed implementation and workload are byte-identical between f5be and9ac. The workload executes 100 signal writes and one dependent effect flush per batch; the changed supplied-node lifecycle/graph representation is therefore on the callback/dependency path, even though the batch primitive itself is unchanged. That identifies a plausible affected surface, not a demonstrated cause. This campaign has no CPU/inlining trace isolating it, so I do not attribute the decline to JIT, GC or host noise. The large write/fan/create gains support accepting the measured batch cost under the user's product decision, with the limitation explicit.

**Selection regressed relative to published before this effects integration.** Published 0.68±0.13ms becomes 1.58±0.29ms on green main and 1.36±0.43ms on selected. Vanilla is 0.24ms in all three trials. The selected cost doubles the published mean (+0.68ms) but is 0.22ms lower than main. The application, list implementation and selected-versus-main event registration path are unchanged; only a retired, unreachable raw-HTML branch changed in element.ts. Shared cleanup/root context and callback forwarding do change, so source inspection cannot prove that effects have no influence. Nevertheless, this evidence does not identify a new selection slowdown introduced by the selected patch: the higher baseline already exists on main. Keep the published regression visible and investigate separately without crediting selected with a general selection fix.

**Other adverse DOM points also remain explicit.** Update-every-tenth is 14.33% (+0.92ms) slower than main, while 7.09% faster than published; vanilla also rises from 6.04 to 7.08ms and the Forma/vanilla ratio improves. Clear is 30.43% (+1.40ms) slower than main but 0.66% faster than published; its normalized vanilla ratio worsens from 1.3855 to 1.6854, so neither the near-published result nor sample spread rules out a real loss relative to main. Append, 10k creation and remove are 3.26%,1.49% and1.55% slower than main. Replace and swap improve against both comparators. All means and spreads are below rather than hidden behind an overall score.

No memory, server startup, image size or island-adoption speed conclusion is inferred from this client campaign. Existing correctness and actual packed-format coverage remain necessary; separate prospective P17/server/island evidence owns those claims. The selected release should be described as a substantial public-effects improvement with modest delivery cost and disclosed batching/large-list limitations.

## Signals: operations per second
Means ± sample SD, five samples after two warmups. Higher is better.

| Operation | Published | Main f5be | Selected 9ac | Change vs published | Change vs main | Selected / control |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| signal create | 55,933,207.39 ± 37,980,965.88 | 58,535,805.76 ± 35,479,060.95 | 57,300,604.21 ± 36,781,039.53 | +2.44% | -2.11% | 0.9429× |
| signal read | 116,645,198.12 ± 10,476,103.04 | 117,551,933.45 ± 10,774,895.14 | 114,411,893.36 ± 23,171,013.84 | -1.91% | -2.67% | 0.9525× |
| write with one effect | 5,307,554.59 ± 388,554.40 | 4,891,725.00 ± 347,021.90 | 9,062,326.73 ± 1,318,688.77 | +70.74% | +85.26% | 0.8603× |
| computed cache hit | 67,099,746.11 ± 12,092,011.79 | 67,041,778.71 ± 13,264,125.39 | 66,419,866.93 ± 5,233,030.21 | -1.01% | -0.93% | 0.8940× |
| chain of 100 | 173,706.36 ± 16,594.20 | 177,791.96 ± 15,957.16 | 171,843.20 ± 18,646.22 | -1.07% | -3.35% | 0.8985× |
| diamond (500 middles) | 26,519.40 ± 2,004.17 | 26,440.32 ± 1,202.84 | 27,110.13 ± 995.78 | +2.23% | +2.53% | 0.8714× |
| fan-out to 100 effects | 67,272.88 ± 3,275.47 | 66,739.52 ± 3,764.57 | 165,336.21 ± 16,143.87 | +145.77% | +147.73% | 0.7164× |
| effect create and dispose | 2,194,656.26 ± 249,140.33 | 2,152,798.46 ± 240,336.52 | 7,710,678.24 ± 2,009,202.94 | +251.34% | +258.17% | 0.8521× |
| batch of 100 writes | 214,962.45 ± 48,257.10 | 199,100.20 ± 25,842.32 | 185,312.37 ± 23,095.44 | -13.79% | -6.93% | 0.8315× |

## DOM: milliseconds
Means ± sample SD, five samples after two warmups. Lower is better.

| Operation | Published | Main f5be | Selected 9ac | Change vs published | Change vs main | Selected / control |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| create1000 | 44.82 ± 3.90 | 43.48 ± 8.44 | 44.56 ± 4.11 | -0.58% | +2.48% | 1.7047× |
| replace1000 | 46.58 ± 3.07 | 44.44 ± 1.99 | 43.40 ± 2.11 | -6.83% | -2.34% | 1.4966× |
| update10th | 7.90 ± 4.76 | 6.42 ± 3.17 | 7.34 ± 3.23 | -7.09% | +14.33% | 1.0367× |
| select | 0.68 ± 0.13 | 1.58 ± 0.29 | 1.36 ± 0.43 | +100.00% | -13.92% | 5.6667× |
| swap | 3.22 ± 0.68 | 2.96 ± 0.55 | 2.62 ± 0.26 | -18.63% | -11.49% | 1.3100× |
| remove | 4.14 ± 1.76 | 2.58 ± 0.52 | 2.62 ± 0.41 | -36.71% | +1.55% | 1.2970× |
| create10000 | 480.52 ± 99.27 | 457.34 ± 93.97 | 464.16 ± 94.18 | -3.40% | +1.49% | 1.4063× |
| append1000 | 43.94 ± 7.72 | 40.50 ± 4.32 | 41.82 ± 7.80 | -4.82% | +3.26% | 1.5341× |
| clear | 6.04 ± 1.77 | 4.60 ± 0.35 | 6.00 ± 1.80 | -0.66% | +30.43% | 1.6854× |
