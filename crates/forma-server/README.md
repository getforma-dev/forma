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

- **`try_render(config, ctx)`** — renders a page from an IR module + slot data and returns `Result<PageResponse, RenderError>`: the page with its counts (nodes, bytes, list rows, walk time), or a coded error naming the route and component; never an empty shell in place of a failure, and a panic in the render comes back as `RenderError::Fault`
- **`render_browser_shell(config, ctx)`** — the bundle and the same headers around an empty root, for a route the build declares `ssr: false`
- **`render_page(config)`** — deprecated in 0.2.2: serves the empty Phase 1 shell with a 200 on any failure
- **`PageResponse`** — the page as axum's `IntoResponse`: always `Cache-Control: no-store`, the strict policy for the page's nonce, and the document headers; a handler extends the policy with typed `PolicyExtensions`, never as text
- **`load_ir_modules_strict(manifest)`** — the module loader: loads and checks every `.ir` file the manifest declares at startup, or returns every failure (route, file and a `LOAD-1xx` code) so the server refuses to start before its port binds; a route declared `ssr: false` needs no module. The lenient `load_ir_modules`, which serves a corrupt module's route as an empty shell, is deprecated in 0.2.2
- **`IrModules::<Assets>::load(manifest)`** — the same strict loading, holding the modules for you: `get(route)` returns the route's module, and in a debug build rereads it when `forma-build --watch` rewrites it, so an edited page is served on the next request without a restart (a module that fails to load keeps the previous one and logs its code). A release build reads nothing after start
- **`sw::serve_sw` and `sw::configure`**: the service worker is opt-in (0.2.2). By default no page registers one and `/sw.js` serves a retiring worker that clears Forma's v1 caches and unregisters; an application that wants its worker calls `sw::configure(ServiceWorker::for_app("name")?.enabled())` once at start
- **`serve_asset(filename)`** — serves assets with Brotli/gzip negotiation; `Cache-Control: immutable` for content-hashed names, revalidation + ETag for the rest
- **`generate_csp_nonce()`** — 256-bit cryptographically random nonce (ring CSPRNG), returned as a validating `CspNonce`
- **`build_csp_header(nonce)`** — strict CSP: nonce + `'strict-dynamic'` scripts, nonce-locked style elements, no `unsafe-eval`

## Quick Start

```rust,no_run
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use forma_server::{assets, load_ir_modules_strict, try_render, PageConfig, RenderCtx, RenderMode};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "dist/"]
struct Assets;

// At startup, before the port binds: a bad manifest or module stops the server.
let manifest = assets::try_load_manifest::<Assets>()?;
let (render_modes, ir_modules) = load_ir_modules_strict::<Assets>(&manifest)
    .map_err(|errors| format!("{errors:?}"))?;

// Per request. PageConfig has no Default impl — every field is explicit.
let page = try_render(
    &PageConfig {
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
        slots: Some(&forma_ir::SlotData::new(0)),
    },
    &RenderCtx::new(),
);
let response: Response = match page {
    // A PageResponse writes no-store, the policy and the document headers.
    Ok(page) => page.into_response(),
    // The handler chooses: log `error` (its code, route and component), then
    // serve the application's own error page.
    Err(error) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
};
```

A page whose counts show more than about 12,500 nodes holds its thread past a millisecond (at the measured 12.5 million nodes a second); move that route's `try_render` into `tokio::task::spawn_blocking` (the recipe is in `try_render`'s documentation). forma-server itself starts no threads and depends on no async runtime.

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
- **Render failures are values**: `try_render` returns every failure as a `RenderError` with a stable code (RENDER-101 to RENDER-399), and catches a panic in the render as `RenderError::Fault`, so one bad page answers one request with the application's error page and the process carries on. That needs the application to unwind on panic, as both templates do: under `panic = "abort"` a fault still ends the process. Both crates deny `unwrap`, `expect` and `panic!` outside tests
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
