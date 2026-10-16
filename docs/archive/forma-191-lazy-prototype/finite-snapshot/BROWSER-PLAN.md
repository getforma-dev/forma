# Proposed source and real-browser gate — not executed

Source candidate `dc43901dcb3cd44d927b44067775bf7767920343` in this owned clone. Root must authorize the bounded build/browser lane after the decoder diagnostic. No acceptance timing, CPU profile or mobile/decoder gate is part of this plan.

Environment: explicit Node 24.22.0 PATH, `CARGO_BUILD_JOBS=3`, `PLAYWRIGHT_SKIP_BROWSER_GC=1`; Playwright 1.64.1 from this clone's exact installed lock, all three official browser paths/versions recorded. Do not reuse another clone's servers or workspace dist. Preserve source/test/lock and all output hashes, command exit statuses, first failures and machine scope. No automatic retry.

## Build and artifact controls

From the clone root:

```sh
npm run build -w packages/core
npm run check:size -w packages/core
FORMA_SSR_PROFILE=release bash e2e/ssr/build.sh
```

The last unchanged script builds this clone's compiler/build packages and every existing typed SSR case, then uses the native release renderer with the ordinary e2e target layout. Release profile is the existing three-engine product policy; it avoids a debug-only endpoint-less report-only configuration warning without weakening enforced CSP. Record all five core size results; do not change any cap. Record the exact `forma.esm.js` and entry artifacts used by each browser suite.

For the existing typed fauth app only, reproduce the same library-link setup from e2e/fixtures/apps/build.sh (`core`, `compiler`, `build` symlinked under e2e/fixtures/apps/node_modules/@getforma to this clone's package roots), then:

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

A separate source-reviewed browser test is needed because Happy DOM lacks defaultSelected. Proposed three-engine test uses this clone's actual built public ESM in a fresh page, changes the first template content and first input/textarea/option state, then checks a fresh h() result remains a distinct empty/default element. Assert real option.selected=false/defaultSelected=false and no selected attribute before attaching to a select; verify subsequent real selection behavior using existing core-regressions. Assert template.content remains empty after mutating the first clone. Add registered custom-element independent instance identity without engine-specific constructor-count assumptions. This is structural behavior, not a timer. It must be written and reviewed before browser launch; the current finite native-model comparison is not substituted for it.

No actual browser output, build size or performance outcome is claimed by this plan. Subsequent timing would need a separate reviewed bounded experiment linking real first-interaction tasks to the factory work while retaining both existing no->50ms and decoder<=12ms requirements.
