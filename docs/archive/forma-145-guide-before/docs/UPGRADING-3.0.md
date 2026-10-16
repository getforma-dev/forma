# Server API migration to the staged 3.0.0 contract

This describes the coordinated development tree. Publication remains gated; source A2 templates and application migrations remain separate follow-up work.

Replace the A2 module maps, per-request SlotData and `try_render` calls with declared TypeScript props and derived Rust handlers. Startup calls `load_ir_modules`, binds every SSR route with `pages.bind::<Props>` or `bind_with`, then calls `pages.finalize()` before the application's listener. A refused module, incompatible handler or unbound SSR route stops that startup path. Failed finalization is repairable; successful finalization seals every clone and refuses further binds. Handles return RENDER-406 until finalization succeeds.

A request calls `handle.render(&props, &RenderCtx::new())` and handles the returned `Result<PageResponse, RenderError>`. Return the PageResponse through the framework response adapter so its HTML, nonce, policy and no-store headers stay together. Log/respond to errors in the application; never turn an SSR error into a browser shell. `into_parts_unchecked` remains the explicitly named exit for integrations that need response parts.

`Limits` aliases the existing WalkLimits. Defaults remain 8 MiB of walked HTML and 50,000 list iterations. `bind_with` sets an immutable page default; a context without an override inherits it. `with_limits` overrides the pair for that request only. Zero is restrictive. Error counts and timing describe the walker; props checking/conversion and document assembly take additional time. Measure the complete handle call before choosing a blocking-pool policy. Forma does not spawn rendering threads.

Move per-request document extensions to RenderCtx: title/body class, typed policy/head/preload settings, `with_config_json(Value)`, `with_personality_css(String)` and `with_body_prefix(RawHtml)`. JSON and CSS retain their existing escaping. RawHtml still requires the reviewed constructor. A handler accepts neither a caller nonce nor executable config script. Public PageConfig now contains only browser document metadata, with no module, slots or render-mode selector.

An explicit `ssr: false` route may use `render_browser_shell`; the route must exist and be declared Browser. Removed APIs are `try_render`, `render_page`, `render_page_with_nonce`, PageOutput, `load_ir_modules_strict`, public IrModules/RenderMode and the obsolete PageConfig fields. The strict Pages loader is the only public module loader.

Development reload keeps module and asset snapshots paired. Invalid/missing manifests and corrupt modules retain the last accepted pair. Compatible edits reload; schema mismatches return RENDER-405. Adding/removing a route or changing its SSR/Browser mode after finalization requires restart and new bindings, so a running registry cannot acquire an unbound SSR route.

Unwinding faults during the typed request boundary become RENDER-399, and a later request can render. **`panic = "abort"` terminates the process and all in-flight requests instead.** Audit the application's deployment profile during migration; the previously inventoried fAuth A2 profile uses abort and requires its assigned application review. This library change does not alter that application's profile.

See [declared props](DECLARED-PROPS.md), [server API](../crates/forma-server/README.md) and [diagnostic codes](DIAGNOSTICS.md). Application migration and rollback remain handler-by-handler work in their assigned tickets; this repository change does not claim those applications are already upgraded.


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

Rebuild schema2 manifests with complete canonical SHA-384 metadata before starting the reader. Every asset requires `integrity`, including retained files; a filename hash is not a substitute. Manually constructed Browser manifests follow the same checks. External script, stylesheet and modulepreload tags now include integrity and anonymous crossorigin attributes while retaining their existing nonces. Inline bodies remain nonce-protected. A typed preload no longer present in the response's accepted manifest returns RENDER-104, so development reloads must refresh that table rather than emitting an unchecked reference.


## Staged static-route policy (FORMA-105)

An explicit SSR manifest route with `js: []` must have a valid IR module with no declared islands and an empty `modulepreload` list. Missing JS metadata is an error, not a static declaration. LOAD-109 refuses an island module without browser code; MANIFEST-103 refuses contradictory static preloads. The development reader checks changed manifest policy even for unchanged IR bytes and keeps both parts of the last valid pair on failure.

Do not pass `with_config_json` or a stale/nonempty module-preload table to a static SSR handle: these return RENDER-105. Configuration remains a nonced `window.__FORMA_CONFIG__` assignment on JS-enabled SSR and Browser routes; it is not moved into the inert island state channel. CSS/fonts, branding, strict headers and the inert empty state block remain. Explicit executable RawHtml is outside zero-JS qualification.

Enabled worker registration now requires a page JS entry. Static pages do not newly install workers; serving `/sw.js` and the off-mode retirement path remain unchanged for existing clients. Keep the endpoint while changing worker policy. This is the staged server slice; compiler static-entry filtering, island-only activation, mount refusal and template/browser acceptance still depend on coordinated103/104/105 integration. It does not authorize application migration or publication.
