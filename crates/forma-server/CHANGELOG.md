# Changelog

## [Unreleased]

Release A2's bridge (0.2.2): additive. Every 0.2.1 call compiles and behaves
as before; the old forms warn as deprecated and go in 3.0.0.

### Added
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
  component path; Forma logs none of them. A panic in the render is caught
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
- **`render_browser_shell(config, ctx)`**: the bundle and the same headers
  around an empty root, for a route the build declares `ssr: false`; never in
  place of a failure. Test: `tests/try_render.rs` >
  `render_browser_shell_serves_the_bundle_around_an_empty_root_with_the_page_headers`.
- `CspNonce::try_generate` and `NonceError`: the nonce draw that returns an
  error instead of panicking (DR-12).
- `tests/page_response.rs`'s policy property and invalid-extension tests now
  run over every path that makes a `PageResponse`: the bridge, `try_render`
  and `render_browser_shell`.

### Deprecated
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
  caller supplies one (L-14).
- Each deprecation is pinned by a doctest pair in `src/deprecations.rs` (the
  0.2.1 call compiles under `allow(deprecated)` and fails under
  `deny(deprecated)`), and `tests/compat_0_2_1.rs` calls the whole 0.2.1 page
  API as an application does; its
  `render_page_writes_the_0_2_1_document_byte_for_byte` compares the
  document and policy against goldens written by 0.2.1 itself.

### Changed
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
