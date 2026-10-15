# Paired declared island emitter fixtures

These are new FORMA-103 fixtures, separate from the archived pre-contract corpus.
`packages/compiler/tests/island-emission.test.ts` contains their complete fixed
TypeScript source programs and verifies every byte against these files on each
ordinary run. `crates/forma-ir/tests/island_emitter.rs` parses these exact files
and checks native HTML and projected per-occurrence state.

Cases cover ordered repeated fields, optional nullish local seeds, nested list
row snapshots, closed aggregate projection and browserOnly's empty native host.
The closed-nullish case also pairs omitted/null call inputs with fallback seeds
and verifies that zero, false and empty strings remain values. The optional-root
case proves `props?.count` on a declared, non-null props root has exactly the
same wire identity as `props.count`, retaining 1001 and defaulting only nullish
values. Nullable intermediate accesses and optional calls still refuse.
Local aggregate controls cover nested LIST values, shared module seeds, unused
constants and each row's declared island input. The aggregate fallback control
keeps an empty array and keyed object rows; a nested closed nullish projection
folds before COALESCE rather than inventing schema provenance.
No timestamps, absolute temporary source paths or generated call IDs occur in
the contract digest. The current binary hashes are in `manifest.json`.

## Key paths (FORMA-181 checkpoint A)

The four cases whose source contains `createList` (`rows`, `local-inputs`,
`local-aggregates`, `aggregate-fallback`) carry FMIR section `0x0006` with one
entry per LIST. `local-aggregates` and `aggregate-fallback` were migrated from
scalar keys (`t=>t`, `r=>r`) to object rows keyed by `id`; `rows` and
`local-inputs` kept their source. The pre-181 binaries are byte-exact in
`unkeyed/` (see its README) and in `docs/archive/2026-10-15-pre-keyed-rows/`,
whose `ledger.json` records each before/after hash. The native suite proves the
keyed and unkeyed `rows`, `local-inputs` and `aggregate-fallback` modules render
identical HTML and state, and that no `data-forma-key` is written at this
checkpoint.

Intentional regeneration uses the compiler test's explicit
`FORMA_EMITTER_PROBE_DIR` output directory; ordinary runs never write fixtures.
Run the native paired suite after regeneration. This does not update any of the
14 historical HTML goldens or 67 frozen reader-refusal inputs.
