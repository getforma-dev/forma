#!/usr/bin/env bash
# R17: one command, from a clean clone, builds every package in both languages
# and runs every test (FORMA-113; v2 R17, G6). `npm run check` runs it; CI's
# `check` job runs it on every push and pull request and the target is under
# ten minutes there. It is the per-merge gate of the four repositories this one
# replaced, in one place:
#
#   Rust    fmt, clippy over every target and feature, the workspace's tests
#           and docs (forma's CI `test` job)
#   npm     the four packages built in dependency order and their unit suites
#           (formajs, forma-tools and create-forma-app's `test` jobs); core's
#           type check, size gate, packaging lint and probe-anchor check
#           (formajs's `test`, `package` and `probes-check` jobs); the packed
#           forma-raw-lint bin as an application installs it (forma-tools)
#   FMIR    the compiler in this tree emits the corpus committed for forma-ir's
#           cross-implementation contract, and forma-ir reads it (forma-tools'
#           `fmir-contract` job, which used to check out another repository)
#   e2e     the build package's browser test, the full-stack, SSR and
#           preview-frame lanes (forma-tools' `e2e` job, which used to clone
#           formajs and forma), the fixture applications (FORMA-188: three
#           consumer-shaped applications built in strict mode and served by
#           forma-server) and core's own Playwright suite, all in Chromium
#   parity  the parity harness's own tests (FORMA-183, e2e/parity/): the state
#           generator, the comparison, the serializer against Chromium's
#           parser and renderBoth end to end, then the full step-1 corpus at
#           100 generated states where a declared schema exists, with no exceptions
#
# Needs: Node 24 with npm (`.node-version`; the parity harness's TypeScript runs
# by Node's type stripping), a stable Rust toolchain with rustfmt, clippy and
# Playwright's Chromium
# (`npx playwright install chromium` once; CI installs it before this runs).
# Not here: the 32-bit, release-profile and MSRV builds, cargo-deny, the
# Windows legs, the release-workflow lint and the scaffold gate, which are
# their own CI jobs beside this one, and the three-engine and nightly-probe
# workflows.
set -euo pipefail
cd "$(dirname "$0")/.."

# Fail fast on the wrong Node: the parity harness's step (near the end) runs
# TypeScript by Node's own type stripping (Node 24, `.node-version`). A Node
# without it fails here, by name, before the long run, never skipping the step
# (TESTING.md P7).
node -e 'if (!process.features.typescript) { console.error(`::error::scripts/check.sh needs a Node that strips types (.node-version: 24) for the parity harness; this is ${process.version}`); process.exit(1); }'

started=$(date +%s)
step() { echo; echo "### $* ($(( $(date +%s) - started ))s)"; }

step "npm ci --ignore-scripts"
npm ci --ignore-scripts
step "npm advisory gate (fails closed)"
npm audit --omit=dev
step "npm audit signatures"
npm audit signatures

step "FMIR shared constants are current"
node scripts/generate-fmir-constants.mjs --check

step "cargo fmt --all --check"
cargo fmt --all --check
step "cargo clippy --locked --workspace --all-targets --all-features -- -D warnings"
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
step "cargo test --locked --workspace"
cargo test --locked --workspace
step "cargo test --locked -p forma-server --features compression"
cargo test --locked -p forma-server --features compression
step "actual renderer 3.1 accepts older writers and refuses 3.2 before bind"
node scripts/test-renderer-window.mjs
step "cargo doc --locked --workspace --no-deps"
cargo doc --locked --workspace --no-deps

step "npm run build (compiler, build, core, create-app)"
# Keep npm run build's dependency order. Only this shell and its explicitly
# sourced subshells know which fresh builds succeeded; no exported skip flag.
source scripts/check-builds.sh
forma_check_build_package packages/compiler dist/index.js dist/index.d.ts
forma_check_build_package packages/build dist/index.js dist/index.d.ts dist/raw-lint-cli.js
forma_check_build_package packages/core dist/index.js dist/formajs-runtime.global.js dist/forma.esm.js dist/formajs-frame.global.js
forma_check_build_package packages/create-app dist/index.js
step "npm test --workspaces"
npm test --workspaces
step "declared props: compiler bytes match the native typed-handler fixtures"
node packages/compiler/scripts/emit-props-contract.mjs --check
step "packed compiler API and actual optional-compiler compatibility"
node --test scripts/compatibility-package.test.mjs scripts/core-raw-package.test.mjs
step "packed integrity gate: resource observations and mandatory native checks"
node --test scripts/release-integrity.test.mjs
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

step "FMIR contract: historical and current-writer corpus preserve exact payloads and HTML"
node --test scripts/fmir-corpus.test.mjs
node scripts/check-fmir-corpus.mjs
if [ -n "$(git status --porcelain -- crates/forma-ir/tests/fixtures/js-emitter)" ]; then
  echo "::error::the historical compiler corpus changed during verification:"
  git status --porcelain -- crates/forma-ir/tests/fixtures/js-emitter
  echo "::error::Review and regenerate the .ir/.dump corpus against docs/FMIR-FORMAT.md; the existing .html goldens must continue to match."
  exit 1
fi

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
