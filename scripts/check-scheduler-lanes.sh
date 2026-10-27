#!/usr/bin/env bash
# Private bodies called only by check-scheduler-pair under its original Linux
# subreaper. Builds and shared input sealing belong to the complete prototype.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$#" -eq 3 ] || exit 2
lane="$1"; started="$2"; scheduler_evidence="$3"
step() { echo; echo "### $* ($(( $(date +%s) - started ))s)"; }
case "$lane" in
  a)
step "npm test workspaces: core correctness partition, then the remaining four packages"
node scripts/check-core-partition.mjs unit overlap
npm test -w packages/router -w packages/compiler -w packages/build -w packages/create-app
step "declared props: compiler bytes match the native typed-handler fixtures"
node packages/compiler/scripts/emit-props-contract.mjs --check
step "packed compiler API and actual optional-compiler compatibility"
node --test scripts/compatibility-package.test.mjs scripts/core-raw-package.test.mjs
step "packed integrity gate: resource observations and mandatory native checks"
node --test scripts/release-publication-recovery.test.mjs
node --test scripts/release-provider-placeholder.test.mjs
node --test scripts/release-support.test.mjs scripts/release-support-history.test.mjs scripts/toolchain-policy.test.mjs scripts/package-metadata.test.mjs
ruby scripts/check-toolchain-policy.rb
step "P17's fixture applications and measurement step: staging, pruned lock, resolution, budgets (FORMA-188)"
node --test scripts/release-fixture-apps.test.mjs scripts/release-measurements.test.mjs scripts/release-record.test.mjs scripts/release-skew-contract.test.mjs scripts/release-performance-baseline.test.mjs scripts/release-performance-contract.test.mjs scripts/release-performance-startup.test.mjs scripts/release-performance-evidence.test.mjs scripts/release-performance-attribution.test.mjs scripts/release-record-limits.test.mjs scripts/release-record-download.test.mjs scripts/release-performance-decoder.test.mjs scripts/release-performance-durability.test.mjs
step "packed decoder: actual built compiler regenerates the timed contracts"
node --test scripts/release-performance-journal.test.mjs scripts/release-performance-mobile-phases.test.mjs scripts/release-performance-child-evidence.test.mjs scripts/release-performance-finalization.test.mjs
node --test --test-concurrency=2 scripts/release-performance-correlation.test.mjs scripts/release-performance-metadata.test.mjs scripts/release-performance-parser-attribution.test.mjs scripts/release-performance-mobile-start.test.mjs
node --test scripts/decoder-compiler-package.test.mjs
step "core: typecheck, size gate, packaging lint, probe anchors"
npm run typecheck -w packages/core
npm run check:size -w packages/core
npm run check:pack -w packages/core
(cd packages/core && node scripts/run-probes.mjs --check)
step "expression qualification:100000 generated cases, removed-charge control and independent nightly floor"
node --test --test-concurrency=2 packages/core/scripts/expression-probe-floor.test.mjs packages/core/scripts/probe-results.test.mjs packages/core/scripts/probe-reporter.test.mjs scripts/release-security.test.mjs
node packages/core/scripts/qualify-expression-mutation.mjs
step "build: the packed forma-raw-lint bin"
node packages/build/scripts/test-raw-lint-bin.mjs

;;
  b)
step "hostile widgets: complete reviewed-tier matrix and real removed-grant control"
node packages/core/e2e/hostile-widgets/run.mjs
node packages/core/e2e/hostile-widgets/qualify-guard.mjs

step "browser tests: build's worker upgrade, the lanes, core's suite (Chromium)"
node --test scripts/template-islands-browser.test.mjs scripts/ssr-csp-reports.test.mjs
# N3 timing runs as its own required serial phase after all other tests.
npx playwright test --workers=2 --grep-invert 'indexed products: complete public set'
node scripts/check-core-partition.mjs browser overlap "$scheduler_evidence/core-overlap"
;;
  *) exit 2;;
esac
