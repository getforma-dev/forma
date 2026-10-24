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

**Threat model — read this first.** FMIR is a **trusted input**. `forma-ir` validates structure and bounds when parsing and walking, returning errors for malformed structures. These checks do not recover allocation failure or a panic compiled with `panic = "abort"`; the typed server boundary catches unwinding request faults. It does *not* treat the IR itself as hostile content that must be neutralised: tag names, attribute names and static attribute values come from the module's own string table, and while names are now validated against an HTML name charset, an IR file you did not compile can still choose what markup your page contains. **Only run IR produced by a compiler you trust.**

For 3.0, every FMIR module must come from the application's own build. A module from any other source requires M9 before admission. M9 and design5 remain deferred; 3.0 does not provide an untrusted-module admission mechanism. Decoder/walker fuzzing (M10) is implemented: the [nightly workflow](.github/workflows/fmir-fuzz.yml) runs `parse_raw`, `parse_body`, `parse_mutated` and `walk` under AddressSanitizer, with retained findings and stable regression replay. Fuzzing does not authenticate module producers. Structural validation does not establish who produced a module (SA4).

Given that boundary:

- Dynamic HTML text and attribute *values* are escaped (`&`, `<`, `>`, `"`)
- Tag and attribute *names* are validated against `[A-Za-z_:][-A-Za-z0-9_:.]*` — an invalid tag name is an error, an invalid attribute name is dropped
- URL-bearing attributes (`href`, `src`, `action`, `formaction`, `xlink:href`, `poster`, `background`, `data`) are scheme-checked after browser-equivalent normalisation, and `on*` event-handler attributes are dropped — matching what `@getforma/core` does client-side, so SSR and CSR agree
- HTML comment content escaped (`--` → `&#45;&#45;`), and a leading `>` / `->` cannot self-close the comment
- Island props JSON is escaped so it cannot terminate or re-open its enclosing `<script>` element (covers `</script`, `<!--` and `<script`). Consumers must read it with `JSON.parse`, never by string-matching the raw text
- Binary parser validates all bounds before reading (no buffer overflows), and rejects declared table counts the section cannot possibly hold
- The opcode stream is structurally validated once at parse time: control-flow regions must tile exactly, island offsets must point at their own `ISLAND_START`, and slot/island ids must be unique and declared
- FMIR 3 validates its 24-byte signature/version/length/CRC header before parsing the section table. Reserved header/table bits must be zero; section flags admit only the required bit. Unknown required sections are refused and unknown optional sections are skipped. Declared props and state contracts are validated rather than treated as reserved zero fields
- Recursion depth limited to 64; list nesting limited to 4 levels
- Rendered output capped (default 8 MiB) and total LIST iterations capped (default 50,000) per render, both configurable via `WalkLimits`
- Zero `unsafe` blocks — enforced by `#![forbid(unsafe_code)]` on both library crate roots, so this is a compile error rather than a claim. (The allocation-counting harness in `crates/forma-ir/tests/list_scaling.rs` implements `GlobalAlloc` and is necessarily `unsafe`; it is a test target and ships in nothing.)

Known residual: an *under*-long control-flow length whose orphaned bytes still decode as a legal sibling sequence is structurally indistinguishable from a legitimate module, so no length check can reject it. The FMIR 3 CRC-32 detects accidental changes, but is not producer authentication: a writer can restamp a wrong module. Compiler/parity tests remain necessary for that class; only admit modules from the trusted application build.

### forma-server

- Each successful render draws a fresh 256-bit cryptographic nonce (ring CSPRNG) and keeps it with the response headers and HTML. `RenderCtx` has no caller-supplied nonce; a failed random draw returns an error
- `script-src` uses `'nonce-…' 'strict-dynamic' 'self'`. Without `'strict-dynamic'` the `'self'` host-source stays live alongside the nonce, so any same-origin URL reflecting attacker-controlled bytes is loadable as `<script src>`
- Script sources and style *elements* are nonce-locked, with no `unsafe-inline` and no `unsafe-eval`. Style *attributes* are permitted via `style-src-attr 'unsafe-inline'`, because compiled `style:` bindings emit them and a nonce cannot be attached to an attribute. `style-src-elem` falls back to the nonce-locked `style-src`, so `<style>` blocks stay strict. (`style-src-attr` is CSP3; older engines ignore it and fall back to blocking attribute styles — fail-closed.) That allowance is the policy's only `'unsafe-inline'` (asserted by `csp_is_strict`).
- Trusted Types is enforced by default in the page's `Content-Security-Policy`: `require-trusted-types-for 'script'; trusted-types forma forma-runtime`. A reporting endpoint is not required for enforcement in browsers implementing Trusted Types. `PolicyExtensions::relax_trusted_types` is an explicit, reason-bearing per-route escape that removes those enforced directives, retains Report-Only reporting and logs the relaxation; it is not the default. Applications own reporting endpoints: `report_to` emits `Reporting-Endpoints`, `report-to` and the `report-uri` fallback, while `report_uri` supports URI-only reporting. Endpoint validation rejects userinfo and release-build loopback HTTP. Report handlers must bound request size/rate, omit URL query strings from stored reports and monitor their own baseline. CSP and the runtime's admission checks remain necessary where a browser does not implement Trusted Types
- `worker-src 'self'` is explicit because `'strict-dynamic'` does not cover workers
- Asset serving via `rust-embed` prevents path traversal; requested filenames are additionally checked for exact membership in the embedded file list, so debug (filesystem) and release (compiled-in) builds agree and Windows filename aliases do not resolve
- `manifest.json`, `size-report.json`, native `.ir` modules and direct `.br`/`.gz` requests are refused on the asset route
- Template data is escaped. `RenderCtx::with_config_json` serializes JSON with every `<` escaped; on JS-enabled routes it emits a nonced configuration assignment, while static SSR refuses it. `RenderCtx::with_body_prefix` takes only `RawHtml`, explicitly created with `RawHtml::trusted`; this is reviewed application-owned HTML, not a sanitizer or a home for untrusted data. The executable `config_script`, raw SSR entry and `PageOutput` bridges are removed; `PageConfig` remains available for explicit Browser rendering. Use typed head links/preloads and the declared island state channel instead of executable handler strings
- Content nobody reviewed renders only in the preview frame (from 0.2.2): `PageResponse::frame` writes its document with, in the enforced header, `sandbox allow-scripts` (no `allow-same-origin`, so an opaque origin), `frame-ancestors` the application's origin, `script-src` the inline runtime's SHA-256 (no script it creates or imports runs), `connect-src 'none'`, and `img-src data:`, `style-src` by nonce alone, `font-src`, `worker-src` and `form-action 'none'` (in an opaque-origin document `'self'` still names the application, so markup alone would otherwise send it requests with its `SameSite=None` cookies). The document itself fetches nothing. **Residuals:** a script in the frame can use WebRTC (STUN packets and DNS lookups to any host; no CSP directive closes it in Chrome 155); the frame can navigate itself wherever the host page's `frame-src` admits, so the host names the frame's exact URL there, and even then CSP's path matching ignores the query: a navigation to the frame's own path with another query reaches the frame route, with the application's `SameSite=None` cookies, before the host tears the frame down, so the frame route ignores its query and that data reaches only the application's access log; and the module can show the user anything inside the frame. Link hints and `srcdoc` are closed in the runtime, not by the policy: no CSP directive governs `<link rel="preconnect">`, and in WebKit a module's preconnect, or an `<iframe srcdoc>` holding one, connected to the host it named from inside the frame; The current `@getforma/core` frame runtime mounts the module with `tier: 'unreviewed'`, which removes every `<link>` and `srcdoc` before the markup reaches the document, re-checks the live subtree and refuses the render if one appears. The application frames it with `sandbox="allow-scripts"` and a `MessageChannel` bridge (the `frame` module's docs)
- Rendered HTML embeds a per-request nonce, so it must be served `Cache-Control: no-store` and never cached across requests. `PageResponse` writes `no-store`, the policy and the document headers whenever it is sent, and an invalid policy extension fails the page instead of dropping the header.
- The service worker is opt-in. Off mode serves a retiring `/sw.js` that deletes Forma's legacy `forma-` cache names and unregisters. An enabled worker uses per-application/build caches (`forma:<app>:<build>`) with a waiting upgrade; it does not delete another application's caches. It verifies complete SHA-384 asset digests before returning cached or fetched bytes, evicts failed entries and refuses unverified responses. Navigations and requests marked `no-store`/`reload` bypass the asset cache. Static pages do not newly register a worker; keep the endpoint when retiring an existing worker
- HSTS is deliberately not set here — it is the TLS terminator's responsibility
- Startup loads and binds declared routes, then `Pages::finalize` refuses incomplete or incompatible contracts before the listener opens. `PageHandle::render` returns `PageResponse` or a coded `RenderError` for missing/refused modules, exceeded budgets, invalid policy, nonce failure or a panic caught in the native walk (`RenderError::Fault`). The fault path requires unwinding; `panic = "abort"` still ends the process. Explicit Browser routes use `render_browser_shell`; an SSR failure never silently substitutes that shell
- `forma-ir` and `forma-server` deny Clippy's `unwrap_used`, `expect_used` and `panic` lints outside tests. Public asset/manifest loading and nonce generation return errors rather than retaining the old panic bridges; the `try_*` spellings remain compatible fallible aliases. The WASM reader/renderer is removed. Deliberate fault injection and fuzz support are confined to tests or the named internal harness features; those feature builds are not the ordinary published runtime configuration

### Opt-in page compression (FORMA-261)

Rendered pages remain uncompressed by default. The optional `compression` Cargo
feature only makes `PageResponse::with_compression` available; a handler must
explicitly opt each response in. The build cannot infer whether declared props
contain a secret, so neither a static route nor an island-free route is opted in
automatically.

HTTP compression can disclose a response secret through length when the same
body reflects attacker-controlled input ([BREACH](https://www.breachattack.com/)).
Do not opt in pages mixing reflected text with CSRF tokens, session-derived
secrets or private account data. The CSP nonce is freshly randomized per request,
but it does not protect other secrets; TLS and `Cache-Control: no-store` do not
remove this side channel. Apply the same route exclusions to a compressing proxy.

Compression preserves the original CSP and all document policy headers, keeps
`no-store`, adds `Vary: Accept-Encoding`, and compresses only that request's owned
HTML. It never caches a compressed nonce-bearing response. Roll back by removing
the per-response call or the Cargo feature. No global middleware is installed.

## Supported Versions

<!-- forma-supported-lines:start -->
Generated from the published release records and their original GitHub publication dates.

| Line | Security support | End date (UTC) |
|---|---|---|
| v1 maintenance: core 2.x; crates 0.2.x; build 0.3.x; compiler 0.3.x | Critical and High fixes | 2027-04-20 |
| 3.x unified set | Critical and High fixes | Current major; six months after its successor ships |

The next unified major may ship no earlier than 2027-04-20T04:09:01.000Z.
Critical and High fixes target seven calendar days on each supported line.
End dates do not restart on a patch release or a release-record rerun.
<!-- forma-supported-lines:end -->
