# Pre-key-adoption test originals (FORMA-181 checkpoint C)

Frozen from `2c7d4f6849f5ff82cc5f245df09894cc2ce7a898` (the integration branch with checkpoint
B merged) before strict adoption began binding keyed rows by key. `manifest.json` authenticates
each file by byte count and SHA-256; `packages/core/src/dom/__tests__/adoption-keyed-list.test.ts`
> "keeps every archived original byte-exact under its manifest" checks it. Nothing here is edited
to make a new implementation pass.

## What changed on purpose

Checkpoint C retires the pre-181 initial key-order limitation and FORMA-123's count check as the
criterion for keyed rows. Five cases in three files changed their expectation; every other case
in them is unchanged.

| File | Original case | Now |
| --- | --- | --- |
| `adoption-list.test.ts` | "retains the explicit pre181 key-order limitation without moving mismatched rows" (refused `FORMA_E_HYDRATE_STRUCTURE`) | "binds reversed served keys to their own rows without moving them": adopts, zero records |
| `list-adoption-count.test.ts` | "keyed initial count mismatch refuses without removing or replacing any server row" (`FORMA_E_HYDRATE_LIST_COUNT`) | same name; `FORMA_E_HYDRATE_KEY`, still no row removed |
| `list-hydration.test.ts` | "refuses extra/missing initial keyed rows without repairing them" (`FORMA_E_HYDRATE_LIST_COUNT`) | same name; `FORMA_E_HYDRATE_KEY` |
| `list-hydration.test.ts` | "refuses initial reordered keys and preserves later supported reordering" (`FORMA_E_HYDRATE_STRUCTURE`) | "adopts initial reordered keys in place and reconciles only on a real update" |
| `list-hydration.test.ts` | "refuses a duplicate initial data-forma-key row without dropping a ghost" (`FORMA_E_HYDRATE_LIST_COUNT`) | same name; `FORMA_E_HYDRATE_KEY` |

Unkeyed rows keep `FORMA_E_HYDRATE_LIST_COUNT` and every assertion about it.
