# Native navigation timing and heap qualification

2026-10-26. **Passed the four-cell N5 synchronous commit budget.** The source integration campaign completed without failed samples, source/artifact drift, power changes, or unfinished owned processes. The raw [receipt](evidence/performance-final.json) and [log](evidence/performance-final.log) retain every warmup, sample, source/asset/server hash, host/browser version, command and cleanup result.

This timing campaign executed source-built fixture products at `c509976704481d98818dae4ee1888d5bbe485915` (clean tree at start), after the production freeze at `9d4aafee0c99cde4faff3f39a8fca2705e70a398`. Its eight archive hashes are provenance references. Actual packed execution is independently established by [packed-native-final.json](evidence/packed-native-final.json), whose 90 cases ran through installed sealed npm archives and extracted crate archives. The unchanged inner browser harness retains its source-integration label; the outer packed receipt records the authenticated execution boundary. Neither receipt publishes a release.

## Conditions and method

MacBookPro18,1, Apple M1 Pro, 10 logical CPUs, 16 GiB RAM; macOS 26.1 (25B78), Node 24.22.1, Rust 1.93.1. AC power was verified before and after; other build/test/browser jobs were stopped. Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2 ran serially. Desktop viewports were 1365×900, device scale 1, unthrottled loopback. Mobile used Chromium 390×844, scale 1, 4× CPU slowdown, 150 ms latency, 1.6 Mbit/s download and 750 kbit/s upload. This is emulation, not a physical-device result.

Each engine/profile and mode discarded five fixed warmups per direction, then retained 30 A→B and 30 B→A samples with 250 ms between intents. Directions use separate nearest-rank p50/p95 (items 15/29), with no outlier removal. There are 480 retained warm transitions, 80 warmups and 48 descriptive cold entries across the two modes and four cells. Private responses are no-store; a browser context retains the HTTP cache within its warm cell. Cold entries use fresh contexts.

The conservative `commitMs` interval starts at the final post-history-permit public validation and ends at activation entry. It includes validation, history write, the full owner commit and synchronous coordinator signal/title/scroll bookkeeping. The narrower owner commit, preparation, history wait/write and readiness are retained separately. `readyMs` includes network/preparation/activation and final navigation settlement. The document control has the same typed owners and props but performs a real new-document navigation and initial public hydration. Its timing is browser navigation-start-relative; driver-inclusive values remain separate in the raw receipt.

## Synchronous commit (N5)

All values are milliseconds. Zeroes in Firefox/WebKit reflect timer resolution, not zero work.

| Engine/profile | Direction | Min | p50 | p95 | Max | p95 budget |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Chromium desktop | A→B | 0.30 | 0.60 | 0.90 | 0.90 | 16 |
| Chromium desktop | B→A | 0.30 | 0.70 | 0.90 | 1.00 | 16 |
| Firefox desktop | A→B | 0.00 | 1.00 | 2.00 | 2.00 | 16 |
| Firefox desktop | B→A | 0.00 | 1.00 | 2.00 | 3.00 | 16 |
| WebKit desktop | A→B | 0.00 | 1.00 | 1.00 | 1.00 | 16 |
| WebKit desktop | B→A | 0.00 | 1.00 | 1.00 | 1.00 | 16 |
| Chromium mobile 4× | A→B | 1.00 | 1.60 | 2.00 | 2.60 | 50 |
| Chromium mobile 4× | B→A | 0.80 | 1.50 | 3.30 | 5.70 | 50 |

## Network-inclusive readiness and frame scheduling

The native ready measure runs from navigation intent through full settlement. Document ready runs from browser navigation start through initial islands ready. These are distinct user-visible paths and are shown directly, without inferring a universal speedup. Two animation frames scheduled in-page after readiness are a scheduling proxy, **not actual compositor paint**.

| Engine/profile | Direction | Native ready p50 / p95 | Document ready p50 / p95 | Native 2rAF p50 / p95 | Document 2rAF p50 / p95 |
| --- | --- | ---: | ---: | ---: | ---: |
| Chromium desktop | A→B | 6.60 / 8.60 | 14.80 / 18.70 | 27.70 / 39.40 | 44.00 / 46.30 |
| Chromium desktop | B→A | 6.30 / 9.70 | 12.80 / 16.30 | 36.20 / 41.50 | 41.80 / 45.70 |
| Firefox desktop | A→B | 9.00 / 12.00 | 25.00 / 29.00 | 36.00 / 41.00 | 44.00 / 55.00 |
| Firefox desktop | B→A | 9.00 / 12.00 | 26.00 / 31.00 | 37.00 / 43.00 | 48.00 / 60.00 |
| WebKit desktop | A→B | 11.00 / 13.00 | 20.00 / 25.00 | 25.00 / 30.00 | 42.00 / 57.00 |
| WebKit desktop | B→A | 11.00 / 13.00 | 20.00 / 26.00 | 25.00 / 28.00 | 43.00 / 54.00 |
| Chromium mobile 4× | A→B | 187.10 / 193.20 | 196.00 / 203.00 | 210.00 / 223.40 | 217.80 / 230.20 |
| Chromium mobile 4× | B→A | 187.10 / 194.00 | 196.80 / 200.30 | 210.80 / 227.30 | 218.00 / 225.30 |

## Cold entries

Three fresh-context browser-ready samples per route/mode are listed in milliseconds. These are descriptive observations; no cold p95 or reliable cold-performance ranking is claimed. All raw navigation and transfer timing remains in the receipt.

| Engine/profile | Route | Native ready samples | Document ready samples |
| --- | --- | --- | --- |
| Chromium desktop | /native/a | 56.40, 47.80, 47.90 | 48.80, 47.90, 47.70 |
| Chromium desktop | /native/b | 46.90, 49.80, 48.80 | 45.40, 45.20, 47.50 |
| Firefox desktop | /native/a | 39.00, 34.00, 35.00 | 36.00, 34.00, 37.00 |
| Firefox desktop | /native/b | 55.00, 36.00, 34.00 | 32.00, 36.00, 36.00 |
| WebKit desktop | /native/a | 175.00, 180.00, 182.00 | 175.00, 168.00, 173.00 |
| WebKit desktop | /native/b | 172.00, 195.00, 171.00 | 163.00, 171.00, 170.00 |
| Chromium mobile 4× | /native/a | 590.50, 592.60, 595.20 | 530.60, 526.80, 518.40 |
| Chromium mobile 4× | /native/b | 586.50, 582.70, 604.30 | 517.70, 553.50, 527.10 |

## Heap and resource scope

Chromium desktop performed 10 warmups and then 100 transitions, with one bounded CDP garbage collection before and one afterward. Browser history intentionally grew. The observation is not a leak threshold or a zero-leak assertion.

| CDP quantity | Before (bytes) | After (bytes) | Delta (bytes) |
| --- | ---: | ---: | ---: |
| usedSize | 2,150,044 | 2,382,704 | 232,660 |
| totalSize | 2,703,360 | 2,965,504 | 262,144 |
| embedderHeapUsedSize | 457,208 | 500,384 | 43,176 |
| backingStorageSize | 121,371 | 124,971 | 3,600 |

The separate packed 100-cycle scenarios count actual fixture listener registration/removal, pending timers, live island hosts and inactive detached controls. They do not exercise workers or observers that the fixture does not create. This heap observation also does not qualify all browser/native resources.

## Remaining release gates and historical evidence

Manual screen-reader operation, physical mobile back/forward gestures, actual-device behavior and real BFCache eligibility remain separate release gates. Dispatched lifecycle events validate handler behavior only. Frame scheduling is not paint timing. The campaign is macOS-local and does not establish Linux CI status or hosted-site deployment.

Earlier smoke receipts are diagnostic only. `performance-smoke-coordinator.json` retains a source-integrity failure caused by a concurrent source change; it is not promoted to qualification. Earlier source-browser receipts at `33ae2bce` predate the final callback/lifetime fixes. Final packed90 and this complete timing receipt supersede those claims without deleting their evidence.

Preparation logs: [measurement assets](evidence/perf-build-successor.log), [optimized typed server](evidence/perf-server-successor.log). The measurement assets live separately from the fixed size-qualification fixture.
