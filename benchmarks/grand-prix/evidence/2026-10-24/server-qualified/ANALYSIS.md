# Qualified Linux server campaign: run 40123441558

**Independent audit: passed.** This is a complete published 3.0.0 baseline on the dated `gha-4-v1` profile. It is not an integrated-candidate measurement, a cross-campaign speed comparison, or release approval. The earlier unresolved run 40116667052 remains retained separately.

## Authentication and source

- GitHub artifact 12573154988: 12,859,901 bytes, 459 files. ZIP SHA-256 `40b5692f0b9773d3797f7eb33f66a828e31c112d9e753a34f832587714211b41` matches the provider digest; CRCs, unique safe paths and all extracted member hashes were verified.
- Harness: `be858597a42c3fbcbd0146d111c2f3bc7bc8d67a`; frozen car source: `3d9de62d0709e8158cadd62be387ff1481ca9e66`; Forma dependency: published 3.0.0. The exact 46-file harness snapshot and source manifest are retained.
- One GHA campaign `c7fd2a3c-3286-44b5-bffe-eb22a1dfba3c`, run 40123441558/attempt 1/job budgets. Every scored record, smoke check, transport witness and counts record agrees.
- All 14 cars/events 1–8 ran sequentially on one Linux x64 four-CPU VM. Class A: 1 CPU/1 GiB; Class B: 2 CPUs/2 GiB; load generator: 2 CPUs on disjoint affinity. Build-only: 4 CPUs. The Docker engine is Linux/non-Desktop; retained inspections verify actual quotas, affinity and memory.

## Coverage and transport

The audit verified 112 scored records, 14 smoke records, 168 ten-second timed loads, 56 five-second warmups, 70 cold starts, 42 warm builds, 294 memory samples and 224 retained resource entries. The 112 retained probe bodies comprise 42 smoke bodies (10/100/1,000 rows per car) and 70 event preflights. All 294 transport witnesses match their event/sample records.

Probes and the pinned oha 1.16.0 load generator use the same explicit User-Agent, Accept and identity encoding. Each encoded probe body has checked Base64, SHA-256, length, raw header pairs, response encoding and decoded SSR rows/data. Every timed sample and warmup retains complete oha output and exact arguments. All have only HTTP 200 completed responses and no failure except permitted deadline cancellations bounded by concurrency. The completed status-count denominator, total body bytes and floored mean are consistent. Every identity sample total equals its matching verified body length times completed responses; all 168 timed samples, including React Router, pass.

This validates aggregate representation length alongside sampled semantic correctness. Individual timed response bodies were not retained; equal aggregate length is not a claim of byte-for-byte identity or semantic validation of each timed response. The old unresolved run is not retroactively qualified or spliced into this campaign.

## Forma strength budgets

| Metric | Observed | Limit | Result |
|---|---:|---:|---|
| Mean of measured memory peaks | 4.033333 MiB | 8 MiB | Pass |
| Mean boot remainder | 18.144030 ms | 50 ms | Pass |
| Image bytes | 78,187,609 B | 150,000,000 B | Pass |

Memory peaks are 3.98/4.00/4.12 MiB. Boot budget uses time from `docker run` returning until first HTTP 200; it is not pure process startup. The scored Grid event includes Docker startup and therefore has a different value.

## Reproduced Forma server scores

| Event | Mean | Sample SD | Min–max | Rank of 14 |
|---|---:|---:|---|---:|
| SSR Sprint (req/s) | 1,405.151635 | 3.968826 | 1,400.669465–1,408.219880 | 11 |
| SSR Endurance (req/s) | 162.050829 | 1.649602 | 160.352297–163.646706 | 9 |
| Multi-core (req/s) | 1,726.836553 | 2.688740 | 1,723.746408–1,728.641585 | 11 |
| Reaction time (ms p99) | 0.802684 | 0.008930 | 0.796910–0.812970 | 9 |
| Fuel (MiB peak) | 4.033333 | 0.075719 | 3.980000–4.120000 | 1 |
| Grid start (ms) | 178.014610 | 4.269761 | 171.496841–182.762848 | 2 |
| Weight: image size (bytes) | 78,187,609.000000 | 0.000000 | 78,187,609.000000–78,187,609.000000 | 1 |
| Weight: gzip response (bytes) | 2,611.000000 | 0.000000 | 2,611.000000–2,611.000000 | 12 |
| Pit stop (ms build) | 3,949.333333 | 396.315951 | 3,677.000000–4,404.000000 | 13 |

Forma ranks 7/14 in this server-only championship with 59.5 points over 8 events. Event 7 splits its points between image and gzip weight. All 14 standings, per-event values, spreads and ties are retained in `publication-summary.json` and the source-reproduced summary. No client or overall-combined result is inferred from this server-only artifact.

The frozen scoring implementation reproduces every ranking from this campaign. Canonical measurement SHA-256: `0588973de9ded2618bfc3d584cdff2020d54eab8cf93d2ec02808670dfdb13df`. No entrants are disqualified. The raw file tree, rather than rounded report numbers, is authoritative.

## Separate renderer and runtime diagnostics

The instrumented counts binary runs after the timed car and preserves its exact response body. Original/instrumented sources, diff and binary hashes are retained; the same original runtime image and resource profile are verified. Each 100/1,000-row condition has 20 warmups and 101 observations; all 202 observations and statistic formulas were independently checked. These measurements are explicitly instrumented and do not replace HTTP scores.

- 100 rows: walk bytes 32,851, nodes 1,440; median 220,592 ns, median 6.714925 ns/byte; range 208,740–426,687 ns.
- 1000 rows: walk bytes 326,384, nodes 14,040; median 2,216,993 ns, median 6.792591 ns/byte; range 2,026,546–3,450,487 ns.

The same executable was also checked in a separate distroless runtime image: 78,187,609→31,030,953 bytes, saving 47,156,656 bytes. Binary SHA-256 and retained 10/100/1,000-row body/policy equivalence pass. The distroless image runs as user 65532. This is an image-size/correctness experiment only (`performanceQualified:false`), not a timed runtime substitution or deployment change.

## Privacy, cleanup and reproduction

The privacy scan checked 454 textual archive members and 30 unique decoded probe bodies; it found no credential/private-key/signed-URL pattern. Five binaries are hashed and separately bound to the source/binary checks. Image environment key review found no secret-bearing names; retained proxy/labels are empty. Raw campaign machine/tracking IDs are absent; hashes, public GHA IDs, CPU/kernel data, ephemeral runner/container IDs and build paths remain as documented provenance. Pattern/source review cannot prove arbitrary binary contents contain no secret. Temporary download URLs are not retained in publication metadata.

All run-owned containers, images and builder cleanup steps succeeded; final cleanup had no remaining actions. Runtime and instrumented-count cleanup lists are empty. No unrelated Docker resources were changed.

From this directory, after extracting the authenticated ZIP into `artifact/`, run:

```sh
node verify.mjs
python3 privacy_scan.py
python3 verify-supplementary.py
```

Node 24.22.0 was used for this independent replay. `verify.mjs` uses only the retained exact harness snapshot and this run's raw files. The scorer includes a generation timestamp, so reproducibility binds measurement digest, numerical scores and source; a later replay need not have the same output-file timestamp.
