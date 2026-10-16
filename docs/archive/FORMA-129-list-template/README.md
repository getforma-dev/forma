# Nested list template scope

The actual strict-CSP Chromium matrix showed a correct visible list model plus an incorrect unresolved-item diagnostic. Snapshot traversal skipped the detached row root but still bound its nested descendants, whose parent was that detached root, against the parent scope. All four dedicated tests failed before correction.

After checking membership in the captured scope root, document, detached DocumentFragment and shadow-root cases render/edit/update the nested keyed model without bogus diagnostics and retain the live node. A real forbidden constructor expression still reports KEY_DENIED. The focused corrected invocation passed22tests including existing failure semantics and expression residuals. Browser matrix replay remains a separate gate.
