# Changelog

## [Unreleased]

Release A2's bridge (0.2.2): additive. Every 0.2.1 call compiles and behaves
as before, except one default: the service worker is off unless the
application turns it on (FORMA-130, under Changed). The old forms warn as
deprecated and go in 3.0.0.

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
- **Requires forma-ir 0.2.2** (`walk_to_html_counted`, `IrError::Panicked`).
  The manifest still says `forma-ir = "0.2.0"` until the A2 release raises it
  with the version (FORMA-138): until then a lockfile holding forma-ir 0.2.1
  would not build this crate.
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
  `sw::tests::application_names_are_what_a_cache_name_can_carry`;
  `sw::tests::the_retiring_worker_deletes_v1_s_caches_and_its_own_never_another_s`,
  which runs the worker in Node over `tests/js/retiring_worker.mjs`, whose
  table of cache names is the contract's shared vectors. `cargo test` now
  needs Node 18 or later on `PATH` (CONTRIBUTING).

### Deprecated
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
  caller supplies one (L-14).
- Each deprecation is pinned by a doctest pair in `src/deprecations.rs` (the
  0.2.1 call compiles under `allow(deprecated)` and fails under
  `deny(deprecated)`), and `tests/compat_0_2_1.rs` calls the whole 0.2.1 page
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
