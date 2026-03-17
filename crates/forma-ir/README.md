# forma-ir

[![crates.io](https://img.shields.io/crates/v/forma-ir)](https://crates.io/crates/forma-ir)
[![CI](https://github.com/getforma-dev/forma/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/forma/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

FMIR binary format parser, walker, and HTML generator for the [Forma Stack](https://getforma.dev). Parses compiled component IR and generates server-rendered HTML with hydration markers — no JavaScript runtime needed.

## Install

```toml
[dependencies]
forma-ir = "0.1"
```

## What It Does

- Parses `.ir` binary files (FMIR format) into a validated `IrModule`
- Walks the opcode stream and generates HTML with proper escaping
- Fills dynamic values (text, attributes, conditionals, lists) from typed `SlotData`
- Emits hydration markers (`<!--f:t0-->`, `<!--f:s0-->`, etc.) for [FormaJS](https://github.com/getforma-dev/formajs) client-side hydration
- Compiles to WASM for client-side island re-renders

## Quick Start

```rust
use forma_ir::{IrModule, SlotData, walker};

// Parse a compiled .ir binary
let module = IrModule::parse(&ir_bytes)?;

// Fill slots with runtime data
let slots = SlotData::from_json(r#"{"count": 42}"#, &module)?;

// Generate HTML
let html = walker::walk_to_html(&module, &slots)?;
```

## When You Need This

- **Building your own server** (not Axum) — parse IR and generate HTML yourself
- **Client-side WASM** — re-render islands in the browser without a server round-trip
- **Build tools** — inspect, transform, or generate IR files

If you're using Axum, use [`forma-server`](https://crates.io/crates/forma-server) instead — it wraps `forma-ir` with page rendering, asset serving, and CSP headers.

## Security

- All dynamic text and attributes are HTML-escaped
- Recursion depth limited to 64 (prevents stack overflow from malicious IR)
- List nesting limited to 4 levels
- Comment content escaped (`--` → `&#45;&#45;`)
- Script tag props escaped (`</script>` → `<\/script>`)
- Zero `unsafe` blocks
- 126 tests including XSS payload verification

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
| [forma-ir](https://crates.io/crates/forma-ir) | **This crate** — FMIR parser, walker, WASM exports |
| [forma-server](https://crates.io/crates/forma-server) | Axum middleware — SSR, asset serving, CSP headers |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://github.com/getforma-dev/create-forma-app) | `npx @getforma/create-app` — scaffolds Rust server + TypeScript frontend |

## License

MIT
