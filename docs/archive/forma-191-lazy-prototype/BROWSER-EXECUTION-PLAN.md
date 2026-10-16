# Proposed source and real-browser gate — not executed

Production source candidate `dc43901dcb3cd44d927b44067775bf7767920343` plus the source-only two-file browser/changelog delta hashed in `tmp/browser-source-hashes.json`, in this owned clone. The older BROWSER-PLAN.md and finite manifest are preserved unchanged. Root must authorize the bounded build/browser lane after the decoder diagnostic. No acceptance timing, CPU profile or mobile/decoder gate is part of this plan.

Environment: explicit Node 24.22.0 PATH, `CARGO_BUILD_JOBS=3`, `PLAYWRIGHT_SKIP_BROWSER_GC=1`; Playwright 1.64.1 from this clone's exact installed lock, all three official browser paths/versions recorded. Do not reuse another clone's servers or workspace dist. Preserve source/test/lock and all output hashes, command exit statuses, first failures and machine scope. No automatic retry.

## Build and artifact controls

From the clone root:

```sh
npm run build -w packages/core
npm run check:size -w packages/core
FORMA_SSR_PROFILE=release bash e2e/ssr/build.sh
```

The last unchanged script builds this clone's compiler/build packages and every existing typed SSR case, then uses the native release renderer with the ordinary e2e target layout. Release profile is the existing three-engine product policy; it avoids a debug-only endpoint-less report-only configuration warning without weakening enforced CSP. Record all five core size results; do not change any cap. Record the exact `forma.esm.js` and entry artifacts used by each browser suite.

For the existing typed fauth app only, use the same library-link setup as e2e/fixtures/apps/build.sh, explicitly pointing to this clone:

```sh
node --input-type=module -e 'import {mkdir,symlink} from "node:fs/promises"; import {resolve,join} from "node:path"; const base=resolve("e2e/fixtures/apps/node_modules/@getforma"); await mkdir(base,{recursive:true}); for(const name of ["core","compiler","build"]) await symlink(resolve("packages",name),join(base,name),"dir");'
```

This is a new clone with no existing fixture package links. An unexpected existing path fails for inspection rather than being silently replaced. Then:

```sh
node e2e/fixtures/apps/build.mjs fauth
cargo build --quiet --locked --manifest-path e2e/fixtures/apps/Cargo.toml --bin fixture-fauth
```

This uses the unchanged real builder and PageProps handler, not a substitute page. Save size-report.json, report.json, manifest and product hashes. Normal native output stays in e2e/target.

## Existing behavior, no duplicate login/disposal fixtures

The source-only `../root-three-engine.config.ts` is a temporary root-config extension which imports the existing root Playwright config and changes projects to Chromium/Firefox/WebKit, selects the two source files below and explicitly anchors testDir/server cwd to this clone because the wrapper lives outside it. Keep original timeout, retries=0, server ownership and identity checks. Run from clone root with explicit `--workers=2`:

```sh
npx playwright test --config ../root-three-engine.config.ts e2e/fixtures/apps/apps.spec.ts --grep 'fixture application fauth' --workers=2
npx playwright test --config ../root-three-engine.config.ts e2e/ssr/namespaces.spec.ts --workers=2
npx playwright test --config e2e/ssr/beta-acceptance.config.ts conditional-element.spec.ts --workers=2
npx playwright test --config packages/core/playwright.config.ts core-regressions.spec.ts --workers=2
```

The real fauth test already checks untouched server values, zero-write adoption, OAuth text, real sign-in/sign-up branch toggles, reveal and form errors plus invite-only and hostile-name variants. namespaces.spec.ts checks native parse, fresh compiled creation, zero-write adoption and inline SVG branch updates. The existing typed conditional test keeps original node identity and asserts detached old branch listeners no longer run. Existing core-regressions covers input/textarea/checkbox and single/multiple option state, plus keyed rerender disposal/focus. Do not copy, weaken or rewrite these controls.

## Small additional native-browser prototype control

One new test is prepared in the existing `packages/core/e2e/core-regressions.spec.ts` harness: `HTML prototype clones keep template and form-control state private`. Its unchanged beforeEach serves this clone's built `packages/core/dist/forma.esm.js` under `/core-regression.mjs`; the test imports that public module in a fresh page. There is no workspace fallback, duplicated login fixture or timer.

The test changes the first template.content, input value/default/checked state, textarea value/default state, option text/value/selected/defaultSelected/disabled and form contents/attributes. Positive observations prove the original mutations happened. Later h() calls must return distinct untouched elements; the option is observed before select insertion, so real browser selected/defaultSelected must be false rather than compared to a native-model placeholder. Template content and form collections must be empty. A registered custom element retains class identity and independent instance-owned state without asserting an engine-specific constructor count. Existing core-regressions continues to check actual user edits and select behavior. The same full core-regressions command above includes this new control and all pre-existing cases unchanged.

The added CHANGELOG bullet reports only lazy native prototype allocation and independent shallow cloning, with no timing pass claim. `git diff --check` passed; this new browser source has not executed and no build exists yet.

No actual browser output, build size or performance outcome is claimed by this plan. Subsequent timing would need a separate reviewed bounded experiment linking real first-interaction tasks to the factory work while retaining both existing no->50ms and decoder<=12ms requirements.

## Launch environment and provenance

Before execution, use explicit Node 24.22.0 PATH, export CARGO_BUILD_JOBS=3 and PLAYWRIGHT_SKIP_BROWSER_GC=1, and unset inherited CARGO_TARGET_DIR/FORMAJS_DIR/FORMA_DIR/FORMA_TEST_BROWSER_CHANNEL in the child environment. Record node/npm and resolved @playwright/test/playwright package paths and versions from this clone, executable paths and actual browser.version(), source HEAD plus expected clean state, lock hash and output package hashes. Every command gets a distinct log and exit record; every Playwright invocation gets a distinct JSON result/output directory and workers=2. The wrapper's only config adaptations are the reviewed three-engine selection and explicit clone directories. Do not start the next stage after a failure, retry a failed stage, raise deadlines or change any oracle. Root must authorize the execution lane after the decoder trace.
