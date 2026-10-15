# Template rendering modes

A route declares `Browser` or `Ssr` in its manifest. Browser routes use
`render_browser_shell`. SSR routes load through `load_ir_modules`, bind a
`PageHandle<Props>` once, and render typed values per request. Every SSR route
must be bound when the application calls `pages.finalize()` before listening.
A failed SSR render returns a coded error; it never selects the browser mode.

Minimal declares `HomeProps { count: number }` in its same-file TypeScript
page and a matching derived Rust struct. `build:ssr` emits actual FMIR and
Rust supplies7 to Counter through the declared state contract. Its unary
Counter owns the signal; the authenticated native root mount is removed from
the browser product. An explicit Browser build retains its independent zero
default. About has empty props and no islands: its native route retains IR
and CSS while publishing no JavaScript. Server markup alone does not prove
zero-write adoption; the packed activation checks qualify that separately.

Dashboard retains an explicit Browser route for every page. It has no compiler
dependency and no SSR build command. Its API-backed client behavior has not
been migrated to declared server props in slice 1.

The compiler reads source rather than executing it. Unsupported constructs
refuse with mandatory codes; strict builds also reject advisory diagnostics. Consult the maintained
[compiler contract](../../compiler/README.md) before introducing new shapes.
The dated A2 rendering measurements and old API guidance are preserved in
[the template migration archive](../../../docs/archive/2026-10-15-template-slice1/README.md).

Verified by: `tests/templates.test.ts` > "declares the same count prop in its page and Rust handler with a distinct server seed"
Verified by: `tests/templates.test.ts` > "binds declared props once, finalizes before listening, and never falls back after an SSR failure"
Verified by: `tests/templates.test.ts` > "validates and finalizes browser routes before serving explicit browser shells"

Verified by: `tests/template-islands.test.ts` > "scaffolds a declared Counter and a separate truly static native page"
Verified by: `tests/template-islands.test.ts` > "pairs actual Counter metadata with its native module and never mounts the native page in JavaScript"
