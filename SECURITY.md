# Security Policy

This repository holds the whole Forma Stack since the repository merge
(FORMA-113). Each half keeps its own policy, because their trust boundaries
differ:

| Part | Policy |
|---|---|
| The crates (`forma-ir`, `forma-ir-derive`, `forma-server`) | The rest of this file |
| `@getforma/core` (`packages/core`) | [`packages/core/SECURITY.md`](packages/core/SECURITY.md), with [`packages/core/CSP.md`](packages/core/CSP.md) |
| `@getforma/compiler`, `@getforma/build`, `@getforma/create-app` | No policy of their own; report as below |

Report a vulnerability in any part as the next section says.


## Reporting Vulnerabilities

Report security vulnerabilities to **victor@getforma.dev**. Do not open public issues for security reports. We will respond within 48 hours.

## Security Properties

### forma-ir

**Threat model — read this first.** FMIR is a **trusted input**. `forma-ir` validates structure and bounds so that malformed IR cannot read out of bounds, panic, or abort the process. It does *not* treat the IR itself as hostile content that must be neutralised: tag names, attribute names and static attribute values come from the module's own string table, and while names are now validated against an HTML name charset, an IR file you did not compile can still choose what markup your page contains. **Only run IR produced by a compiler you trust.**

For 3.0, every FMIR module must come from the application's own build. A module from any other source requires M9 before admission. M9, M10 and design5 are deferred; 3.0 does not provide an untrusted-module admission mechanism. Structural validation does not establish who produced a module (SA4).

Given that boundary:

- Dynamic HTML text and attribute *values* are escaped (`&`, `<`, `>`, `"`)
- Tag and attribute *names* are validated against `[A-Za-z_:][-A-Za-z0-9_:.]*` — an invalid tag name is an error, an invalid attribute name is dropped
- URL-bearing attributes (`href`, `src`, `action`, `formaction`, `xlink:href`, `poster`, `background`, `data`) are scheme-checked after browser-equivalent normalisation, and `on*` event-handler attributes are dropped — matching what `@getforma/core` does client-side, so SSR and CSR agree
- HTML comment content escaped (`--` → `&#45;&#45;`), and a leading `>` / `->` cannot self-close the comment
- Island props JSON is escaped so it cannot terminate or re-open its enclosing `<script>` element (covers `</script`, `<!--` and `<script`). Consumers must read it with `JSON.parse`, never by string-matching the raw text
- Binary parser validates all bounds before reading (no buffer overflows), and rejects declared table counts the section cannot possibly hold
- The opcode stream is structurally validated once at parse time: control-flow regions must tile exactly, island offsets must point at their own `ISLAND_START`, and slot/island ids must be unique and declared
- Reserved header `flags` must be zero — unknown future extensions fail closed rather than being mis-parsed
- Recursion depth limited to 64; list nesting limited to 4 levels
- Rendered output capped (default 8 MiB) and total LIST iterations capped (default 50,000) per render, both configurable via `WalkLimits`
- Zero `unsafe` blocks — enforced by `#![forbid(unsafe_code)]` on both library crate roots, so this is a compile error rather than a claim. (The allocation-counting harness in `crates/forma-ir/tests/list_scaling.rs` implements `GlobalAlloc` and is necessarily `unsafe`; it is a test target and ships in nothing.)

Known residual: an *under*-long control-flow length whose orphaned bytes still decode as a legal sibling sequence is structurally indistinguishable from a legitimate module, so no length check can reject it. Closing that class needs module integrity (the FMIR header reserves `source_hash` for it; the compiler currently writes zero).

### forma-server

- CSP headers with 256-bit cryptographic nonces (ring CSPRNG), wrapped in a validating `CspNonce` type so a caller-supplied nonce cannot break out of an HTML attribute or the policy itself
- `script-src` uses `'nonce-…' 'strict-dynamic' 'self'`. Without `'strict-dynamic'` the `'self'` host-source stays live alongside the nonce, so any same-origin URL reflecting attacker-controlled bytes is loadable as `<script src>`
- Script sources and style *elements* are nonce-locked, with no `unsafe-inline` and no `unsafe-eval`. Style *attributes* are permitted via `style-src-attr 'unsafe-inline'`, because compiled `style:` bindings emit them and a nonce cannot be attached to an attribute. `style-src-elem` falls back to the nonce-locked `style-src`, so `<style>` blocks stay strict. (`style-src-attr` is CSP3; older engines ignore it and fall back to blocking attribute styles — fail-closed.) That allowance is the policy's only `'unsafe-inline'` (asserted by `csp_is_strict`).
- Trusted Types (from 0.2.2): a page carries `Content-Security-Policy-Report-Only: require-trusted-types-for 'script'; trusted-types forma forma-runtime` beside its enforced policy when the application names a reporting endpoint, and with none in development builds only (a released Report-Only policy with no endpoint would report to nobody, and WebKit logs an error for it on every page; a development build with no endpoint still triggers that error in WebKit, and `report_uri` silences it; "development build" is forma-server's own `debug_assertions`), so a string written to a script-carrying DOM sink is reported, not yet blocked; 3.0.0 enforces it. A check that Trusted Types raise zero reports or violations must therefore name an endpoint or run against a debug build: a release build with no endpoint sends no Report-Only policy, and the check would prove nothing. An application names a reporting endpoint with `PolicyExtensions::report_to` (written into both policies as `report-to` with a `Reporting-Endpoints` header, and `report-uri` for engines without `report-to`), or, for pages served over plain HTTP (`http://localhost` included), where Chrome and Firefox send no Reporting API report, `PolicyExtensions::report_uri` (`report-uri` alone); an endpoint's authority never carries userinfo, and a loopback `http://` endpoint is refused in release builds; the endpoint is the application's, and must store report URLs without their query strings, bound each report's size and the rate it accepts, and alert per route and directive above a baseline. `PolicyExtensions::relax_trusted_types` is the named, logged per-route relaxation, an exit for an application's raw-entry allowlist (`forma-raw-lint`)
- `worker-src 'self'` is explicit because `'strict-dynamic'` does not cover workers
- Asset serving via `rust-embed` prevents path traversal; requested filenames are additionally checked for exact membership in the embedded file list, so debug (filesystem) and release (compiled-in) builds agree and Windows filename aliases do not resolve
- `manifest.json` and direct `.br`/`.gz` requests are refused on the asset route
- Template interpolations are HTML-escaped, **except** two documented raw sinks: `PageConfig::config_script` (raw JS — `</script`/`<!--` are neutralised so it cannot escape its element, but its *contents* are trusted; deprecated in 0.2.2, removed in 3.0.0) and `PageConfig::body_prefix` (raw HTML: pass a `RawHtml`, made only by `RawHtml::trusted`, so every raw entry is found by that name; a plain string still works in 0.2.x and warns once per process in debug builds). Use `PageConfig::config_json` for anything derived from user input — it is serialised with every `<` escaped
- Content nobody reviewed renders only in the preview frame (from 0.2.2): `PageResponse::frame` writes its document with, in the enforced header, `sandbox allow-scripts` (no `allow-same-origin`, so an opaque origin), `frame-ancestors` the application's origin, `script-src` the inline runtime's SHA-256 (no script it creates or imports runs), `connect-src 'none'`, and `img-src data:`, `style-src` by nonce alone, `font-src`, `worker-src` and `form-action 'none'` (in an opaque-origin document `'self'` still names the application, so markup alone would otherwise send it requests with its `SameSite=None` cookies). The document itself fetches nothing. **Residuals:** a script in the frame can use WebRTC (STUN packets and DNS lookups to any host; no CSP directive closes it in Chrome 155); the frame can navigate itself wherever the host page's `frame-src` admits, so the host names the frame's exact URL there, and even then CSP's path matching ignores the query: a navigation to the frame's own path with another query reaches the frame route, with the application's `SameSite=None` cookies, before the host tears the frame down, so the frame route ignores its query and that data reaches only the application's access log; and the module can show the user anything inside the frame. Link hints and `srcdoc` are closed in the runtime, not by the policy: no CSP directive governs `<link rel="preconnect">`, and in WebKit a module's preconnect, or an `<iframe srcdoc>` holding one, connected to the host it named from inside the frame; `@getforma/core` 2.1.0's frame runtime mounts the module with `tier: 'unreviewed'`, which removes every `<link>` and `srcdoc` before the markup reaches the document, re-checks the live subtree and refuses the render if one appears, and no core before 2.1.0 ships a frame runtime. The application frames it with `sandbox="allow-scripts"` and a `MessageChannel` bridge (the `frame` module's docs)
- Rendered HTML embeds a per-request nonce, so it must be served `Cache-Control: no-store` and never cached across requests. `PageResponse` writes `no-store`, the policy and the document headers whenever it is sent, and an invalid policy extension fails the page instead of dropping the header. (`PageOutput::headers()`, deprecated in 0.2.2, does the first part and silently drops an invalid policy)
- The service worker is opt-in: by default no page registers one, and `/sw.js` serves a retiring worker that deletes Forma's v1 cache names and unregisters, so a worker an earlier release installed cannot keep replaying cached script. An application that enables its worker, with `@getforma/build` 0.3.1 and its `app` setting, gets caches named per application and build (`forma:<app>:<build>`) and a waiting upgrade, and no such worker deletes another application's caches; with build 0.3.0 the enabled worker is still that release's (shared `forma-` names, immediate takeover)
- HSTS is deliberately not set here — it is the TLS terminator's responsibility
- A render failure is a value: `try_render` returns a coded `RenderError` (route, component path, cause) for a missing module, a refused walk, an exceeded budget, an invalid policy extension, a failed nonce draw, or a panic caught inside the render (`RenderError::Fault`; it holds while the application unwinds on panic, not under `panic = "abort"`). The deprecated `render_page` still falls back to the Phase 1 shell on any error, until 3.0.0
- No `unwrap`, `expect` or `panic!` in either crate's shipped code (Clippy denies them outside tests), except the documented panics of the 0.2.1 functions whose signatures cannot carry an error (`CspNonce::generate`, `assets::asset`, the deprecated `assets::load_manifest`), each beside a fallible twin, and forma-ir's `wasm` exports, whose panic is the JS exception the client catches

## Supported Versions

Both crates, `forma-ir` and `forma-server`, take the workspace version.

| Version | Supported |
|---------|-----------|
| 0.2.x | Yes: fixes ship as 0.2 patch releases; run the latest one |
| 0.1.x and earlier | No: upgrade to 0.2 ([CHANGELOG.md](CHANGELOG.md) lists its breaking changes) |
