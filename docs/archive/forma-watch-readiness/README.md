# Watch readiness failure and correction

The original Windows job38854874895/116823982939 leaves the final static route
as an island after the existing ten-second deadline. Its complete raw log and
the original helper are retained byte-for-byte; the manifest records hashes.

The new control runs the real build/compiler/esbuild pipeline, with a test-only
wrapper holding creation of the third real nonsplit watch context behind a file
barrier. The original helper reports ready after two real initial markers while
that third context is still blocked: one genuine failure, one split positive
pass. The barrier is released in finally even when the original assertion fails;
the existing owned-process cleanup closes the watcher and descendants.

The helper now waits for one split context or every nonsplit entry context,
and change awaits that readiness before applying its update. No deadline,
production build behavior or source classification changed. The identical two
controls and eight existing actual static-product checks plus owned-process
cleanup pass11/11 on Node24.22.0/Vitest3.2.7 with two workers (2.21s).

This proves the initial-readiness bug and preserves the original CI failure.
It does not claim the hosted Windows failure is resolved until fresh exact-head
Windows CI passes. Other concurrent rebuild/context races remain outside this
narrow repair unless a separate actual failure demonstrates one.
