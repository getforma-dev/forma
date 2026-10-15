# Template rendering modes

A route declares `Browser` or `Ssr` in its manifest. Browser routes use
`render_browser_shell`. SSR routes load through `load_ir_modules`, bind a
`PageHandle<Props>` once, and render typed values per request. Every SSR route
must be bound when the application calls `pages.finalize()` before listening.
A failed SSR render returns a coded error; it never selects the browser mode.

Minimal declares `HomeProps { count: number }` in its same-file TypeScript
page and a matching derived Rust struct. `build:ssr` emits actual FMIR and
Rust supplies the count. Its whole-page browser mount still starts at zero,
matching the example handler. Island state adoption remains a later
FORMA-144 slice; server markup alone does not prove persistent client state.

Dashboard retains an explicit Browser route for every page. It has no compiler
dependency and no SSR build command. Its API-backed client behavior has not
been migrated to declared server props in slice 1.

The compiler reads source rather than executing it. Unsupported constructs
are diagnosed under strict builds. Consult the maintained
[compiler contract](../../compiler/README.md) before introducing new shapes.
The dated A2 rendering measurements and old API guidance are preserved in
[the template migration archive](../../../docs/archive/2026-10-15-template-slice1/README.md).

Verified by: `tests/templates.test.ts` > "declares the same count prop in its page and Rust handler, with matching initial browser state"
Verified by: `tests/templates.test.ts` > "binds declared props once, finalizes before listening, and never falls back after an SSR failure"
Verified by: `tests/templates.test.ts` > "validates and finalizes browser routes before serving explicit browser shells"
