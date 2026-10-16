# Dynamic fetch fixture migration

The authoritative candidate R17 at `ae7d38f4df06e67245ace38c245fd958a687fc58` passed 409/410 core browser cases; only the stalled-fetch test failed with blank `#busy`. Its served HTML loaded the runtime IIFE but never mounted an owned root after the removal of automatic binding. The full original log, page context and byte-exact test source are preserved here. The original source is identical in candidate ae7d and PR100 parent56393bc0.

The fixture now wraps its authored markup in one owned root and explicitly mounts it as reviewed, with GET fetch access only for the two named paths, no cookies, and the existing 30,000 ms timeout. All original virtual-clock, request-count, error and successful-sibling assertions are unchanged. No production runtime behavior changes. Corrected three-engine execution is pending.
