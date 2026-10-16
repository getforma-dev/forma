# Changelog

## [Unreleased]

- Execute every declared route JavaScript entry in manifest order with its nonce, integrity and crossorigin attributes. Earlier entries are no longer merely preloaded while only the last runs; dependency-only modulepreloads remain hints. Both typed SSR and Browser documents charge all entry tags to their complete output budget.

### Ordinary document metadata — FORMA-182

- Normalize CRLF/CR to LF and NUL to U+FFFD before escaping ordinary title,
  body class, typed head fields and resource URL values on both SSR and browser
  shell paths. Shared rule-1 vectors cover both actual document writers.
  Request state, configuration JSON, nonces, integrity digests, build identity
  and raw CSS retain their existing encoding. URL refusal and exact complete
  document byte-budget checks remain active.

### Attribute values — FORMA-182

- Pages render through forma-ir's attribute table (rule 6, finding F2): a `true` on a non-boolean attribute is written as `name="true"` (`tests/typed_pages.rs` asserts `data-enabled="true"` on a keyed row where it asserted the bare name).

### The build's size report is not served — FORMA-190

- `serve_asset` refuses `size-report.json` (404), as it refuses `manifest.json`: `@getforma/build` 3.0 writes the report beside the manifest, in the directory an application embeds, and it lists every route with its class, ceilings and bytes. The report is not an asset, and an embed that carries it never serves it. Tests: `assets::tests::denied_names_are_never_served` (the name), and `assets::tests::an_embedded_size_report_is_not_served_through_the_route` (the route, with the file really embedded).

### The deployment identity on the page's root — FORMA-186 (DR-29)

- Every page's root names the build the manifest names: `<div id="app" data-forma-build="<manifest.build>" data-forma-ssr>` for a server-rendered page, `<div id="app" data-forma-build="<manifest.build>"></div>` for a browser shell. `@getforma/core` compares it with the identity `@getforma/build` compiled into the bundle before it activates anything (a later FORMA-186 slice); a page from an older server has no attribute and is unchecked. The value is the manifest's `build`, escaped as any attribute value is; no render input can set or override it. The preview-frame document is not stamped.
- A manifest that lists a `retained` asset that is not `immutable` is refused at start (`MANIFEST-103`): a retained file is the previous release's, served as any content-named asset (`serve_asset` is unchanged: it already serves what the manifest marks immutable as immutable).

### Keyed list rows — FORMA-181

- `RenderError::code()` reports `RENDER-503` for a walk refused by forma-ir's `IrError::InvalidListKey` (a keyed row without a usable identity, a duplicate key, a row without one root): a new cause with its own code, still carried by `RenderError::Walk` with the route, component path and counts. Every other walk refusal stays `RENDER-102`.

### Staged static SSR policy — FORMA-105

- Refuse island modules paired with an empty SSR JavaScript list at startup/reload (LOAD-109); keep the prior valid module and manifest together, including unchanged-IR and same-byte recovery transitions.
- Refuse static manifest preloads (MANIFEST-103), executable request configuration and effective request preloads (RENDER-105). Keep CSS/fonts, inert state, strict headers and exact full-response limits.
- Register enabled workers only from pages with JS entries; preserve worker serving and scoped off-mode retirement. Compiler/browser/template integration remains pending for overall105 acceptance.

## [3.0.0-alpha.2] - 2026-10-15

Supersedes `3.0.0-alpha.1`, whose tag never published (its release run stopped in P17, the verification harness, before any publish job: the packed build's optional compiler peer resolved through the unbuilt workspace instead of the packed set; nothing reached the registries). The harness now resolves packed libraries inside the packed set and proves it. Version only; the alpha.1 notes below stand.

## [3.0.0-alpha.1] - 2026-10-15

The first 3.0.0 pre-release (milestone M2), a Cargo pre-release version on crates.io that plain requirements exclude. Part of the seven-package set 3.0.0-alpha.1; bound rendering and `Pages::finalize` (FORMA-107), declared handler props (FORMA-102), `PageResponse` only and Trusted Types enforced (FORMA-109), asset integrity and manifest 2 (FORMA-111, 112), FMIR v3 loading (FORMA-185) and the removals (FORMA-110) below are the alpha's gates. The deployment identity and the skew behaviour (FORMA-186) are pending before the rc. See the root CHANGELOG for the set and the pending gates.

- Require canonical full SHA-384 metadata for every schema2 asset; emit SRI on external scripts, stylesheets and modulepreloads while retaining nonces. Invalid Browser manifests or unavailable preload digests refuse with RENDER-104.

### Bound rendering and startup completion — FORMA-107

- Add repairable `Pages::finalize`: every declared SSR route must have a verified handler before rendering; successful completion seals all registry clones. Debug route topology changes require restart while compatible module/asset snapshots still reload.
- Add `bind_with`/`Limits` defaults and explicit request overrides; preserve existing budgets/counts and guard the entire typed render, including props conversion, against unwinding faults.
- Remove public `try_render`, tuple loader, IrModules, RenderMode and PageConfig's module/slots/mode fields. Explicit browser shells validate Browser route mode. Preserve SSR JSON, branding CSS and RawHtml through typed RenderCtx builders.

### Declared handler props — FORMA-102

- `load_ir_modules` now strictly returns `Pages`; `bind::<P>(page)` verifies a derived handler once, then `PageHandle<P>::render(&props, &ctx)` checks and projects request values into exact declared SERVER roots. The old lenient tuple loader is removed; `load_ir_modules_strict` remains temporarily.
- Added request title/body-class metadata on `RenderCtx`, source-aware BIND diagnostics, checked-value RENDER-401..404 and RENDER-405 for incompatible debug reloads. A corrupt reload keeps the prior module and its asset snapshot; a valid incompatible schema returns an error.
- Repeated lists share a declared root array with private CLIENT temporaries. Local state is never handler-filled, extra Rust fields warn and are omitted, and both no-parameter and typed-empty pages bind to an empty derived struct.

### Response and raw boundaries — FORMA-109

- Remove `PageOutput`, `render_page`, `render_page_with_nonce` and `PageConfig::config_script`. Retained checked renderers return only `PageResponse`; HTML leaves separately only through the named `into_parts_unchecked` exit. `try_render` remains for typed-handle integration until FORMA-107.
- Require `PageConfig::body_prefix: Option<&RawHtml>` and remove the string-provenance registry and RAW-101 bridge warning. Keep the single reviewed `RawHtml::trusted` constructor.
- Enforce both Trusted Types directives for strict pages and named frames in every build without requiring a reporting endpoint. The typed route relaxation removes only those directives from enforcement and retains Report-Only; SR8 governs owner/date metadata. Existing frame overrides, document headers, nonce generation and escaped JSON remain.


### Compatibility — FORMA-112

- Validate schema-2 manifests and module compatibility before startup; use explicit browser/SSR modes and filename-keyed immutable metadata, including retained assets. Enabled service workers require configure_for_manifest and a matching app; failed validation does not seal defaults. Development reload shares the validator and preserves last good state on refusal.

### Removed — FORMA-110

- Removed `AssetManifest::wasm`, `WasmAssets` and the `window.__FORMA_WASM__` page bootstrap. Unknown legacy manifest fields cannot reactivate the loader. `csp_is_strict` explicitly rejects `wasm-unsafe-eval`.
- Kept the 0.2.1 document goldens as historical bytes; current output is compared after subtracting only the previously removed worker registration and the now-removed WASM bootstrap.


### FMIR v3 loading (FORMA-185)

- Load through the single v3 reader in `ir.rs`; expose `IrError` and delegate diagnostic codes
  to its `code()` method. Invalid versions, CRCs and section/schema references refuse startup
  before the server binds. Existing development reload retains the previous valid module.
- Regenerate loader fixtures as v3 and check all 61 reviewed failures through the strict loader.
  Tail truncation now reports LOAD-104 at the header length check; short headers remain LOAD-103.


### Changed
- **Nothing in the crate.** The release workflow now locks the packed
  crate's `Cargo.lock` with the MSRV-aware resolver, so the next published
  `.crate` builds `--locked` on Rust 1.85 (A2 audit F7, FORMA-180); 0.2.2's
  holds sha2 0.11.1 (Rust 1.88), which only a `cargo build --locked` on the
  `.crate`'s own lock meets, never a consumer's. CI checks that the
  `forma-ir` requirement, normal and dev, equals forma-ir's version (audit
  F8).

## [0.2.2] - 2026-10-14

Release A2's bridge (0.2.2): additive. Every 0.2.1 call compiles and behaves
as before, except one default: the service worker is off unless the
application turns it on (FORMA-130, under Changed). The old forms warn as
deprecated and go in 3.0.0. Everything else an application may notice is
listed first.

### Upgrading from 0.2.1: what an application may meet
- **No service worker by default.** No page writes the registration line, and
  `/sw.js` serves the retiring worker, which clears Forma's v1 caches and
  unregisters, until the application calls `sw::configure(..enabled())`
  (under Changed). Code that looks for the registration line finds none:
  fAuth's `render_page` wrapper `debug_assert!`s it, so its debug-build
  renders panic on 0.2.2 until the wrapper changes (FORMA-150). Its
  `forma-server = "0.2.0"` requirement lets a plain `cargo update` take
  0.2.2: pin `=0.2.1` until the wrapper changes.
- **Deprecation warnings at compile time.** Every `PageConfig` literal names
  `config_script`, so every application warns at least once, even for
  `config_script: None`; an `AssetManifest` literal warns for `wasm`. A build
  under `-D warnings` (`RUSTFLAGS`, `#![deny(warnings)]`,
  `cargo clippy -- -D warnings`) fails until each call moves to the
  replacement listed under Deprecated or carries `#[allow(deprecated)]`, as
  create-app 0.6.2's templates do on their one `PageConfig` literal.
- **Trusted Types, reported: a second policy header where it can be read.**
  `Content-Security-Policy-Report-Only` with Trusted Types (under Added) goes
  out on a page when the application names a reporting endpoint
  (`PolicyExtensions::report_to` or `report_uri`), in every build, and with no
  endpoint in development builds only, where Chromium and Firefox show its
  violations in the console. A release build with no endpoint sends no
  Report-Only header, so it adds no header to 0.2.1's page. It would report
  to nobody, and WebKit (Safari) logs a console error on every page whose
  Report-Only policy names no `report-to` ("… was delivered in report-only
  mode, but does not specify a 'report-to'; the policy will have no
  effect"), which FORMA-138's packed-set run found. With the header, nothing
  is blocked; a page that registers its own Trusted Types `default` policy
  has it run on string writes. The enforced policy is 0.2.1's, byte for
  byte.
  - **A development build with no endpoint still makes WebKit log that error
    on every page,** so an application's own WebKit test that fails on
    console errors, run against a development server, meets it.
    `report_uri("/csp-reports")` silences it in development too.
  - **A check that Trusted Types raise zero reports or violations must name an
    endpoint (`report_uri` is enough) or run against a debug build.** A
    release build with no endpoint sends no Report-Only policy, so such a
    check passes without testing anything.
  - "Development build" is forma-server's own `debug_assertions`, the switch
    its loopback-endpoint rule uses: a release profile with debug assertions
    on, or a `[profile.release.package.forma-server] debug-assertions = true`
    override, gets the development behaviour.
- **`render_page`'s document is 0.2.1's,** byte for byte, except the worker
  registration line above.
- **Development-build log lines, once per process:** `render_page` and
  `load_ir_modules` log their deprecation, and a plain string in
  `body_prefix` logs `RAW-101`. Release builds log nothing new.
- **Requires forma-ir 0.2.2** (`cargo update -p forma-server` brings it).
  Its HTML is 0.2.1's; a list longer than the remaining iteration budget
  now fails before its first row, so `try_render` reports `RENDER-302`
  ahead of an error the list's rows would have raised first.
- **`load_ir_modules_strict`'s failures** each begin with their code
  (`LOAD-101` to `LOAD-103`), and it no longer logs "Phase 1 fallback" for
  them.

### Added
- **`PageResponse::frame`, the preview frame's document** (DR-14 tier (c);
  L-12, L-17, L-27, L-33, L-44 (b), L-52; SR32; FORMA-125, the forma-server
  half). For content nobody reviewed: a document with an opaque origin, its
  requests closed but for the residuals below, the zero-build runtime inline.
  - Its enforced `Content-Security-Policy` is the strict policy with nine
    directives written in their place, the one exception to SR5's no-rewrite
    rule: `sandbox allow-scripts` (never `allow-same-origin`),
    `frame-ancestors` the application's origin, `script-src` the runtime's
    SHA-256 (no nonce, so no script it creates or imports runs),
    `connect-src 'none'`, and `img-src data:`, `style-src 'nonce-N'` alone,
    `font-src 'none'`, `worker-src 'none'`, `form-action 'none'`: in an
    opaque-origin document CSP's `'self'` still names the application, so
    markup alone would otherwise send it requests with its `SameSite=None`
    cookies (L-52). In the enforced header only, since browsers ignore
    `sandbox` in Report-Only and `meta`. It carries Trusted Types in
    Report-Only with no reporting endpoint, so, like any page without one,
    in development builds only.
  - **Residuals (documented in the `frame` module, SECURITY.md):** WebRTC
    (a script can send STUN packets and DNS lookups to any host; no CSP
    directive closes it in Chrome 155), the frame navigating itself (the
    host's `frame-src` naming the frame's exact URL refuses every other URL,
    save the frame's own path with another query, since CSP's path matching
    ignores the query: that reaches the frame route, which ignores its
    query, with the application's `SameSite=None` cookies before the
    teardown, so its data lands in the application's access log; a wider
    `frame-src` lets a navigation out, with those cookies on the
    application's origin), and whatever the module shows the user inside
    the frame. **Link hints and `srcdoc` are closed in core, not by the
    policy:** no CSP directive governs `<link rel="preconnect">`, and in
    WebKit a module's preconnect (its `href` written or bound) or an
    `<iframe srcdoc>` holding one connected to the host it named, from inside
    the frame (the A2 audit's S1). `@getforma/core` 2.1.0's frame runtime
    mounts the module with `tier: 'unreviewed'`, which removes every `<link>`
    and `srcdoc` before the markup reaches the document, re-checks the live
    subtree, and refuses the render if one appears (formajs#35); the frame
    route's self-navigation residual above is unchanged.
  - The document is one root, `<div id="forma-frame">`, and the runtime as
    one inline script; it names no URL, so loading it fetches nothing.
  - The runtime comes from the application's own build: the manifest's
    `assets` entry `forma-runtime.js` (`FRAME_RUNTIME_ASSET`), read from the
    embedded `dist` and hashed once at start by `PreviewFrame::load::<A>(&manifest,
    app_origin)`. A missing or unusable runtime is a coded `FrameError` at
    start, never a frame without it: `FRAME-101` (no entry), `FRAME-102`
    (named, not embedded), `FRAME-103` (empty, not UTF-8, or containing
    `</script`, `<!--`, a carriage return or a NUL: inlined and hashed as it
    is, never rewritten, and the parser rewrites CR and NUL), `FRAME-104`
    (the application's origin is not `https://host[:port]` or loopback
    `http://`, with a port of 1 to 65535 and no leading zero); per request,
    `FRAME-201` (no nonce for `style-src`) and `FRAME-202` (no header value,
    ruled out at start).
  - The host's side is documented in the `frame` module: the `iframe`'s
    `sandbox="allow-scripts"` set with `src` before insertion; the host
    page's `frame-src` naming the frame's exact URL, the only control on
    where the frame may navigate; one `MessageChannel` port on the first
    load, carrying nothing else; no listener trusting origin `"null"`; only
    `ready`, `resize` and `error`, schema-checked; teardown on any later
    load.
  - `PagePolicy`'s fields are private to `csp.rs`, so only `page_policy` and
    `frame_policy` write a policy, and `frame_policy`'s one caller is
    `PageResponse::frame`.
  - Needs, from the other repositories: core's frame runtime as a classic,
    self-contained script with LF line endings and no source-map comment
    (FORMA-128), taking the port only from `event.source === parent`; and
    `@getforma/build` writing it into `dist` as `forma-runtime.js`.
  Tests: `tests/preview_frame.rs` >
  `the_frame_policy_replaces_exactly_its_nine_directives`,
  `the_frame_document_inlines_the_runtime_by_its_hash_and_names_nothing_to_fetch`,
  `a_frame_without_its_runtime_is_a_coded_error_at_start`,
  `page_response_frame_is_the_only_response_that_rewrites_the_policy`;
  `frame::tests::frame_201_a_failed_nonce_draw_is_no_frame`,
  `frame_202_a_policy_that_is_no_header_value_is_no_frame`. Checked in Chrome
  155 (forma#22 and its review's harness): markup alone (`<img>`, a
  stylesheet, `url()` in a `style` attribute, a font) reached neither the
  application nor another origin; the runtime ran; `import()` and scripts it
  created were refused; `fetch` was refused by `connect-src 'none'`;
  `window.origin` was `"null"`, with or without the header. With core
  2.1.0's runtime, a module's `<link>` (preconnect, dns-prefetch, prefetch,
  preload, a bound `href`, one re-created by foreign content) and an
  `<iframe srcdoc>` open no connection in Chromium 151, Firefox 153 or
  WebKit 26.5 (formajs's `e2e/frame.spec.ts`).
- **Trusted Types in Report-Only** (DR-20, SR15; FORMA-127, the
  forma-server half). A page carries
  `Content-Security-Policy-Report-Only: require-trusted-types-for
  'script'; trusted-types forma forma-runtime` beside its enforced policy
  when the application names a reporting endpoint (`report_to`,
  `report_uri`), in every build, and with no endpoint in development builds
  (`cfg(debug_assertions)`) only, where Chromium and Firefox show its
  violations in the console. A release build with no endpoint sends no
  Report-Only header: it would report to nobody, and WebKit logs a console
  error on every page whose Report-Only policy names no `report-to` ("the
  policy will have no effect", found by FORMA-138's packed-set run). With
  the header, a string written to a
  script-carrying DOM sink, or a Trusted Types policy other than core's
  `forma` and `forma-runtime`, is reported and not blocked, for this release;
  3.0.0 enforces it (FORMA-109). Written by `PageResponse` (`try_render`,
  `render_browser_shell` and the `into_page_response` bridge) and by the
  deprecated `PageOutput::headers()`; the enforced policy, `build_csp_header`
  and `PageOutput::csp` are byte-identical to 0.2.1, so the 0.2.1 goldens
  (document and enforced policy) do not move. A page whose application sets
  its headers from `PageOutput::csp` by hand gets no Report-Only header.
  Tests: `tests/trusted_types_report_only.rs` >
  `trusted_types_go_out_in_report_only_with_an_endpoint_or_in_a_debug_build_and_the_enforced_policy_is_unchanged`
  (on both profiles, as are the frame and property tests);
  `csp::tests::csp_is_strict` (both directives, Forma's two policies, no
  `'allow-duplicates'`, and SR39: `style-src-attr 'unsafe-inline'` the
  policy's only `'unsafe-inline'`, with every extension too); the 2,000-case
  property in `tests/page_response.rs` asserts SR39 and the Report-Only
  policy on every accepted extension set, and now names reporting
  endpoints too (valid, loopback and the review's hostile ones).

  **Not quite behaviour-neutral:** with `require-trusted-types-for 'script'`
  in any policy, Report-Only included, a browser runs the page's own
  Trusted Types `default` policy, if it registered one, on every string
  written to a script-carrying sink and uses what it returns; under 0.2.1
  nothing ran. An application with a `default` policy is already Trusted
  Types-aware; it should check that policy before upgrading (review
  5517672933, measured in Chrome for Testing 156).
- **`PolicyExtensions::report_to(endpoint)` and `report_uri(endpoint)`**, the reporting endpoint the
  application names (DR-20, SR8, L-38): a path on its own origin, an
  `https://` URL, or `http://` on a loopback host. It is written into both
  policies as `report-to forma-csp` with `Reporting-Endpoints:
  forma-csp="<endpoint>"` (the Reporting API: Chrome and Edge, Safari 16.4+,
  Firefox 149+ for CSP) and `report-uri <endpoint>` (Firefox before 149;
  ignored where `report-to` is supported), per MDN's compatibility data at
  `4d6aed6`. The endpoint therefore takes both `application/reports+json`
  and `application/csp-report` bodies. Its obligations, documented on the
  method, are the application's: store report URLs without query strings,
  bound each report's size and the request rate, alert per route and
  directive above a baseline, deduplicated. An endpoint carrying `;`, `,`, a
  quote, a backslash, whitespace or a fragment, starting with `//`, or using
  another scheme fails the page (`PolicyError` for `report-to`). Without an
  endpoint nothing changes. **Over plain HTTP, `http://localhost`
  included, `report_uri(endpoint)`** instead: Chrome and Firefox take
  `Reporting-Endpoints` only from an HTTPS page and, once a policy names
  `report-to`, ignore `report-uri`, so an HTTP page with both reports
  nothing, on `localhost` too, although it is a secure context;
  `report_uri` writes `report-uri` alone, which every current engine sends
  from HTTP. Checked in Chrome 155 with this branch, and in Chrome 156 and
  Firefox Nightly 155 by its review: `report_to` over HTTPS delivered one
  `application/reports+json` report for a string written to `innerHTML`, and
  the page rendered; the same over HTTP, on `localhost` or another host,
  delivered none; `report_uri` over HTTP delivered one
  `application/csp-report`. An absolute endpoint's authority is a host and
  an optional port, never userinfo (a credential there would go to every
  visitor), and a loopback `http://` endpoint is accepted in development
  builds only: in a release build it would send each visitor's reports to
  their own machine, so it fails the page like any invalid endpoint. Tests:
  `tests/trusted_types_report_only.rs` >
  `a_named_endpoint_is_written_into_both_policies_and_reporting_endpoints`,
  `an_invalid_endpoint_fails_the_page_on_every_path`;
  `csp::tests::endpoints_accept_a_path_https_or_loopback_http_and_refuse_the_rest`.
- **`PolicyExtensions::relax_trusted_types(reason)`**, the named per-route
  relaxation (DR-20's bridge; one of SR8's allowlisted exits, so the lint
  finds it by name). In 0.2.x it changes no header, since Trusted Types are
  Report-Only everywhere; from 3.0.0 the route keeps them Report-Only while
  the others enforce. Its violations are still reported. Each relaxed route
  is logged, once per route and reason per process, as a `tracing` warning
  with the route and `reason`; the log allocates nothing after a pair's
  first render and names at most 1,024 pairs, then says once that
  `route_pattern` must be a pattern, not a request path; an empty `reason` fails the page (`PolicyError` for
  `trusted-types`). Test: `tests/trusted_types_report_only.rs` >
  `a_relaxed_route_keeps_reporting_and_is_logged_once_per_route_and_reason`;
  `tests/relaxation_log_bound.rs` >
  `the_relaxation_log_names_at_most_1024_pairs_and_then_says_so_once`.
- **`PageResponse`**, a page that cannot be sent without its headers (DR-17,
  FORMA-124). As axum's `IntoResponse` it always writes `Cache-Control:
  no-store`, the strict policy for the nonce its HTML carries,
  `Cross-Origin-Opener-Policy`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy` and the HTML content type. Its HTML is reachable apart
  from those headers only through `into_parts_unchecked()`, one named,
  searchable exit returning `PageParts`; `counts()` returns the walk's bytes
  and time (`RenderCounts`). Get one from today's render with
  `PageOutput::into_page_response`, which refuses (a `PolicyError` for
  `content-security-policy`) a `csp` edited as text, since the policy is
  rebuilt from the nonce and the edit would be lost; it trusts the deprecated
  `nonce` and `html` as they are, so a fresh nonce per response holds only
  when the render drew it. Tests: `tests/page_response.rs` >
  `page_response_writes_no_store_the_policy_and_the_document_headers`,
  `two_fetches_get_no_store_and_two_different_nonces`,
  `into_parts_unchecked_returns_exactly_what_the_response_writes`,
  `a_page_response_counts_its_walk`; the `compile_fail` doctest on
  `PageResponse` (the HTML is private).
- **`PolicyExtensions`**, the typed way to loosen a page's policy (L-38):
  `img_src`, `frame_src`, `form_action` add one CSP source expression each
  (`'self'`, a scheme such as `https:` or `blob:`, or a host), and
  `allow_popups` sends `Cross-Origin-Opener-Policy: same-origin-allow-popups`
  for a login popup. Nothing else can be added, nothing can be removed, and a
  source carrying `;`, `,`, a quote, whitespace, a keyword other than
  `'self'`, a nonce, a hash or a bare `*` fails the page with a `PolicyError`
  naming the directive and the source, instead of reaching a header; so do
  the `javascript` and `vbscript` schemes in either form (`javascript:`,
  `javascript://host`, any case), and `data:` or `filesystem:` as a frame or
  form target (images keep `data:`). This
  replaces rewriting `PageOutput::csp` as text (GateWASM's console,
  Generative UI's `frame-src blob:`). Tests: `tests/page_response.rs` >
  `no_policy_extension_yields_a_response_without_the_policy` (2,000 generated
  extension sets, valid and hostile: every accepted one carries the whole
  strict policy), `an_invalid_extension_fails_instead_of_sending_a_page_without_the_policy`,
  `extensions_add_sources_to_their_own_directive_only`; `csp::tests` >
  `extension_sources_accept_what_consumers_add`,
  `extension_sources_refuse_injection_and_loosening`,
  `frame_and_form_targets_refuse_data_and_filesystem`; `tests/page_response.rs`
  > `into_page_response_refuses_a_policy_edited_as_text`.

- **`try_render(config, ctx) -> Result<PageResponse, RenderError>`**, beside
  `render_page` (DR-11, DR-12, L-3; FORMA-120). It never serves an empty shell
  in place of a failure: a missing module or slots, a walk the module or data
  fails, an exceeded budget (with the counts reached, SR22), an invalid policy
  extension, a failed nonce draw and a panic each return a `RenderError` with a
  stable code (`RENDER-101` to `RENDER-399`, by family), the route and the
  component path; Forma logs none of them (a caught panic still runs the
  process's panic hook, which by default prints it). A panic in the render is caught
  (`catch_unwind`) as `RenderError::Fault`, so the handler answers 500 and the
  next request renders, while the application unwinds on panic (SA8). The
  page's `RenderCounts` gain `nodes` and `list_iterations`. `RenderCtx` carries
  the policy extensions and the walk's `WalkLimits` (re-exported), never a
  nonce. Its documentation gives the `spawn_blocking` recipe for pages past
  about 12,500 nodes. Tests: `tests/try_render.rs` >
  `a_panicking_component_returns_fault_the_handler_answers_500_and_the_next_request_renders`
  (SR44), `a_component_failing_on_one_tenants_branding_fails_that_request_alone`
  (S2), one test per code (`render_101_…` to `render_399_…`, and
  `render::tests::render_202_a_failed_nonce_draw`),
  `try_render_writes_render_page_s_document_and_counts_the_walk`,
  `try_render_never_serves_a_shell_in_place_of_a_failure`;
  `render::tests::a_panic_outside_the_walk_is_still_a_fault`,
  `an_invalid_extension_fails_before_the_walk`.
- **RENDER-302 before the first row** (FORMA-122, SR38): through forma-ir's
  list pre-check, `try_render` refuses a list longer than the remaining
  iteration budget before walking any of it, its counts saying so
  (`list_iterations` 0). Test: `tests/try_render.rs` >
  `render_302_a_60_000_row_list_fails_before_its_first_row_in_under_a_millisecond`
  (and a list of exactly 50,000 rows renders). The deprecated `render_page`
  falls back to its shell sooner on the same input.
- **`render_browser_shell(config, ctx)`**: the bundle and the same headers
  around an empty root, for a route the build declares `ssr: false`; never in
  place of a failure. Test: `tests/try_render.rs` >
  `render_browser_shell_serves_the_bundle_around_an_empty_root_with_the_page_headers`.
- `CspNonce::try_generate` and `NonceError` (`#[non_exhaustive]`): the nonce
  draw that returns an error instead of panicking (DR-12).
- **Requires forma-ir 0.2.2** (`forma-ir = "0.2.2"`, FORMA-138): it calls
  `walk_to_html_counted`, `WalkCounts` and `IrError::Panicked`, which 0.2.1
  lacks, so a lockfile holding forma-ir 0.2.1 cannot build it.
- `IrLoadError::code()`: the failure's stable code, `LOAD-101` (declared but
  not embedded), `LOAD-102` (magic, version or flags: not a module this reader
  accepts) or `LOAD-103` (corrupt or truncated: sections, tables, opcodes,
  names), read from the start of `reason`, which now begins with it (FORMA-121).
- `tests/page_response.rs`'s policy property and invalid-extension tests now
  run over every path that makes a `PageResponse`: the bridge, `try_render`
  and `render_browser_shell`.
- `sw::ServiceWorker` (`off`, `for_app`, `enabled`, `is_enabled`, `app`),
  `sw::configure`, `sw::configured`, `sw::AppNameError`,
  `sw::AlreadyConfigured`: the setting, fixed once per process before the
  first page or `/sw.js`. `sw`'s module docs state the per-application cache
  name contract the build follows (`forma:<app>:<build>`; FORMA-130's build
  half). Tests: `tests/service_worker_off.rs` >
  `by_default_no_page_registers_a_worker`,
  `by_default_sw_js_is_the_retiring_worker_even_with_a_built_worker_embedded`,
  `configuring_after_the_first_use_is_refused`;
  `tests/service_worker_named_off.rs`; `tests/service_worker_on.rs` (pages
  register, the embedded worker is served, configured once);
  `sw::tests::application_names_are_what_a_cache_name_can_carry`, over
  `tests/js/app_name_vectors.json`, the accepted and refused names shared with
  `@getforma/build`'s `app` (the trailing-hyphen, one-character and
  double-hyphen edges included, and the hostile names);
  `sw::tests::the_retiring_worker_deletes_v1_s_caches_and_its_own_never_another_s`,
  which runs the worker in Node over `tests/js/retiring_worker.mjs`, whose
  table of cache names is the contract's shared vectors (anchored, separator
  and prefix near misses included; the script reports its own pass count, so
  the check holds under any Node test reporter, and a `self.onfetch`
  assignment counts as answering requests). `cargo test` now
  needs Node 18 or later on `PATH` (CONTRIBUTING).

- **`RawHtml::trusted(..)`, the one named raw-HTML type** (DR-19, SR15, TH8;
  FORMA-126). Markup a handler vouches for, written into the page unescaped;
  made only by `RawHtml::trusted` (no `From`, `Default`, `FromStr` or public
  field), so a search for that name finds every raw entry, which is what
  SR8's allowlist lint will look for. `body_prefix` takes it bound first and
  borrowed, `let logo = RawHtml::trusted(..);` then `body_prefix:
  Some(&logo)`: it dereferences to the markup, so the 0.2.x field
  (`Option<&str>`) accepts it and the same line compiles in 3.0.0, where the
  field takes only a `RawHtml`. (Written inline,
  `Some(&RawHtml::trusted(..))` borrows a temporary that Rust 1.85, the
  MSRV, drops at the end of the statement: E0716 there.) Written exactly as
  the same text passed as a string. Tests: `tests/raw_html.rs` > `a_search_finds_one_raw_constructor`
  (in the crate's sources the `html` field is initialised only in
  `trusted`, whatever type name or `Self` precedes it; the trait impls, the
  inherent functions and the functions returning a `RawHtml`, however the
  type is path-qualified, are exact lists; no other name for the type (a
  `type` alias, a `use .. as` rename) and no `r#html`; and sixteen second
  constructors, the two reviews' seven among them, each written into a copy
  of the sources, are found), `the_documented_body_prefix_form_compiles_on_the_msrv_and_renders`
  (the bound form, compiled by the 1.85 MSRV job),
  `a_raw_html_body_prefix_is_written_exactly_as_the_same_string_on_every_path`
  (`render_page`, `render_page_with_nonce`, `try_render`,
  `render_browser_shell`); the `compile_fail` doctests on `RawHtml`
  (`From<String>`, `From<&str>`, `parse`, `default`, a struct literal).
- **Typed homes for what applications put in `body_prefix` that is not their
  own markup** (DR-19; FORMA-126), written only by `try_render` and
  `render_browser_shell`, through `RenderCtx`:
  - `RenderCtx::with_module_preloads(&ModulePreloads)`: forma-server writes
    the route's `modulepreload` links from the build's manifest (the
    `modulepreload` list `@getforma/build` writes with `codeSplitting`), each
    with the page's nonce, after the route's own modules: the home for
    Ledger's preload workaround. `assets::try_load_module_preloads::<A>()`
    reads the table at start and refuses a manifest whose preload names a
    file that is not one of the build's `assets` (another origin, a path,
    markup); the route's own modules and repeats are left out. Tests:
    `tests/typed_homes.rs` >
    `try_render_writes_the_routes_manifest_modulepreload_links_nonced` (three
    routes, both renders, the nonce the policy blesses),
    `a_manifest_preload_that_is_not_one_of_the_builds_files_refuses_the_table`;
    `head::tests::a_preload_must_be_one_of_the_builds_files`.
  - `RenderCtx::with_head_link(HeadLink)`: a `<link>` in the head (an icon, a
    canonical URL, a feed), every value escaped, written after the
    stylesheets and preloads in the order added: the home for ksx Studio's
    `</head>` splice. `HeadLink::new(rel, href)` takes a closed list of link
    types, none of which loads style or script: `icon`, `apple-touch-icon`,
    `mask-icon` (images, under `img-src`), `manifest`, `canonical`,
    `alternate`, `author`, `license` (metadata), `preconnect`, `dns-prefetch`
    (connection hints), matched without regard to case. It refuses, with a
    `HeadLinkError` and its `code()`: `HEAD-101` for `stylesheet`,
    `modulepreload`, `preload`, `prefetch`, `prerender` and `import` (a
    page's stylesheets and module preloads come from the build's manifest);
    `HEAD-102` for any other word; `HEAD-103` for a `javascript:` or
    `vbscript:` href, in any case and with the tabs, newlines and leading
    controls a browser strips; `HEAD-104` for an empty href. `with_type`,
    `with_sizes` add attributes. A `manifest` link needs `manifest-src`,
    which the default policy (`default-src 'none'`) does not grant and
    `PolicyExtensions` cannot add, so it is refused by the browser today
    (documented on `HeadLink`). Tests: `tests/typed_homes.rs` >
    `head_links_are_written_escaped_in_the_head_in_the_order_added`,
    `a_head_link_carries_only_the_listed_link_types` (every kept type, every
    loading type, and every other link type the HTML standard defines),
    `a_head_link_refuses_a_script_url_and_keeps_every_other`;
    `head::tests::script_urls_are_recognised_as_a_browser_reads_them`.
  - Data: `PageConfig::config_json`, as before (and in 3.0.0 the state block).
  The deprecated `render_page` takes no `RenderCtx` and writes the document
  0.2.1 wrote (`tests/compat_0_2_1.rs`).
- **`IrModules<A>`: in development, a page's module is reread when the
  build's watch mode rewrites it** (FORMA-166; L-31, N7; FORMA-022 is the
  build's half). `IrModules::<Assets>::load(&manifest)` is the strict loader
  (the same check, the same `LOAD-1xx` errors, refuse to start on them), and
  `get(route)` returns the route's module as an `Arc<IrModule>`. In a debug
  build (`cfg(debug_assertions)`, the switch rust-embed itself uses to read
  files from disk) each `get` rereads the manifest's entry and the module's
  file, and loads a changed module through the same check: the next request
  serves the edit with no restart. A module that fails to load keeps the
  previous one and logs its coded error as a `tracing` warning, once per
  distinct write; a route the manifest starts naming is loaded on its first
  `get`. A release build does no file watching and no per-request check:
  `get` is a map lookup over the modules loaded at start. No watcher thread
  and no new dependency. Opt-in: `load_ir_modules_strict` is unchanged.
  Tests: `tests/dev_reload.rs` >
  `an_edited_page_is_served_on_the_next_request_and_a_broken_edit_keeps_the_previous_page`
  (real rust-embed over files published by rename, debug builds);
  `ir_compat::reload_tests` >
  `a_release_build_reads_nothing_per_request_and_a_debug_build_rereads` (on
  the release profile: no read after start, the start's module served),
  `the_reload_loads_through_the_strict_loader_at_start`,
  `development::a_module_that_fails_to_load_keeps_the_previous_one_and_is_logged_once_with_its_code`,
  `development::the_manifest_can_rename_a_module_or_name_a_new_one_and_a_bad_one_changes_nothing`;
  `tests/strict_loader.rs` >
  `ir_modules_load_refuses_exactly_what_the_strict_loader_refuses`.

### Deprecated

Each still compiles and behaves as at 0.2.1, warns, and goes in 3.0.0:

| Deprecated in 0.2.2 | Use instead (3.0.0's form) |
|---|---|
| `render_page(config)` | `try_render(config, &RenderCtx::new())`, which returns `Result<PageResponse, RenderError>`; `render_browser_shell` for a route the build declares `ssr: false` |
| `render_page_with_nonce(config, nonce)` | `try_render`: the render draws the nonce, and 3.0.0 takes none from a caller |
| `load_ir_modules(manifest)`, the lenient loader | `load_ir_modules_strict(manifest)` at start, refusing to start on its errors (or `IrModules`, which loads the same way) |
| `assets::load_manifest()` | `assets::try_load_manifest()`; in 3.0.0 `load_manifest` itself returns the `Result` |
| `PageOutput`'s public `html`, `csp` and `nonce` fields, and `PageOutput::headers()` | a `PageResponse`: from `try_render`, or `PageOutput::into_page_response` for 0.2.1 code; extend the policy with `PolicyExtensions`, never as text. The fields go private in 3.0.0 |
| `PageConfig::config_script` | `PageConfig::config_json` for data, and the page's bundle for code; set it to `None` until 3.0.0 removes it |
| a plain string in `PageConfig::body_prefix` | `RawHtml::trusted(..)`, bound first and passed as `Some(&raw)`; the route's preloads through `RenderCtx::with_module_preloads`, head links through `RenderCtx::with_head_link`, data through `config_json` |
| `AssetManifest::wasm` and `WasmAssets` (and the `window.__FORMA_WASM__` script) | none in forma-server: islands re-render with `@getforma/core`'s `h()` |

- `load_ir_modules`, the lenient loader: it serves a corrupt module's route as
  an empty shell for the life of the process. `load_ir_modules_strict` is the
  default loader (DR-11, Q13; FORMA-121): call it at start and refuse to start
  on its errors, before the port binds. The lenient loader behaves exactly as
  at 0.2.1, and in debug builds logs its deprecation once per process. Tests:
  `tests/strict_loader.rs` >
  `a_flipped_byte_fails_the_default_loader_naming_route_file_and_code`,
  `a_truncated_module_fails_the_default_loader_naming_route_file_and_code`,
  `with_a_bad_module_the_fixture_server_binds_no_port` (and its other side,
  `the_same_server_binds_and_serves_with_good_modules_or_the_lenient_loader`),
  `a_route_declared_ssr_false_needs_no_module`,
  `the_deprecated_lenient_loader_behaves_as_at_0_2_1`;
  `tests/load_ir_modules_deprecation.rs`. The fixtures are written by code in
  the test file and pinned to it (`module_fixtures_are_what_their_generator_writes`).
  FMIR v2 has no checksum: a flipped byte that no structure check reaches (in
  the source hash, or inside a text string) still loads, as the fixtures
  record; FMIR v3's CRC-32 closes that (DR-28, FORMA-114).
- `render_page`: it serves the empty Phase 1 shell with a 200 on any failure.
  Use `try_render` (DR-11). It keeps its fallback until 3.0.0, and in debug
  builds logs its deprecation once per process (`tests/render_page_deprecation.rs`
  > `render_page_logs_its_deprecation_once_per_process_in_debug_builds`).
- `assets::load_manifest`, which panics on a missing or malformed manifest:
  use `try_load_manifest` (L-13).
- `PageOutput`'s public fields `html`, `csp` and `nonce`, and
  `PageOutput::headers()`, which drops an invalid policy silently: send a
  `PageResponse` (DR-17). The fields go private in 3.0.0.
- `PageConfig::config_script`, which writes handler text into a nonced script
  (TH4): pass data through `config_json`, move code into the bundle (DR-18).
  Every `PageConfig` literal names the field, so `config_script: None` warns
  too; it is removed in 3.0.0.
- `render_page_with_nonce`: from 3.0.0 the render draws every nonce and no
  caller supplies one (L-14). Use `try_render`.
- A plain string in `PageConfig::body_prefix` (DR-19; FORMA-126): it is
  written exactly as before, and in debug builds the first one a process
  renders logs a warning, code `RAW-101`, naming the route; a `RawHtml` never
  does, and release builds keep no record and check nothing. 3.0.0 accepts
  only a `RawHtml`. To tell the two apart a debug build remembers the address
  and length of every live `RawHtml`'s markup (`raw::provenance`). Tests:
  `tests/body_prefix_string_warning.rs` >
  `a_string_body_prefix_warns_once_per_process_in_debug_builds_and_a_raw_html_never_does`
  (debug and release); `raw::provenance::tests`.
- `AssetManifest::wasm` and `WasmAssets`, the WASM walker's entry in the
  manifest (FORMA-131, DR-23). The walker is deprecated across the stack:
  `@getforma/core/wasm`, forma-ir's `wasm` feature and `@getforma/build`'s
  `wasm` key all go in 3.0.0. With them goes the nonced
  `window.__FORMA_WASM__` script a page gets when the manifest names a
  walker and its route has an `.ir` module; until then that page is
  unchanged. Every `AssetManifest` literal names the field, so `wasm: None`
  warns too. Doctest pairs: `ManifestWasm`, `ManifestWasmLiteral`,
  `WasmAssetsType`.
- Each `#[deprecated]` item (seven rows of the table above, eleven
  attributes) is pinned by a doctest pair in `src/deprecations.rs` (the 0.2.1
  call compiles under `allow(deprecated)` and fails under
  `deny(deprecated)`). The eighth row, a plain string in
  `PageConfig::body_prefix`, carries no `#[deprecated]` (the field's type is
  unchanged) and warns only at run time in debug builds, pinned by
  `tests/body_prefix_string_warning.rs`. And `tests/compat_0_2_1.rs` calls the whole 0.2.1 page
  API as an application does; its
  `render_page_writes_the_0_2_1_document_byte_for_byte` compares the
  document and policy against goldens written by 0.2.1 itself.

### Changed
- **The service worker is opt-in, and retired everywhere else** (FORMA-130;
  DR-25, Q15, M25). By default no page registers `/sw.js` any more, and
  `serve_sw` answers `/sw.js` with forma-server's *retiring worker* instead of
  the `sw.js` the build embedded: a browser that installed a worker from an
  earlier release receives it on its next visits, and it deletes Forma's v1
  cache names (`forma-dev`, `forma-` + 12 hex, either with `-on-demand-v1`),
  keeps every other cache, unregisters, and answers no request, so pages and
  assets load from the network. An application that wants its worker (today
  Ledger, Q15) turns it on once at start:
  `forma_server::sw::configure(ServiceWorker::for_app("ledger")?.enabled())`;
  its pages then register `/sw.js` as at 0.2.1 and `serve_sw` serves the
  embedded worker. Naming the application with the worker off (a rollback)
  makes the retiring worker delete that application's own caches too. The
  retiring worker is served through 3.x. `render_page`'s document therefore
  differs from 0.2.1's by exactly that one registration line:
  `tests/compat_0_2_1.rs` > `render_page_writes_the_0_2_1_document_byte_for_byte`
  takes it out of 0.2.1's goldens, once, and checks every other byte.

  **Migration: delete any code that strips or asserts the registration
  script.** 0.2.2 writes none by default, so code that looks for it now finds
  nothing. fAuth's (formerly GateWASM) `render_page` wrapper `debug_assert!`s
  the line before stripping it, so every debug-build render panics on 0.2.2
  until the wrapper changes (FORMA-150), and its `forma-server = "0.2.0"`
  requirement lets a plain `cargo update` bring 0.2.2 in. No application
  gates this release (L-53): fAuth is fixed forward when it migrates, and
  pins `=0.2.1` until then.
  An application that enables its worker with no `sw.js` embedded is warned
  once, at the first `/sw.js` request (`tests/service_worker_on.rs` >
  `an_enabled_application_with_no_built_worker_is_told_once`).
- `load_ir_modules_strict` no longer logs "Phase 1 fallback" for the failures
  it returns: it takes no fallback, and the caller holds every failure. The
  lenient loader still logs each one. Each failure's `reason` now starts with
  its code (`LOAD-101` to `LOAD-103`), so `Display` names route, file and code.
- **No `unwrap`, `expect` or `panic!` in the shipped code** (DR-12, SR44):
  Clippy denies them outside tests. `serve_asset` and `serve_sw` answer 500
  rather than panic if a response fails to build (it cannot with today's
  headers). `CspNonce::generate`, `assets::asset` and the deprecated
  `assets::load_manifest` keep their documented 0.2.1 panics under a scoped
  `allow`, each beside its fallible twin; none is on the render path.
- `build_csp_header` writes from the directive table the extensions share; its
  output is byte-identical to 0.2.1 (`csp::tests` >
  `build_csp_header_is_byte_identical_to_0_2_1`).

### Fixed (documentation only)
- `RouteAssets::ir`'s doc comment names its value as the build writes it, the
  hashed `.ir` file name, not a `.fmir` module (FORMA-009).

## [0.2.1] - 2026-10-14

### Fixed
- **A second `Embed` type's assets no longer answer 404 in release builds.**
  `is_embedded` cached the release file list in a `static` declared inside the
  generic function, and Rust shares such a static across every instantiation,
  so the first type `serve_asset` served filled it and every other type's valid
  assets were refused. Debug builds never cached, so only release builds
  failed. The cache is now keyed by `TypeId`: one write-once slot per type, read
  without a lock, and a type beyond the four slots is checked by scanning its
  list. Tests: `tests/asset_sets.rs` > `two_embed_types_each_serve_their_own_assets`
  and `assets::tests::more_embed_types_than_cache_slots_each_serve_their_own_assets`;
  CI now runs this crate's suite with the release profile (`test-release`).

### Changed
- `serve_asset::<A>` now states the `A: 'static` bound the `TypeId` key needs.
  Mounting the handler on an axum route already required it, and every
  `#[derive(Embed)]` type meets it. One pattern breaks: a generic function
  that calls `serve_asset::<A>` with only `A: Embed` compiled on 0.2.0 and now
  fails with E0310. It must now state `A: Embed + 'static`.

## [0.2.0] - 2026-08-06

### Fixed
- **`rust-version` was a fiction.** The manifest declared 1.70; this crate has
  never been able to build below 1.85 (rust-embed 8 pulls sha2 0.11). Corrected
  and pinned by a CI job that builds at exactly the declared version. Note it
  is deliberately *not* the same as forma-ir's 1.71.

### Added
- **`#![forbid(unsafe_code)]`** — the README's "zero unsafe" is compiler-
  enforced now. Every public item is documented.
- Faster page renders for any route with a list: see forma-ir 0.2.0, which
  takes a 400-row table from 31.5 ms to 0.15 ms.

### Security
- **`personality_css` `</style>` breakout actually prevented.** The 0.1.3 guard
  was a literal two-case string replace (`</style>` and `</STYLE>`), but HTML
  tag names are case-insensitive and the tokenizer accepts whitespace and `/`
  before `>` — `</StYlE>`, `</style >`, `</style\t>` and `</style/>` all escaped
  the element and injected markup into `<head>`. Now the `</` sequence itself is
  neutralised as a CSS escape (`<\/`), which is lossless for real CSS and is the
  only complete answer for a RAWTEXT element. Note `\00003c` was rejected as the
  fix: it is an ident-start escape, so it silently breaks `@media (width < …)`.
- **`config_script` can no longer break out of its `<script>` element.**
  `</script` and `<!--` are neutralised (case-insensitively) as JS identity
  escapes. This does not make the field safe for untrusted data — it is
  documented as a raw, trusted escape hatch. New `PageConfig::config_json` is
  the safe path: serialised with every `<` escaped and emitted as
  `window.__FORMA_CONFIG__`.
- **`script-src` now carries `'strict-dynamic'`.** Without it the `'self'`
  host-source stays live alongside the nonce, so any same-origin URL reflecting
  attacker-controlled bytes was loadable as `<script src>`. Added explicit
  `worker-src 'self'` (strict-dynamic does not cover workers) and
  `object-src 'none'`.
- **`style-src-attr 'unsafe-inline'` added.** A nonce in `style-src` drops
  `unsafe-inline` semantics and cannot be attached to an attribute, so the
  previous policy silently broke every `style:` binding the framework's own
  compiler emits. Style elements stay nonce-locked via the `style-src-elem`
  fallback.
- Nonces are now a validating `CspNonce` type — they are interpolated unescaped
  into five HTML attributes and into the policy, so a caller-supplied string was
  an injection sink.
- `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy` added to
  the service worker and asset responses; document responses gain
  `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy` via
  `PageOutput::headers()`.
- Asset filenames are validated for exact membership in the embedded file list,
  closing the debug-only Windows aliases (`APP.JS`, `app.js::$DATA`) that 404ed
  in release. `manifest.json` (route table + asset graph) and direct `.br`/`.gz`
  requests are refused.

### Fixed
- `Accept-Encoding` is parsed properly instead of substring-matched. `br;q=0` —
  the standard way to say "I cannot decode brotli" — was read as acceptance and
  produced an undecodable response; `x-brotli-nope` matched as brotli; and an
  asset with only a `.gz` sibling was served raw to a br+gzip client.
- `Cache-Control: immutable` is applied only to content-hashed filenames. It was
  applied to everything the route could reach, pinning `sw.js`, `index.html` and
  un-hashed fonts for a year with no way to invalidate them. Un-hashed assets now
  revalidate, with a strong `ETag` and `304` support so that costs nothing.
- MIME table extended (images, fonts, `.mjs`, `.map`, `.xml`, `.webmanifest`) and
  matched case-insensitively, anchored after the last path separator. The
  load-bearing gap was case sensitivity plus `.mjs`: with `nosniff` set, a script
  served as `application/octet-stream` is hard-blocked.
- Asset bodies are no longer heap-copied per request. `rust-embed` hands back a
  `&'static [u8]` in release builds; every response copied it, so N concurrent
  requests for the WASM binary allocated N full copies.
- A manifest route declaring an `.ir` file that is not embedded is now logged and
  recorded as `Phase1ClientMount`. It used to fall through silently — literally
  indistinguishable from a route that never had IR.

### Added
- `PageConfig::config_json` — safe server-data channel (`window.__FORMA_CONFIG__`).
- `PageOutput::nonce` and `render_page_with_nonce` — cache-aware callers can
  supply a per-request nonce instead of parsing it back out of the CSP string.
- `PageOutput::headers()`, `document_security_headers()`, `asset_security_headers()`.
- `load_ir_modules_strict` — returns the collected `IrLoadError`s so an app can
  fail startup on a build/embed skew instead of quietly shipping without SSR.
- `try_asset` / `try_load_manifest` — fallible variants; `asset`/`load_manifest`
  are documented startup-only because they panic.

### Changed (breaking)
- `PageConfig` gained `config_json`; `PageOutput` gained `nonce` and is now
  `#[non_exhaustive]`.
- `generate_csp_nonce()` returns `CspNonce`; `build_csp_header` takes `&CspNonce`.
- `asset_bytes` returns `Option<Bytes>` (re-exported as `forma_server::Bytes`).
- `check_ir_compatibility` was **removed**. Its version check was unreachable —
  `IrModule::parse` already rejects a mismatched version with
  `UnsupportedVersion` — while its docstring implied it was a live gate.
- `serve_asset` now 404s `manifest.json` and direct `.br`/`.gz` requests.

## [0.1.3] - 2026-03-17

### Security
- Template interpolations escaped: asset URLs, body_class, personality_css
- `</style>` breakout prevention in personality CSS
  — **this claim was not true**; see the 0.2.0 entry for the real fix

### Added
- README for crates.io with full documentation
- 4 new security tests (escape_html, asset XSS, body_class escaping, CSS breakout)
- Crate-level `//!` documentation

## [0.1.1] - 2026-03-14

### Fixed
- Dependency on `forma-ir` versioned correctly

## [0.1.0] - 2026-03-13

### Added
- Initial release: page rendering, asset serving, CSP headers, service worker
- Phase 1 (client mount) and Phase 2 (SSR reconcile) rendering modes
- 14 tests
