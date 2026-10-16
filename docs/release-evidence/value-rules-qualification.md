# FORMA-182 value-rule qualification

The full campaign passed on clean source `9dbf7c13283ac3d66cfda4731125a5a6958db96f` with Node 24.22.0,
Chromium, seed 1820300 and batches of 1,000: **7,000,000 admitted comparisons**
plus **123,118 expected origin refusals** in **1184.333 seconds**.
The exact unmodified report is [value-rules-qualification.json](value-rules-qualification.json),
SHA-256 `3497d585e268f2aff9e08f8d01b857042df75fdc671e92c54e45ad44a8f5ef9d`.

Each admitted case uses the actual native FMIR writer, browser-parsed native
HTML, fresh `h()` DOM and strict owned adoption. All original nodes remain,
adoption makes zero writes, and every case checks its MutationObserver with
a deliberate write. An additional real signal updates retained text and an
attribute (zero initial writes, two later writes). Disabled adoption is
rejected; an actual global no-op helper mutation passes the original `6e834ffe` runner and
fails the repaired `9dbf7c13` runner at this liveness check. Changed native output
also fails the same comparison path. The actual 87 compiler refusal/near-miss
controls run before the campaign; their log digest is in the report.

| Rule | Admitted | Expected refusals | Seconds |
|---|---:|---:|---:|
| 1 | 1,000,000 | 0 | 149.427 |
| 2 | 1,000,000 | 0 | 188.977 |
| 3 | 1,000,000 | 108,767 | 184.508 |
| 4 | 1,000,000 | 14,351 | 177.565 |
| 5 | 1,000,000 | 0 | 159.759 |
| 6 | 1,000,000 | 0 | 157.490 |
| 7 | 1,000,000 | 0 | 166.604 |

Exact unsafe i64/u64 origins yield RENDER-401; out-of-range SystemTime origins
yield RENDER-403 before comparison. Refusals do not reduce the million admitted
cases per rule. The report retains per-rule input digests, source and artifact
hashes, controls and timestamps. Generated coverage is Chromium; finite shared
value/namespace vectors and 52 actual SSR/shell metadata documents retain their
separate Chromium, Firefox and WebKit gates. The new decimal-tie vectors pass
36 browser cases across those engines.

The canonical namespace fixture moved byte-exact with SHA-256
`9e59d31da781680e7bee3a48e01b86229d2072fb994ab49bcac295da930aa503`.
Six browser-admitted cases and the intentional script refusal remain intact;
the new Rust reader constructs real FMIR and checks the same seven references.

The initial pilot found binary64 `c2eeb5cf467752d4`: native LowerExp chose
`.63`, JavaScript chose `.62`. Its full original replay, both signs and adjacent
values were preserved before the approved pinned ryu-js 1.0.3 correction.
Full native workspace: 511 passed/two existing ignored, all-target Clippy,
Rust 1.71 all-target forma-ir, cargo-deny, 339 client contract/vector tests,
namespace mutation controls and six generator/real-worker tests passed.

An earlier full attempt on `6e834ffe` stopped after 650,000 recorded rule 1 comparisons
because a native child awaited stdin EOF; its report remains passed:false.
The repaired run above uses a persistent bounded framed worker and a 30-second
per-batch deadline. That interrupted attempt is not counted as qualification.

This source candidate was independently approved before the full run. The
full campaign exceeds the ten-minute per-merge allowance, so the explicit
nightly fallback runs 1 million/rule and R17 samples 1,000/rule. Final integrated R17,
packed P17, CI and release-browser checks remain separate release gates.
Namespace stacks, dynamic SVG-title admission and native non-boolean SHOW_IF
policy remain explicitly deferred under L-57.
