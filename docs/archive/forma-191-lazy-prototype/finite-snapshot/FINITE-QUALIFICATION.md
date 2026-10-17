# Lazy HTML prototype finite qualification

Frozen source: `dc43901dcb3cd44d927b44067775bf7767920343`, based on `cf869f8302ea0a07d144f39b808a8452485df970`. Only element.ts and its new fresh-module test changed. This is not a browser or performance acceptance claim. Both release timing blockers remain unchanged.

Node 24.22.0, Vitest 4.1.12, every Vitest invocation explicitly `--maxWorkers=2`. One `npm ci --ignore-scripts` succeeded; package-lock SHA256 `06c9440fc0700441b3560566d3abb850a78a98bd3f420b7c8d8b53523743ea90` stayed unchanged. No builds, browsers, Cargo or performance measurements ran.

## Authentic first outcomes

Original 51-control source is retained at `tmp/controls/element-prototype-cache.test.ts`. The archived base element.ts produced 50 failures/1 pass. Forty-nine failures demonstrate unrelated eager native factory calls (40 common tags, or 41 when a new tag was requested). One additional failure was a test assumption: Happy DOM's untouched option.defaultSelected is undefined, not the assumed false. Against the candidate those same controls gave 50 passes and that same one test-assumption failure. Logs `tmp/cache-controls-before.log` and `tmp/cache-controls-after.log` are intact.

The approved test-only correction compares a fresh option's selected/defaultSelected values with an untouched native-model option and independently checks absence of the selected attribute. It preserves private-state isolation; it does not prove real-browser behavior. Corrected controls against the same archived base gave 49 intended failures/2 passes. Those identical corrected controls against the candidate passed 51/51. Both runs and source hashes are recorded in `tmp/cache-controls-corrected-results.json`; source restoration is verified by the wrapper in finally.

## Existing controls and types

The existing seven files passed 119/119 before the test-only correction. A combined replay after correction passed 170/170 across eight files (51 new +119 existing). The exact command from this clone root was:

```sh
npm test -w packages/core -- src/dom/__tests__/element-prototype-cache.test.ts src/dom/__tests__/element.test.ts src/dom/__tests__/namespace-resolution.test.ts src/dom/__tests__/adoption-materialize.test.ts src/dom/__tests__/adoption-callback-mode.test.ts src/dom/__tests__/adoption-conditional-generations.test.ts src/dom/__tests__/adoption-listener-installation.test.ts src/dom/__tests__/list-disposal.test.ts --maxWorkers=2
npm run typecheck -w packages/core
```

Core types passed both before and after the test-only correction. Exact commands, timestamps and exit codes are in `tmp/existing-behavior-result.json`, `tmp/core-types-result.json` and `tmp/corrected-finite-results.json`. The new suite also separately passed 51/51 after its corrected fail-before run. Every actual outcome is retained; no failure was overwritten. All finite processes exited before the lane was handed directly to the decoder diagnostic owner.

## Remaining scope

Real option/template/form behavior must be checked in three browsers; re-use existing typed login, namespace and disposal controls. Build artifacts and gzip sizes are unmeasured. The lazy cache intentionally changes document.createElement call count/order, constructor/monkeypatch observability and when an unused tag captures a later global document. It retains the existing per-module singleton and final successful lookup/assignment; it does not redesign per-Document caching or same-tag recursive constructors. The old profile is only a source hypothesis; no old milliseconds are transferred to the new toolchain.
