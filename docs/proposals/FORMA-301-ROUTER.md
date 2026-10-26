# FORMA-301: optional router decision and experiment

Status: target design with an internal native feasibility implementation.
Baseline: published Forma 3.1.0, commit
`9a570afece5eb5091824422f00134a875310e857`.

The authoritative architecture is the design-doc-factory `forma-router` task,
delivery `v1`, tag `task/forma-router/v1`. Read its `design.md`, `api-protocol.md`,
research map, acceptance matrix and review/evidence bundle together. This pointer
does not replace or rewrite the historical Forma Stack v2/v3 documents.

The selected product boundary is a separate optional `@getforma/router`, using
core as a peer and released with the coordinated stack after qualification.
Navigation is not added to the default core API. Compiler/build authenticates
registration groups; Rust retains typed rendering, authorization and response
policy; the router owns browser history and navigation/mutation lifetimes.

Initial scope includes browser, generated-HTML and typed native adapters;
ranked explicit routes; nested/persistent owners; accessibility/history; and
enhanced forms with one managed mutation and authoritative revalidation.
Independent fetchers, optimistic state, general data caching/streaming and lazy
executable graph transport remain deferred. No fetched script is replayed and no
uncertain mutation is automatically retried.

The [experiment](../../experiments/forma-router/README.md) establishes native
transport/adoption and a real form handler without exporting a public API.
Its static shell does not satisfy the proposed nested owner contract. The
production implementation must partition initial claims, prevent child outlets
inside island-owned subtrees, capture hosts permanently per owner, and prove
retained-prefix/departing-suffix behavior before exposing native routing.

The ticket remains open through packed-consumer, resource/performance, complete
browser and bounded pilot qualification. Forma 3.1.0 release records remain
historical; this work neither reopens that release nor claims a new stable feature.
