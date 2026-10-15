# Local qualification record — 2026-10-15 UTC

Codex recovered the interrupted worker's adapter and corrected its incomplete test fixture
and output-bound assertions. Five ordinary stable replay tests pass, covering every committed
regression adapter, all fourteen real compiler modules, all 67 reviewed rule fixtures, bounded
slot decoding, and malformed/oversized inputs. The full implementation remains subject to
independent production review and the workspace gate.

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

Remaining qualification: complete the deferred minimization/replay qualification only when
resumed, review the production implementation independently, and observe the nightly GitHub
workflow after it is present on the repository's default branch. No tag or publication occurred.
