# Forma

[![CI](https://github.com/getforma-dev/forma/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/forma/actions/workflows/ci.yml)
[![crates.io](https://img.shields.io/crates/v/forma-ir)](https://crates.io/crates/forma-ir)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Rust backend for the [Forma Stack](https://getforma.dev) — server-side rendering without Node.js. The `@getforma/compiler` compiles TypeScript components to a binary IR (FMIR). These Rust crates parse that binary and generate HTML, so your server never needs a JavaScript runtime.

## Crates

### `forma-ir` — The IR Engine

[![crates.io](https://img.shields.io/crates/v/forma-ir)](https://crates.io/crates/forma-ir)

Parses FMIR binary files and generates HTML from them. This is the core — everything else builds on top of it.

```toml
[dependencies]
forma-ir = "0.1"
```

**What it does:**
- Parses `.ir` binary files into a validated `IrModule` (header, opcodes, string table, slot table, island table)
- Walks the opcode stream and generates HTML with proper escaping
- Fills dynamic values (text, attributes, conditionals, lists) from typed `SlotData`
- Emits hydration markers (`<!--f:t0-->`, `<!--f:s0-->`, `<!--f:l0-->`, `<!--f:i0-->`) that FormaJS uses for client-side hydration
- Compiles to WASM for client-side re-renders in the browser

**Use it when:**
- You're building your own server (not Axum) and want Forma SSR
- You need the WASM build for client-side island re-rendering
- You're building tools that inspect, transform, or generate IR files

**You don't need it directly if:** You're using `forma-server` — it wraps `forma-ir` for you.

### `forma-server` — Axum Middleware

[![crates.io](https://img.shields.io/crates/v/forma-server)](https://crates.io/crates/forma-server)

Full SSR middleware for [Axum](https://github.com/tokio-rs/axum). Renders pages, serves content-hashed assets, generates CSP headers with cryptographic nonces, and handles the Phase 1 (client mount) / Phase 2 (SSR reconcile) pipeline.

```toml
[dependencies]
forma-server = "0.1"
```

**What it does:**
- `render_page(config)` — generates a full HTML page from an IR module + slot data
- `load_ir_modules(manifest)` — loads `.ir` files from embedded assets at startup (`load_ir_modules_strict` returns the failures so you can fail startup on a build/embed skew)
- `serve_asset(filename)` — serves assets with Brotli/gzip negotiation, `Cache-Control: immutable` for content-hashed names and revalidation + ETag for the rest
- `generate_csp_nonce()` — 256-bit cryptographically random nonce (ring CSPRNG), returned as a validating `CspNonce`
- `build_csp_header(nonce)` — strict CSP: nonce + `'strict-dynamic'` scripts, nonce-locked style elements, no `unsafe-eval`

**Two rendering modes:**

| Mode | What happens | When to use |
|------|-------------|-------------|
| **Phase 1: Client Mount** | Renders `<div id="app"></div>` — FormaJS mounts from scratch | No IR available, or first visit |
| **Phase 2: SSR Reconcile** | Renders full HTML from IR walker — FormaJS hydrates | IR + slots available, fast first paint |

**Use it when:** Your backend is Rust + Axum and you want the full Forma SSR pipeline.

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
```

## Architecture

```
TypeScript/JSX components
        ↓
  @getforma/compiler        → emits .ir binary (FMIR format)
        ↓
  forma-ir                  → parses binary, walks opcodes, generates HTML
        ↓
  forma-server              → Axum middleware: SSR + assets + CSP
        ↓
  HTML response             → browser receives server-rendered page
        ↓
  @getforma/core (FormaJS)  → hydrates using marker comments, attaches reactivity
```

## Security

See [SECURITY.md](SECURITY.md) for the full list and the threat model — in particular, **FMIR is a trusted input**: run only IR produced by a compiler you trust.

- **HTML escaping:** All dynamic text and attribute values are escaped (`&`, `<`, `>`, `"`); tag and attribute names are validated against an HTML name charset
- **Attribute safety:** URL-bearing attributes are scheme-checked and `on*` handlers are dropped, matching the client renderer so SSR and CSR agree
- **CSP headers:** Strict policy with cryptographic nonces — `'strict-dynamic'` scripts, nonce-locked style *elements*, no `unsafe-eval`. Style *attributes* are allowed via `style-src-attr` because compiled `style:` bindings emit them
- **Resource limits:** Recursion depth 64, list nesting 4, plus a per-render output cap and LIST-iteration budget (both configurable) so a small module cannot force a multi-gigabyte allocation
- **Comment escaping:** `--` in HTML comments replaced with `&#45;&#45;`, and a comment cannot self-close
- **Island props:** the `__forma_islands` JSON block is escaped so it cannot terminate or re-open its `<script>` element; read it with `JSON.parse`
- **No unsafe code:** Zero `unsafe` blocks across both crates
- XSS payload verification and malformed-input handling are covered by the test suite (`cargo test --workspace`)

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
| [forma-ir](https://crates.io/crates/forma-ir) | **This repo** — FMIR binary format: parser, walker, WASM exports |
| [forma-server](https://crates.io/crates/forma-server) | **This repo** — Axum middleware: SSR, asset serving, CSP headers |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://github.com/getforma-dev/create-forma-app) | `npx @getforma/create-app` — scaffolds Rust server + TypeScript frontend |

## Development

```bash
git clone https://github.com/getforma-dev/forma.git
cd forma
cargo test --workspace     # full suite
cargo clippy --workspace   # lint
cargo fmt --all --check    # format check

# Offset arithmetic differs where usize is 32 bits (as on wasm32):
cargo test --workspace --target i686-unknown-linux-gnu
```

## License

MIT
