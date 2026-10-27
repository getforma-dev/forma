# forma-server

Typed server rendering and explicit browser shells for the Forma stack. These examples use the coordinated `3.2.0` package set. Pin matching crate versions:

```toml
[dependencies]
forma-server = "=3.2.0"
forma-ir = "=3.2.0"
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
    let manifest = assets::load_manifest::<A>()?;
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

## Static SSR policy — FORMA-105

Each manifest route's `js` array is its declared entry list. Both typed SSR and Browser documents execute every entry in that order with the response nonce and its SRI/crossorigin attributes. `modulepreload` contains dependency hints, not extra executable entries; the complete document budget includes every entry tag.

An explicit SSR route with an empty `js` list is static. It must retain its valid IR association and have no declared islands or module preloads. Missing `js` metadata is not an empty list. Island modules without a JavaScript entry fail startup with LOAD-109; malformed static preload declarations fail manifest validation with MANIFEST-103. Debug reload checks the pair even when the IR bytes are unchanged and preserves the last good module **and** asset manifest on refusal.

Static SSR emits its native body, CSS/fonts and strict response headers. With FORMA-257 it omits adoption comments, injected row keys, the empty island-state envelope, and the root build/SSR attributes; JavaScript-enabled routes keep their adoption markup. It refuses `with_config_json` and an effective request module-preload table with RENDER-105, including a stale table naming a valid retained asset. `config_json` is an executable, nonced assignment to `window.__FORMA_CONFIG__`; it is not silently dropped or reinterpreted as inert data. JS-enabled SSR and explicit Browser routes retain that API. Complete escaped-response limits remain unchanged.

Worker registration is emitted only on pages with a published JS entry. A static-only app may enable worker serving, but its pages do not newly install a worker. The endpoint and off-mode retirement remain available; already controlled clients can perform browser-managed worker update checks independently. Fresh-context zero-JS navigation and retirement of a previously installed worker are separate qualifications.

`RawHtml` remains explicitly reviewed markup. The framework does not parse or sanitize it here: an application that adds executable raw markup cannot claim zero-JS qualification. The compiler removes unused activation entries from static SSR routes; the minimal template demonstrates a static page alongside a page with a counter island. Packed-template tests check the actual served routes and browser network activity. Release qualification still requires those tests to pass on the exact candidate.

## Limits and request metadata

`Limits` is the existing `WalkLimits` type: 8 MiB of complete response HTML and 50,000 total list iterations by default. `RenderCtx::new()` inherits the handle's limits. `with_limits` overrides both budgets for one request; struct-update from `page.limits()` changes one. Zero remains restrictive. A list longer than its remaining budget fails before its first row; output and list failures report counts reached with RENDER-301/302. Fixed structural/depth ceilings remain. The final length includes escaped head/config metadata, state JSON and its tags, and body markup; the final document allocation occurs only after this check. `RenderCounts.bytes` continues to report body-walk bytes for diagnostics.

Counts report nodes, walked bytes, list rows and **walker time**. The time excludes checked props conversion and document assembly. Measure the complete handle call separately when deciding whether to move a cloned handle and owned props into the runtime's blocking pool. Forma starts no threads.

RenderCtx preserves the document's typed homes: title/body class, policy extensions, head links and manifest preloads; `with_config_json(Value)` writes a nonced assignment of escaped JSON on JS-enabled SSR or Browser routes, `with_personality_css` applies the existing style-end-tag escaping, and `with_body_prefix(RawHtml::trusted(...))` writes explicitly reviewed markup. Plain-string prefixes, handler scripts and caller-supplied nonces are unavailable. Raw entries remain subject to the application's reviewed allowlist.

## Response and explicit browser mode

`PageResponse` keeps HTML, a fresh nonce, enforced CSP, no-store and document security headers together. Axum's IntoResponse sends them. Its fields are private; `into_parts_unchecked` is the named reviewed integration exit. The named preview frame policy retains its separate documented overrides.

`render_browser_shell(&PageConfig, &RenderCtx)` requires a manifest route explicitly declared Browser (`ssr:false`). An unknown or SSR route returns RENDER-103 before document work. PageConfig is browser document metadata and carries no module, slots or render-mode selector. A browser shell has an empty root and the same response headers; it is never a fallback for SSR failure.

Both Trusted Types directives are enforced without requiring a reporting endpoint. The typed per-route relaxation removes exactly those directives from enforcement and retains Report-Only; owner/date governance applies. The existing bounded relaxation audit and loader/reload diagnostics remain distinct from application-owned render-error reporting.

## Development and panics

Debug reload keeps immutable module/asset snapshots paired. A corrupt write retains the last good pair; a valid incompatible schema returns RENDER-405 until corrected. After finalization, adding/removing a route or changing its mode requires restart/rebinding. Compatible module and asset edits can reload without restart. Release builds use embedded snapshots without per-request filesystem reads.

The complete handle boundary catches unwinding request faults, including custom props conversion, and returns RENDER-399; a later request can still render. Under `panic = "abort"`, a fault ends the process and every in-flight request. The previously recorded fAuth abort profile therefore requires application migration review; this package does not change application profiles.

The old `try_render`, tuple loader, public IrModules/RenderMode, PageOutput, render_page, caller-nonce renderer and raw config_script are removed. [The previous staged README](../../docs/archive/2026-10-15-bound-render/forma-server-README.md) is preserved for migration context. The maintained minimal and dashboard templates use the current typed-page and explicit Browser APIs. Publication is controlled by the release milestone gates and trusted-publishing workflow.

The [3.0 migration guide](../../docs/UPGRADING-3.0.md) covers startup, request metadata, limits and deployment profiles.

Asset serving, opt-in checked service-worker configuration and the named preview frame retain their existing APIs. See their module documentation and [release runbook](../../docs/RELEASING.md).


## Rendered-page compression

HTML compression is opt-in at both build time and the response boundary. Enable
the `compression` feature on `forma-server`, then return
`page.with_compression(&request_headers)` from selected handlers. The argument is
Axum's request `HeaderMap`; the returned `CompressedPageResponse` implements
`IntoResponse` and retains `counts()`. An ordinary `PageResponse` is unchanged.

Only enable this on responses that cannot mix secrets with attacker-controlled
text. CSRF tokens, private account data and session-derived secrets need the same
exclusions at a reverse proxy. Read the [BREACH decision](../../SECURITY.md#opt-in-page-compression-forma-261).
A fresh CSP nonce does not protect another secret in the document.

The server negotiates Brotli and gzip by quality, preferring Brotli on ties.
Explicit zero qualities override wildcards. Explicit identity preference is
honored; missing `Accept-Encoding` uses identity. Multiple header lines are
combined, and duplicate tokens use their lowest quality. If no supported encoding
or identity is acceptable, the response is an empty 406. Bodies below 1 KiB and
results that would grow stay uncompressed when identity is acceptable. The
response always carries `Vary: Accept-Encoding`, the original CSP and `no-store`.
Axum's GET routing preserves these representation headers for HEAD and strips
its body.

Compression runs once per response, synchronously, at Brotli quality 4 (1 MiB
window) or gzip level 4. Budget that CPU work alongside rendering; large responses
may belong in the application's blocking pool. Compression does not cache a
nonce-bearing document or make it public-cacheable. A proxy should pass an
already encoded body through. If the proxy owns compression instead, omit this
method and apply the same exclusions there. Roll back by removing the call or
disabling the Cargo feature.

Level selection used the Grand Prix 100-row HTML fragment (32,851 bytes), before
the document shell, on an Apple M1 Pro with Rust 1.93.1 in release mode. Each
encoding had 20 warmups and 101 timed calls; other desktop work remained active.
These are encoding costs, not HTTP throughput or a cross-machine guarantee.

| Encoding | Encoded bytes | Median duration per call | p95 |
| --- | ---: | ---: | ---: |
| Brotli 4 | 2,292 | 135 µs | 226 µs |
| Brotli 5 | 1,872 | 207 µs | 325 µs |
| gzip 4 | 2,539 | 87 µs | 110 µs |
| gzip 5 | 2,520 | 91 µs | 144 µs |
| gzip 6 | 2,504 | 128 µs | 153 µs |

Repeat with a representative uncompressed HTML response saved to a file:

```sh
FORMA_COMPRESSION_SAMPLE=/absolute/path/to/page.html CARGO_BUILD_JOBS=1 \
  cargo test --locked -p forma-server --features compression --release --lib \
  response::compression::tests::compression_levels -- --ignored --nocapture
```

Measure complete request throughput and tail latency with the load generator's
`Accept-Encoding` header enabled before choosing where to opt in.

## The deployment identity

Every page's root carries `data-forma-build="<the manifest's build>"`, on a
server-rendered page and on a browser shell alike, escaped as an attribute
value. `@getforma/build` computes that identity from the build's own outputs
and compiles it into every bundle. Core's `activateIslands()` and component
`mount()` compare nonempty page and bundle identities before component execution.
A mismatch keeps their work inert or triggers at most one automatic reload per
page identity in the tab; cancellation or unavailable session storage keeps it
inert. Missing identities remain unchecked. Direct `hydrateIsland()` and
application-owned imports are outside this guard; see
[deployment mismatch](../../packages/core/docs/ISLANDS.md#deployment-mismatch).
A manifest listing a `retained` asset that is not `immutable` is refused at
start (`MANIFEST-103`).

## Asset integrity

Schema2 manifests require a full canonical `sha384-` digest for every asset, including retained files. Build metadata hashes the final uncompressed bytes. Missing or malformed digests refuse startup with MANIFEST-103 and the filename. Every external script, stylesheet and modulepreload tag carries that digest and `crossorigin="anonymous"`; script tags and modulepreloads keep their existing nonce. Inline request JSON, branding CSS and registration code remain nonce-protected.

Browser rendering revalidates a manually constructed manifest. A missing/invalid digest or a typed preload absent from the current manifest refuses the response with RENDER-104. A development preload table must be replaced when its files leave the accepted snapshot. The public-path controls in `tests/asset_integrity.rs` cover exact tag attributes, both rendering modes, canonical digest refusals and stale preload references. Resource byte verification in the optional worker is separate from tag SRI, including dynamically imported chunks that have no tag.

Declared island inputs are projected at each native `ISLAND_START` into private owned state. Every SSR response includes exactly one head `<script type="application/json" data-island-state>` before the body, including the empty envelope when no island executes. Browser shells have no state block. Host `data-forma-state` occurrence indices and `data-forma-h` digests refer to those snapshots; the retired inline props and `__forma_islands` channels are not emitted. Invalid mapping/value returns `RENDER-501` with route, component and field path. The exact escaped state JSON limit is 1 MiB (`RENDER-502`); it is independently included in the complete response budget.

## Native owner navigation — FORMA-301

Native owner navigation is part of Forma 3.2.0. Use the coordinated
compiler/build/core/router set and the [routing guide](../../docs/ROUTING.md).

Enable the additive `navigation` Cargo feature and a compiler/build navigation
group. Every owner is an existing finalized `PageHandle<P>` with its own checked
props and FMIR module. The build publishes `route.navigation = { group, owner,
outlet }`, one shared bootstrap, and identical CSS/font assets for the group.
An outlet is a single literal empty `<div data-forma-outlet="main"></div>` outside
all island subtrees. The server checks that declaration again against rendered
markup. Default rendering and routes without this feature remain unchanged.

```rust,no_run
use forma_server::{NavigationBranch, NavigationConfig, RenderCtx, SealedNavigationPolicy};
# #[derive(forma_ir::PageProps)] struct Props { value: String }
# fn example(shell: &forma_server::PageHandle<Props>, leaf: &forma_server::PageHandle<Props>, props: &Props) -> Result<forma_server::PageResponse, Box<dyn std::error::Error>> {
let profile = SealedNavigationPolicy::page_response_only(["/save"])?;
let ctx = RenderCtx::new().with_navigation(
    NavigationConfig::new("account", "layout-v1", "session-generation-v1")?
        .with_sealed_policy(profile),
);
let branch = NavigationBranch::new("/account/profile", vec![
    shell.render_owner(props, &ctx, "account-shell")?,
    leaf.render_owner(props, &ctx.with_title("Profile"), "profile")?,
])?;
// For the matching navigation Accept header, return into_navigation_response().
// Ordinary GETs, reloads, and no-JavaScript requests receive the full document.
let page = branch.into_document_response()?;
# Ok(page) }
```

`SealedNavigationPolicy::page_response_only` is an explicit application
attestation: the typed PageResponse must represent the **complete effective
policy**. Middleware/proxies must not add unrepresented policy headers; pages
must not add policy meta elements or use `into_parts_unchecked` to alter the
response. The constructor cannot inspect hosting configuration. Applications
that cannot guarantee this profile must use document navigation. Native owners
reject raw prefixes, config scripts, inline styles, body classes, request head
links/preloads and additional `form-action` destinations. The initial owner profile
also excludes embedded resources/media, SVG/MathML, templates, custom elements,
policy/head elements and executable/styling attributes. URL attributes must be
relative (including root-relative/query/fragment) and cannot contain schemes,
protocol-relative hosts, controls or backslashes. Applications needing broader
markup use ordinary document navigation. The effective form
policy must be exactly `form-action 'self'`. Typed CSP/reporting/COOP and ordinary
document security headers all contribute to the admission fingerprint. Deployment
qualification must verify the actual served headers and policy before opt-in.

The application constructs the actual root-to-leaf branch on each request.
Opaque owners cannot be constructed from raw HTML/state. The server hashes the
actual module and all declared checked props; extra Rust fields are excluded.
Reuse identity includes those digests, the server-owned lifetime key and security
context generation. Never use secrets or user identifiers in context labels.
Changing authentication/authorization context must change that opaque generation;
these identities do not authenticate a request. The server still owns routing,
authorization, loading and mutation validation.

A branch has 1–32 unique owners, at most 200 island occurrences, and a maximum
1 MiB complete representation (or a stricter handle limit), 10,000 markup tokens
and 64 nesting levels. It rejects missing
outlets, nested island-owned outlets, duplicate identities, mixed asset sets and
policy/context mismatches. Native JSON keeps each owner's local island indices.
Full HTML composes a stable `[data-forma-router-root]` container with owner
wrappers and one initial `data-island-state` envelope whose occurrence indices
are global. Initial metadata contains identities only. Core captures this
original document authority once; later incoming owners have isolated scopes.

`with_status` accepts 200, 404, 410, 500 or 503 and preserves that status in both
JSON and full HTTP documents, including optional compression. Authentication
401/403 responses use the document boundary and invalidate private owners.
`into_redirect("/destination")` emits an admitted GET redirect as JSON with HTTP
200; it never relies on Fetch following an HTTP redirect. The router limits
redirect hops and commits one final history entry.

Enhanced forms are restricted to the canonical same-origin pathnames declared
in the profile (at most 128). Create a fresh
`handle.action_context(&ctx, "/save")` from a finalized bound handle after the
request's policy/authentication checks. `ActionResponse::{success, validation,
error, redirect}` preserve admission and HTTP/outcome semantics. The framework
does not execute or authorize mutations, provide CSRF/idempotency protection, or
replay POST. An unreadable result after submission is an unknown outcome;
applications must reconcile it explicitly. Ordinary forms keep normal document
POST/redirect/GET behavior.

The `experimental-router` feature remains a compatibility alias for the original
local feasibility harness; its legacy single-fragment API is not the production
owner protocol. Its historical receipts are evidence of that earlier boundary,
not qualification of the new implementation.
