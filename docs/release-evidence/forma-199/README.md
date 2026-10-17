# FORMA-199: real module completion before adoption observation ends

Source: `f21e821369361053e0e59195577bf015ca0abaf9` plus helper-only runner correction `6079cee38e6d432645c8f035b09f3bf28ef0d115`, based on reviewed `8065de89`. This is a bounded correctness qualification, not full P17 or performance acceptance.

The positive fixture and minimal-template entries now author `await activateIslands(...)`. Both shared adoption verifiers import every exact already-requested manifest entry URL before collecting final mutation records and ending observation. The browser module map shares the original evaluation; no second activation, cache-busting, or readiness global is introduced. The existing verifier timeout bounds unfinished module evaluation. Resource requests stay held until the observation has ended. Runtime, response measurement, CSS and limits are unchanged.

The real three-engine controls show that DOMContentLoaded can occur while TLA remains pending, and repeated import of the exact module URL evaluates it only once. Each verifier is also given a yielded module that makes a late initial DOM write. Before repair, all six refusal assertions failed because the original verifiers accepted that page. The three native module controls passed. All nine cases passed after the initial repair and again on the final serialization-corrected helper (11.6 seconds). `readiness-before.log` preserves the actual six false passes; `readiness-final.log` is the current result.

The first actual packed minimal test exposed a Vitest integration error: its transform replaced native import inside the serialized browser callback with `__vite_ssr_dynamic_import__`, which does not exist in the browser. `packed-before-import-serialization.log` retains that failure. The narrow helper repair passes an explicit browser expression with JSON-encoded arguments, keeping native import outside the Node-side transform. The unchanged existing minimal scaffold test exercises this through the real Vitest path and remains recurring integration coverage.

The final packed check uses fresh seven-package dry archives recorded at f21. Core/compiler dist were built at91a; their producer sources, build and CLI sources are unchanged by this repair. Actual template source is from f21. Normal candidate/source/lock/resolution/signature checks ran; no archive was edited. The later6079 helper-only repair changes neither package inputs nor fixture source, so the same exact seven archives were retained. The normal DS11 and archives remain at `work/FORMA-199/packages`. This result does not qualify future beta-version bytes.

Actual packed results (`packed-results.json`, `minimal-vitest.json`, final log):

- The selected existing minimal scaffold test passed in10.74 seconds. Chromium, Firefox and WebKit each retained the native Counter's original nodes with zero initial mutations, produced7→8→0→1 from real clicks, and verified the static route requested no executable code.
- The existing100-island fixture passed in all three engines: zero initial mutations, original node identity, all100 real tile updates, and the existing switch behavior.
- The ledger held-request fixture passed in all three engines: zero initial mutations while its resource remained held, followed by the real loaded response. This checks that awaiting module completion does not deadlock held fetches.
- Ordinary locked Rust release compilation completed in17.03 seconds; all fixture builds used their existing caps. Cargo jobs3, Vitest/Playwright workers2.

All owned browsers and servers closed; the temporary staged fixture project was removed. The external command is `work/FORMA-199/run-packed.mjs`; the controlled browser suite is the tracked `e2e/fixtures/apps/module-readiness.spec.ts`. No full P17, mobile audit, threshold change, tag, publish or acceptance claim was made. Independent final source review and merged/versioned qualification remain required.
