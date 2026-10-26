# Local FORMA-301 qualification

These records distinguish source checks, a sealed eight-package development candidate, and isolated packed-consumer checks. The source version stays **3.1.0**. The already published 3.1.0 release contains seven packages; these local archives add `@getforma/router` and the opt-in `native-router` starter. They are not published release bytes and do not authorize a release.

The root `qualification.json`, `release-set.json` and `SHA256SUMS` preserve the superseded 33ae attempt. The corrected candidate is recorded in `successor-9d4aafee/`, which names its source identity, all eight archive checksums and the completed packed-consumer checks. Archives and complete raw reports are retained outside Git, with durable paths and hashes in each qualification record.

## Source checks

The first four `npm run check` attempts are retained as failures. They exposed, respectively, an uncommitted package absent from the archive check, a workspace-hoisted development tool lookup, an inherited worker setting defeating a serial mutation probe, and a baseline macOS canonical-path mismatch in a fixture test. The gates were corrected without removing their assertions. The last failure occurred immediately before the browser stages.

The exact remaining check script ran with fresh private build state and passed in 647 seconds. The extracted command and its original provenance are retained. The corrected process-tree helper and native Chromium launcher ran independently afterward. The final browser-adapter delta passed the full 121-test router suite, type checking, package lint/type analysis, and a fresh build before candidate sealing. This is aggregate evidence with explicit source bindings; no failed full-check attempt is presented as a successful uninterrupted run.

## Packed checks

The first P17 attempt is also retained as a failure: an untracked benchmark log appeared during the strict clean-source security campaign. That owned log was moved outside the checkout. The same sealed archives were retried on the same clean source commit, with all checkout writes frozen.

The dry-run performance target is `v3.1.0` because the unchanged release contract requires a matching version. A coordinated future minor release must rerun release qualification on its actual versioned archives. Local macOS results do not substitute for Linux N8, Windows, CI, trusted-publisher enrollment, or publication.

## Result and supersession

The clean 33ae candidate passed P17: 75 checks in 1222.075 seconds against the 1800-second limit. Its corrected packed scaffold replay passed 218 tests including all 24 heavy cases on macOS. The first scaffold run failed two harness cases and is retained beside the correction. Independent callback review then found additional coordinator defects against the actual extracted archives. These results remain valid for 33ae; they do not qualify the corrected successor candidate. See `callback-review/` and the explicit scope in `qualification.json`.

The successful P17 portable file is an explicit selected-fields summary, not the full raw report. Its `summaryOf` block records the complete durable report and SHA-256. Original sample arrays, security details, and duplicated fixture data remain in that full report and the retained raw-file inventory.

## Corrected successor

The clean `9d4aafee0c99cde4faff3f39a8fca2705e70a398` candidate passed all **75 P17 checks in 1235.994 seconds**, below the unchanged 1800-second limit, and all **218 scaffold cases including the 24 required heavy cases** in 140.34 seconds on macOS. This includes all three starters and the native starter in Chromium, Firefox and WebKit. The complete source and archives stayed frozen through both campaigns. All eight archive hashes were verified again afterward.

`successor-9d4aafee/p17-summary.json` uses a distinct summary schema and keeps only each check's name, outcome and recorded duration, key budgets, archive identity and the full report's path/hash. The 59,727,456-byte raw report and all 237 named raw files remain outside Git. The final router delta passed 190 tests, type checking and package analysis. The pinned native size comparison is 12,281/12,288 gzip bytes: **7 bytes of headroom**. Future coordinated version preparation must remeasure the actual versioned output.

The successor archive qualification binds the sealed commit above. Later test/helper-only CI repairs and independent packed native, website and timing campaigns have their own receipts; this record does not silently rebind P17 to a later Git head.
