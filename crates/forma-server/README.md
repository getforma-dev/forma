# forma-server

Typed server rendering and explicit browser shells for the Forma stack. This is the 3.0.0-alpha.1 pre-release (milestone M2): a Cargo pre-release version that plain requirements exclude; the first stable 3.0.0 follows the beta and rc.

```toml
[dependencies]
forma-server = "=3.0.0-alpha.1"
forma-ir = "=3.0.0-alpha.1"
```

The [archived A2 README](../../docs/archive/2026-10-15-declared-props/forma-server-README.md) preserves the old slot-injection API.

## Startup and rendering

The only module loader is `load_ir_modules`. It checks every declared SSR module, then returns `Pages`. Bind every SSR route to its derived Rust handler and finalize before opening the application's listener. A missing/corrupt/incompatible module or schema mismatch is a startup failure. Browser routes require no typed handler.

```rust,no_run
use forma_ir::PageProps;
use forma_server::{assets, load_ir_modules, Limits, PageHandle, RenderCtx};
#[derive(PageProps)]
struct HomeProps { title: String }
fn start<A: rust_embed::Embed + 'static>() -> Result<PageHandle<HomeProps>, String> {
    let manifest = assets::try_load_manifest::<A>()?;
    let pages = load_ir_modules::<A>(&manifest).map_err(|e| format!("{e:?}"))?;
    let home = pages.bind_with("home", Limits::default()).map_err(|e| format!("{e:?}"))?;
    pages.finalize().map_err(|e| format!("{e:?}"))?;
    Ok(home) // open the listener only after this succeeds
}
fn home(page: &PageHandle<HomeProps>) -> Result<forma_server::PageResponse, forma_server::RenderError> {
    page.render(&HomeProps { title: "Hello".into() }, &RenderCtx::new().with_title("Welcome"))
}
```

`bind` selects defaults; `bind_with` selects immutable page limits. Both accept an exact route or an unambiguous logical page alias. Failed binds never register a handler. `finalize` lists all unbound SSR routes and stays repairable; successful finalization seals every clone, is idempotent, and refuses later binds. Rendering before it succeeds returns RENDER-406 without a response. Forma does not own the listener and cannot intercept an application that opens one prematurely.

`PageHandle::render` checks and projects declared props by name and returns `Result<PageResponse, RenderError>`. The handler chooses/logs its error response. No failed render becomes an empty shell. See [declared props](../../docs/DECLARED-PROPS.md) for field/type/source diagnostics. Extra Rust fields warn and never enter the rendered data.

## Limits and request metadata

`Limits` is the existing `WalkLimits` type: 8 MiB of walked HTML and 50,000 total list iterations by default. `RenderCtx::new()` inherits the handle's limits. `with_limits` overrides both budgets for one request; struct-update from `page.limits()` changes one. Zero remains restrictive. A list longer than its remaining budget fails before its first row; output and list failures report counts reached with RENDER-301/302. Fixed structural/depth ceilings remain.

Counts report nodes, walked bytes, list rows and **walker time**. The time excludes checked props conversion and document assembly. Measure the complete handle call separately when deciding whether to move a cloned handle and owned props into the runtime's blocking pool. Forma starts no threads.

RenderCtx preserves the document's typed homes: title/body class, policy extensions, head links and manifest preloads; `with_config_json(Value)` writes escaped JSON, `with_personality_css` applies the existing style-end-tag escaping, and `with_body_prefix(RawHtml::trusted(...))` writes explicitly reviewed markup. Plain-string prefixes, handler scripts and caller-supplied nonces are unavailable. Raw entries remain subject to the application's reviewed allowlist.

## Response and explicit browser mode

`PageResponse` keeps HTML, a fresh nonce, enforced CSP, no-store and document security headers together. Axum's IntoResponse sends them. Its fields are private; `into_parts_unchecked` is the named reviewed integration exit. The named preview frame policy retains its separate documented overrides.

`render_browser_shell(&PageConfig, &RenderCtx)` requires a manifest route explicitly declared Browser (`ssr:false`). An unknown or SSR route returns RENDER-103 before document work. PageConfig is browser document metadata and carries no module, slots or render-mode selector. A browser shell has an empty root and the same response headers; it is never a fallback for SSR failure.

Both Trusted Types directives are enforced without requiring a reporting endpoint. The typed per-route relaxation removes exactly those directives from enforcement and retains Report-Only; owner/date governance applies. The existing bounded relaxation audit and loader/reload diagnostics remain distinct from application-owned render-error reporting.

## Development and panics

Debug reload keeps immutable module/asset snapshots paired. A corrupt write retains the last good pair; a valid incompatible schema returns RENDER-405 until corrected. After finalization, adding/removing a route or changing its mode requires restart/rebinding. Compatible module and asset edits can reload without restart. Release builds use embedded snapshots without per-request filesystem reads.

The complete handle boundary catches unwinding request faults, including custom props conversion, and returns RENDER-399; a later request can still render. Under `panic = "abort"`, a fault ends the process and every in-flight request. The previously recorded fAuth abort profile therefore requires application migration review; this package does not change application profiles.

The old `try_render`, tuple loader, public IrModules/RenderMode, PageOutput, render_page, caller-nonce renderer and raw config_script are removed. [The previous staged README](../../docs/archive/2026-10-15-bound-render/forma-server-README.md) is preserved for migration context. Source A2 templates remain historical until their milestone migration; release verification stages an explicit candidate-only adapter, and live publication stays disabled.

The [3.0 migration guide](../../docs/UPGRADING-3.0.md) covers startup, request metadata, limits and deployment profiles.

Asset serving, opt-in checked service-worker configuration and the named preview frame retain their existing APIs. See their module documentation and [release runbook](../../docs/RELEASING.md).


## Asset integrity

Schema2 manifests require a full canonical `sha384-` digest for every asset, including retained files. Build metadata hashes the final uncompressed bytes. Missing or malformed digests refuse startup with MANIFEST-103 and the filename. Every external script, stylesheet and modulepreload tag carries that digest and `crossorigin="anonymous"`; script tags and modulepreloads keep their existing nonce. Inline request JSON, branding CSS and registration code remain nonce-protected.

Browser rendering revalidates a manually constructed manifest. A missing/invalid digest or a typed preload absent from the current manifest refuses the response with RENDER-104. A development preload table must be replaced when its files leave the accepted snapshot. The public-path controls in `tests/asset_integrity.rs` cover exact tag attributes, both rendering modes, canonical digest refusals and stale preload references. Resource byte verification in the optional worker is separate from tag SRI, including dynamically imported chunks that have no tag.
