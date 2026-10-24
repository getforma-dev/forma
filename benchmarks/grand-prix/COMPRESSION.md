# Opt-in response compression experiment

This is the separate FORMA-261 experiment. The original race and default Forma
car remain uncompressed. The experiment requires an exact framework commit
containing the compression feature and the frozen published Forma car:

```sh
GP_RUN_ID=compression-example node harness/linux-run.mjs \
  --baseline --cars forma --forma-ref FULL_SOURCE_COMMIT \
  --compression --events 1,3,4,5,7
```

Use `--diagnostic` on a Linux host with fewer than eight CPUs. The existing
Grand Prix response compression workflow runs this experiment in its own
concurrency group, so it can coexist with the full server grid. The budgets
workflow also exposes it through its `compression` input. Both require
`forma_ref`; ordinary pull-request checks
continue to exercise the uncompressed default and its strength budgets.

Before compilation the preparer enables `forma-server/compression` and changes
only `/ssr` to call `page.with_compression(&headers)`. This benchmark response
contains deterministic public data with no attacker-controlled strings or
secrets, satisfying the explicit per-route BREACH decision. There is no blanket
middleware, cache, or change to production framework defaults.

The published consumer lock is retained. The candidate's Forma crates replace
their registry copies at the exact supplied commit. Every other existing
registry package must retain its version, source and checksum. The only new
packages permitted are the nine pinned records in
`harness/compression-codecs.json`, reviewed against FORMA-261's lock. Codec
resolution and fetch happen before the timed build; release compilation stays
`--locked --offline`. Any additional package, version drift, missing codec or
checksum drift fails preparation instead of changing the comparison.

One server image is built. Identity, Brotli and gzip then run sequentially in
fresh directories beneath `results/<run>-compression/`, with the original
five-second warmup, three ten-second samples, and CPU/memory limits. Events
1/5 record one-CPU throughput, p95/p99 latency, memory peaks and sampled CPU;
event 3 repeats throughput and tails with four CPUs; event 4 measures
single-client p99; event 7 records actual encoded bytes. The machine settles
after compilation and between encodings. No compilation overlaps a timed race.

The explicit header is sent to both probes and oha. In
[oha 1.16.0](https://github.com/hatoo/oha/blob/v1.16.0/src/lib.rs#L457-L527),
`--disable-compression` omits its automatic header, then `-H Accept-Encoding: …`
sets the chosen value. The harness preserves encoded wire-body accounting. It
checks the server's encoding, Vary, no-store and content length, decodes the
page, and verifies its rows before timing. Each load sample's bytes per request
must equal the verified encoded body size; sending identity accidentally
cannot be reported as a compression measurement.

`comparison.json` retains the common image ID, encoding sizes, means of each
three-run throughput/latency set, memory peaks, CPU sample mean/max, and ratios
to identity. Every raw event stays available. It rejects mixed images, missing
samples, transport failures, changed decoded page sizes and missing CPU data.
Only oha's bounded duration-expiry cancellation is accepted. A loaded-machine
override is diagnostic only.

The identity case uses the same compression-enabled binary and includes
negotiation overhead. It isolates the cost of encoding within the opt-in path;
the ordinary before/after server race remains the evidence for the framework's
default behavior. Sampled CPU percentages and saturated throughput are reported
separately, without claiming a precise per-request CPU duration. Compression
results are not substituted into the unchanged default strength budgets.
