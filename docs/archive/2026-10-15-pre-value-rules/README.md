# Pre-value-rules originals (FORMA-182 rules 6 and 7)

Frozen from the `sourceCommit` in `manifest.json` (branch `forma-182-rules-2-7`, before the
compiler refused a boolean in text and a condition that is not boolean-typed). `manifest.json`
authenticates every file here by byte count and SHA-256. Nothing here is regenerated to make a
new implementation pass.

## What is here

- `sources/`: the inline test programs that the value rules ([parity rules](../../parity-rules.md),
  rules 6 and 7) now refuse, so their tests were migrated. The tests composed them from
  fragments; each file is the exact composition the compiler saw, except the `ir-walk-*`
  pair, which the low-level walk read as two separate fragments, kept as they were.

## Migration map

| Archived source | Was | Now | Code |
|---|---|---|---|
| `sources/props-bindings-declared-boolean-child.page.ts` (+ `declared-page.app.ts`) | a declared page ending with the bare child `p.ok` (`ok: boolean`), asserted to write nothing | the same page without that child, `tests/props-bindings.test.ts` > "uses declared values in createShow branches and direct or nested ternaries" | the archived form refuses with BUILD-614 |
| `sources/ssr-emission-inline-mount-boolean-child.app.ts` | an inline-mount entry reading the boolean signal `open` as text, `h('i', null, () => open())`, to name its slot | `open` read by an attribute, `h('i', { hidden: () => open() })`; the slot names and defaults asserted are unchanged, `tests/ssr-emission.test.ts` > "names signal slots on an inline-mount entry" | BUILD-614 |
| `sources/ir-walk-zero-number-condition.declarations.ts` + `.expression.ts` | the low-level walk of `h('div', null, () => count() ? 'some' : 'none')` with `count` defaulting to `0`, asserted to give the SHOW_IF slot the default `false` (the walk read the two fragments separately; the archive test composes them into a page) | the test reads `!!count()`, a boolean, and asserts the same default, `tests/ir-walk.test.ts` > "writes false when the condition evaluates falsy, including a zero number read through !!" | BUILD-615 |

`packages/compiler/tests/value-rules-archive.test.ts` reads the archived sources and pins each
refusal code, so the historical evidence stays executable.
