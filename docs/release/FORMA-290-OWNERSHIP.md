# Component-list key ownership repair

FORMA-290 repairs a defect reproduced in published 3.0.0 and main
`ad26d9f8cdf78f6cfd2f22afefa2883cd903187a`. Repeated eight-row updates with a
`NaN` key replaced the row and lost ownership records; detached effects could
continue after row removal and parent disposal. Finite unique-key controls
cleaned up correctly. PR #198 disclosed this defect; PR #200 did not repair it.

The small-list scan now uses SameValueZero, matching the large-list Map path.
Ownership is indexed by the reconciler's actual row node, keeping duplicate-key
occurrences separate. Rerender replaces that node's ownership record. There is
no new finite-key restriction, extra per-row root, or changed SSR key domain.

## Correctness evidence

The frozen runtime source has SHA-256
`e70daf2f920ae9fe8e4b6896fbd88a89fa73494cf91c2aebb41f6f98144493a4`.
The same 26 new unit cases fail 20/pass 6 on original main and pass all 26 on the
repair. Focused and adjacent suites pass 157 tests; TypeScript checking passes.
The unchanged corpus's 328 mutation anchors still apply.

The same 54 browser checks fail 21/pass 33 on the old source and pass all 54 on the
repair across Chromium, Firefox and WebKit. They cover 8/31/32/33/64 rows,
threshold crossings, repeated updates, retained input/node identity, duplicate
occurrences, rerender generations, removal/clear/root disposal, and revocation
of actual compiler-generated row handlers. An additional 12 controls against
the exact old standalone bundle fail the three small-NaN cases and pass the
nine finite/large-list controls. Original failures are retained.

## Size and performance decision

All five existing package limits pass without adjustment. Main ESM gzip is
49,836 B, +40 B from ad26 and 90 B below 49,926. Browser/runtime/frame/hardened graphs
shrink by 10/19/21/22 B respectively.

One unchanged local nine-operation screen used two warmups and five samples
in fixed old→new order. Create 1,000 changed 21.52→22.26 ms, replace 20.24→21.30 ms,
remove 1.48→1.60 ms and clear 3.22→3.06 ms. Eight point estimates are slower; the
nine-operation geomean is 8.23% slower, materially influenced by one 1.7 ms
selection sample. All samples remain included. The fixed order, small sample
and busy local machine cannot establish equivalence or rule out a modest
regression. This is a correctness repair, not a performance-win claim. Reliable
row lifetime is worth the observed modest absolute cost. Fresh combined Linux
and packed release qualification remain required; FORMA-294's earlier
byte-equivalence claim does not extend across this changed runtime.

## Remaining limit

List updates are not transactional. An independent three-row probe reproduced
a historical recovery defect when the renderer replaces one row then throws
on another. A later update can leave stale DOM; both old and repaired runtimes
stop all recorded row effects on parent disposal. Dispose and remount the list
boundary after such a renderer failure. This separate defect is not presented
as fixed by the NaN repair.

Browser receipt SHA-256:
`dbedf36f4a674b14e2b0606153b22b7322abacf535844ada93351dfd24dc542e`.

Local source-bound evidence is retained under `work/FORMA-290/` on the work
board: unit manifest SHA-256
`0c8bc1b0585286bbc8550b2f77976b8c70d9dd3a1bf1693a8c3da949ae15645e`,
size/performance manifest
`a316e256804f887d0354b6e7b88bd6990a73d9fa0a4ba0220e8370af24168b7d`.
Fresh release evidence must retain its actual source/run identities.
