# Original shipped CSP example

The original example loads the hardened IIFE before its declarative markup but never owns a mount. With the explicit runtime it remains inert. This byte-exact source is retained as an actual browser negative control alongside the corrected live example, which retains the identical self-only CSP and existing counter, filter and class-toggle expressions. No production runtime is changed. Browser qualification is recorded separately after exact source review.

The first real three-engine run at4311d539 passed the original-inert controls but failed each live counter assertion: the named mount root was also the state element, so its innerHTML omitted the state attribute. The mount contract renders markup under the root. The correction adds an outer named main container and preserves the original state div and every expression. Exact first HTML/owner/test, raw reports and all3 failure contexts remain here. No production behavior changes.
