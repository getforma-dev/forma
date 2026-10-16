# Pre-attribute-values originals (FORMA-182 findings F2 and F3)

Frozen from the `sourceCommit` in `manifest.json` (branch `forma-182-attribute-values`, before
rule 6's attribute table: [parity rules](../../parity-rules.md)). `manifest.json` authenticates
every file here by byte count and SHA-256; `ledger.json` records the before and after hash of each
live file regenerated from them. Nothing here is regenerated to make a new implementation pass.

## What is here

- `js-emitter/`: the contract corpus outputs the attribute table changes.
  - F2 (the walker writes a `true` bare only on an HTML boolean attribute, the word `"true"`
    elsewhere, as `h()` does): `jsx-page.html` (`data-live`) and `sub-component-scopes.html`
    (`data-ready`). Their `.ir` and `.dump` are unchanged; only the walker's render is.
  - F3 (an attribute whose server value is the empty string is written, not dropped): the
    `dynamic-attrs` module, whose `value: () => query()` over `createSignal('')` is now a static
    `value=""` (`.ir`, `.dump`, `.html`). The fixture source's comment about the `query` binding
    was rewritten in place, on the same lines, so no source position moved.

`packages/compiler/tests/attribute-values-archive.test.ts` checks the manifest and the ledger
against the archived and live bytes.
