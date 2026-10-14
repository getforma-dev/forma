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
- Emits hydration markers (`<!--f:t0-->`, `<!--f:s0-->`, etc.) for [FormaJS](https://github.com/getforma-dev/formajs) client-side hydration, except inside `textarea`, `title`, `style` and `script`, whose content HTML reads as text
- Writes form-control values as HTML reads them: a `textarea`'s `value` as its text, a `select`'s as `selected` on the matching option
- Compiles to WASM for client-side island re-renders
- Renders a list in O(rows), with a committed regression gate that fails the build if that changes (`tests/list_scaling.rs`)

The on-disk layout and its stability contract are documented in
[`docs/FMIR-FORMAT.md`](https://github.com/getforma-dev/forma/blob/main/docs/FMIR-FORMAT.md).

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

`walk_to_html_counted(&module, &slots, limits)` writes the same HTML and also
returns what it wrote (`WalkCounts`: nodes, bytes, list rows); on failure it
returns a `WalkFailure` with the counts reached and the component path, the
islands open where the walk stopped. It catches a panic inside the walk as
`IrError::Panicked`, while the application unwinds on panic.

## When You Need This

- **Building your own server** (not Axum) — parse IR and generate HTML yourself
- **Client-side WASM** — re-render islands in the browser without a server round-trip
- **Build tools** — inspect, transform, or generate IR files

If you're using Axum, use [`forma-server`](https://crates.io/crates/forma-server) instead — it wraps `forma-ir` with page rendering, asset serving, and CSP headers.

## Security

**FMIR is a trusted input.** This crate validates structure and bounds so that malformed IR cannot read out of bounds, panic, or abort the process — but it does not sanitise the IR's *content*. An `.ir` file chooses what markup your page contains. Only run IR produced by a compiler you trust.

- All dynamic text and attribute values are HTML-escaped; tag and attribute names are validated against `[A-Za-z_:][-A-Za-z0-9_:.]*`
- URL-bearing attributes are scheme-checked and `on*` handlers dropped, matching `@getforma/core` so SSR and CSR agree
- Recursion depth limited to 64; list nesting limited to 4 levels
- Per-render output cap (default 8 MiB) and LIST iteration budget (default 50,000), both configurable via `WalkLimits` — a small module plus a large request array cannot force a multi-gigabyte allocation
- Parser rejects declared table counts the section cannot hold, and structurally validates the opcode stream once at load
- Comment content escaped (`--` → `&#45;&#45;`); a comment cannot self-close
- Island props JSON is escaped so it cannot terminate or re-open its `<script>` element — read it with `JSON.parse`, never by string-matching
- `#![forbid(unsafe_code)]` on the crate root — zero `unsafe` is compiler-enforced, not asserted
- XSS payload verification and malformed-input handling covered by the test suite

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
