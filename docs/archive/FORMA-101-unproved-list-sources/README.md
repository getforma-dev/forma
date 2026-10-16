# FORMA-101 native LIST source migration

These originals are byte-exact from `215e61f52013220be493dfb319f78bdbcfa1889b`
(the earlier conformance sources are unchanged from `6d995f0`). `manifest.json`
authenticates each archived file; `ledger.json` records each live migration.

BUILD-616 only proves that core cannot call a source. A callable source alone
cannot supply native rows: an arbitrary getter such as `() => [...]` or a derived
`items().filter(...)` previously emitted an empty default list. BUILD-610 now
requires a declared array prop or closed literal-default signal, read through a
getter binding or explicit callback. Mutable/opaque sources are refused by that
native contract without falsely reporting that they are non-callable.

The live `list-same-source` corpus uses `createSignal` with two records and two
independent LIST projections. The real Rust consumer renders four keyed rows,
including their title and owner values. Its IR, dump and HTML are regenerated;
its state snapshot and all thirteen other corpus modules stay byte-identical.
Earlier F1 and keyed-row ledgers now pin this preserved pre-101 stage; this
ledger pins the current stage. The original inputs remain refusal regressions.

Conformance near misses for BUILD-107/612/613/616/701 and the imported-core alias
proof now also use real two-row defaults. The old BUILD-303 number stays retired.
