# Maintenance Node pin correction

The original source is reviewed `22547c596ab4cd92a0455522f88d475237fc916a`. `manifest.json` authenticates nine original files from that Git commit, the complete preserved hosted log, five local control logs, seven changed implementation files and eight unchanged pin/manifest/lock/matrix files. `.gitattributes` preserves this archive byte-for-byte on Windows.

`CI-38860249893-failed.log` is the original PR #100 failure log. At 2026-10-16 06:17:29 UTC, R17's npm install reports the private workspace requires Node `>=24.22.0 <25` while its runner uses Node `v24.21.0` and npm `11.19.0`. The job's `node-version: 24` selector did not implement the declared maintenance pin. The log's later test failure is separate; this repair makes no claim that Node caused that failure.

The source correction changes six floating maintenance selectors to `.node-version`. The published package floor remains Node 22, its dated compatibility matrix remains Node 22/24 (adding 26 on 2026-10-28), and all dependencies/lock bytes remain unchanged. Direct release packaging, P17 and publishing jobs already used the pin and were not changed.

The local original-policy probe (`maintenance-policy-before.log`) expected the old policy validator to reject the actual unpinned maintenance configuration. It failed because the validator returned success. New parsed policy controls cover each affected selector, a conflicting older selector, conditional/duplicate setup, a stale literal pin, malformed/missing/mismatched pin, private engine drift and accidental replacement of the published floor.

The first post-change positive scratch-fixture check also caught an existing macOS test flaw: `/var` temporary paths and Node's canonical `/private/var` module path caused the copied matrix CLI guard to emit no output. The old mutation test only required a nonzero status, so it could accept that unrelated failure. Both failure logs are retained. Tests now canonicalize temporary paths, require a passing baseline and match the intended diagnostic for every mutation; production matrix behavior is unchanged.

Final finite qualification on Node **v24.22.0**:

```sh
node --test scripts/toolchain-policy.test.mjs scripts/release-workflow-evidence.test.mjs
ruby scripts/check-release-workflow.rb
git diff --check
```

All **20** top-level controls passed in **3.74 seconds** (three policy tests, including 21 seeded drift refusals, and 17 release failure-evidence controls). The direct parsed release validator passed. This is source/control qualification only: no install, build, browser, timing campaign or hosted run was performed for this change. Independent review and exact-head CI remain required before merge; earlier Node 24.21.0 results are not relabeled as pinned-toolchain qualification.
