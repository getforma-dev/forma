# Paired declared island emitter fixtures

These are new FORMA-103 fixtures, separate from the archived pre-contract corpus.
`packages/compiler/tests/island-emission.test.ts` contains their complete fixed
TypeScript source programs and verifies every byte against these files on each
ordinary run. `crates/forma-ir/tests/island_emitter.rs` parses these exact files
and checks native HTML and projected per-occurrence state.

Cases cover ordered repeated fields, optional nullish local seeds, nested list
row snapshots, closed aggregate projection and browserOnly's empty native host.
The closed-nullish case also pairs omitted/null call inputs with fallback seeds
and verifies that zero, false and empty strings remain values.
No timestamps, absolute temporary source paths or generated call IDs occur in
the contract digest. The current binary hashes are in `manifest.json`.

Intentional regeneration uses the compiler test's explicit
`FORMA_EMITTER_PROBE_DIR` output directory; ordinary runs never write fixtures.
Run the native paired suite after regeneration. This does not update any of the
14 historical HTML goldens or 67 frozen reader-refusal inputs.
