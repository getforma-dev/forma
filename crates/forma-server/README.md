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
- **`load_ir_modules(manifest)`** — loads `.ir` files from embedded assets at startup
- **`serve_asset(filename)`** — serves content-hashed assets with Brotli/gzip negotiation and `Cache-Control: immutable`
- **`generate_nonce()`** — 256-bit cryptographically random nonce (ring CSPRNG)
- **`build_csp_header(nonce)`** — strict CSP: no `unsafe-inline`, no `unsafe-eval`, nonce-based scripts/styles

## Quick Start

```rust
use forma_server::{assets, render_page, PageConfig, RenderMode, load_ir_modules};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "dist/"]
struct Assets;

// At startup: load manifest and IR modules
let manifest = assets::load_manifest::<Assets>();
let (render_modes, ir_modules) = load_ir_modules::<Assets>(&manifest);

// Render a page
let page = render_page(&PageConfig {
    title: "Home",
    route_pattern: "/",
    manifest: &manifest,
    render_mode: RenderMode::Phase2SsrReconcile,
    ir_module: ir_modules.get("/"),
    slots: None,
    ..Default::default()
});
```

## Two Rendering Modes

| Mode | What happens | When to use |
|------|-------------|-------------|
| **Phase 1: Client Mount** | Renders `<div id="app"></div>` — FormaJS mounts from scratch | No IR available, or fallback |
| **Phase 2: SSR Reconcile** | Renders full HTML from IR walker — FormaJS hydrates | IR + slots available, fast first paint |

## Security

- **CSP headers**: Strict policy with cryptographic nonces — no `unsafe-inline`, no `unsafe-eval`
- **Nonce generation**: 256-bit entropy via ring CSPRNG
- **Asset serving**: `rust-embed` prevents path traversal — only compile-time embedded files are served
- **Template escaping**: All interpolated values (URLs, class names, CSS) are HTML-escaped
- **No unsafe code**: Zero `unsafe` blocks

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
