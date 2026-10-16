# Integrated indexed-row qualification

Measured 2026-10-15 on Apple M1 Pro, macOS arm64, Node 24.22.0. Exact source `a9f5eebd894c7e10e6f4070744f4e6ecc84fb687` includes the reviewed strict HTML/source policy, deployment guard and drill, value normalization/qualification, shared SSR/Browser entry support, lexical JSX namespaces, strict parity gate, and N3. This is the combined local measurement; final packed release/device qualification remains separate. The earlier frozen-source evidence in the parent directory is preserved unchanged.

The normal production build and release-profile typed renderer produced independent 200/2,000-row owners. The evidence script verifies current emitted IR, native state, registration, served assets and 18 file hashes. It records real native headers: Trusted Types remains enforced; configured report-only delivery names the actual local receiver. All six three-engine functional controls pass, including original nodes, zero-write adoption, focus/selection, selected-row updates, current listeners, invalid-key atomicity, structural movement, disposal, and isolated tamper refusal. Every case also requires zero CSP violation events and zero received reports for this page, alongside the exact expected tamper diagnostic.

Actual Forma route gzip is **27,745 B SSR** and **27,108 B Browser**, both within founder-approved L-59 N2 = 28,000 B. Total JavaScript is 29,540/28,903 B. Core entry/ESM are 48,063/48,209 B, under existing 48,294/48,448 limits. Runtime bundles remain 41,310/40,230/39,658 B under unchanged limits; no additional cap increase was needed.

The isolated three-engine timing run passed once in 40.6 seconds, without any competing local build/test or acceptance retry. The same public existing-key set includes canonical lookup, key validation, signal publication and synchronous selected-row DOM writes. Protocol is unchanged from the independently reviewed bounded calibration in the parent record: 5,000 warmups per owner, 16 clock ticks, one shared batch per engine selected only from clock duration/resolution, fixed 101 alternating paired rounds, separate no-op samples and sampled single-operation maxima. Both median and p95 large/small ratios must be ≤1.10; large p95 and sampled single maximum must be <16 ms.

All durations are milliseconds; per-edit values are batched means.

| Engine | Shared batch | Clock resolution | 200 median / p95 | 2,000 median / p95 | Median / p95 ratio | Sampled single max |
|---|---:|---:|---:|---:|---:|---:|
| chromium | 16,384 | 0.100 | 0.000671387 / 0.000708008 | 0.000665283 / 0.000695801 | 0.990909 / 0.982759 | 0.100 |
| firefox | 65,536 | 1.000 | 0.001342773 / 0.001434326 | 0.001358032 / 0.001419067 | 1.011364 / 0.989362 | 1.000 |
| webkit | 65,536 | 1.000 | 0.000930786 / 0.000991821 | 0.000915527 / 0.000961304 | 0.983607 / 0.969231 | 0.000 |

WebKit's sampled single maximum 0 is below its 1 ms clock resolution, not a claim of zero execution time. Its calibrated paired batch samples are nonzero and satisfy the unchanged scaling/frame bounds. Full raw samples, clock ticks, calibration attempts, no-op samples, spread, user agent and machine details are retained below.

The first integrated evidence assertion expected no report-only header, which predates the reviewed fixture receiver. It failed honestly after the successful native build. The narrow evidence repair requires enforced Trusted Types and the configured receiver, records actual headers, and strengthens browser checks with policy events and received reports. Runtime, product fixture, timing protocol and thresholds did not change. Original failure remains in the working qualification record.

Combined source gates pass: core 3,254/3,254, compiler 1,543/1,543, build 363/363; all three source typechecks; core package checks; 260/260 probe anchors; all five actual size gates and 42 built artifact guards. All 14 corpus modules regenerate byte-identical IR/dumps. Hosted CI, final independent review and packed release qualification remain separate gates.

SHA-256:

- [chromium.json](./chromium.json): `a785d252dc26acac09c3c76eba465315150bcd0346fa0bc5951d8987f46633d4`
- [firefox.json](./firefox.json): `55574c35383e4ce2c5f7cb5384ebdec7fda3a8870f1a95f928c449274c587b37`
- [products.json](./products.json): `f27fc9f3a2b7a6378785dbb2ace52206f5752b7f8f9b7e56a981580c79076009`
- [webkit.json](./webkit.json): `cdb7903e28d0f98019c13e826cdb2cc4e62ec7a58d2e8adfb14a0eff78251a61`
