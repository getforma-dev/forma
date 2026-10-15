# Pre-F1 list source (FORMA-183 finding F1, fixed under FORMA-181)

Frozen from `49c614619d1a43f92620b532fa046182d8026952` (the integration branch) before the
compiler began refusing a `createList` source it can prove is not a function (BUILD-614).
`manifest.json` authenticates each file by byte count and SHA-256; nothing here is edited to
make a new implementation pass.

## What is here

- `sources/list-same-source/page.ts` and `app.ts`: the js-emitter contract corpus case
  (`packages/compiler/tests/fixtures/ir-corpus/list-same-source/`) as it was. Its two
  `createList(todos, …)` calls passed the array `todos` itself. The compiler admitted it (the
  page's list array is a named SERVER slot, so the module never evaluates the source), but core
  3.0's `createList(items, …)` calls `items()`, so the page failed in the browser with
  `items is not a function` (FORMA-183's parity harness, finding F1).

## What changed and what did not

`ledger.json` records the before/after hash of each file. Only `page.ts` changed: its source is
`const todos = () => [...]`, the same rows behind a function. The case's `.ir`, `.dump`, `.html`
and `.state.json` are byte-identical, because the function source compiles to the same module.

The archived page stays executable evidence:
- `packages/compiler/tests/list-source-archive.test.ts` compiles it and asserts BUILD-614 at its
  first list;
- the parity harness's error-verdict test renders it as the twin core cannot build
  (`e2e/parity/tests/render-both.test.mts`).
