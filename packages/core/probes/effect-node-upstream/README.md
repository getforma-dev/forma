# Supplied-node adapter qualification

These controls qualify the supplied-node adapter selected for the 3.1 release.
The original flat candidate exceeded the previous package and route size gates,
and its latest qualified Linux fan-out result was 76.3% of the pinned engine,
below the original 80% target. The [3.1 performance decision](../../../../docs/release/3.1-PERFORMANCE-TRADEOFFS.md)
records the explicitly accepted product tradeoff and revised byte budgets.
Those historical misses remain failures; this suite establishes graph behavior,
not throughput or release acceptance.

The `pristine` and `adapter` suites retain the upstream alien-signals 3.1.2
tests from commit `836130c4837f8184ae0079e6d550b0adba07b936`, with only imports
redirected to the installed engine or the supplied-node initialization adapter.
The original MIT notice is included at `../../licenses/alien-signals.txt` and
in the packed package. The engine package itself is not patched or vendored.

Run both variants and the ESM/CJS export controls with:

```
npm run test:engine
```

These 84 controls supplement the regular core suite and run in the regular
Node CI matrix after the workspace tests. The adapter uses the
original engine's active subscriber and scheduler; its separate public
`createReactiveSystem` instance supplies only link/unlink operations. Its
update/notify hooks deliberately throw if that boundary is crossed. The source
tests pin all four ESM/CJS engine implementation hashes. Any engine upgrade
must requalify initialization, dependency purge, mutable-computed unwatching,
immutable scopes, initial throws, nested scopes and mixed native/Forma graphs.

Native scope teardown stops graph reactions. Forma's returned disposer remains
responsible for its own cleanup collector, matching the existing wrapper
contract. The packed ESM and CJS graphs must each resolve the same engine
instance as their own format's public Forma entry. Packed interop, browser
ownership, size gates and the unchanged throughput harness remain separate,
source-bound checks required before promoting the selected release candidate.
