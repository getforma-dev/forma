# FORMA-294 compiler candidate

Status: **opt-in implementation selected; final exact-commit review and CI pending**.
No release version or published tag has changed. RC2 evidence does not qualify
this implementation. The package transport cap decision below is explicit;
route, runtime and startup budgets remain unchanged.

The compiler lowers closed HTML subtrees in direct inline `createList` render
callbacks to a cached template and staged binding initializer. Original native
FMIR is unchanged. `@getforma/build` enables this only with `clientTemplates: true`;
ordinary builds do not import the optional helper. Adoption describes the original
JSX, including rows inserted into adopted lists after activation. This accelerates
client-created lists, not server-adopted lists. The supported surface and intentional
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
  the two affected files then passed all 24 tests. This is composed verification,
  not a claim that the full command was rerun.
- Three browsers: 60/60 passed, one worker, including real enforced Trusted
  Types, zero-write adoption, fresh native-island rows, expression/effect order,
  removal/clear, reconnected stale nodes and setup disposal/throw paths.
- Actual packed ESM and CJS pairs: owner cleanup, stale callback revocation and
  live-neighbor controls passed. Package compatibility tests passed 2/2.
- Core build and distribution verification passed for 50 JavaScript artifacts.

The ordinary three-argument list still has an existing lifetime gap: retained
`h()` nodes can keep their element-owned native handlers after owner disposal.
The indexed overload explicitly cleans descendants; ordinary `h()` exposes
`cleanup(el)`. This feature does not change ordinary native listener ownership.
The paired diagnostic is retained, and compiled rows must independently revoke
their callbacks (zero calls after disposal and reconnection). That existing gap
is not a desired behavior or a reason to weaken compiled cleanup.

Final opt-in verification: the complete build suite passes **410/410**, including default/false/true selection, split and non-split watch rebuilds, invalid option refusal and unsupported compiler refusal. Size/docs checks pass **29/29**. The first missing-export mock failure is retained; the corrected mock models an absent API. All five package gates pass under the separately recorded package-cap decision below.

One additional focused integration test passes for a shared native/Browser entry
with templates enabled: one browser mount, shared identities, native metadata,
identical on/off FMIR, and paired watch-generation updates. Its observable core
stubs verify build composition; the separate real-browser and packed tests above
verify runtime ownership. Initial fixture assumptions and their failed attempts
are retained. The final artifact receipt SHA256 is
`2d837ee887fdee1bba8e4f5a6a9fd6919365ccc07f1cfce7a2ea87b17d9f7188`.

## Size evidence and explicit package decision

| Measurement | Control | Compiled candidate | Result |
|---|---:|---:|---|
| Core ESM graph gzip | RC2 49,212 B; original limit 49,414 B | 49,796 B | Original gate fails by 382 B; new package-only limit 49,926 B |
| Eligible native-list Forma gzip | 27,947 B | 28,875 B | N2 limit 28,420; fails by 455 B |
| Grand Prix whole app Brotli, published RC2 | 8,498 B | 9,434 B | +936 B |
| Grand Prix whole app Brotli, same new core without transform | 8,545 B | 9,434 B | +889 B |
| Dashboard whole cold JS+worker gzip | 19,293 B | 20,473 B | +1,180 B; under route limits |

The minimal native Counter and original single-node list produce byte-identical
outputs with the transform enabled/disabled. The separately named eligible
native list actually imports the helper and fails N2; the unoptimized fixture
is not evidence that compiled list costs pass. Dashboard CSS was excluded from
this JavaScript size diagnostic. Native FMIR equality was checked.

The complete three-route `fauth` fixture, including CSS and its service worker,
passes with the default option: `/platform/benchmark` uses 28,216 B of Forma code.
Explicitly opting it in uses 29,167 B and still fails N2 by 747 B. The option grants
no exemption. The selected design leaves native routes ordinary by default
because their adopted lists do not gain the clone path.

A small actual `@getforma/build` client-created-list fixture passes with the
option enabled: 9,250 of 28,420 B Forma gzip, 10,896 B whole JS plus worker gzip
and 9,828 B Brotli. Its compiled helper is present; the default build excludes it.
This is a build/size check, not a new latency benchmark.

Accept the optional package entry's 584 B transport growth under the founder's
delegated product-tradeoff decision. Raise only the main graph cap by 512 B,
49,414 →49,926 B, leaving 130 B above the measured 49,796. The implementation
itself is absent from main; adding its entry splits the shared DOM/list chunk
into two compression streams. That group grows 536 B, root/effects 29 B and main
imports 19 B. A concatenation diagnostic attributes about 462 B to the compression
boundary, but is not runnable output or a gate pass. Separately bundling the
helper would duplicate owner/adoption state; a different shared-chunk packaging
design is deferred. No compression accounting changed.

All four runtime caps and N2's 28,420 B route limit stay unchanged. The 50 ms
startup target, bounded 55 ms exceptions, 8 MiB memory and 150 MB image limits
stay unchanged. This decision does not retroactively pass any failed run.

One bounded native-event alternative passed 133 focused tests and 66 three-engine
controls, and reduced the app to 9,115 B Brotli. It still failed the old package
cap by 361 B and the real native route by 373 B. Reject it: it restores per-row
native listeners/controllers, has no qualified timing benefit, and does not
solve the route-budget problem. Preserve its source, failures and results.

## One local performance screen

All 180 recorded samples are retained; every iteration passed its result check.
Per-iteration DOM-state payloads were not serialized. Five samples and
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

The local result did not support promotion. No samples were discarded and the
following Linux run, rather than a selected local rerun, informed the decision.
The old handwritten prototype's gain does not transfer automatically.

## Qualified Linux follow-up and selection

[Run40226501380](https://github.com/getforma-dev/forma/actions/runs/40226501380)
measures exact candidate 1d204ba4 against RC2 main 226f0d8d and unchanged pinned
contestants on gha-4-v1. Five recorded samples and two warmups per operation,
fixed order; one campaign is bounded evidence, not proof of statistical
significance or a universal gain. The independently authenticated artifact
contains all 1,305 samples across 29 reports; all 261 means/sample SDs and 29
geomeans were recomputed. Its published package control is 3.0.0; the RC2
comparison below uses the separate 226f0d8d ref.

| Operation | RC2 ms | Compiled ms | Absolute delta ms |
|---|---:|---:|---:|
| Create1,000 |31.92|28.22|-3.70|
| Replace1,000 |33.88|26.84|-7.04|
| Update every tenth |5.82|5.12|-0.70|
| Select |0.46|0.52|+0.06|
| Swap |2.40|2.50|+0.10|
| Remove |2.44|2.42|-0.02|
| Create10,000 |347.24|287.34|-59.90|
| Append1,000 |28.28|23.16|-5.12|
| Clear |4.24|5.18|+0.94|
| Nine-operation geomean |9.62046|9.08246|-5.59%|

Removal is effectively unchanged; the local outlier was not reproduced. Clear's
22.17%/+0.94 ms cost remains real in this campaign, and select/swap are slightly
slower. Accept those bounded costs for the opt-in client-list workload while
retaining guaranteed cleanup. Do not remove cleanup or keep experimenting until
a preferred result appears. Creation is still 1.271× matched vanilla for 1,000 and
1.256× for 10,000; the original 1.10× target remains a miss. The matched vanilla
control also moved between ref blocks, limiting causal claims about absolute
gains. The unchanged opt-in compiler/core bytes are the measured implementation;
the final build change selects it explicitly instead of enabling it automatically.
The final locally built race JavaScript, CSS and HTML are byte-identical to the
qualified Linux candidate. Compiler distribution, source JSX and transformed
JSX hashes also match; the selection change does not borrow a different runtime's
timing result.

Reactive results are mixed: seven higher, write/one-effect approximately flat,
batch throughput 6.18% lower. Large standard deviations and a moving matched
alien control preclude attributing a reactive speedup to the root correctness
repair. This feature changes no scheduler. No new SSR throughput gain is claimed.

Adopt the guarded compiler API as an explicit option. Defer automatic enablement,
adopted-list acceleration and package restructuring. Stop this bounded runtime
experiment; further designs need a new hypothesis and separately frozen evidence.

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
The authenticated Linux artifact is in `compiler-integration/linux-40226501380/`;
the ZIP SHA256 is
`003573da4ec89255a70fe4ed7721d21684185238cf3efe4cb82d6679c34dff72`.
Its independent review SHA256 is
`c7a6813ad4839427cb285b71fc37f02301b89f25e00303ae9c49f4d5ac15a07d`.
The final option's real-route checks are in `compiler-integration/opt-in-qualification/`;
the rejected alternative and package analysis are in
`compiler-integration/native-event-screen-evidence/`.
The local screen receipt SHA256 is
`62c9804e55841410e816bc8caa6982a0cb1d4b9c93eac307c1a007afd39a7c17`.
The independent staged source review SHA256 is
`2afaf92b234fc0f400c763f04e69e2a6e009659d5710f5debae8579166ad45f7`.
Original failed attempts remain alongside repaired evidence. Roll back the
compiler/build/helper integration together; retain the separately reviewable
root exception repair and its tests only after its own validation.
