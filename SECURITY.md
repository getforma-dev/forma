# Security Policy

## Reporting Vulnerabilities

Report security vulnerabilities to **victor@getforma.dev**. Do not open public issues for security reports. We will respond within 48 hours.

## Security Properties

### forma-ir

**Threat model — read this first.** FMIR is a **trusted input**. `forma-ir` validates structure and bounds so that malformed IR cannot read out of bounds, panic, or abort the process. It does *not* treat the IR itself as hostile content that must be neutralised: tag names, attribute names and static attribute values come from the module's own string table, and while names are now validated against an HTML name charset, an IR file you did not compile can still choose what markup your page contains. **Only run IR produced by a compiler you trust.**

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
- Script sources and style *elements* are nonce-locked, with no `unsafe-inline` and no `unsafe-eval`. Style *attributes* are permitted via `style-src-attr 'unsafe-inline'`, because compiled `style:` bindings emit them and a nonce cannot be attached to an attribute. `style-src-elem` falls back to the nonce-locked `style-src`, so `<style>` blocks stay strict. (`style-src-attr` is CSP3; older engines ignore it and fall back to blocking attribute styles — fail-closed.)
- `worker-src 'self'` is explicit because `'strict-dynamic'` does not cover workers
- Asset serving via `rust-embed` prevents path traversal; requested filenames are additionally checked for exact membership in the embedded file list, so debug (filesystem) and release (compiled-in) builds agree and Windows filename aliases do not resolve
- `manifest.json` and direct `.br`/`.gz` requests are refused on the asset route
- Template interpolations are HTML-escaped, **except** two documented raw sinks: `PageConfig::config_script` (raw JS — `</script`/`<!--` are neutralised so it cannot escape its element, but its *contents* are trusted) and `PageConfig::body_prefix` (raw HTML). Use `PageConfig::config_json` for anything derived from user input — it is serialised with every `<` escaped
- Rendered HTML embeds a per-request nonce, so it must be served `Cache-Control: no-store` and never cached across requests. `PageOutput::headers()` does this
- The service worker is opt-in: by default no page registers one, and `/sw.js` serves a retiring worker that deletes Forma's v1 cache names and unregisters, so a worker an earlier release installed cannot keep replaying cached script (TH19). An application that enables its worker gets caches named per application and build (`forma:<app>:<build>`), and no Forma worker deletes another application's caches
- HSTS is deliberately not set here — it is the TLS terminator's responsibility
- Graceful fallback from Phase 2 SSR to Phase 1 on any error

## Supported Versions

Both crates, `forma-ir` and `forma-server`, take the workspace version.

| Version | Supported |
|---------|-----------|
| 0.2.x | Yes: fixes ship as 0.2 patch releases; run the latest one |
| 0.1.x and earlier | No: upgrade to 0.2 ([CHANGELOG.md](CHANGELOG.md) lists its breaking changes) |
