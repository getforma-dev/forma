# Attribute alias transition

The original FORMA-139 archive and its manifest remain byte-for-byte intact.
Two unchanged near-miss sources use `htmlFor`; the corrected compiler emits
`for`, so their native IR legitimately changes. This ledger names both old
and new hashes, authenticates the same source bytes, and pins the regenerated
IR. Every other near-miss still requires its original hash.

The full prior `html-context.test.ts` is retained here before its expectation
migration. Its identical `type` duplicate is now an explicit BUILD-610
refusal, paired with a single-hidden-input admission. Production still
refuses every repeated normalized native attribute name.

Compiler source: 939961cde6b89c91489fc75a0fddabc606d1fc77.
The manifest records the exact built compiler hash used for regeneration.
