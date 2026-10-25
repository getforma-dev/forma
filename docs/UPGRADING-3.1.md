# Upgrading from Forma 3.0 to 3.1

**Preparation draft: 3.1 is not published.** This guide describes the reviewed
changes being prepared for the coordinated release. The documented
[performance tradeoffs](release/3.1-PERFORMANCE-TRADEOFFS.md), fresh exact-source
qualification and independent release audit govern RC acceptance. Original
missed effects and row-creation targets remain disclosed. Final publication additionally requires active burn-in
of that published RC and final-delta qualification. The [3.0 guide](UPGRADING-3.0.md)
remains the guide for upgrades from earlier releases.

## Upgrade the coordinated packages

Update the application's direct Forma dependencies and their matching dependency
closure together: `@getforma/core`, `@getforma/compiler`, `@getforma/build`,
`@getforma/create-app`, `forma-ir`, `forma-ir-derive` and `forma-server`. Update
and retain the npm and Cargo lockfiles and rebuild browser assets, manifest and native
modules from the same source. A framework release does not migrate application
repositories automatically.

FMIR remains version 3 and manifests remain schema 2. Within the major, a reader
accepts writers of its own or an older minor. Upgrade the renderer before
deploying output from the 3.1 compiler/build packages. A 3.0 renderer refuses
3.1-written output; a 3.1 renderer accepts 3.0-written output. Patch versions do
not restrict this window. See [compatibility](compatibility.md) for package
peers, prereleases and startup/build refusal rules.

## No-JavaScript routes now emit plain HTML

An SSR route with explicit `js: []`, no declared islands and no module preloads
omits hydration comments, injected row keys, the empty island-state block and
root build/SSR attributes. Authored attributes, visible content, key validation,
value escaping, CSS/fonts and response policy remain. Routes with browser code
retain the adoption marker contract.

Use authored attributes for selectors or scraping on a static route. Do not
inject hydration markers to recover the old output. A page that needs browser
behavior must declare it through its normal browser entry/islands. Static
routes continue to refuse executable request configuration and contradictory
module preloads; they do not become browser shells on a render failure.

## Rendered-page compression is opt-in

Enable the `compression` Cargo feature for `forma-server` and return
`page.with_compression(&request_headers)` only from selected handlers. The
argument is Axum's request `HeaderMap`. Ordinary `PageResponse` responses remain
uncompressed. The wrapper negotiates Brotli, gzip or identity, preserves CSP and
`no-store`, and adds `Vary: Accept-Encoding`. It returns 406 when no available
representation is acceptable.

Review each route for secrets mixed with attacker-controlled text before opting
in, including compression supplied by a reverse proxy. A fresh CSP nonce does
not protect another secret against length disclosure. Compression is synchronous
and costs CPU; fewer transferred bytes do not imply faster responses. See the
[server API](../crates/forma-server/README.md#rendered-page-compression) and
[BREACH policy](../SECURITY.md#opt-in-page-compression-forma-261). Disable it by
removing the wrapper or feature.

## Effects and performance budgets

The selected effect implementation consolidates graph and lifecycle state while
preserving synchronous execution, cleanup, error reporting and ownership.
No effect API migration is required. Default `createList` and event ownership
remain unchanged; the large-table creation gap is a documented limitation.
The experimental template and listener transforms are excluded from this release.

The core ESM graph gate increases from 48,902 to 49,414 gzip bytes, and the
route's Forma-code ceiling from 28,100 to 28,420. Total page/canvas JavaScript
budgets and zero-JavaScript static routes stay unchanged. These explicit costs
support the measured effects gains; they do not mean every workload is faster.
Use the final qualified report and your application's own measurements.

## Repaired: `NaN` keys in component lists

FORMA-290 repairs a lifecycle defect present in published 3.0.0 and 3.1.0-rc.2.
The small-list scan now uses the same SameValueZero key equality as the large
Map path: `NaN` matches itself and positive/negative zero match. Repeated updates
retain the row and its owner. Each actual row node holds its own ownership record,
so duplicate keys cannot overwrite another row's cleanup. Removed, cleared or
rerendered rows stop their effects; root disposal drains the remaining rows.

Continue to use stable unique keys for predictable row identity. Finite keys are
no longer required as a workaround for this component-list leak. The separate
strict SSR/indexed keyed-list domain still rejects `NaN`; its contract is unchanged.
The old mutation outcomes remain historical; current qualification must report
the actual outcomes of the unchanged threshold probes.

This repair does not make list updates transactional. If a row renderer throws
after earlier rows were replaced, an existing recovery defect can leave stale
DOM on a later update. Dispose and remount that list boundary after such a
rendering failure rather than relying on incremental recovery. Parent disposal
still stops the row effects in the reproduced case.

## Check explicit HTML-runtime declarations

These changes apply to `mountMarkup` and `data-*` runtime markup; the weighted
list cap is not a limit on the component `createList` API.

A `data-computed` name must differ from writable state in the same lexical scope.
A collision is refused with `FORMA_E_UNSUPPORTED` before evaluating the computed
expression, and the original state getter/setter remain intact. Remove a state
placeholder that was intended only for a computed value, or give the derived
value a separate name. Separate lexical scopes may reuse names.

Host values such as `$el` stay opaque to data operations. A host nested inside
data passed to `JSON.stringify`, object enumeration or value-cost accounting
appears only as its public `label`; passing a host directly is still refused.
Supported method calls, coercion and grants are unchanged. Markup that
serialized nested hosts to read anything other than their labels must use a
supported, granted operation instead.

A `data-list` pass is refused with `FORMA_E_BUDGET` when row count multiplied by
row weight exceeds 24,000. Row weight is one plus the template's element and
attribute count, including nested template contents. This admits 12,000 rows of
`<li>{item}</li>` at weight 2, or 1,000 rows at weight 24. For a larger data set,
render a smaller page of rows. The runtime checks the bound before constructing
rows. See [runtime budgets and declarations](../packages/core/docs/HTML-RUNTIME.md).

## Build and verify the deployment

The generated-template CI workflows cache locked Cargo release builds. They can
reuse dependencies after a page-only edit; the application still rebuilds.
Development already reloads accepted page/module snapshots from disk. The
release server continues to use its built deployment artifacts.

Run the application's tests, build and browser/native checks against the new
coordinated set. Check static output, island activation and retained node
identity, later interactions and disposal. If compression is enabled, verify
negotiation and the response policy at the real HTTP boundary. Inspect actual
package and route-size reports rather than inferring them from another app's
benchmark result.

The [Round 2 report](../benchmarks/grand-prix/evidence/2026-10-24/index.html)
retains measured sources, sample spread and failed candidates. Its Linux and
local measurements describe those fixtures and campaigns; the original
throughput estimates are not release guarantees.

For rollback, restore the previously tested source, both lockfiles and matching
assets, manifest and native executable together. An older renderer must not
receive newer-minor output. Preserve previous deployment artifacts only where
the existing retention/security policy permits them.
