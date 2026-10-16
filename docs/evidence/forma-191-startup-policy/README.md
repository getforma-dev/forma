# L63 startup policy and DS12 evidence

This is source and finite-control qualification on integration base
`51486f74dfbe3667cc45df03d9cda4069bdb61ed`. It is not a mobile performance pass.
No runtime, fixture, CSS, throttle, browser, or dependency bytes change.

L63 retains the 50 ms target. Each original route still needs twenty fresh cold
Lighthouse audits and independent actual-response observations at the unchanged
mobile profile. The p95 of each run's maximum application/unattributed task must
be at most 75 ms; every such task must be at most 100 ms. Responses remain at
most 500 ms after first paint; whole-page p95 TBT remains below 200 ms. LCP and
every original raw task remain recorded. `startup.targetMiss` reports counted
tasks over 50 ms; `startup.wholePageTargetMiss` separately includes the original
unfiltered Lighthouse and observer tasks. A target miss is never a claim that
the original no-task-over-50-ms target passed. FORMA-193 retains that follow-up.

The trace proof is deliberately conservative. It requires an exact LHR time
origin/navigation URL, committed main frame and renderer, a unique complete
matching task, only recognized browser layout/render events in that task, and
an observed later script boundary. A different frame, crossing event, script,
unknown event, unmatched task or later task counts in full. `ScriptCatchup` in
Chrome's two source-rundown categories is retrospective metadata; the installed
primary parser excerpt and original trace observation are retained here. It
still prevents exclusion when found inside a candidate task. Independent
observer tasks have no same-run timeline proof and all count in full.

Both complete raw LHR and raw trace are journaled before attribution can fail.
The complete trace is also stored as gzip/base64 with compressed and decoded
lengths and hashes; bounded decoding authenticates before parsing. The validator
recomputes classification and all summaries from that evidence. Each compressed
and decoded trace has a 32 MiB ceiling. Missing, corrupt, oversized or ambiguous
trace identity refuses. This changes no measurement interval.

The shared DS12 limit is 128 MiB, enforced by bounded streamed readers and the
separately integrated writer/burn-in consumer. Other metadata and product bounds
remain unchanged. The journal remains bounded to 256 records and 2 GiB, with
32 MiB for each `mobile-lighthouse-*` record. The full producer has 197 records:
2 attempt/baseline, 14 native, 120 mobile, 2 controls, 58 client, 1 completion.
The retained real trace occupies 3,661,977 decoded bytes, 709,211 gzip bytes and
945,616 base64 bytes; forty equivalent traces plus LHRs use about 54 MiB before
other measurements. Pathological aggregate growth still refuses at the bounds.

## Evidence and its limits

- `first-finite.log`: 44/44 Node 24 controls, 1.157 s, concurrency 2.
- `final-finite.log`: 58/58 controls, 1.457 s, concurrency 2, including existing
  durability, journal, finalization and record checks. New controls cover the
  inclusive 75/100 boundaries, every observer task, forged summaries, raw trace
  corruption, actual bounded gzip expansion, streamed overflow cancellation,
  and authenticated 33 MiB DS12 through both published readers.
- `retained-trace-attribution.json`: the first conservative source probe also
  counted the pre-module layout because it treated source metadata as execution.
- `retained-trace-attribution-corrected.json`: the exact-category correction
  separates only the 61.490 ms pre-module browser layout; the 69.122 ms module
  task remains counted in full. This read-only use of retained diagnostic bytes
  does not reclassify the historical acceptance outcome or count as a fresh run.

The original source, original 90 ms negative control, and old assertions are
byte-preserved under `docs/archive/forma-191-startup-policy`. The original raw
trace/LHR remain in their already hash-bound diagnostic checkpoint rather than
being duplicated here; both hashes appear in each attribution result. The new
110 ms negative requires the observed interval itself to fail the 100 ms task
oracle even if response latency is independently normalized for that assertion.
Actual execution of this new browser control and a full fresh 20-run-per-route
campaign remain required. No old failure or one-run pilot qualifies.

Run the finite gate with Node 24.22.0:

```sh
node --test --test-concurrency=2 scripts/release-performance-attribution.test.mjs scripts/release-record-limits.test.mjs scripts/release-record-download.test.mjs scripts/release-performance-mobile-phases.test.mjs scripts/release-performance-contract.test.mjs scripts/release-performance-evidence.test.mjs scripts/release-performance-baseline.test.mjs scripts/release-support-history.test.mjs scripts/release-support.test.mjs scripts/release-performance-journal.test.mjs scripts/release-performance-durability.test.mjs scripts/release-performance-child-evidence.test.mjs scripts/release-performance-finalization.test.mjs scripts/release-record.test.mjs
```
