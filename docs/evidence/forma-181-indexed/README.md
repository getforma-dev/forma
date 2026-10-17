# FORMA-181 indexed row qualification

Measured on 2026-10-15, Apple M1 Pro / macOS arm64, Node 24.22.0. Source head `f4183e831f8fa3141601fcfc46091e2c7c44d4ce`; runtime and rich source fixture are unchanged from reviewed `8ebcf17f`. This records the local N3 measurement, not final integrated release or reference-device qualification.

The actual typed native page contains independent 200-row and 2,000-row owners. Each measurement calls the public `createKeyedRows(...).set(existingKey, nextItem)` and includes canonical lookup, key validation, signal publication and synchronous selected-row title/text writes. Values are prepared before timing. No internal signal shortcut or aggregate-array replacement substitutes for the operation.

Each engine ran once, serially with no competing local build/browser process. After 5,000 warmup edits per owner, calibration measured 16 clock ticks and chose one shared power-of-two batch for both sizes, bounded at 1,048,576. Both calibration batches had to exceed max(8 ms, 64 ticks); unresolved clocks refuse acceptance. Calibration observes only duration/resolution, never acceptance ratios. The acceptance run keeps 101 alternating paired samples. Each reported sample is the mean complete-edit duration of that batch; median and p95 describe those samples. Single-operation maxima are separately sampled. Raw calibration, every sample, no-op samples, spread, browser and machine data are retained in the linked JSON files.

The unchanged requirements are median **and** p95 large/small ratios ≤1.10, large p95 <16 ms and sampled single-operation maximum <16 ms. All passed on the first calibrated run (41.1 s total).

All durations below are milliseconds, including the small per-edit averages.

| Engine | Shared batch | Clock resolution | 200 median / p95 | 2,000 median / p95 | Median / p95 ratio | Single max |
|---|---:|---:|---:|---:|---:|---:|
| chromium | 16,384 | 0.100 | 0.000653076 / 0.000683594 | 0.000659180 / 0.000695801 | 1.009346 / 1.017857 | 0.100 |
| firefox | 65,536 | 1.000 | 0.001327515 / 0.001388550 | 0.001342773 / 0.001403809 | 1.011494 / 1.010989 | 1.000 |
| webkit | 65,536 | 1.000 | 0.000961304 / 0.001037598 | 0.000946045 / 0.000991821 | 0.984127 / 0.955882 | 1.000 |

Three-engine functional controls passed before timing: native state and all 2,200 original row nodes, zero-write adoption, pre-activation focus/selection, exactly two selected-row writes, current-value click/input listeners, canonical-key refusal atomicity, a real one-row move, retained focus/selection, nonvacuous removed-listener disposal, and neighboring-owner isolation. The tampered text hole remains untouched, its owner fails with exactly one structure diagnostic, and the other owner stays live.

The initial 256-edit protocol passed Chromium but returned zero median durations in Firefox/WebKit. That run was rejected as unresolved clock precision. The bounded calibration was independently reviewed before the single replay; no runtime, rich fixture, acceptance threshold or result-driven retry changed. The first tamper run had an incorrect no-console-error expectation; the fixed test requires the exact expected structure diagnostic. Original failure logs remain in the release working record.

`products.json` verifies current compiler IR and registration, actual typed native state, served asset identity and 18 file hashes. The unchanged rich route, including createSignal click/input observability, measures 27,724 B Forma gzip for SSR and 27,077 B for Browser mounting, both below founder-approved L-59 N2 = 28,000 B. Original 27,500 B refusals were preserved; no failed output was accepted. Package graph 47,994/48,148 B uses L-58 measured +300 limits 48,294/48,448; runtime bundle limits stay unchanged.

Author source gates: full core 3,220/3,220; full compiler 1,382/1,382; compiler source types; core size/docs 28/28; all 5 actual package-size gates. Original initial-data tests fail 31/71 on the previous proof and pass 71/71 with the guard. Earlier compact core source/types and all 42 built artifact guards passed. Final integration, independent whole-feature review and hosted CI remain separate requirements.

Reproduction after building core/compiler/build and release-profile typed SSR fixtures:

```sh
FORMA_SSR_PROFILE=release bash e2e/ssr/build.sh
FORMA_SSR_PROFILE=release node e2e/ssr/indexed-products-evidence.mjs
npx playwright test --config e2e/ssr/indexed-products.config.ts --workers=2 --grep-invert 'complete public set'
npx playwright test --config e2e/ssr/indexed-products.config.ts --workers=1 --grep 'complete public set'
```

Use Node 24.22.0 and CARGO_BUILD_JOBS=3. Do not overlap the timing command with another heavy suite. Each timing JSON is written to its test output directory and attached to the result.

Raw evidence SHA-256:

- [chromium.json](./chromium.json): `970d69e12f1b8a899879c02aea56e07e2c387ac925125d64da8cb0b85f710217`
- [firefox.json](./firefox.json): `03b6ba931ecd3ec859938db7bdb69ab68bff34c03097805aa1ec9cc9391e0264`
- [products.json](./products.json): `e63c04fdfaa08faf49df18aec511bf4c98db9114a5fe6be1da4dacddcc3f962e`
- [webkit.json](./webkit.json): `4f7e7a035cf7405f1464cf5e2de1c48dbf39ff96efd6f1fb62155b5aba735a3f`
