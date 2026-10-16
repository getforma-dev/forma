# Corpus migration to mandatory native admission

These are the exact sources and committed IR, dump, HTML and state products from
`b037644` (reviewed list-source/main synchronization, attribute values and expanded
parity dependencies), before the remaining FORMA-101 strict publication change.
`manifest.json` authenticates every original; `ledger.json` records the real
compiler/native-consumer migration once regenerated.

The old `dynamic-attrs` unknown `docsHref` getter has no native value. It remains
an executable BUILD-206 negative; the live page uses `createSignal('/docs')`, so
both renderers receive a real closed href. This does not introduce an evaluator.

The old `sub-component-scopes` duplicate `count` getter remains an executable
BUILD-503 negative. The live panel uses `panelCount`, preserving its actual
numeric default and the truthy show branch. BUILD-503 has not been removed or
downgraded, and this migration does not claim independent scope proof.

The compiler's strict-corpus tests run these originals through the production
plugin with `strict:false`, require the exact refusal and original location, and
check that no product was published. Every live cross-language corpus page must
have a native product with zero error diagnostics; the emission script enforces
the same requirement before writing any module.
