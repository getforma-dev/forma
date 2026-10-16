# Stability

What you can build on, what is still moving, and what is known to be broken.

**Stable** means the API and its observable behaviour are not expected to
change, and a change would be a breaking release with a migration note in
`CHANGELOG.md`. **Beta** means it works and is tested, but the shape may still
move. **Experimental** means do not build on it yet. **Deprecated** means it
still works as documented and is removed in the major its row names; a
[development build](#development-builds) logs a coded warning, and an installed
package shows it as `@deprecated` in its types. See
[Deprecated entry points](#deprecated-entry-points).

| Feature | Status | Notes |
|---|---|---|
| Signals (`createSignal`, `createEffect`, `createComputed`, `batch`) | **Stable** | Core primitive. Custom `equals` supported. |
| Reactive introspection (`isSignal`, `isComputed`, `trigger`, `getBatchDepth`) | **Stable** | alien-signals 3.x type guards |
| `h()` / JSX rendering | **Stable** | Function components supported |
| `mount()`, `createShow`, `createSwitch`, `createList` | **Stable** | |
| HTML runtime (`data-*` directives) | **Stable** | CSP-safe expression parser; the grammar is a documented subset — see [HTML-RUNTIME.md](HTML-RUNTIME.md) |
| CSP-hardened runtime | **Stable** | No `new Function` in the artifact — asserted by `scripts/verify-dist.mjs` as the last step of `npm run build` |
| `createStore` (deep reactivity) | **Stable** | Membership changes (`Object.keys`, spread, `for…in`) are not reactive by design |
| Components (`defineComponent`, lifecycle) | **Stable** | |
| Context (`createContext`, `provide`, `inject`) | **Stable** | |
| Islands (`activateIslands`, disposal, triggers) | **3.0 development** | 156 tests across 12 dedicated files †; strict activation and later materialization are integrated, while full size and packed acceptance remain open. |
| `createHistory` (undo/redo) | **Stable** | Takes a `[get, set]` tuple; returns a controls object, not a tuple |
| `createReducer` | **Stable** | |
| `createResource` / `createSuspense` | **Stable** | Abortable; the Suspense boundary is captured at resource creation |
| `createPortal`, `svg()`, `template()` | **Stable** | |
| `trustedHtml()`, the raw-HTML entry every raw sink takes | **Stable** | A plain string at a raw sink, and `h('script')`, are refused: see [Deprecated forms](#deprecated-forms). |
| `data-fetch`, `data-transition:*`, `data-ref` | **Stable** | |
| Tiered mount (`mountMarkup(root, markup, { tier, grants, config })`) | **3.0 development** | Every call names a tier. Omitted grants give none; explicit fetch, DOM and navigate grants bound the handed root. The handle owns update/disposal. See [HTML-RUNTIME.md](HTML-RUNTIME.md#mounting-markup-you-did-not-write-tiers-and-grants). |
| Preview frame runtime (`dist/formajs-frame.global.js`) | **Beta** | New in 2.1.0: the runtime a server writes inline into the opaque-origin preview frame; renders the module its host sends in tier `'unreviewed'`. Its message protocol (`module` in; `ready`, `resize`, `error` out) may still move before 3.0.0. |
| Tierless HTML runtime lifecycle and automatic mounting | **Removed in 3.0.0** | Use `mountMarkup(root, trustedHtml(markup), { tier, grants, config })` and its update/unmount handle. Importing the runtime and DOM changes never bind markup. The obsolete manual attribute grants no authority; development only warns `FORMA_W_MANUAL_MOUNT_REMOVED`. |
| TC39 Signals compat (`State`, `Computed`) | **Beta** | Tracks an evolving TC39 proposal |
| Development build (the `development` export condition) | **Beta** | Each subpath's `development` condition selects a twin under `dist/dev/` that keeps the `__DEV__` warnings; the CDN bundles have none. What the warnings say may change in any release. See [Development builds](#development-builds). |

† The island figure counts literal test declarations (parameterized rows expand
to additional runtime cases) in `activate`, `activate-isolation`,
`activate-reactivate`, `activate-triggers`, `activate-visible`,
`activate-visible-leak`, `deactivate`, `hydrate`, `hydrate-cleanup`,
`list-hydration`, `multi-island-integration` and
`shared-signals-across-islands` under `src/dom/__tests__/`.

Verified by `src/__tests__/docs-truth.test.ts` > "the island coverage figure matches the island test files"

## Removed in 3.0.0

`@getforma/core/server`, `@getforma/core/ssr` and `@getforma/core/wasm` no longer
resolve. Call authenticated Rust routes with `fetch` for server work, render
pages with forma-server, and re-render islands with core's `h()`.
`@getforma/build` rejects `"use server"` directives with `BUILD-808`.
The [pre-removal API documentation](archive/2026-10-15-legacy-apis/STABILITY.md)
is retained for 2.x users.

Verified by `src/__tests__/package-exports.test.ts` > "publishes the exact v3 surface without server functions, WASM or Node SSR"

## Explicit HTML runtime migration

The runtime's `initRuntime`, `destroyRuntime`, `mount`, `unmount`, `reconcile`,
`setDebug`, `setDiagnostics` and `setDirectiveMap` exports are removed in3.0.0.
Use `mountMarkup(root, trustedHtml(markup), { tier, grants, config })`,
`handle.update()` and `handle.unmount()`. The component entry's `mount()` is
unchanged. No automatic scan, body observer or tierless warning path remains.
The obsolete `data-forma-mount="manual"` attribute only produces the development
migration hint `FORMA_W_MANUAL_MOUNT_REMOVED`; production omits that warning.

Verified by `src/__tests__/runtime-explicit-mount.test.ts` > "exports only explicit mount lifecycle and host inspection helpers"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a production build carries neither the grant report nor the obsolete manual-switch warning"

## Development builds

Development-only warnings sit behind `__DEV__`: remaining deprecations,
props the renderer drops, raw-HTML/children ambiguity and a signal's debug name.
Strict hydration refusals and raw-type violations also report in production;
they do not disappear when this flag is false. `__DEV__` is true in a development build, which is one of:

- **The installed package, resolved with the `development` export
  condition.** Each subpath's `import` and `require` branch has a
  `development` key that selects a twin of its file under `dist/dev/`, built
  from the same sources with `__DEV__` folded to `true`; the type declarations
  are shared. Vite's dev server, webpack in development mode, Vitest and
  Bun's bundler set the condition themselves (Bun's even in a minified build,
  unless given `--production` or `NODE_ENV=production`, and Vitest in every
  test run unless told otherwise); esbuild, Rollup and Node set it only when
  told to (`conditions: ['development', 'module']`, `exportConditions`,
  `node --conditions=development`); `@getforma/build` sets it in watch mode.
  See [CDN-AND-EXPORTS.md](CDN-AND-EXPORTS.md#development-build), which has
  every resolver checked and how to keep a Vitest suite on production.
- **Core compiled from its source**: in Node with `NODE_ENV` other than
  `production`; in a browser bundle of the source, which has no `process`, only
  with the global `__FORMA_DEV__` set.

Everything else is a production build and logs none of these development-only warnings: the installed
package resolved without the condition (the files under `dist/` but
`dist/dev/`), and every CDN bundle. **The CDN bundles have no development
build**: `formajs-runtime.global.js`, its hardened and short-named copies, and
`forma.esm.js` exist in their production form only, so a page that loads core
from a CDN gets none of these warnings. To see them, install the package and
build with a bundler in development.

Verified by `src/__tests__/development-build.test.ts` > "every subpath resolves to production files without the condition and to their development twins with it"
Verified by `src/__tests__/development-build.test.ts` > "a process resolving with the development condition loads one copy of core, and it is the development build"
Verified by `src/__tests__/development-build.test.ts` > "a process resolving without the condition loads one copy of core, and it is the production build"

## Deprecated forms

The A2 warning bridges are removed in 3.x (DR-19). These forms are refused
in development and production before writing to a DOM sink:

| Form | Code | Instead |
|---|---|---|
| A string as `dangerouslySetInnerHTML`'s `__html` | `FORMA_E_RAW_INNER_HTML` | `{ __html: trustedHtml(markup) }` |
| A string to `setHTMLUnsafe()` | `FORMA_E_RAW_SET_HTML` | `setHTMLUnsafe(el, trustedHtml(markup))` |
| A string to `template()` or `templateMany()` | `FORMA_E_RAW_TEMPLATE` | `template(trustedHtml(markup))` |
| A string to the runtime's `reconcile()` | `FORMA_E_RAW_RECONCILE` | `reconcile(container, trustedHtml(markup))` |
| A string as a `srcdoc` value | `FORMA_E_RAW_SRCDOC` | `srcdoc: trustedHtml(markup)` |
| `h('script')` | `FORMA_E_SCRIPT_ELEMENT` | A script in the page, or a module the build bundles |
| `data-bind:srcdoc`, or `{item…}` in a list row's `srcdoc`, in the HTML runtime | `FORMA_E_RUNTIME_SRCDOC` | The frame built with `h()` and `trustedHtml(markup)` |

Each raw sink refuses strings, look-alikes and `String` objects with a coded
TypeError. Native Trusted Types adds browser enforcement; Forma retains the
typed boundary in engines without it ([`../CSP.md`](../CSP.md#trusted-types)). A page that refuses one of core's two
policy names (its `trusted-types` directive does not list it, or another script
created it first) makes core write markup as strings, which it then refuses; a
development build logs `FORMA_W_TT_POLICY_REFUSED` once for each name.

Children given beside `dangerouslySetInnerHTML` (a function, or a value that is
not `null`, `undefined` or `false`) log `FORMA_W_INNER_HTML_CHILDREN` once in a
development build, from h() or from adoption. Ordinary h() retains its existing behavior; strict
adoption validates matching raw content as opaque and binds none of the
children beside non-null markup. An initial null/false value permits fallback
children. Compiler raw-content parity is separate qualification; give the
element one content source.

Verified by `src/dom/__tests__/trusted-html.test.ts` > "every raw sink refuses strings before parsing, including an already cached trusted value"
Verified by `src/dom/__tests__/trusted-html.test.ts` > "h refuses script elements in every HTML spelling before construction"
Verified by `src/dom/__tests__/trusted-html-build.test.ts` > "production artifacts retain refusal codes and strip development-only warnings"
Verified by `src/dom/__tests__/trusted-html.test.ts` > "a refused policy name warns once in development, and the sinks then write strings the page refuses"
Verified by `src/dom/__tests__/adopt-inner-html.test.ts` > "children beside the prop warn once in development, in h() and in adoption, and a falsy prop does not"
Verified by `src/__tests__/runtime-srcdoc.test.ts` > "a list row's srcdoc is refused with its binding code"

## About the numbers on this page

There is exactly one, and a test recomputes it from disk on every run: if
someone adds or deletes an island test, the build fails until this table
agrees. That is the only kind of number worth putting in a document — every
other row here is a statement about *behaviour*, which is what a stability
table is for.

[`PERFORMANCE.md`](PERFORMANCE.md) preserves measured historical baselines
with their noise floors. The strict-adoption benchmark fixtures have changed;
those old timings are not current 3.0 measurements or a cross-version comparison.
