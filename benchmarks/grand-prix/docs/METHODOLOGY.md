# Forma Grand Prix: measurement and interpretation

Grand Prix is a Forma engineering laboratory. Its purpose is to identify where
Forma spends time, memory and bytes, and where changes help or hurt equivalent
work. There is no overall champion. A fast operation does not cancel a slower
operation, a correctness failure, or a missed product budget.

## Preserve the experiment

The dated protocols in `PROTOCOL.md` and `ROUND-2.md` describe historical
measurements. Keep them and their amendments intact. New run manifests bind
the selected protocol, test fingerprint, dependency/source identities, workload
configuration, environment and status to one output directory. Never change an
old result to match a newer protocol or reclassify a diagnostic as qualified.

The report reads every retained raw sample. It writes derived JSON, CSV,
Markdown and self-contained HTML; it does not rewrite evidence or trim outliers.
Regenerating a report from unchanged input produces the same content. A new
test/harness fingerprint starts a new measurement series. Changing competitor
versions is an explicit experimental variable and must keep the previous locks
and source identities available through version control and run provenance.

## Equivalent work before timing

All competitors must perform the same specified operation with production
builds, deterministic data, identical warmups and sample counts, and the same
resource profile. Honor each library's documented execution model. Missing
capabilities remain unavailable; an adapter that calls an unbatched function
must not be compared as an equivalent native batch operation.

Correctness comes first: full server data, transport representation, complete
DOM state and keyed identity, reactive values/disposal, and island adoption and
updates. Failed and partial runs remain visible with reasons. They contribute
no performance ratio. A missing record is missing evidence, never zero time.
Exact byte measurements need one sample; a single timing cannot establish
repeatability. Browser console/page errors invalidate the corresponding result.

The existing `harness/score-profile.mjs` validators are reused for qualified
server/client evidence. Their name reflects the old report; validation does not
award points in the laboratory report. A report is an analysis layer, not a
substitute for the runner's resource, transport and source-authentication gates.
Island qualification additionally binds each raw competitor record to the
adjacent driver's successful `run.json` step: exact campaign, source, image,
container, CPU/memory/affinity, pinned browser, five samples, two warmups, and
error-free script transfer accounting. Missing or inconsistent proof remains
unverified. Next/Astro's unavailable internal activation boundary is explicitly
optional; their common readiness and interaction measurements are still required.

## Campaigns, trials and historical change

A profile describes resource allocation. A campaign identifies one host/job.
The report preserves both plus the trial directory and original raw link on
every observation. Competitor ratios require the same campaign, trial,
workload, resource profile, runtime/browser and machine. Matching CPU names or
profile names alone is insufficient. Internal island activation boundaries are
framework-specific and are displayed separately; common navigation-to-readiness
and verified click timings can be compared when the remaining conditions match.

Historical comparisons additionally require matching protocol version, test
fingerprint, run configuration and environment, plus completed runs. Separate
campaigns display baseline/current observations without a paired improvement
ratio. To evaluate a new Forma version, rerun old and new sources in one paired
campaign under the same frozen protocol. This provides a current control and
avoids attributing hardware, browser or host drift to Forma. Comparisons are
descriptive even then: no causal attribution or statistical significance is
claimed by this report.

Multiple nested raw roots remain separate trials. An ambiguous historical
baseline is reported as ambiguous; the report never chooses a favorable trial.
Archived ZIPs are inventoried without automatic extraction. Analyze an
authenticated, safely extracted archive to calculate sample statistics. An
existing summary is not substituted for raw samples. Unsupported instrumentation
records stay in the evidence inventory without fabricated metrics.

## Statistics and units

Each operation shows every sample, count, arithmetic mean, median, sample
standard deviation, coefficient of variation, minimum and maximum. The sample
unit is a repeated run/context, not each request within that run. The two island
click positions are kept separate so repeated clicks in one context are not
misrepresented as independent contexts. A single observation has unavailable
standard deviation and coefficient of variation. Nonfinite, negative or
nonnumeric samples invalidate the series; no invalid sample is silently dropped.

The mean ratio is Forma / competitor. For throughput, a larger ratio is favorable;
for time, memory or bytes a smaller ratio is favorable. Percent changes use the
competitor or baseline as denominator. Zero baselines do not produce ratios.
There is no geometric mean across unrelated operations and no points-based
aggregate. Variation above 10% is a review flag, not a significance threshold.

Keep these definitions visible:

- Server throughput uses successfully completed responses, with transport errors
  and byte-accounting checks retained. Every repetition's latency percentiles
  are separate observations; their mean is not a pooled percentile.
- Fuel is sampled Docker container memory accounting, not process RSS or total
  allocations, and sampling does not guarantee capture of instantaneous peaks.
- Grid start includes container launch and polling. A boot remainder subtracts
  Docker's return time; it is not a direct process-start-to-listen measurement.
- Image size is Docker's uncompressed image size. Gzip/Brotli sizes and raw
  response size are distinct. Smaller HTML is useful but is not itself proof
  of lower render latency.
- DOM timing ends after the specified task boundary and forced layout. Paint
  is excluded. Zero/sub-resolution values remain visible and are not replaced
  with invented timing values.
- Island transferred JavaScript includes CDP response overhead through readiness,
  two clicks and network idle. It is not pure minified bundle size.
- Build steps, cached dependencies, clean app output and cold compiler builds
  retain their different boundaries. A partial build cannot stand in for the
  complete production build.

## Interpretation checklist

Start with correctness and provenance, then inspect distributions and absolute
units. Report observed strengths, losses and unavailable evidence side by side.
Investigate noisy results with a prospectively fixed repeat protocol rather than
rerunning until favorable. Preserve warmups, raw errors, every timed sample and
the failed controls. Separate runtime families, output modes, profiles and
campaigns. Update conclusions only after the relevant measured path is tested.

The October 25 independent regression audit found meaningful public-effect and
HTML-size gains alongside batching, adoption, selection and other tradeoffs.
That audit is useful context, not a fresh measurement of a later release. Do not
transfer old image, boot or memory values to new exact artifacts on the strength
of matching source ancestry alone.
