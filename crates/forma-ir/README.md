# forma-ir

[![crates.io](https://img.shields.io/crates/v/forma-ir)](https://crates.io/crates/forma-ir)
[![CI](https://github.com/getforma-dev/forma/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/forma/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

FMIR binary format parser, walker, and HTML generator for the [Forma Stack](https://getforma.dev). Parses compiled component IR and generates server-rendered HTML with hydration markers — no JavaScript runtime needed.

## Install

These examples target the `3.0.0-beta.1` prerelease and require its coordinated
publication. Request the prerelease explicitly:

```toml
[dependencies]
forma-ir = "=3.0.0-beta.1"
```

## What It Does

- Parses `.ir` binary files (FMIR format) into a validated `IrModule`
- Walks the opcode stream and generates HTML with proper escaping
- Fills dynamic values (text, attributes, conditionals, lists) from typed `SlotData`
- Emits hydration markers (`<!--f:t0-->`, `<!--f:s0-->`, etc.) for [@getforma/core](https://github.com/getforma-dev/forma/tree/main/packages/core) client-side hydration, except inside `textarea`, `title`, `style` and `script`, whose content HTML reads as text
- Writes form-control values as HTML reads them: a `textarea`'s `value` as its text, a `select`'s as `selected` on the matching option
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

`SlotData::from_json` resolves known slot names from a JSON object and leaves
missing values at their defaults. Its numeric values are IEEE-754 `f64`: decimal
parsing is correctly rounded and preserves serialized finite `f64` bits,
including negative zero. It does not provide arbitrary-precision integers;
integers beyond the exactly representable range may round. Declared page props
use the typed bounds below. The island-state Serialize9 contract subsequently
normalizes negative zero to zero.

`walk_to_html_counted(&module, &slots, limits)` writes the same HTML and also
returns what it wrote (`WalkCounts`: nodes, bytes, list rows); on failure it
returns a `WalkFailure` with the counts reached and the component path, the
islands open where the walk stopped. It catches a panic inside the walk as
`IrError::Panicked`, while the application unwinds on panic.

## FMIR v3 development

The prepared set is `3.0.0-beta.1`; its publication and release qualification remain pending. Modules carry a 24-byte signature/version/length/CRC
header and a variable section table; the reader accepts writers of its own major up to its own minor; patch is ignored.
Package prerelease suffixes are absent from the numeric wire triple.
V2 modules require rebuilding. `IrModule::parse` validates every bytecode string reference,
props schemas, key paths and optional source positions before rendering; `IrError::code()`
provides stable `LOAD-` diagnostics. See [`FMIR-FORMAT.md`](../../docs/FMIR-FORMAT.md)
for the maintained contract and [`CHANGELOG.md`](CHANGELOG.md) for the breaking changes.

`dump::dump_ir` is a lossless canonical text representation shared with the compiler. It
includes every section, including unknown optional bytes and island extensions.

The `wasm` feature and its JavaScript exports were removed in 3.0.0. Browser
islands re-render with `@getforma/core`. `walk_island` remains internal and is
not a supported API; server callers use the full-page walker.

## Declared page props (3.0.0 development)

`#[derive(forma_ir::PageProps)]` describes named Rust structs and unit enums using
FMIR's actual props schema. `props::BoundProps::<P>::bind(module, route)` checks
that contract by field name once and retains the immutable module. Its `encode`
method checks each request's values and emits only declared fields. Extra Rust
fields warn and never reach the page; every declared TypeScript field must exist
in Rust, including optional fields. Errors include route, property path and both
source declarations where available.

The [derive reference](../forma-ir-derive/README.md) documents supported types,
renames, optional direction, integer bounds and signed epoch-millisecond dates.
`props::encode_props` is a one-shot convenience that also performs the comparison;
servers should retain a binding and rebind only when the module changes.

## When You Need This

- **Building your own server** (not Axum) — parse IR and generate HTML yourself
- **Build tools** — inspect, transform, or generate IR files

If you're using Axum, use [`forma-server`](https://crates.io/crates/forma-server) instead — it wraps `forma-ir` with page rendering, asset serving, and CSP headers.

## Security

**FMIR is a trusted input.** This crate validates structure and bounds so that malformed IR cannot read out of bounds, panic, or abort the process — but it does not sanitise the IR's *content*. An `.ir` file chooses what markup your page contains. Only run IR produced by a compiler you trust.

- All dynamic text and attribute values are HTML-escaped; tag and attribute names are validated against `[A-Za-z_:][-A-Za-z0-9_:.]*`
- URL-bearing attributes are scheme-checked and `on*` handlers dropped, matching `@getforma/core` so SSR and CSR agree
- Recursion depth limited to 64; list nesting limited to 4 levels
- Per-render output cap (default 8 MiB) and LIST iteration budget (default 50,000), both configurable via `WalkLimits` — a small module plus a large request array cannot force a multi-gigabyte allocation
- Parser rejects declared table counts the section cannot hold, and structurally validates the opcode stream once at load
- Island props JSON is escaped so it cannot terminate or re-open its `<script>` element — read it with `JSON.parse`, never by string-matching
- `#![forbid(unsafe_code)]` on the crate root — zero `unsafe` is compiler-enforced, not asserted
- XSS payload verification and malformed-input handling covered by the test suite

## Part of the Forma Stack

### Frontend (TypeScript)

| Package | Description |
|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | Reactive DOM library — signals, h(), islands, SSR hydration |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | FMIR compiler and esbuild SSR plugin |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | Production pipeline — bundling, hashing, compression, manifest |

### Backend (Rust)

| Package | Description |
|---|---|
| [forma-ir](https://crates.io/crates/forma-ir) | **This crate** — FMIR parser and native HTML walker |
| [forma-server](https://crates.io/crates/forma-server) | Axum middleware — SSR, asset serving, CSP headers |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://github.com/getforma-dev/create-forma-app) | `npx @getforma/create-app` — scaffolds Rust server + TypeScript frontend |

## License

MIT
