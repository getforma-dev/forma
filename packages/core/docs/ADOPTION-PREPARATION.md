# Staged private adoption content helpers

These FORMA-104 helpers are source-private preparation infrastructure. They are
not a new public API or a claim that the pending adopter switch is complete.
Ordinary `h()`/CSR and the currently exported direct hydration implementation are
unchanged by this helper checkpoint.

Preparation validates already-read CSS and typed raw markup without repairing
served content, installing readers or invoking effects. CSS uses the existing
per-declaration parser/writer; later writes cache the actual CSSOM result, because
an invalid declaration can leave an older valid declaration in place. Raw HTML
keeps the `trustedHtml()` policy at detached and live sinks. HTML templates own
their content fragment: the caller must snapshot it before component execution,
and clearing it invokes owned teardown only when content is present.

**HTML `noscript` limitation.** Non-null/non-false raw markup on an HTML `noscript`
target receives `FORMA_E_HYDRATE_STRUCTURE`, after the ordinary typed-markup
check. This applies both during preparation and to a later raw transition from
fallback. Null/false initial fallback remains untouched; a later null/false clear
remains supported. Plain strings still receive the existing raw-policy refusal.

The inert validation document cannot establish the target document's scripting
mode. That mode changes noscript fragment parsing between raw text and parsed
content. The helper neither infers it from `defaultView` nor parses inside the
live document. It therefore reports an explicit unsupported context rather than
a false value mismatch or a repair. This limitation does not assert that the
compiler already refuses this source shape; the pending FORMA-101 subset policy
remains separate. See the [HTML fragment parsing algorithm](https://html.spec.whatwg.org/multipage/parsing.html#html-fragment-parsing-algorithm).

Controls: `review-content.test.ts`, `review-content-template-native.spec.ts`,
`review-content-noscript-native.spec.ts` and the strict CSP/Trusted Types cases in
`adoption-content.spec.ts`. Original reviewer failures are retained in the
external FORMA-104 evidence directory.
