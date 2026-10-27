# Authoritative R17 command bodies, shared by serial and admitted Linux plans.
# Source only; invoke stages as bare commands so Bash errexit is not suppressed.
forma_check_stage() {
  local stage_id="$1"
  case "$stage_id" in
    s00)
      step "npm ci --ignore-scripts"
      npm ci --ignore-scripts
      ;;
    s01)
      step "npm advisory gate (fails closed)"
      npm audit --omit=dev
      ;;
    s02)
      step "npm audit signatures"
      npm audit signatures
      ;;
    s03)
      step "router design and reverse-engineering provenance are complete"
      node scripts/check-router-research.mjs
      ;;
    s04)
      step "FMIR shared constants are current"
      node scripts/generate-fmir-constants.mjs --check
      ;;
    s05)
      step "cargo fmt --all --check"
      cargo fmt --all --check
      ;;
    s06)
      step "cargo clippy --locked --workspace --all-targets --all-features -- -D warnings"
      cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
      ;;
    s07)
      step "cargo test --locked --workspace"
      cargo test --locked --workspace
      ;;
    s08)
      step "cargo test --locked -p forma-server --all-features"
      cargo test --locked -p forma-server --all-features
      ;;
    s09)
      step "actual renderer 3.1 accepts older writers and refuses 3.2 before bind"
      node scripts/test-renderer-window.mjs
      ;;
    s10)
      step "cargo doc --locked --workspace --no-deps"
      cargo doc --locked --workspace --no-deps
      ;;
    s11)
      step "npm run build (compiler, build, core, router, create-app)"
      # Keep npm run build's dependency order. Only this shell and its explicitly
      # sourced subshells know which fresh builds succeeded; no exported skip flag.
      source scripts/check-builds.sh
      forma_check_build_package packages/compiler dist/index.js dist/index.d.ts
      forma_check_build_package packages/build dist/index.js dist/index.d.ts dist/raw-lint-cli.js
      forma_check_build_package packages/core dist/index.js dist/formajs-runtime.global.js dist/forma.esm.js dist/formajs-frame.global.js
      forma_check_build_package packages/router dist/index.js dist/index.d.ts
      forma_check_build_package packages/create-app dist/index.js
      ;;
    s12)
      step "npm test --workspaces"
      npm test --workspaces
      ;;
    s13)
      step "declared props: compiler bytes match the native typed-handler fixtures"
      node packages/compiler/scripts/emit-props-contract.mjs --check
      ;;
    s14)
      step "packed compiler API and actual optional-compiler compatibility"
      node --test scripts/compatibility-package.test.mjs scripts/core-raw-package.test.mjs
      ;;
    s15)
      # Compound serial stage retains its original subpart order.
      forma_check_stage s15-cargo
      forma_check_stage s15-controls
      ;;
    s16)
      step "P17's fixture applications and measurement step: staging, pruned lock, resolution, budgets (FORMA-188)"
      node --test scripts/release-fixture-apps.test.mjs scripts/release-measurements.test.mjs scripts/release-record.test.mjs scripts/release-skew-contract.test.mjs scripts/release-performance-baseline.test.mjs scripts/release-performance-contract.test.mjs scripts/release-performance-startup.test.mjs scripts/release-performance-evidence.test.mjs scripts/release-performance-attribution.test.mjs scripts/release-record-limits.test.mjs scripts/release-record-download.test.mjs scripts/release-performance-decoder.test.mjs scripts/release-performance-durability.test.mjs
      ;;
    s17)
      step "packed decoder: actual built compiler regenerates the timed contracts"
      node --test scripts/release-performance-journal.test.mjs scripts/release-performance-mobile-phases.test.mjs scripts/release-performance-child-evidence.test.mjs scripts/release-performance-finalization.test.mjs
      node --test --test-concurrency=2 scripts/release-performance-correlation.test.mjs scripts/release-performance-metadata.test.mjs scripts/release-performance-parser-attribution.test.mjs scripts/release-performance-mobile-start.test.mjs
      node --test scripts/decoder-compiler-package.test.mjs
      ;;
    s18)
      step "core: typecheck, size gate, packaging lint, probe anchors"
      npm run typecheck -w packages/core
      npm run check:size -w packages/core
      npm run check:pack -w packages/core
      (cd packages/core && node scripts/run-probes.mjs --check)
      ;;
    s19)
      step "expression qualification:100000 generated cases, removed-charge control and independent nightly floor"
      node --test --test-concurrency=2 packages/core/scripts/expression-probe-floor.test.mjs packages/core/scripts/probe-results.test.mjs packages/core/scripts/probe-reporter.test.mjs scripts/release-security.test.mjs
      node packages/core/scripts/qualify-expression-mutation.mjs
      ;;
    s20)
      step "router: types and packed public exports"
      npm run typecheck -w packages/router
      npm run check:pack -w packages/router
      node --test scripts/release-router-bootstrap.test.mjs scripts/release-package-inventory.test.mjs scripts/release-router-package.test.mjs scripts/navigation-size-contract.test.mjs
      ;;
    s21)
      step "build: the packed forma-raw-lint bin"
      node packages/build/scripts/test-raw-lint-bin.mjs
      ;;
    s22)
      step "FMIR contract: historical and current-writer corpus preserve exact payloads and HTML"
      node --test scripts/fmir-corpus.test.mjs
      node scripts/check-fmir-corpus.mjs
      if [ -n "$(git status --porcelain -- crates/forma-ir/tests/fixtures/js-emitter)" ]; then
        echo "::error::the historical compiler corpus changed during verification:"
        git status --porcelain -- crates/forma-ir/tests/fixtures/js-emitter
        echo "::error::Review and regenerate the .ir/.dump corpus against docs/FMIR-FORMAT.md; the existing .html goldens must continue to match."
        exit 1
      fi
      ;;
    s23)
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
      ;;
    s24)
      step "fixture applications' servers: rustfmt and clippy (FORMA-188; an e2e workspace member)"
      cargo fmt --manifest-path e2e/fixtures/apps/Cargo.toml --check
      cargo clippy --locked --manifest-path e2e/fixtures/apps/Cargo.toml --all-targets -- -D warnings
      cargo test --locked --manifest-path e2e/fixtures/apps/Cargo.toml --lib measurement_setup_is_inert_and_uncacheable
      ;;
    s25)
      # Compound serial stage retains its original subpart order.
      forma_check_stage s25-worker
      forma_check_stage s25-browser
      (source scripts/check-core-browser.sh --project=chromium)
      ;;
    s26)
      step "native router: real compiled owners, server and Chromium navigation controls"
      node --test scripts/router-proof-process.test.mjs
      node scripts/run-router-native-proof.mjs --engines chromium --skip-package-build
      ;;
    s27)
      step "hostile widgets: complete reviewed-tier matrix and real removed-grant control"
      node packages/core/e2e/hostile-widgets/run.mjs
      node packages/core/e2e/hostile-widgets/qualify-guard.mjs
      ;;
    s28)
      step "parity harness (FORMA-183): generator, comparison, serializer, renderBoth"
      npx tsc --noEmit -p e2e/parity
      node --test --test-concurrency=2 "e2e/parity/tests/*.test.mts"
      ;;
    s29)
      step "blocking parity: step 1, 100 states, typed P1/P2/P3 with no exceptions"
      node --input-type=module -e 'import assert from "node:assert/strict"; import {readExpected} from "./e2e/parity/src/expected.mts"; assert.equal(readExpected().length, 0, "blocking parity requires an empty expected-divergent list");'
      node e2e/parity/src/run.mts --step 1 --states 100 --report "${RUNNER_TEMP:-$PWD/test-results}/parity/report.jsonl"
      ;;
    s30)
      step "value rules: deterministic generator, actual native metadata, 1,000 comparisons/rule"
      node --test e2e/value-rules/*.test.mjs
      node e2e/value-rules/metadata.mjs --engine chromium
      node e2e/value-rules/run.mjs --count 1000
      ;;
    s31)
      step "N3: actual indexed public-set timing, serial Chromium"
      node --test e2e/ssr/indexed-timing.test.mjs
      npx playwright test --config e2e/ssr/indexed-products.config.ts --project=chromium --workers=1 --grep 'indexed products: complete public set' --output test-results/indexed-chromium
      ;;
    s12-overlap)
      step "npm test workspaces: core correctness partition, then the remaining four packages"
      node scripts/check-core-partition.mjs unit overlap
      npm test -w packages/router -w packages/compiler -w packages/build -w packages/create-app
      ;;
    s12-exclusive)
      step "exclusive core unit resource guards"
      node scripts/check-core-partition.mjs unit exclusive
      ;;
    s15-cargo)
      step "exclusive packed integrity Cargo controls"
      node --test scripts/release-integrity.test.mjs
      ;;
    s15-controls)
      step "packed integrity gate: resource observations and mandatory native checks"
      node --test scripts/release-publication-recovery.test.mjs
      node --test scripts/release-provider-placeholder.test.mjs
      node --test scripts/release-support.test.mjs scripts/release-support-history.test.mjs scripts/toolchain-policy.test.mjs scripts/package-metadata.test.mjs
      ruby scripts/check-toolchain-policy.rb
      ;;
    s25-worker)
      step "exclusive build-worker Cargo controls"
      npm run test:browser -w packages/build
      ;;
    s25-browser)
      step "browser tests: build's worker upgrade, the lanes, core's suite (Chromium)"
      node --test scripts/template-islands-browser.test.mjs scripts/ssr-csp-reports.test.mjs
      # Indexed timing remains a later exclusive stage.
      if [ "$check_mode" = linux-overlap ]; then
        npx playwright test --workers=2 --grep-invert 'indexed products: complete public set'
      else
        npx playwright test --grep-invert 'indexed products: complete public set'
      fi
      ;;
    s25-prepare)
      step "prepare the core browser runtime before sealing shared inputs"
      forma_check_prepare_core_browser
      ;;
    s25-core-overlap)
      step "core browser correctness partition"
      node scripts/check-core-partition.mjs browser overlap "$scheduler_evidence/core-overlap"
      ;;
    s25-core-exclusive)
      step "exclusive core browser timing and Cargo files"
      node scripts/check-core-partition.mjs browser exclusive "$scheduler_evidence/core-exclusive"
      ;;
    scheduler-controls)
      step "scheduler: complete current partition and fake-child controls"
      node scripts/check-core-partition.mjs --verify
      node --test scripts/check-scheduler.test.mjs
      FORMA_SCHEDULER_CONTROL_EVIDENCE="$scheduler_evidence/owner-controls" node --test scripts/check-scheduler-owned.test.mjs
      ;;
    *) echo "Unknown R17 stage: $stage_id" >&2; return 2;;
  esac
}
