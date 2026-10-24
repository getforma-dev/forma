# Round 2 evidence, 24 October 2026

These are the original GitHub Actions ZIP bytes, authenticated against the
provider's SHA-256 digests before extraction or analysis. `archives.json` binds
each archive to its workflow run, artifact ID, byte length, digest and outcome.
The JSON summaries beside them are derived analysis; they do not replace the raw
archives. `SHA256SUMS.json` also covers those summaries and this documentation.

Run the offline integrity check from any directory:

```sh
python3 benchmarks/grand-prix/evidence/2026-10-24/verify.py
```

This checks file digests, original archive digests, ZIP CRCs and member paths. It
does **not** establish performance acceptance or authenticate a newly downloaded
archive against GitHub. The provider metadata retained beside each experiment
records that separate authentication step.

| Archive | Interpretation |
| --- | --- |
| `server-qualified` | Corrected full fourteen-server campaign with identical request headers and retained transport evidence. All identity probes and timed aggregate transfer arithmetic agree; exact score replay and Forma's strength budgets pass. |
| `paired-server` | Published, walker-only, static-only and combined source on one VM. Byte, mean-based tail and strength budgets pass. Estimated throughput gains did not materialize. |
| `islands` | Eleven published native island implementations. Correctness passes. Activation spans differ by framework API; row content is checked, not row-node identity. |
| `compression` | Same executable, identity/Brotli/gzip. Compression reduces transfer bytes and costs CPU/tail latency; it remains opt-in. |
| `client-withdrawn` | First qualified client measurement. Acceptance failed; row optimizations were withdrawn. |
| `client-rollback` | Published, withdrawn and rollback sources with contemporaneous vanilla and pristine own-engine controls. Both effect and row-creation targets still fail. |
| `client-final` | Final integrated source `9ac07a44`, pre-effect main `f5be8647` and published Forma on one VM. Effect throughput improves; the original fan-out and row-creation targets still fail. Batching and DOM point regressions are disclosed. These remaining costs are accepted as prospective 3.1 product tradeoffs, not numerical passes. |
| `client-zero-diagnostic` | Failed diagnostic retained. A valid zero-duration observation was incorrectly rejected by the old harness. |
| `server-unresolved` | Original full server run retained. All 12 React Router samples report floored mean body sizes 660 bytes shorter than their probes. Individual timed bodies were not retained. The old ranking is not qualified by this audit. |
| `cache-*` | Separate starter-cache experiment: one cold/warm pair per starter, across four runners. Each cold run reports 113 registry compilation artifacts representing 89 unique package IDs; each warm run reports zero. |

The dated `gha-4-v1` profile uses four available virtual CPUs and separates the
measured workload from its driver. Standard hosted VMs do not prove exclusive
physical-host use. Cache observations use a separate experiment. Compare timing
ratios only within a recorded campaign; repeated source versions on another VM do
not make absolute timings comparable. All measured samples remain in each raw
archive, including regressions and large spreads.

The original server run used different user agents for probes and load. React
Router can select different streaming behavior for bot agents, but no timed
bodies were retained, so this cannot retroactively prove equivalence. The
corrected full rerun uses explicit identical request headers and retains probe
bodies and complete load-generator output. It does not normalize bytes or splice
results between VMs. Its independently audited result is preserved separately in
`server-qualified`; the unresolved original remains unchanged.

Use the harness source commit recorded in each archive when reproducing its
derived summaries. Historical archives predate new transport evidence fields and
are deliberately refused by the current qualification validator. Reproducing the
old summary does not turn the unresolved server run into accepted evidence.

The frozen 42-file harness used by the unresolved-server audit is included under
`server-unresolved/harness-source`, with its original source manifest. To replay
that audit, copy `server-unresolved` into a scratch directory first, extract its
`artifact.zip` into an `artifact` child directory, then run `node verify.mjs`
and `python3 verify-supplementary.py` from the copied directory. The first command
intentionally exits 1 and records all 12 unresolved byte comparisons; the second
checks the independent renderer/image evidence. Use Node 24. Replays write derived
JSON into the scratch copy, leaving this authenticated snapshot unchanged.

The corrected audit has its own frozen 46-file harness under
`server-qualified/harness-source`. Replay it with the same scratch-copy and ZIP
extraction procedure, then `node verify.mjs` and
`python3 verify-supplementary.py`. Both commands must pass. It checks all 168
timed samples, 56 warmups, 112 retained probe bodies and 294 transport records,
plus resource limits and exact score reproduction. Retained probes and aggregate
byte equality do not prove the contents of every individual timed response.

`local-bundle` separately preserves the original production JavaScript for the
independent FORMA-263 extraction, source/exclusion hashes, module tables and byte
records. It is a local static measurement, not an Actions timing result. Run
`node benchmarks/grand-prix/evidence/2026-10-24/local-bundle/verify.mjs` with
Node 24.22.0 to recompute raw, gzip and Brotli bytes. Its derived provenance omits
local workspace prefixes while retaining the hash of the original source record.
Mapped module totals come from a separate source-map build and are not the normal
production bundle size; compression savings are not additive by module.

Original ZIPs retain public ephemeral runner names, container IDs, system paths
and hashed host fingerprints needed to audit the experiments. High-confidence
credential, private-key and signed-URL patterns were checked before preservation.
Private security/handoff archives are excluded.

No release or deployment is established by these measurements. The maintainer
accepted the remaining FORMA-259 fan-out and FORMA-260 row-creation misses as
prospective [3.1 product tradeoffs](https://github.com/getforma-dev/forma/blob/2cbf169f78cba285805915f0f1440aabc97894ed/docs/release/3.1-PERFORMANCE-TRADEOFFS.md).
The original numerical targets remain missed. Ordinary correctness, the explicit
size budgets, CI, packed qualification, independent release review and active
RC burn-in remain required; this report supplies none of that release credit.

`client-final` preserves run 40140319634's original 138,657-byte ZIP and provider
metadata. Its candidate is exactly `9ac07a446ebe8aaad407a895fa8aaece189bc69e`,
with pre-effect main `f5be8647439e560c71c27b8c5f4bde26507b8bbb` and published
Forma as separate trials. The portable audit checks the archive digest, all
29 timing records, five samples/two warmups, resource identities, own-engine
ratios, all eleven bundle records and derived report arithmetic. It replays
both independent arithmetic implementations in a temporary directory:

```sh
python3 benchmarks/grand-prix/evidence/2026-10-24/client-final/verify.py
```

The report retains all nine signal and DOM operations. In particular, batching
throughput is 13.79% below published Forma and 6.93% below pre-effect main;
selection is slower than published, and clear is slower than pre-effect main.
Observed spreads and sequential trial order limit attribution and do not prove
equivalence. The original failed/rollback campaigns remain separate and unchanged.
The restricted compiler/listener experiments are excluded from this release.
The separate `client-final/effects-review/PRODUCT-ASSESSMENT.md` records the
independent regression assessment and its source proof: the later `90ff7f65`
repair changes only the core README; all other tracked blobs match measured
`9ac07a44`. That source equivalence does not change the campaign's identity.

The self-contained `index.html` presents the curated Round 2 results without
embedding the separate historical report's local machine records. To reproduce
its data and presentation, run `python3 assemble-report.py` then
`python3 render-report.py` from this directory. These commands use only preserved
summaries; they do not rerun benchmarks or change acceptance decisions. The
original historical report and raw evidence remain unchanged in the local report
workspace. Timing tables state whether they use means/SD or medians/ranges.
