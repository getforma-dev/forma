# Root full-stack runtime fixture migration

The original files are byte-exact from commit `9e867e4a534c9ba625e301e2c19c9e829e504f56`. `manifest.json` pins every original and the full hosted CI log (run 38857234217, check job 116831595193).

The actual prior run failed nine existing root `e2e/full-stack.spec.ts` cases: the eight HTML runtime behaviors and the mixed-API coexistence check. The fixture loaded the runtime IIFE but never called `mountMarkup`, relying on retired auto-binding. Its component and reviewed-template controls passed. This is original CI failure evidence, not a replay of newly added tests against an old product.

The migration adds a fixture-owned external script that mounts only `#test-runtime` as reviewed markup with no grants. Every existing behavior assertion remains. The new control independently demonstrates that a sibling outside that root stays inert, the owned button is live, and disposing its handle stops it. A focused static-server config permits all three engines without rebuilding unrelated native fixtures. Production runtime behavior is unchanged.

The first actual corrected-fixture replay at `a8972d1a` passed all 48 original cases across three engines in 44.419s. Only the three newly added disposal controls failed: they attempted a locator click after the documented handle had already emptied its root. The first test source, full JSON/log and fresh sync log are preserved here. The narrow control correction retains real button/text nodes before unmount, asserts the root is empty, invokes the detached button and requires its retained text to stay unchanged. Its corrected replay is pending. No production change is involved.
