#!/usr/bin/env bash
# R17: one command, from a clean clone, builds every package in both languages
# and runs every test (FORMA-113; v2 R17, G6). `npm run check` runs it; CI's
# `check` job runs it on every push and pull request and the target is under
# ten minutes there. It is the per-merge gate of the four repositories this one
# replaced, in one place:
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
# Application overrides never relax framework fixture qualification.
export FORMA_SIZE_POLICY=framework
cd "$(dirname "$0")/.."
node -e 'if (!process.features.typescript) { console.error(`::error::scripts/check.sh needs a Node that strips types (.node-version: 24) for the parity harness; this is ${process.version}`); process.exit(1); }'
started=$(date +%s)
step() { echo; echo "### $* ($(( $(date +%s) - started ))s)"; }
source scripts/check-stages.sh
# Admission may choose the full serial plan only before any work starts.
# Any later input drift or command/owner failure fails this one invocation.
scheduler_evidence="$(node scripts/check-scheduler-admission.mjs --admit)"
check_mode="$(node scripts/check-scheduler-admission.mjs --mode "$scheduler_evidence")"
echo "R17 schedule: $check_mode; evidence: $scheduler_evidence"
node scripts/check-scheduler-admission.mjs --explain "$scheduler_evidence"
if [ "$check_mode" = serial ]; then
  plan="$(node scripts/check-scheduler-admission.mjs --plan serial)"
  for stage_id in $plan; do
    forma_check_stage "$stage_id"
  done
else
  step "compile Rust and npm in owned lanes, then verify their complete join"
  node scripts/check-compile-phase.mjs "$scheduler_evidence/compile" "$started" &
  scheduler_pid=$!
  trap 'kill -TERM "$scheduler_pid" 2>/dev/null || true; wait "$scheduler_pid" || true; exit 130' INT
  trap 'kill -TERM "$scheduler_pid" 2>/dev/null || true; wait "$scheduler_pid" || true; exit 143' TERM
  if wait "$scheduler_pid"; then scheduler_status=0; else scheduler_status=$?; fi
  trap - INT TERM
  test "$scheduler_status" -eq 0
  source scripts/check-builds.sh
  forma_check_import_compile "$scheduler_evidence/compile"
  plan="$(node scripts/check-scheduler-admission.mjs --plan beforeFork)"
  for stage_id in $plan; do
    forma_check_stage "$stage_id"
  done
  step "overlap sealed R17 lanes and join all owned processes"
  node scripts/check-scheduler-pair.mjs "$scheduler_evidence/overlap" "$started" &
  scheduler_pid=$!
  trap 'kill -TERM "$scheduler_pid" 2>/dev/null || true; wait "$scheduler_pid" || true; exit 130' INT
  trap 'kill -TERM "$scheduler_pid" 2>/dev/null || true; wait "$scheduler_pid" || true; exit 143' TERM
  if wait "$scheduler_pid"; then scheduler_status=0; else scheduler_status=$?; fi
  trap - INT TERM
  test "$scheduler_status" -eq 0
  plan="$(node scripts/check-scheduler-admission.mjs --plan afterJoin)"
  for stage_id in $plan; do
    forma_check_stage "$stage_id"
  done
fi
node scripts/check-scheduler-admission.mjs --complete "$scheduler_evidence"
echo
echo "check: every gate passed in $(( $(date +%s) - started ))s"
