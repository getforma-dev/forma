#!/usr/bin/env bash
# Unintegrated scheduler prototype derived from R17: one command, from a clean clone, builds every package in both languages
# and runs every test (FORMA-113; v2 R17, G6). The existing npm/CI entry point
# remains scripts/check.sh. This separate prototype has no timing qualification.
# It retains the per-merge workload of the four repositories this one replaced:
#
#   Rust    fmt, clippy over every target and feature, the workspace's tests
#           and docs (forma's CI `test` job)
#   npm     the five packages built in dependency order and their unit suites
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

# Separate reviewable prototype, not yet npm run check or a qualification result.
# Preserve the original serial portable entry point and optional heavy contexts.
if [ "$(uname -s)" != Linux ] || [ "${FORMA_SCAFFOLD_E2E:-}" = 1 ] || [ -n "${FORMA_LIST_KEY_EVIDENCE:-}${FORMA_LIST_KEY_CORE_BUNDLE:-}${CARGO_TARGET_DIR:-}" ]; then
  exec bash scripts/check.sh
fi
if [ "$#" -ne 1 ] || [[ "$1" != /* ]]; then
  echo "Usage: bash scripts/check-scheduler-prototype.sh <new-absolute-external-evidence-directory>" >&2
  exit 2
fi

# Fail fast on the wrong Node: the parity harness's step (near the end) runs
# TypeScript by Node's own type stripping (Node 24, `.node-version`). A Node
# without it fails here, by name, before the long run, never skipping the step
# (TESTING.md P7).
node -e 'if (!process.features.typescript) { console.error(`::error::scripts/check.sh needs a Node that strips types (.node-version: 24) for the parity harness; this is ${process.version}`); process.exit(1); }'

started=$(date +%s)
step() { echo; echo "### $* ($(( $(date +%s) - started ))s)"; }

scheduler_evidence="$(node scripts/check-scheduler-pair.mjs --evidence-path "$1")"
mkdir "$scheduler_evidence"
step "npm ci --ignore-scripts"
npm ci --ignore-scripts
step "npm advisory gate (fails closed)"
npm audit --omit=dev
step "npm audit signatures"
npm audit signatures

step "router design and reverse-engineering provenance are complete"
node scripts/check-router-research.mjs

step "FMIR shared constants are current"
node scripts/generate-fmir-constants.mjs --check

step "cargo fmt --all --check"
cargo fmt --all --check
step "cargo clippy --locked --workspace --all-targets --all-features -- -D warnings"
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
step "cargo test --locked --workspace"
cargo test --locked --workspace
step "cargo test --locked -p forma-server --all-features"
cargo test --locked -p forma-server --all-features
step "actual renderer 3.1 accepts older writers and refuses 3.2 before bind"
node scripts/test-renderer-window.mjs
step "cargo doc --locked --workspace --no-deps"
cargo doc --locked --workspace --no-deps

step "npm run build (compiler, build, core, router, create-app)"
# Keep npm run build's dependency order. Only this shell and its explicitly
# sourced subshells know which fresh builds succeeded; no exported skip flag.
source scripts/check-builds.sh
forma_check_build_package packages/compiler dist/index.js dist/index.d.ts
forma_check_build_package packages/build dist/index.js dist/index.d.ts dist/raw-lint-cli.js
forma_check_build_package packages/core dist/index.js dist/formajs-runtime.global.js dist/forma.esm.js dist/formajs-frame.global.js
forma_check_build_package packages/router dist/index.js dist/index.d.ts
forma_check_build_package packages/create-app dist/index.js
step "scheduler: exhaustive frozen partition and fake-child controls"
node scripts/check-core-partition.mjs --verify
node --test scripts/check-scheduler.test.mjs
FORMA_SCHEDULER_CONTROL_EVIDENCE="$scheduler_evidence/owner-controls" node --test scripts/check-scheduler-owned.test.mjs

step "router: types and packed public exports"
npm run typecheck -w packages/router
npm run check:pack -w packages/router
node --test scripts/release-router-bootstrap.test.mjs scripts/release-package-inventory.test.mjs scripts/release-router-package.test.mjs scripts/navigation-size-contract.test.mjs
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
step "exclusive integrity Cargo and build-worker Cargo controls"
node --test scripts/release-integrity.test.mjs
npm run test:browser -w packages/build

step "prepare the core browser runtime before sealing shared inputs"
(cd packages/core
 forma_check_build_package "$PWD" dist/formajs-runtime.global.js
 node -e "require('fs').copyFileSync('dist/formajs-runtime.global.js','e2e/fixtures/formajs-runtime.global.js')")

step "overlap two sealed R17 lanes, then join every result and owned process"
node scripts/check-scheduler-pair.mjs "$scheduler_evidence/overlap" "$started" &
scheduler_pid=$!
trap 'kill -TERM "$scheduler_pid" 2>/dev/null || true; wait "$scheduler_pid" || true; exit 130' INT
trap 'kill -TERM "$scheduler_pid" 2>/dev/null || true; wait "$scheduler_pid" || true; exit 143' TERM
if wait "$scheduler_pid"; then scheduler_status=0; else scheduler_status=$?; fi
trap - INT TERM
test "$scheduler_status" -eq 0

step "exclusive core unit resource guards and browser timing/Cargo files"
node scripts/check-core-partition.mjs unit exclusive
node scripts/check-core-partition.mjs browser exclusive "$scheduler_evidence/core-exclusive"

step "native router: real compiled owners, server and Chromium navigation controls"
node --test scripts/router-proof-process.test.mjs
node scripts/run-router-native-proof.mjs --engines chromium --skip-package-build

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
