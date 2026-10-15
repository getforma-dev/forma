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
#
# Needs: Node 20+ with npm, a stable Rust toolchain with rustfmt, clippy and
# Playwright's Chromium
# (`npx playwright install chromium` once; CI installs it before this runs).
# Not here: the 32-bit, release-profile and MSRV builds, cargo-deny, the
# Windows legs, the release-workflow lint and the scaffold gate, which are
# their own CI jobs beside this one, and the three-engine and nightly-probe
# workflows.
set -euo pipefail
cd "$(dirname "$0")/.."

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
step "actual renderer 3.1 accepts older writers and refuses 3.2 before bind"
node scripts/test-renderer-window.mjs
step "cargo doc --locked --workspace --no-deps"
cargo doc --locked --workspace --no-deps

step "npm run build (compiler, build, core, create-app)"
npm run build
step "npm test --workspaces"
npm test --workspaces
step "declared props: compiler bytes match the native typed-handler fixtures"
node packages/compiler/scripts/emit-props-contract.mjs --check
step "packed compiler API and actual optional-compiler compatibility"
node --test scripts/compatibility-package.test.mjs scripts/core-raw-package.test.mjs
step "packed integrity gate: resource observations and mandatory native checks"
node --test scripts/release-integrity.test.mjs
step "P17's fixture applications and measurement step: staging, pruned lock, resolution, budgets (FORMA-188)"
node --test scripts/release-fixture-apps.test.mjs scripts/release-measurements.test.mjs scripts/release-record.test.mjs
step "core: typecheck, size gate, packaging lint, probe anchors"
npm run typecheck -w packages/core
npm run check:size -w packages/core
npm run check:pack -w packages/core
(cd packages/core && node scripts/run-probes.mjs --check)
step "build: the packed forma-raw-lint bin"
node packages/build/scripts/test-raw-lint-bin.mjs

step "FMIR contract: this compiler's corpus is the one forma-ir has committed"
npm run emit:corpus -w packages/compiler -- "$PWD/crates/forma-ir/tests/fixtures/js-emitter"
cargo test --locked -p forma-ir --lib js_emitter_contract
if [ -n "$(git status --porcelain -- crates/forma-ir/tests/fixtures/js-emitter)" ]; then
  echo "::error::the compiler no longer emits the .ir bytes and canonical .dump texts committed in crates/forma-ir/tests/fixtures/js-emitter:"
  git status --porcelain -- crates/forma-ir/tests/fixtures/js-emitter
  echo "::error::Review and regenerate the .ir/.dump corpus against docs/FMIR-FORMAT.md; the existing .html goldens must continue to match."
  exit 1
fi

step "e2e lanes: fixtures, the SSR site, the preview frame, the fixture applications"
bash e2e/sync-fixtures.sh
bash e2e/ssr/build.sh
bash e2e/frame/build.sh
bash e2e/fixtures/apps/build.sh
# After the build: the servers embed what it wrote, and the embed needs the folders to exist.
step "fixture applications' servers: rustfmt and clippy (FORMA-188; an e2e workspace member)"
cargo fmt --manifest-path e2e/fixtures/apps/Cargo.toml --check
cargo clippy --locked --manifest-path e2e/fixtures/apps/Cargo.toml --all-targets -- -D warnings
step "browser tests: build's worker upgrade, the lanes, core's suite (Chromium)"
npm run test:browser -w packages/build
node --test scripts/template-islands-browser.test.mjs
npx playwright test
npm run test:e2e -w packages/core

echo
echo "check: every gate passed in $(( $(date +%s) - started ))s"
