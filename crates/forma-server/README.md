# forma-server

[![crates.io](https://img.shields.io/crates/v/forma-server)](https://crates.io/crates/forma-server)
[![CI](https://github.com/getforma-dev/forma/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/forma/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Axum middleware for the [Forma Stack](https://getforma.dev) — server-side rendering, content-hashed asset serving, and CSP headers. Renders pages from FMIR binary IR without a JavaScript runtime.

## Install

```toml
[dependencies]
forma-server = "0.1"
```

This pulls in `forma-ir` automatically.

## What It Does

- **`render_page(config)`** — generates a full HTML page from an IR module + slot data
- **`PageResponse`** — the page as axum's `IntoResponse`: always `Cache-Control: no-store`, the strict policy for the page's nonce, and the document headers; a handler extends the policy with typed `PolicyExtensions`, never as text
- **`load_ir_modules(manifest)`** — loads `.ir` files from embedded assets at startup (`load_ir_modules_strict` returns the failures instead of swallowing them)
- **`serve_asset(filename)`** — serves assets with Brotli/gzip negotiation; `Cache-Control: immutable` for content-hashed names, revalidation + ETag for the rest
- **`generate_csp_nonce()`** — 256-bit cryptographically random nonce (ring CSPRNG), returned as a validating `CspNonce`
- **`build_csp_header(nonce)`** — strict CSP: nonce + `'strict-dynamic'` scripts, nonce-locked style elements, no `unsafe-eval`

## Quick Start

```rust,no_run
use forma_server::{assets, render_page, PageConfig, PolicyExtensions, RenderMode, load_ir_modules};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "dist/"]
struct Assets;

// At startup: load manifest and IR modules
let manifest = assets::load_manifest::<Assets>();
let (render_modes, ir_modules) = load_ir_modules::<Assets>(&manifest);

// Render a page. PageConfig has no Default impl — every field is explicit.
let page = render_page(&PageConfig {
    title: "Home",
    route_pattern: "/",
    manifest: &manifest,
    config_script: None, // deprecated in 0.2.2: pass data through config_json
    config_json: None,
    body_class: None,
    personality_css: None,
    body_prefix: None,
    render_mode: RenderMode::Phase2SsrReconcile,
    ir_module: ir_modules.get("/"),
    slots: None,
});

// The HTML and the CSP header are one unit: send the page as a PageResponse,
// which writes no-store, the policy and the document headers with it.
let response = page.into_page_response(&PolicyExtensions::new())?;
// In an axum handler: `return response.into_response();`
```

## Two Rendering Modes

| Mode | What happens | When to use |
|------|-------------|-------------|
| **Phase 1: Client Mount** | Renders `<div id="app"></div>` — FormaJS mounts from scratch | No IR available, or fallback |
| **Phase 2: SSR Reconcile** | Renders full HTML from IR walker — FormaJS hydrates | IR + slots available, fast first paint |

## Security

- **CSP headers**: Strict policy with cryptographic nonces — `'strict-dynamic'` scripts, nonce-locked style *elements*, no `unsafe-eval`. Style *attributes* are permitted via `style-src-attr 'unsafe-inline'`, because compiled `style:` bindings emit them and a nonce cannot be attached to an attribute
- **Nonce generation**: 256-bit entropy via ring CSPRNG, wrapped in a validating `CspNonce`
- **Serve HTML and CSP together**: the HTML embeds a per-request nonce, so it must be sent `Cache-Control: no-store` and never cached across requests. `PageResponse` writes both, with `Cross-Origin-Opener-Policy` and the other document headers, every time it is sent; its HTML is reachable apart from them only through `into_parts_unchecked()`. A page needing another image or frame source, a form target or a login popup adds a typed `PolicyExtensions` entry; an invalid one fails the page rather than reaching a header. `PageOutput`'s public fields, `PageOutput::headers()` and `render_page_with_nonce` are deprecated in 0.2.2
- **Asset serving**: `rust-embed` prevents path traversal, and requested names are checked for exact membership in the embedded list so debug and release builds behave identically; `manifest.json` and direct `.br`/`.gz` requests are refused
- **Template escaping**: Interpolated values (URLs, class names, CSS, title) are HTML-escaped. Two fields are documented raw sinks: `config_script` (raw JS, terminator-neutralised but trusted; deprecated in 0.2.2 and removed in 3.0.0) and `body_prefix` (raw HTML). Use `config_json` for data
- **No unsafe code**: `#![forbid(unsafe_code)]` on the crate root — compiler-enforced, not asserted

## When You Need This

**Use it when:** Your backend is Rust + Axum and you want the full Forma SSR pipeline with asset serving and CSP.

**You don't need it if:** You're only using FormaJS client-side (no Rust server), or you're using a non-Axum framework (use `forma-ir` directly).

## Part of the Forma Stack

### Frontend (TypeScript)

| Package | Description |
|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | Reactive DOM library — signals, h(), islands, SSR hydration |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | Vite plugin — h() optimization, server transforms, FMIR emission |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | Production pipeline — bundling, hashing, compression, manifest |

### Backend (Rust)

| Package | Description |
|---|---|
| [forma-ir](https://crates.io/crates/forma-ir) | FMIR parser, walker, WASM exports |
| [forma-server](https://crates.io/crates/forma-server) | **This crate** — Axum middleware: SSR, asset serving, CSP |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://github.com/getforma-dev/create-forma-app) | `npx @getforma/create-app` — scaffolds Rust server + TypeScript frontend |

## License

MIT
