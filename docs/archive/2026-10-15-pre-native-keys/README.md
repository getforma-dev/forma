# Pre-native-keys original (FORMA-181 checkpoint B)

Frozen from `330b65a5443c61676969eaa089e3aaa2c914d054` (the integration branch at
`f2e7a4e` plus the key-text seam wiring) before the walker consumed FMIR section `0x0006`
and wrote `data-forma-key` on every keyed row. `manifest.json` authenticates the file here by
byte count and SHA-256. Nothing here is regenerated to make a new implementation pass.

## What is here

- `js-emitter/list-same-source.html`: the js-emitter contract golden
  (`crates/forma-ir/tests/fixtures/js-emitter/list-same-source.html`) as the walker rendered
  it before checkpoint B. It is the only committed rendering of a keyed list the native suite
  pins as a golden: the four native `island-emitter` list fixtures are asserted in
  `crates/forma-ir/tests/island_emitter.rs` against their `unkeyed/` controls, not against
  stored HTML, and the forma-server fixtures assert counts, not bytes.

## What changed and what did not

`ledger.json` records the before/after hash of the regenerated golden and, for the record,
the unchanged hashes of the case's `.ir`, `.dump` and `.state.json`: the compiler did not
change at checkpoint B, so the module bytes and canonical dump are the same, and keys are not
part of the state envelope, so the state snapshot is the same. The golden gained one
`data-forma-key` per row of both lists, carrying the identity the contract harness now feeds
at each list's key path (`todos[n].id`, `todos#2[n].id`), and nothing else moved.

`packages/compiler/tests/keyed-list-archive.test.ts` reads this ledger and manifest and pins
the live file at `after`, the archived file at `before`, and that exactly one file changed.
