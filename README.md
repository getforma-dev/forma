# Forma

[![CI](https://github.com/getforma-dev/forma/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/forma/actions/workflows/ci.yml)
[![crates.io](https://img.shields.io/crates/v/forma-ir)](https://crates.io/crates/forma-ir)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Rust server framework for the Forma Stack — binary IR format, SSR rendering, asset serving, and CSP.

## Crates

| Crate | Description | crates.io |
|-------|-------------|-----------|
| [`forma-ir`](crates/forma-ir) | FMIR binary format: parser, walker, slots, WASM | [![](https://img.shields.io/crates/v/forma-ir)](https://crates.io/crates/forma-ir) |
| [`forma-server`](crates/forma-server) | Axum middleware: render_page, asset serving, CSP | [![](https://img.shields.io/crates/v/forma-server)](https://crates.io/crates/forma-server) |

### When you need each crate

- **`forma-ir` only** — You want to parse or walk `.fmir` binaries (e.g., in a custom SSR pipeline, a build tool, or WASM on the client).
- **`forma-server` (includes `forma-ir`)** — You are building an Axum-based server that renders pages, serves hashed assets, and sets CSP headers.

## Architecture

```
TypeScript → @getforma/compiler → .ir binary
                                    ↓
                              forma-ir (parse)
                                    ↓
                            forma-server (render HTML)
                                    ↓
                              Axum response
```

## Quick Start

```toml
[dependencies]
forma-ir = "0.1"
forma-server = "0.1"
```

```rust
use forma_server::{assets, render_page, PageConfig, RenderMode, load_ir_modules};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "dist/"]
struct Assets;

// Load manifest and IR modules at startup
let manifest = assets::load_manifest::<Assets>();
let (render_modes, ir_modules) = load_ir_modules::<Assets>(&manifest);
```

## Forma Stack

| Layer | Package | Registry |
|-------|---------|----------|
| **Frontend** | [@getforma/core](https://github.com/getforma-dev/formajs) | npm |
| **Build tooling** | [forma-tools](https://github.com/getforma-dev/forma-tools) | npm |
| **Backend (IR)** | [forma-ir](https://crates.io/crates/forma-ir) | crates.io |
| **Backend (Server)** | [forma-server](https://crates.io/crates/forma-server) | crates.io |
| **Full Framework** | [create-forma-app](https://github.com/getforma-dev/create-forma-app) | npm |

## License

MIT
