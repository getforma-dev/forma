#!/usr/bin/env bash
set -euo pipefail
cd '/Users/victorvillacis/dev/Forma/work/FORMA-301/forma'
started=$(date +%s)
step() { echo; echo "### $* ($(( $(date +%s) - started ))s)"; }
source scripts/check-builds.sh
step "e2e lanes: fixtures, the SSR site, the preview frame, the fixture applications"
node --test scripts/check-builds.test.mjs
node --test e2e/performance/build/measurement.test.mjs
node --test scripts/sync-fixtures.test.mjs
# Subshells inherit the private build state and isolate fixture cwd/variables.
(source e2e/sync-fixtures.sh)
(source e2e/ssr/build.sh)
(source e2e/frame/build.sh)
bash e2e/fixtures/apps/build.sh
bash e2e/skew/build.sh
# After the build: the servers embed what it wrote, and the embed needs the folders to exist.
step "fixture applications' servers: rustfmt and clippy (FORMA-188; an e2e workspace member)"
cargo fmt --manifest-path e2e/fixtures/apps/Cargo.toml --check
cargo clippy --locked --manifest-path e2e/fixtures/apps/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path e2e/fixtures/apps/Cargo.toml --lib measurement_setup_is_inert_and_uncacheable
step "browser tests: build's worker upgrade, the lanes, core's suite (Chromium)"
npm run test:browser -w packages/build
node --test scripts/template-islands-browser.test.mjs scripts/ssr-csp-reports.test.mjs
# N3 timing runs as its own required serial phase after all other tests.
npx playwright test --grep-invert 'indexed products: complete public set'
(source scripts/check-core-browser.sh --project=chromium)
step "native router: real compiled owners, server and Chromium navigation controls"
node scripts/run-router-native-proof.mjs --engines chromium --skip-package-build

step "hostile widgets: complete reviewed-tier matrix and real removed-grant control"
node packages/core/e2e/hostile-widgets/run.mjs
node packages/core/e2e/hostile-widgets/qualify-guard.mjs

step "parity harness (FORMA-183): generator, comparison, serializer, renderBoth"
npx tsc --noEmit -p e2e/parity
node --test --test-concurrency=2 "e2e/parity/tests/*.test.mts"

step "blocking parity: step 1, 100 states, typed P1/P2/P3 with no exceptions"
node --input-type=module -e 'import assert from "node:assert/strict"; import {readExpected} from "./e2e/parity/src/expected.mts"; assert.equal(readExpected().length, 0, "blocking parity requires an empty expected-divergent list");'
node e2e/parity/src/run.mts --step 1 --states 100 --report "${RUNNER_TEMP:-$PWD/test-results}/parity/report.jsonl"

step "value rules: deterministic generator, actual native metadata, 1,000 comparisons/rule"
node --test e2e/value-rules/*.test.mjs
node e2e/value-rules/metadata.mjs --engine chromium
node e2e/value-rules/run.mjs --count 1000

step "N3: actual indexed public-set timing, serial Chromium"
node --test e2e/ssr/indexed-timing.test.mjs
npx playwright test --config e2e/ssr/indexed-products.config.ts --project=chromium --workers=1 --grep 'indexed products: complete public set' --output test-results/indexed-chromium

echo
echo "check: every gate passed in $(( $(date +%s) - started ))s"
