# Counted walker benchmark

`walker` renders the frozen FORMA-254 dashboard through the public counted
walker at 100 and 1,000 rows. Its TypeScript source and derived Rust presentation
props are retained in `fixtures/grand-prix/`. FMIR comes from the real compiler,
not a hand-built encoding. The source has no island; this benchmark deliberately
uses the existing adoption-capable walker to isolate renderer performance from
the static-route output change in FORMA-257.

```sh
CARGO_BUILD_JOBS=1 cargo bench --locked -p forma-ir --bench walker -- --save-baseline before
# After a walker change:
CARGO_BUILD_JOBS=1 cargo bench --locked -p forma-ir --bench walker -- --baseline before
```

Criterion reports time per render and bytes per second. Divide nanoseconds per
render by the printed output byte count for ns/byte. Before timing each case,
the global counting allocator reports allocations (including reallocations)
per render and per row. Fixture construction, typed props validation and slot
encoding are outside both measurements; this is walker cost, not HTTP response
latency. Timed runs disable allocation counting. Use the same machine, toolchain
and load for before/after; coordinate other benchmarks on that machine.

To regenerate the fixture after an intentional compiler change:

```sh
npm run build -w packages/compiler
node crates/forma-ir/benches/fixtures/grand-prix/emit.mjs
```

`FORMA_WALK_PROFILE_SECONDS=30` runs the 1,000-row walk continuously for a native
sampling profiler, bypassing Criterion measurement and analysis. For example,
run the built `target/release/deps/walker-*` executable (not its `.d` file) with
that environment variable and `--bench`, then attach `sample` on macOS or `perf`
on Linux. Build with `CARGO_PROFILE_BENCH_DEBUG=1` if line-level symbols are needed.
The profiler and allocation counter add overhead; do not report their wall time
as a benchmark result.

## FORMA-258 measurements (2026-10-24)

Apple M1 Pro, ten CPUs, macOS 26.1, Rust 1.93.1, release profile, default crate
features. Baseline runtime: `d727d28e`. Same fixture, benchmark executable options
and machine before/after. Other development agents coordinated pauses for the
measurements; normal desktop background work remained, and another agent's
test startup may overlap the end of the after run. Treat these as local evidence,
not an idle Linux baseline or a cross-framework comparison.

| Rows | HTML bytes (unchanged) | Before | After | Before ns/B | After ns/B | Allocations before | Allocations after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 32,851 | 146.65 µs | 118.74 µs | 4.46 | 3.61 | 1,937 (19.370/row) | 1,133 (11.330/row) |
| 1,000 | 326,384 | 1.4672 ms | 1.1895 ms | 4.50 | 3.64 | 19,044 (19.044/row) | 11,040 (11.040/row) |

The central time estimates fall 19.0% and 18.9%; allocations fall 41.5% and
42.0%. This benchmark excludes typed projection, dataset construction, document
assembly and HTTP transport. FORMA-254's inferred 15.8 ns/B includes those costs
and ran inside Docker; it must not be compared directly with this table.
The separate HTTP race must establish throughput and the Endurance tail ratio.

Before changing code, macOS `sample` observed 8,281 samples over ten seconds of
the 1,000-row walk (one-millisecond sampling). Escaping was 11.6% of leaf samples
(HTML 601, attributes 363); `to_text` and its callees accounted for approximately
8.4% (697 inclusive samples). Marker formatting was 1.9% of leaf samples (158),
`push_checked` 0.4% (35), opcode dispatch 17.3% (1,430), and slot journaling 0.7%
(58). Inlined work is charged to its enclosing symbol, so these are attribution
estimates, not independent precise phase timings. Allocation/copy work was also
visible below property lookup. The selected change removes scalar conversion
allocations and character-at-a-time copying; it does not relax limits or alter
the slot journal, key validation, marker grammar or property ownership.

Scalar text and attribute conversion now borrow strings/constant spellings or
use a stack-based Ryū buffer for numbers. Arrays retain their original complete
join conversion. The escaping fast path copies unchanged UTF-8 runs only after
the existing worst-case expansion test proves that the complete value fits.
Close to the limit, the original checked character loop preserves partial-byte
counts on failure. Differential tests compare that character reference with
the optimized path for mixed ASCII/Unicode, all escaping characters, NUL, CRLF
and lone CR at every output boundary; the existing compiler-emitted HTML/state
goldens and shared parity vectors remain unchanged.
