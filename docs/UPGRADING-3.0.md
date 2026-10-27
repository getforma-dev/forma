# Upgrading to Forma 3.0

> Historical maintainer migration notes. New applications start directly with
> Forma 3.2.0 using the [scaffolder](../packages/create-app/README.md) and
> [current documentation](README.md). This is not an onboarding sequence.

This guide describes the published coordinated 3.0.0 APIs. See the [as-built summary](release/V3-AS-BUILT.md) for actual publication and qualification. It explains an application upgrade; it does not claim that any external application has already migrated.

## Move the coordinated set

Forma now ships from one repository as seven packages at one release version: `@getforma/core`, `@getforma/compiler`, `@getforma/build`, `@getforma/create-app`, `forma-ir`, `forma-ir-derive` and `forma-server`. Move the application’s direct dependencies and their matching dependency closure together, commit the npm and Cargo lockfiles, and rebuild both assets and server. Stable template manifests use caret requirements; prerelease manifests and the tested archive locks remain exact. Use Node 22 and Rust 1.85 or newer for the templates; repository qualification uses the pinned Node 24 toolchain.

FMIR 3 and manifest schema 2 replace the prior wire formats. Within a major, a reader accepts writers of its own or an older minor; upgrade the renderer first, then compiler/build/core. Patches do not restrict that window. This rule does not make a mixed major or unrelated prerelease compatible. See the [compatibility contract](compatibility.md), and start template migrations with [the preserved-source comparison](../packages/create-app/docs/UPGRADING-3.0.md).

The removed `@getforma/core/server`, `/ssr` and `/wasm` subpaths no longer resolve. Use authenticated application routes for server operations and forma-server for native rendering; `"use server"` is refused by the build. See [the public surface and removed forms](../packages/core/docs/STABILITY.md).

## Bind typed server pages before listening

Replace the A2 module maps, per-request SlotData and `try_render` calls with declared TypeScript props and derived Rust handlers. Startup calls `load_ir_modules`, binds every SSR route with `pages.bind::<Props>` or `bind_with`, then calls `pages.finalize()` before the application's listener. A refused module, incompatible handler or unbound SSR route stops that startup path. Failed finalization is repairable; successful finalization seals every clone and refuses further binds. Handles return RENDER-406 until finalization succeeds.

The original startup helpers now return errors: `assets::load_manifest::<A>()` returns `Result<AssetManifest, String>`, `assets::asset::<A>(name)` returns `Result<String, String>`, and both `CspNonce::generate()` and `generate_csp_nonce()` return `Result<CspNonce, NonceError>`. Propagate these results with `?` or handle the error before starting the server or constructing a response. Missing/non-UTF8 assets, invalid manifests and a failed nonce draw no longer panic through these names. Existing `try_asset`, `try_load_manifest` and `CspNonce::try_generate` callers keep their fallible signatures as compatibility aliases.

A request calls `handle.render(&props, &RenderCtx::new())` and handles the returned `Result<PageResponse, RenderError>`. Return the PageResponse through the framework response adapter so its HTML, nonce, policy and no-store headers stay together. Log/respond to errors in the application; never turn an SSR error into a browser shell. `into_parts_unchecked` remains the explicitly named exit for integrations that need response parts.

`Limits` aliases the existing WalkLimits. Defaults remain 8 MiB of walked HTML and 50,000 list iterations. `bind_with` sets an immutable page default; a context without an override inherits it. `with_limits` overrides the pair for that request only. Zero is restrictive. Error counts and timing describe the walker; props checking/conversion and document assembly take additional time. Measure the complete handle call before choosing a blocking-pool policy. Forma does not spawn rendering threads.

Move per-request document extensions to RenderCtx: title/body class, typed policy/head/preload settings, `with_config_json(Value)`, `with_personality_css(String)` and `with_body_prefix(RawHtml)`. JSON and CSS retain their existing escaping. RawHtml still requires the reviewed constructor. A handler accepts neither a caller nonce nor executable config script. Public PageConfig now contains only browser document metadata, with no module, slots or render-mode selector.

An explicit `ssr: false` route may use `render_browser_shell`; the route must exist and be declared Browser. Removed APIs are `try_render`, `render_page`, `render_page_with_nonce`, PageOutput, `load_ir_modules_strict`, public IrModules/RenderMode and the obsolete PageConfig fields. The strict Pages loader is the only public module loader.

Development reload keeps module and asset snapshots paired. Invalid/missing manifests and corrupt modules retain the last accepted pair. Compatible edits reload; schema mismatches return RENDER-405. Adding/removing a route or changing its SSR/Browser mode after finalization requires restart and new bindings, so a running registry cannot acquire an unbound SSR route.

Unwinding faults during the typed request boundary become RENDER-399, and a later request can render. **`panic = "abort"` terminates the process and all in-flight requests instead.** Audit the application's deployment profile during migration. A library upgrade does not change that profile.

See [declared props](DECLARED-PROPS.md), [server API](../crates/forma-server/README.md) and [diagnostic codes](DIAGNOSTICS.md). Keep the response and startup contracts together while migrating each handler.

## Activate declared islands on native HTML

Register compiler-visible islands with `activateIslands({ Counter })`. The call now returns `Promise<void>`: await it when subsequent code requires requested load activation to finish. Preflight stays synchronous; load work may continue in browser tasks, while deferred triggers settle readiness once armed. Default entry calls can ignore the promise. See [load scheduling and readiness](../packages/core/docs/ISLANDS.md). Seed their local signals from declared props, not independent Browser defaults. The server emits one bounded, inert head-state envelope, and original island hosts carry their state occurrence and compiled identity. The complete escaped envelope is limited to 1 MiB; do not hand-write the markers or state block.

Activation validates state and the served structure before attaching behavior. It adopts existing nodes without initial DOM repair or initial setter replay. A mismatch leaves that island inert with a coded diagnostic; unrelated valid entries remain eligible. Calling the component entry’s `mount()` on marked SSR content throws `FORMA_E_MOUNT_SSR`. The minimal template demonstrates a server count of 7, retained nodes through activation and later 7 → 8 → 0 interaction; explicit Browser mode starts at 0. See [island state, ownership and early edits](../packages/core/docs/ISLANDS.md).

Native components require one stable owned Element root. Keep conditional and list ranges inside that root. Native lists use callable sources backed by declared rows or admitted literal defaults, stable supported keys, and a single Element row root. `createKeyedRows` supports indexed replacement while preserving row ownership; see [its API](../packages/core/docs/API.md#indexed-item-replacement). Use `browserOnly` for an explicitly client-rendered island body, or declare an entire Browser route when native rendering is not intended.

The native compiler rejects unsupported source even without `--strict`; the old placeholder/warning escape is gone. Address the reported code and source position using [the admitted subset](../packages/compiler/docs/subset.md). In particular, boolean-valued text requires an explicit textual representation, conditions must be boolean, and unsupported computed data should become declared presentation props. Attribute omission, boolean presence and string values follow the shared [parity rules](parity-rules.md). Exact `className`, `htmlFor` and `tabIndex` aliases use their native attribute names; duplicate native attribute names, including ASCII case variants in serialized markup, are refused before publication.

Native SVG and MathML attributes must preserve spelling and namespace through HTML parsing. Use canonical SVG names such as `viewBox` and `preserveAspectRatio`, MathML `definitionURL`, and lowercase `data-*`/`aria-*`. Mismatched spellings and unsupported XML/XMLNS or nonstandard XLink namespace forms refuse BUILD-610; use a supported attribute or explicit Browser mode. Standard lowercase XLink forms such as `xlink:href` remain supported on foreign elements. Integration-point children follow their possible namespaces, and this proof does not widen the downstream ASCII-only attribute-name policy. The [admitted subset](../packages/compiler/docs/subset.md#admitted-source) records these finite rules.

## Mount HTML-runtime markup explicitly

The HTML runtime entry no longer starts on import or watches the document. Replace its tierless `mount`, `reconcile`, `initRuntime`, `destroyRuntime` and global configuration calls with an explicit owner:

```ts
import { mountMarkup, trustedHtml } from '@getforma/core/runtime';
const handle = mountMarkup(root, trustedHtml(reviewedMarkup), {
  tier: 'reviewed',
  grants: {},
});
handle.update(trustedHtml(nextReviewedMarkup));
// Dispose before removing/replacing the owned widget, including nested handles.
handle.unmount();
```

Every mount names its tier. Omitted grants give no fetch, outside-root DOM or navigation authority. Pass any required authority and diagnostic/budget configuration in that mount’s options. `trustedHtml` marks reviewed raw input; it is not a sanitizer, and unreviewed markup belongs in the opaque-origin frame. Removing a DOM root alone does not dispose its handle. The obsolete `data-forma-mount="manual"` switch can be removed; it only emits a development migration warning. These removals apply to `@getforma/core/runtime`; the component entry’s Browser `mount()` remains available. See [the runtime migration](../packages/core/docs/HTML-RUNTIME.md#migrating-the-2x-runtime-bridge).

## Keeping the previous release's assets (FORMA-186)

Keep the `dist/` of the release that is live as a release artifact in your pipeline
and pass its path to the build as `previousDist` (another directory than
`outputDir`). The build copies that release's own hashed assets into the new
`dist/`, flagged `retained` and `immutable` in the manifest, so a tab opened before
a deploy still loads its lazily imported chunks from the one `dist/` you embed.
One generation only. Mark every release that fixes a vulnerability, a Forma
security upgrade included, with `security: true` (or `FORMA_SECURITY_RELEASE=1`):
it retains nothing. Leave the option out for a first deploy; your first 3.0.0
deploy over a 2.x release retains nothing and says so. Details and the errors
(`BUILD-820`, `BUILD-821`, `BUILD-822`) are in `packages/build/README.md`, "Retention".
Unknown `FORMA_SECURITY_RELEASE` values fail even when `security: true` already marks the build.
Treat the previous artifact store as trusted input: the SHA-384 checks detect changed files,
not an attacker who can replace both the files and their manifest.

## Full asset digests

Rebuild schema 2 manifests with complete canonical SHA-384 metadata before starting the reader. Every asset requires `integrity`, including retained files; a filename hash is not a substitute. Manually constructed Browser manifests follow the same checks. External script, stylesheet and modulepreload tags now include integrity and anonymous crossorigin attributes while retaining their existing nonces. Inline bodies remain nonce-protected. A typed preload no longer present in the response's accepted manifest returns RENDER-104, so development reloads must refresh that table rather than emitting an unchecked reference.

## Static routes and explicit Browser mode

An explicit SSR manifest route with `js: []` must have a valid IR module with no declared islands and an empty `modulepreload` list. Missing JS metadata is an error, not a static declaration. LOAD-109 refuses an island module without browser code; MANIFEST-103 refuses contradictory static preloads. The development reader checks changed manifest policy even for unchanged IR bytes and keeps both parts of the last valid pair on failure.

Do not pass `with_config_json` or a stale/nonempty module-preload table to a static SSR handle: these return RENDER-105. Configuration remains a nonced `window.__FORMA_CONFIG__` assignment on JS-enabled SSR and Browser routes; it is not moved into the inert island state channel. CSS/fonts, branding, strict headers and the inert empty state block remain in 3.0.0. The later plain-HTML output change belongs to the [3.1 preparation](UPGRADING-3.1.md#no-javascript-routes-now-emit-plain-html). Explicit executable RawHtml is outside zero-JS qualification.

Enabled worker registration now requires a page JS entry. Static pages do not newly install workers; serving `/sw.js` and the off-mode retirement path remain unchanged for existing clients. Keep the endpoint while changing worker policy. The compiler removes a native page’s whole-page mount and drops its browser entry when there are no islands. Browser routes explicitly declare `ssr: false`; unsupported native source never silently turns into a Browser route. Rebuild and restart when changing a route’s mode.

## Deployment identity, qualification and rollback

Build and deploy assets, manifest and native modules from the same accepted output. Before `mount` or `activateIslands`, the bundle compares its identity to the page root. A mismatch leaves the page inert and dispatches the cancelable Document event `forma:skew` with `{ page, bundle, reload }`. Its automatic reload is bounded to once per full page identity when storage is available. Public direct `hydrateIsland` and application-owned dynamic imports remain outside that guard; the application handles its own failed imports. See [the deployment contract](../packages/core/docs/ISLANDS.md#deployment-mismatch).

Keep the scripts-off install policy and registry signature checks, and inspect the build’s actual size report. The framework's own release fixtures enforce the L-64 ceiling of 28,100 gzip bytes of attributed Forma code; this is not a whole-application size maximum or a substitute for browser measurements. Package bundle caps remain separate. Framework release qualification includes R17, packed templates, parity and P17. A successful application build alone does not reproduce those checks.

The 3.0.0 release's independently audited RC and final qualification are complete. L-66-QUOTA scheduled its active burn-in after final publication; the later receipt verifies 3,660 active seconds with zero faults, while the immutable original record retains its then-deferred status. See the [as-built summary](release/V3-AS-BUILT.md) and [burn-in procedure](release/RC-BURN-IN.md). This historical exception does not waive verification for a future release.

For rollback, restore the previously tested source, both lockfiles and matching deployment artifacts together. Do not combine an old reader with FMIR 3 or an old manifest with a new browser bundle. Preserve one previous deployment’s artifacts where the retention policy permits it; security releases intentionally retain none. Consult [the support policy](../SECURITY.md) for the release family’s published maintenance window.
