# Native walk and real-file test migration, 2026-10-15

These two files preserve exact Git bytes from `8c907ab64758ae71e279f66497b6c7aa5253ec9e`. The adjacent manifest records every original SHA-256 and byte length. They are historical assertions, not current product promises. Their active counterparts had 24 failures and 152 passes before this migration. All 176 test cases remain active; the 152 previously passing cases retain their assertions.

| Historical assertion family | Current assertion |
| --- | --- |
| Unknown spreads, computed tags, calls, unresolvable components and missing list mapper produce empty island shells | The same source and resolver context must throw `BUILD-610`, naming the unsupported construct where available. No registered identity is invented. |
| Inline depth limit and direct/mutual recursion terminate in shells | The existing depth and visited-set controls plus the actual A → B → A traversal terminate in a coded refusal. The adjacent depth-2 positive remains unchanged. |
| Imported runtime/mutated/shadowed/cyclic table degrades to a shell | Compilation refuses. Existing construct, source-module, non-static reason, lexical-shadow and cycle diagnostics remain asserted. Static imported tables and aliases retain their existing positive controls. |
| Unresolved untyped destructuring default emits a shell for `tone` | The same unsupported untyped inline path refuses. The old test never rendered the fallback `'plain'`; this does not remove a previously working default-value promise. Existing resolved call-site, destructuring and scope controls remain. |
| An arbitrary `islandNames` set supplies identity | A real source file with an actual literal `activateIslands({ Card })` registration supplies the empty declared schema and SSR contract. The original article/body/island boundary opcode assertions remain, with binary invariants also checked. |
| A local `.tsx` signal is copied into island inputs | Its CLIENT source, exact numeric default and actual dynamic-text operand remain asserted; the empty declared schema supplies zero ordered inputs. |
| A captured store getter becomes a serialized island prop | Page and island still share exactly one CLIENT slot, its default and distinct text markers. The capture does not become a per-instance prop or seed. |

The migration changes tests and this archive only. It changes no compiler/native production implementation, wire format, fixture binary or browser behavior. These controls do not claim end-to-end head-state/browser qualification; that has separate native/browser transport evidence.
