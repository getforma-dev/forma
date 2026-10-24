# Supplied-node diagnostic controls

This prototype is diagnostic and nonpublishable. It does not satisfy the fixed
package/route size limits or all effect throughput targets. Its purpose is to
qualify the graph contract before a source-bound Linux comparison. No limit or
acceptance criterion changes with this probe.

The `pristine` and `adapter` suites retain the upstream alien-signals 3.1.2
tests from commit `836130c4837f8184ae0079e6d550b0adba07b936`, with only imports
redirected to the installed engine or the supplied-node initialization adapter.
The original MIT notice is included at `../../licenses/alien-signals.txt` and
in the packed package. The engine package itself is not patched or vendored.

Run both variants and the ESM/CJS export controls with:

```
npx vitest run --config vitest.engine-probe.config.ts --maxWorkers=1
```

These 84 controls supplement the regular core suite. The adapter uses the
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
ownership, size gates and the unchanged throughput harness are separate checks.
