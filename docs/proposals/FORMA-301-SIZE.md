# FORMA-301 executable size contract

The frozen design-doc-factory `forma-router` v1 design defines N3 as at most
12 KiB gzip incremental router code in the fixed proof consumer, including new
shared-core code, and N4 as at most 64 KiB for the entire two-route group.
Its measurement protocol requires the same candidate toolchain, gzip level 9,
all reachable executable assets, and explicit set/total differences.

The public build therefore gives only a compiler-checked native navigation group
a separate `navigation-group` class: 64 KiB total JavaScript, including the worker,
and an additional aggregate Forma check of 28,420 + 12,288 = 40,708 bytes.
The aggregate cap is a conservative build check derived from the ordinary Forma
ceiling and prospective increment; it is not a replacement for the paired N3
measurement. `canvas` cannot raise either group limit. No arbitrary route option
selects this class: navigation config must produce accepted native owners and a
single closed executable group. Ordinary routes still enforce 28,420 Forma bytes
and 75/365 KiB total; standalone core's 49,926-byte cap is unchanged.

`@getforma/router` always counts as Forma code, including when an ordinary route
imports it. Reports identify router bytes separately from core/signals and the
identity banner. Attribution uses the existing metafile proportional-compression
method; the complete file and worker totals use actual compressed bytes.

The first permanent native fixture failed when the existing ordinary-route gate
was applied to its eager group. That observation remains in
[`build-original-budget-failure.log`](../../experiments/forma-router-native/evidence/build-original-budget-failure.log).
It is not reclassified as a pass. The new class implements the reviewed N3/N4
product boundary, rather than changing the ordinary-route limit.

[`measure-size.mjs`](../../experiments/forma-router-native/measure-size.mjs) builds
full-page plain equivalents with the exact same layout and leaf island sources.
It compares the published 3.1 core archive against the candidate core using the
candidate compiler/build and checks the complete current group. It records the
baseline archive digest and npm-pack integrity, source commit/dirty status,
toolchain, all file hashes, raw/Brotli/gzip sizes and cold per-route comparisons.
Positive changes to shared-core bytes count toward the increment. Per-route
comparisons additionally prevent duplicate plain runtime bundles from hiding
increased cold group cost. The union asset totals remain visible.

The local [`size-v1.json`](../../experiments/forma-router-native/evidence/size-v1.json)
measured 39,538 bytes for the complete group and 11,179 bytes worst-case increment.
The later [`size-v2.json`](../../experiments/forma-router-native/evidence/size-v2.json)
includes the reviewed router fixes and identical baseline CSS: 40,390 bytes for
the group and 11,958 bytes worst-case increment. It verifies that the candidate
source and built JavaScript hashes remain unchanged throughout the comparison.
[`size-v3.json`](../../experiments/forma-router-native/evidence/size-v3.json)
then measures the final pending-history repair: 40,538 bytes for the group and
12,106 bytes worst-case increment, leaving 182 bytes within the unchanged N3 cap.
These source measurements are marked dirty and are not whole-P17 or final-release
qualification. Product changes require a fresh receipt; preserve prior results.

Controls cover below/exactly/above 12 KiB incremental and 64 KiB total, shared-core
changes, duplicate baseline runtimes, an ordinary router import over the ordinary
28,420-byte cap, and actual verified groups exceeding either fixed class limit.
