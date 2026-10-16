# Local qualification record — 2026-10-15 UTC

Codex recovered the interrupted worker's adapter and corrected its incomplete test fixture
and output-bound assertions. Five ordinary stable replay tests pass, covering every committed
regression adapter, all fourteen real compiler modules, all 67 reviewed rule fixtures, bounded
slot decoding, and malformed/oversized inputs. The full workspace gate subsequently
passed in 154 seconds. Independent production review approved the reader/emitter contract
at `2c7fe98`. A separate Codex lead who did not author the adapter independently
reviewed the adapter, four targets, stable harness and workflow, and reran all five
stable replay tests. The final workflow correction was approved at `95f2902`; review
and replay evidence are preserved in the recovery workspace under
`work/review-FORMA-185-production/fuzz-adapter-review.md` and
`fuzz-adapter-independent-replay.log`.

The local ASan qualification used nightly-2026-10-01 (rustc1.101.0-nightly), cargo-fuzz0.13.2
and libfuzzer-sys0.4.13. All four targets completed 25,000 cases without a production finding.
These are short local qualification runs, not a claim that the scheduled twenty-minute jobs
have run in GitHub. On this Mac the C++ toolchain required explicit SDKROOT and an `-isystem`
path to the SDK's libc++ headers; the initial missing-header build failure was environmental.

| Target | Completed runs | SHA256 of retained external run log |
|---|---:|---|
| `parse_raw` | 25,000 | `051eda1524dd3d2a2c8634f9958065e1fb5d9d755b33eca808f7c1a265058929` |
| `parse_body` | 25,000 | `557148ae6fc959f4e62386bbe4d75b90b51f311abed874b545006220a2bd9c84` |
| `parse_mutated` | 25,000 | `d1daf4baaf984f3596a735017cbd6a8118ded9b8a2198386ec8a89e38de42622` |
| `walk` | 25,000 | `cb0530cb76b9f8fc7bbd0aaf9a3423cd8edc3e4cda7714c5141c324692938c44` |

Logs remain in the recovery task's `work/FORMA-185/` directory. Subsequent source cleanup only
changed error representation, test expectations and documentation; the scheduled gate and
ordinary replay test remain reproducible from this tree.

A separate scratch copy replaced `StringTable::get`'s bounds-safe lookup with direct indexing.
The production source was never changed by that experiment. `parse_body` found the seeded
failure and exited77; the retained input is `seeded-string-index-guard.body`, SHA256
`b7a72e22e487c73be92c01af8f5886207e29308318134a124407ea8013505bce`. This is a deliberately introduced test defect, not a discovered production
vulnerability. The experiment was stopped before minimization at the coordinating agent's
request. Its scratch tree and log `seeded-parser-found.log` remain in `work/FORMA-185/` for
handoff. Do not represent this input as a completed minimized production regression.

Separately, temporarily disabling CRC refusal caused `reviewed_v3_fixture_codes_are_exact`
to fail. The original implementation was restored in a finally block and the same test passed;
logs `crc-mutation-rejected.log` and `crc-mutation-restored.log` preserve the P6 evidence.

The workflow correction fetches dependencies with `cargo fetch --locked`, executes
cargo-fuzz offline and checks the committed fuzz lockfile SHA256 before and after.
All four ASan targets subsequently built offline with an unchanged lockfile; no fuzz
execution or minimization was resumed during this ordinary build check. Actionlint,
supply-chain lint and all five stable replay tests passed.

Remaining qualification: complete the deferred minimization/replay qualification only when
resumed, and observe the nightly GitHub
workflow after it is present on the repository's default branch. Hosted platform CI is
separate from the completed local workspace gate. No tag or publication occurred.

# Seeded-bug qualification — 2026-10-15 UTC (FORMA-185 closing item)

Completed on `main` (`b68a795`) in a fresh clone; the production reader was never changed.
Three defects were seeded one at a time into a scratch copy of `crates/forma-ir/src` and all
four ASan targets ran 180 s each (the nightly's options except `-max_total_time`), after a
60 s unseeded control that found nothing. Toolchain `nightly-2026-10-01`
(rustc 1.101.0-nightly 21b707e3f), cargo-fuzz 0.13.2, libfuzzer-sys 0.4.13; on this Mac
`SDKROOT` and `CXXFLAGS=-isystem $SDKROOT/usr/include/c++/v1` were again needed to build
libfuzzer-sys. Full table, reasons and the replay command: `docs/FMIR-FORMAT.md` §11.4.

| Seed | Defect | Found by | Time | Exit | Committed regression |
|---|---|---|---:|---:|---|
| A | CRC-32 comparison skipped (`format.rs`) | `parse_raw`, `walk` | 3 s | 77 | `fuzz/regressions/parse_raw/seeded-crc-check-skipped` (183 B, SHA256 `b38a273f7cb6ec6080c61a19bcca32e7887499bdbf57a33d7adf350f5c2b9f62`) |
| B | section-table end bound off by one (`format.rs`) | `parse_body` | 4 s, run 1,321 | 77 | `fuzz/regressions/parse_body/seeded-section-table-end-off-by-one` (3 B, SHA256 `cf7605ed1bc735f6c825554154627467e1cac9df54cee8699218ed434603c568`) |
| C | string length not checked against the bytes left (`parser.rs`) | all four | 3–4 s | 77 | `fuzz/regressions/parse_body/seeded-string-length-unchecked` (70 B, hand-minimised, SHA256 `37c23e83b7d01da6fb45a55cd8397561d7f88b85ac45d8d029b867d03e32377a`); `fuzz/regressions/parse_mutated/seeded-string-length-unchecked` (4 B, SHA256 `0c5a574d0aa996dcd741e81216ce8e6638cc9146bd96d02f6f2e5fdf4ad41604`) |

The stable test `seeded_decoder_defects_are_caught_deterministically` in
`crates/forma-ir/tests/fuzz_regressions.rs` replays them on every pull request. It was run
against the scratch copy with each seed re-applied (fails on that seed's assertion or
panics at the seeded line) and against the clean reader (passes); the fuzz targets replay
the committed inputs with exit 77 under their seed and exit 0 clean. The earlier
`seeded-string-index-guard.body` experiment (a `StringTable::get` bounds check removed,
unminimised) stays as recorded above; it is superseded by this control. Logs, seed diffs and
raw artifacts: `work/FORMA-185-qual/tmp/` (`seed-{none,A,B,C}/`, `verify-seeds.log`).
