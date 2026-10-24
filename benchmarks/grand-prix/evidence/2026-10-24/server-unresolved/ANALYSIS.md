# Full-server campaign audit — run40116667052

The frozen harness completed successfully and reproduces its qualified `gha-4-v1` scores. The stronger independent audit remains **unresolved for React Router timed-body equivalence**: every one of its12 load samples reports660 fewer bytes per completed response than its smoke probe. The original evidence and strict failure are retained. No old sample was relabelled, replaced or combined with another campaign. A corrected transport campaign is required before treating the complete14-car ranking as verified.

Forma's independent strength budgets pass: mean per-run memory peak **4.163333MiB ≤8MiB**, mean first-200-minus-docker-return boot remainder **16.146726ms ≤50ms**, and runtime image **78,187,625bytes ≤150,000,000bytes**. The boot remainder is the protocol's host-observed remainder, not pure process startup. Forma's12 load samples match its smoke sizes; this finding does not invalidate those standalone budgets.

## Authenticated provenance

- Run: https://github.com/getforma-dev/forma/actions/runs/40116667052 ; attempt1, job120939258984, successful cleanup and artifact upload.
- Harness: `03d0b87a3eed1fa4625d37f6a9add3b77a626d3b`; frozen car source: `3d9de62d0709e8158cadd62be387ff1481ca9e66`; framework: published3.0.0.
- Artifact12570952874: original `artifact.zip`,6,564,375bytes,165 entries. GitHub digest and local SHA256 both `16f3908e42f35b4d645237272b624ef5423536f8b69de6589be03b6d7c72baf7`.
- Campaign: `bf8f927a-2a45-4d71-8486-e03607db9570`; one Linux4-CPU GitHub VM. ClassA CPU0/1GiB; ClassB CPUs0,1/2GiB; load generator CPUs2,3. Build-only operations use all4CPUs.
- Exact frozen scoring recomputes measurement digest `55e548a6bd1893065c10d8044b00a69819705a7898b1c694d6b78c4063d0dbb5` in `reproduced-summary.json`. The original harness did not require matching smoke/load byte counts; reproducing its qualification is not an independent waiver.

## Coverage and retained finding

The audit verified14cars ×8events (112records),14 smoke checks,168 load samples,294 memory samples,70 starts and42 builds. All car intervals and timed event intervals are sequential; Fuel intentionally samples the Sprint interval. All recorded campaigns/profiles/image identities agree.224 retained resource entries (including duplicated Sprint/Fuel inspection records) match quotas and disjoint CPU sets. All load responses have status200 only, no non-200 responses, successRate1, and no transport errors except bounded deadline cancellation. All sample durations are at least9.9seconds. Cleanup contains no errors or remaining owned actions.

Exactly156/168 samples match smoke bytes. The remaining12 are all React Router:

| Event | Sample | Rows | Smoke bytes | oha bytes/request | Completed200 | Deadline cancellations |
|---|---:|---:|---:|---:|---:|---:|
| sprint | 1 | 100 | 31,133 | 30,473 | 3,746 | 64 |
| sprint | 2 | 100 | 31,133 | 30,473 | 4,245 | 64 |
| sprint | 3 | 100 | 31,133 | 30,473 | 4,274 | 64 |
| endurance | 1 | 1000 | 276,772 | 276,112 | 522 | 64 |
| endurance | 2 | 1000 | 276,772 | 276,112 | 535 | 64 |
| endurance | 3 | 1000 | 276,772 | 276,112 | 535 | 64 |
| multicore | 1 | 100 | 31,133 | 30,473 | 4,259 | 64 |
| multicore | 2 | 100 | 31,133 | 30,473 | 4,659 | 64 |
| multicore | 3 | 100 | 31,133 | 30,473 | 4,706 | 64 |
| reaction | 1 | 100 | 31,133 | 30,473 | 3,318 | 1 |
| reaction | 2 | 100 | 31,133 | 30,473 | 3,646 | 1 |
| reaction | 3 | 100 | 31,133 | 30,473 | 3,801 | 1 |

Every mismatch is−660bytes. `independent-verification.json.bodyEquality.findings` retains exact seconds, status/error distributions and inferred total-byte ranges. The original harness did not retain oha `totalData` or the timed response bodies, so their contents cannot be reconstructed or asserted equivalent.

The official pinned [oha1.16.0 implementation](https://github.com/hatoo/oha/blob/v1.16.0/src/result_data.rs#L144-L154) computes `total_data` only from successful request records and `size_per_request` by integer division by the number of those records. Deadline cancellations are not in that denominator and therefore cannot explain the fixed660-byte difference. An inferred range is `[averageBytes*completed, (averageBytes+1)*completed−1]`; it is not the missing observed total.

The [pinned oha request defaults](https://github.com/hatoo/oha/blob/v1.16.0/src/lib.rs#L475-L500) send `User-Agent: oha/1.16.0` and `Accept: */*`; the original Node smoke probe sent neither. React Router7.18.4's default server entry selects `onAllReady` when `isbot(userAgent)` is true, otherwise `onShellReady`. The locked isbot5.1.28 returns true for `oha/1.16.0`, false for an absent user agent. The frozen car has no custom server entry. This is a source-supported explanation for differing streaming representations; it does **not** prove which660bytes differed or that the timed table/summary was correct. No additional timing run was used to erase the finding.

The other13 cars' size checks, smoke checks and transport arithmetic pass. Their raw values may be described with this limited validation, while comparisons involving React Router's timed SSR/Fuel and the aggregate14-car standings remain unresolved pending a new whole campaign. Image size and build duration do not depend on the disputed response representation; body-dependent assertions must retain the caveat.

## Supplementary evidence

`verify-supplementary.py` independently checks retained binary/source/body hashes,202 observations and recomputed statistics. Separate instrumented Forma binaries preserve100/1000-row body bytes. Native walk means are232,804.77ns/32,851walk-bytes (7.08669ns/byte) and2,229,263.11ns/326,384walk-bytes (6.83019ns/byte). These are isolated `PageResponse.counts().walk_time` observations, not HTTP throughput or comparisons to another campaign.

The runtime comparison uses the identical3,319,768-byte binary (`be875c8c82ffc09098db7b45eb7397f99d476faec114cca79507b7fd79b95fb4`) in Debian and nonroot65532 distroless. Body hashes and nonce-normalized policy match at10/100/1000rows. Image size is78,187,625→31,030,969bytes (47,156,656saved). It explicitly has `performanceQualified:false`; no memory/startup/throughput gain is claimed.

## Privacy and limitations

The original archive was scanned:160text files and5binary files, no credential-pattern hits, no raw campaign tracking/machine IDs, no signed artifact URL. Manual Docker provenance review finds empty proxy/label fields and no credential-bearing image environment names. Public benchmark provenance includes the ephemeral hosted-runner hostname/DockerID, Linux paths, hardware/kernel details, and hashed runner/machine fingerprints. These are not user-account secrets. Binary review is based on public source and exact provenance, not a general proof that arbitrary bytes cannot contain secrets.

Build limits are bound by the exact command/profile; short-lived `--rm` build containers have no retained post-launch inspect. The old diagnostic run40111974679 remains separate. The audit command deliberately exits1 because timed-body equivalence is unresolved; `sourceHarnessQualified:true` describes the frozen source's result only.

Reproduce offline with Node24: `node verify.mjs` and `python3 verify-supplementary.py` from this directory. `artifact-verification.json`, `artifact-file-manifest.json`, `harness-source-manifest.json`, `independent-verification.json`, `supplementary-verification.json` and the exact original ZIP provide the machine-readable evidence.
