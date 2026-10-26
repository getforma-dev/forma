# FORMA-301 implementation and qualification

This is the working implementation record for optional `@getforma/router`, built
on the published Forma 3.1.0 baseline `9a570afece5eb5091824422f00134a875310e857`.
The v1 reviewed design/PDF remains immutable in the companion design-doc-factory
project (`tasks/forma-router`, delivery `task/forma-router/v1`). This record adds
implementation decisions and receipts; it does not retroactively label the design
proof as production qualification or modify the existing 3.1 release contract.

## Research carried into code

All 105 reference questions remain accounted for: Angular 25, Astro 40, React Router 40.
The full [research map](research-map.md) retains its 48 adopt / 47 adapt / 4 defer / 6 reject
dispositions. The frozen reports/snippets/source pins/licenses are in [research](research/README.md),
with their [input hashes](research-manifest.json). The original raw REA runs remain
in the companion research project's `.local`; the snapshot explicitly records
bounded/truncated graphs and the timed-out run. No upstream suite is claimed as
executed. Production code was implemented for Forma; it does not copy the research
snippets or grant reference-site evidence the status of Forma test results.

| Research decision | Implementation | Principal checks |
|---|---|---|
| RD01 optional package/coordinated release | router peer; core/navigation; versioned package inventories | packed-router proof, release-set/P17 tests |
| RD02 ranked bounded grammar | router/src/routes.ts | matching vectors, encoded/prototype params, depth/count refusals |
| RD03 native platform semantics | Link, click/submit ownership and explicit native escapes | router source tests; native real formdata/noJS cases |
| RD04 generation-owned transaction | router coordinator + detached adapter disposers | ignored aborts, late disposal, cleanup reentry and mutation probes |
| RD05 central history/blocking | real entry keys/indexes, compensation barrier | pending POP+imperative/revalidate/foreground/POST regressions |
| RD06 persistent ownership | browser roots; native exact common prefix | native A–B–A actual node/state retention; core owner tests |
| RD07 typed native/scoped adoption | sealed NavigationBranch + optional core scope | Rust owner tests; original-document partition; hostile claim vectors |
| RD08 policy/build/integrity | complete bounded admission tuple and closed group bootstrap | skewed real second build, policy/status/profile/asset refusals |
| RD09 registration-only group | compiler/build group products, closed executable graph | actual FMIR group products and unsupported import/watch refusals |
| RD10 Rust actions | bound ActionContext; validation/error/303 wire | real mutations, CSRF/noJS, endpoint/HTTP status vectors |
| RD11 mutation/read generations | one POST slot; preserve newer destination after settlement | held GET/POST/validation and lost-result cases |
| RD12 observable readiness/experience | immediate readiness, focus/scroll/status; deferred lifetimes | three engines, early input, retained selection and reduced motion |
| RD13 bounded live speculation | two opt-in requests; no completed private cache | sharing/disposal/no-permission/data-saving controls |
| RD14 typed errors/recovery | status-preserving error branch, bounded method-safe GET | 404/410/500/503 and capped recovery journal |
| RD15 evidence discipline | original failures + source/artifact hashes | receipts below; final-source checks distinguish earlier passes |
| RD16 native proof before expansion | actual typed fixture and optional native-router starter | real Rust/compiler/core/router and packed starter qualification |

## Implementation decisions resolved from the design

The package owns browser policy; core exports only the optional native ownership
boundary. Native rendering is not generalized `innerHTML`: exact host scopes are
captured before assembly, original claims remain immutable, and unchanged owners
ignore incoming replacement claims. All group executable code is eager and SRI
bound. Source-only experimental proof code remains separate.

The generated-HTML profile uses registered complete-document SHA256 and explicit
region markers; its registry is emitted after HTML, then loaded as same-build data
before construction. This avoids a self-referential document/bootstrap hash.
It never parses incoming head scripts. Ordinary external anchors are permitted
only in this verified profile; native sealed owners retain their narrower URL
profile. The application attests unchanged effective HTTP/head policy.

Public form outcomes carry preserved status/application data; unknown transactions
have an explicit `resolveUncertain(check)` hook. One coordinator owns a Document.
An opt-in generated/native adapter change is a document boundary, preventing an
accidental browser mount over a native owner. Foreground checks suspend enhanced
work; physical history repair precedes same-view reads or mutation after a pending
POP. These are implementation refinements, with independent review regressions.

Default core stays within its existing size gates. Adding an optional code-split
entry initially exceeded main gzip by 832 B due to compression boundaries. The fix
preserves readable identifiers/lines while removing non-license descriptive
comments from code-split output; it does not duplicate runtime state or increase
caps. Legal/SPDX/purity/source-map annotations and source-map locations are tested.

The original island-route Forma cap remains 28,420 B. The design's explicit new
navigation-group class combines that base with the 12 KiB incremental allocation
(40,708 B aggregate Forma) and caps the complete group at 64 KiB. Ordinary routes and
core caps remain unchanged; a canvas flag cannot increase a group's cap. The
separate paired consumer measurement includes any added shared-core delta and
must meet 12 KiB. Counting router as ordinary application code is forbidden. Initial
wrong-class and all later failed measurements are retained.

## Evidence and remaining release gates

The [qualification ledger](qualification.md) maps all 57 acceptance scenarios to
source, browser or packed evidence and explicitly names the remaining gates.

- [Native fixture](../../../experiments/forma-router-native/README.md): actual
  compiler output, typed server, distinct islands, nested retained layout, real
  forms, noJS, skewed deployment, three-engine and size receipts. Each receipt
  records its own source/artifact identity; intermediate receipts are not final.
- [Mutation probes](evidence/mutations.json): deleting late-candidate disposal or
  post-cleanup authority checks makes the targeted regression fail; restored
  source passes. Other core/server/build probes live with their fixture receipts.
- [Router source tests](../../../packages/router/tests/): matching, history,
  generation/reentrancy, actions, speculation, DOM admission, typed status,
  bootstrap/action policy and aggregate resource limits.
- [Starter](../../../packages/create-app/templates/native-router/): optional
  complete TSX+Rust app. Existing minimal/dashboard semantics remain unchanged.
- [Release process](../../RELEASING.md): coordinated archive inventory, exact peer,
  source sealing and installed archive verification now include router. Historical
  published 3.0/3.1 evidence still has seven packages and two templates. Source
  manifests keep 3.1 until version preparation; no new 3.1 publication is implied.

Local implementation checks do not replace exact-source CI, platform/MSRV jobs,
manual screen-reader/gesture review, release-channel qualification, RC soak,
registry enrollment or a deliberate publication. A new npm package requires its
trusted publisher and operational monitors enrolled before first publication;
monitoring the currently published four npm packages remains intentional until
then. No stable release, merge or OVH deployment is claimed by this record.
