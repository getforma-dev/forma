# FORMA-103 state-contract expectations

`state-expectations.tsv` extends the FORMA-112 window policy without changing
`index.tsv`, `window-expectations.tsv`, or any of the 67 frozen input files.
Only `PASS-good-b.ir` and `PASS-positions-absent.ir` change from PASS to LOAD-105: both
are otherwise-valid historical island modules without the now-required section 10.
They must be rebuilt by the current compiler. Static modules remain accepted.

Existing structural checks run before conditional section-10 validation. In
particular, malformed key paths and source positions retain their original
LOAD-103 result even when the same legacy module also lacks section 10. The
current Rust reader and server before-bind test use this explicit policy overlay.
The original tables continue to document the exact-stage and window-only policies.
