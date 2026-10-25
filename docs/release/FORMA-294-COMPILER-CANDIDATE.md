# FORMA-294 compiler candidate

Status: **draft; not qualified for promotion**. No size limit, startup limit,
release version or published tag has changed. RC2 evidence does not qualify
this new implementation.

The compiler lowers closed HTML subtrees in direct inline `createList` render
callbacks to a cached template and staged binding initializer. Original native
FMIR is unchanged. Adoption describes the original JSX, and ordinary one-time
islands do not import the optional helper. The supported surface and intentional
event/construction rules are in [the compiler contract](../../packages/compiler/README.md#client-jsx-templates).

The implementation also repairs root setup that throws: it obtains the engine
scope disposer, drains owned work, then rethrows the original value. Previously,
both native and compiled setup could leave a later binding live after an earlier
reader requested disposal and a subsequent expression threw.

## Correctness evidence

The initial integration was rejected for eager sibling-expression capture,
late listener retention after disposal, and an untracked raw HTML entry. The
revised implementation uses staged evaluation, permanent revocation and a lazy
callback returning the existing `trustedHtml()` value. The raw sink refuses
strings and lookalikes; authored helper calls and re-exports enter the raw lint.

Local Node24.22.0 checks on 2026-10-25:

- Full compiler: 1,771 passed. Full build: 400 passed.
- Full core: 4,270 passed and two exact export-inventory failures. The new
  `./compiled` inventory entries were added without loosening those checks;
  the two affected files then passed all24 tests. This is composed verification,
  not a claim that the full command was rerun.
- Three browsers: 60/60 passed, one worker, including real enforced Trusted
  Types, zero-write adoption, fresh native-island rows, expression/effect order,
  removal/clear, reconnected stale nodes and setup disposal/throw paths.
- Actual packed ESM and CJS pairs: owner cleanup, stale callback revocation and
  live-neighbor controls passed. Package compatibility tests passed2/2.
- Core build and distribution verification passed for50 JavaScript artifacts.

The ordinary three-argument list still has an existing lifetime gap: retained
`h()` nodes can keep their element-owned native handlers after owner disposal.
The indexed overload explicitly cleans descendants; ordinary `h()` exposes
`cleanup(el)`. This feature does not change ordinary native listener ownership.
The paired diagnostic is retained, and compiled rows must independently revoke
their callbacks (zero calls after disposal and reconnection). That existing gap
is not a desired behavior or a reason to weaken compiled cleanup.

## Size gates remain unchanged

| Measurement | Control | Compiled candidate | Result |
|---|---:|---:|---|
| Core ESM graph gzip | Limit49,414 B | 49,796 B | Fails by382 B |
| Eligible native-list Forma gzip | 27,947 B | 28,875 B | N2 limit28,420; fails by455 B |
| Grand Prix whole app Brotli, published RC2 | 8,498 B | 9,434 B | +936 B |
| Grand Prix whole app Brotli, same new core without transform | 8,545 B | 9,434 B | +889 B |
| Dashboard whole cold JS+worker gzip | 19,293 B | 20,473 B | +1,180 B; under route limits |

The minimal native Counter and original single-node list produce byte-identical
outputs with the transform enabled/disabled. The separately named eligible
native list actually imports the helper and fails N2; the unoptimized fixture
is not evidence that compiled list costs pass. Dashboard CSS was excluded from
this JavaScript size diagnostic. Native FMIR equality was checked.

## One local performance screen

All180 recorded samples and all result checks are retained. Five samples and
two warmups per operation; fixed order baseline, same-core control, compiled,
vanilla. Apple M1 Pro, Chrome155.0.8059.85, Node24.22.0, busy local host. This is
not a qualified Linux comparison or proof of statistical significance.

| Operation | Published RC2 ms | Same core, no transform ms | Compiled ms | Vanilla ms |
|---|---:|---:|---:|---:|
| Create1,000 |22.02|24.84|20.66|15.84|
| Replace1,000 |22.12|21.78|20.86|17.22|
| Update every tenth |3.38|3.44|4.80|4.70|
| Select |0.72|0.62|0.66|1.12|
| Swap |2.28|2.16|2.74|2.48|
| Remove |1.98|2.52|4.32|1.82|
| Create10,000 |286.36|290.18|205.84|202.50|
| Append1,000 |38.22|26.42|22.60|21.24|
| Clear |3.66|3.70|4.02|2.68|
| Nine-operation geomean |8.427|8.256|8.755|7.496|

Creation is promising; the overall local result and removal/clear do not support
promotion or a budget increase. Preserve the noisy samples. One matched Linux
comparison must measure this actual compiler output before further decisions.
The old handwritten prototype's gain does not transfer automatically.

## Reproduction and retained evidence

The standard Grand Prix client workflow accepts `compiler_templates=true`.
It builds each exact candidate's compiler, transforms the unchanged app before
Vite lowers JSX, and retains transformed source, compiler/source hashes and built
assets. Published/older controls lacking the transform remain ordinary. Do not
combine this mode with source-mapped row profiling until generated source maps
are supported; the wrapper refuses that misleading combination.

Local evidence is on the shared ticket board under `work/FORMA-294/`:
`compiler-integration/staged-checks/`, `islands-tests/STAGED-RESULTS.md`,
`route-size-comparison-list-only/RESULTS.md` and
`compiler-integration/staged-build/analysis.json`.
The local screen receipt SHA256 is
`62c9804e55841410e816bc8caa6982a0cb1d4b9c93eac307c1a007afd39a7c17`.
The independent staged source review SHA256 is
`2afaf92b234fc0f400c763f04e69e2a6e009659d5710f5debae8579166ad45f7`.
Original failed attempts remain alongside repaired evidence. Roll back the
compiler/build/helper integration together; retain the separately reviewable
root exception repair and its tests only after its own validation.
