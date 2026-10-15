# Pre-keyed-rows originals (FORMA-181 checkpoint A)

Frozen from `bb6435f4e8ab867cf187a93cc746e0aa1a689313` before the compiler proved list key
paths and emitted FMIR section `0x0006`. `manifest.json` authenticates every file here by byte
count and SHA-256. Nothing here is regenerated to make a new implementation pass.

## What is here

- `island-emitter/`: the complete native paired fixture directory
  `crates/forma-ir/tests/fixtures/island-emitter/` as it was (twelve `.ir`, the registration
  JSON, `manifest.json`, `README.md`). Eight of the twelve binaries are unchanged by FORMA-181;
  the four whose source contains `createList` (`rows`, `local-inputs`, `local-aggregates`,
  `aggregate-fallback`) now carry section 6 and are regenerated intentionally. The four
  originals also live beside the live fixtures as
  `crates/forma-ir/tests/fixtures/island-emitter/unkeyed/`, where the native suite keeps
  reading them as exact low-level unkeyed inputs.
- `js-emitter/`: the `list-same-source` contract corpus outputs (`.ir`, `.dump`, `.html`,
  `.state.json`). Only the `.ir` and `.dump` change (section 6 and its string-table entry);
  `.html` and `.state.json` are byte-identical after regeneration because checkpoint A does
  not render keys.
- `sources/`: the inline test programs that FORMA-181 either migrates or now refuses. The
  tests composed them from fragments; each file is the exact composition the compiler saw.

## Migration map

| Archived source | Was | Now | Code |
|---|---|---|---|
| `sources/adoption-conditional-row-root-conditional.tsx` | list row `r=>r.live?h('li',…):null` (a conditional as the row root) | the same conditional inside a stable `<li>` root, `tests/adoption-conditional.test.ts` | the archived form refuses with BUILD-613 |
| `sources/adoption-conditional-direct-row-conditional.tsx` | the direct row-root conditional whose description was asserted | the conditional is the first child of the stable row root; the same lazy reads are asserted on it | BUILD-613 |
| `sources/island-emission-local-aggregates.island.ts` (+ `.page.ts`, `island-emission.app.ts`) | inner list `createList(()=>r.tags,t=>t,…)` over scalar tags, keyed by the row itself | `tags` are `{id}` objects keyed by `t.id`; `crates/forma-ir/tests/fixtures/island-emitter/local-aggregates.ir` regenerated | BUILD-612 |
| `sources/island-emission-aggregate-fallback.island.ts` (+ `.page.ts`) | `rows?:string[]` keyed by `r=>r` with scalar row hints | `rows?:{id:string}[]` keyed by `r.id`; `aggregate-fallback.ir` regenerated; the archived unkeyed binary keeps its scalar-row native assertions in `unkeyed/` | BUILD-612 |
| `sources/props-bindings-scalar-key.ts` | `createList(() => p.text, r => r, …)`, asserted as a BUILD-610 unrepresentable binding | the same string-source refusal is asserted with a keyed row (`r => r.id`); the archived scalar key is asserted separately as BUILD-612 | BUILD-612 |

The regenerated outputs and their before/after hashes are recorded in `ledger.json` next to
this file. `packages/compiler/tests/keyed-list-archive.test.ts` reads the archived sources and
pins each refusal code, so the historical evidence stays executable.
