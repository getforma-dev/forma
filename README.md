# Forma

[![CI](https://github.com/getforma-dev/forma/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/forma/actions/workflows/ci.yml)
[![crates.io](https://img.shields.io/crates/v/forma-ir)](https://crates.io/crates/forma-ir)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Rust backend for the [Forma Stack](https://getforma.dev) — server-side rendering without Node.js. The `@getforma/compiler` compiles TypeScript components to a binary IR (FMIR). These Rust crates parse that binary and generate HTML, so your server never needs a JavaScript runtime.

> **Where this sits.** One product, four repos:
>
> ```
> TS/JSX → @getforma/compiler → FMIR (binary) → forma-ir walker → HTML → @getforma/core adopts it
>          forma-tools                          THIS REPO                 formajs
> ```
>
> **You are here:** the server half — the FMIR parser, the HTML walker, and the
> Axum middleware. New to the stack? Read
> **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** first; it explains the whole
> pipeline and why each piece is shaped the way it is.
> Neighbours: [formajs](https://github.com/getforma-dev/formajs) (client
> runtime) · [forma-tools](https://github.com/getforma-dev/forma-tools)
> (compiler + build) ·
> [create-forma-app](https://github.com/getforma-dev/create-forma-app)
> (scaffolder).

## Documentation

| Document | What it is |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The stack, end to end, and the reasoning behind every load-bearing decision. **Start here.** |
| [docs/FMIR-FORMAT.md](docs/FMIR-FORMAT.md) | The binary layout and the stability contract: which bytes are frozen, what a version bump would cost consumers |
| [docs/TESTING.md](docs/TESTING.md) | The testing policy for all four repos, and the `Verified by:` citation contract |
| [docs/README.md](docs/README.md) | Index of the stack's documentation, including the other repos' |
| [SECURITY.md](SECURITY.md) | Threat model and the guarantees these crates do and do not make |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, the gates, and what a reviewer will ask you |

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
- Emits hydration markers (`<!--f:t0-->`, `<!--f:s0-->`, `<!--f:l0-->`, `<!--f:i0-->`) that FormaJS uses for client-side hydration, except inside `textarea`, `title`, `style` and `script`, whose content HTML reads as text
- Writes a `textarea`'s `value` as its text and a `select`'s as `selected` on the matching option, since HTML ignores both as attributes
- Compiles to WASM for client-side re-renders in the browser (the `wasm` feature: deprecated in 0.2.2, removed in 3.0.0)

**Use it when:**
- You're building your own server (not Axum) and want Forma SSR
- You need the WASM build for client-side island re-rendering (deprecated: islands re-render with `@getforma/core`'s `h()`, and the `wasm` feature is removed in 3.0.0)
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
- `try_render(config, ctx)` — renders a page from an IR module + slot data, returning the page with its counts or a coded `RenderError` the handler answers (`render_page`, which falls back to an empty shell on any failure, is deprecated in 0.2.2)
- `load_ir_modules_strict(manifest)` — the module loader: loads `.ir` files from embedded assets at startup and returns every failure (route, file, code) so the server refuses to start on a bad module (the lenient `load_ir_modules` is deprecated in 0.2.2)
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
use forma_server::{assets, load_ir_modules_strict};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "dist/"]
struct Assets;

// At startup, before the port binds: a bad manifest or module stops the server.
let manifest = assets::try_load_manifest::<Assets>()?;
let (render_modes, ir_modules) = load_ir_modules_strict::<Assets>(&manifest)
    .map_err(|errors| format!("{errors:?}"))?;
// Per request: forma_server::try_render(&config, &ctx), see crates/forma-server.
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

What crosses each of those arrows — the slot-name contract, the hydration
marker grammar, the `data-forma-*` attributes and the island props protocol —
is specified in [docs/ARCHITECTURE.md §3](docs/ARCHITECTURE.md), which is the
part to keep open while you work. Those four contracts are shared byte-for-byte
with the TypeScript side and with the applications built on the stack, so
changing one is a cross-repo change.

## Security

See [SECURITY.md](SECURITY.md) for the full list and the threat model — in particular, **FMIR is a trusted input**: run only IR produced by a compiler you trust.

- **HTML escaping:** All dynamic text and attribute values are escaped (`&`, `<`, `>`, `"`); tag and attribute names are validated against an HTML name charset
- **Attribute safety:** URL-bearing attributes are scheme-checked and `on*` handlers are dropped, matching the client renderer so SSR and CSR agree
- **CSP headers:** Strict policy with cryptographic nonces — `'strict-dynamic'` scripts, nonce-locked style *elements*, no `unsafe-eval`. Style *attributes* are allowed via `style-src-attr` because compiled `style:` bindings emit them
- **Resource limits:** Recursion depth 64, list nesting 4, plus a per-render output cap and LIST-iteration budget (both configurable) so a small module cannot force a multi-gigabyte allocation
- **Comment escaping:** `--` in HTML comments replaced with `&#45;&#45;`, and a comment cannot self-close
- **Island props:** the `__forma_islands` JSON block is escaped so it cannot terminate or re-open its `<script>` element; read it with `JSON.parse`
- **Load-time validation:** cross-table references, control-flow tiling, duplicate slot/island ids, and islands the tables do not declare are all rejected at parse time, so a compiler bug fails loudly at startup instead of rendering a quietly wrong page on some later request
- **No unsafe code:** both library crates carry `#![forbid(unsafe_code)]`, so "zero `unsafe`" is compiler-enforced rather than asserted
- XSS payload verification and malformed-input handling are covered by the test suite (`cargo test --workspace`)

## Performance

Lists are the SSR workload the whole design rests on, so the cost of one is a
tested property, not a hope. Rendering a 3-column table page
(`cargo run --release -p forma-ir --example list_scaling`):

| rows | µs | µs/row |
|-----:|---:|-------:|
| 1 | 0.6 | 0.56 |
| 10 | 3.8 | 0.38 |
| 100 | 36.2 | 0.36 |
| 400 | 147.0 | 0.37 |

Flat per-row cost, ~6 allocations per row. `crates/forma-ir/tests/list_scaling.rs`
fails the build if that stops being true — it asserts both wall-clock time and
allocation count grow under 6x for a 4x increase in rows, where linear is ~4x
and quadratic is ~16x.

## The binary format

[`docs/FMIR-FORMAT.md`](docs/FMIR-FORMAT.md) documents the on-disk layout and,
more importantly, the **stability contract**: which bytes are frozen across all
future versions (magic at 0, u16 LE version at 4), what v2 guarantees, and what
a version bump would require of consumers. If you byte-guard an embedded `.ir`
module in your own test suite, that document is what you are guarding against.

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
cargo test --workspace                                    # full suite
cargo clippy --workspace --all-targets --all-features     # lint (CI adds -D warnings)
cargo fmt --all --check                                   # format check

# Offset arithmetic differs where usize is 32 bits (as on wasm32):
cargo test --workspace --target i686-unknown-linux-gnu

# MSRVs differ per crate and CI builds at exactly these versions. The 1.85
# check locks with the MSRV-aware resolver first; CONTRIBUTING.md says why,
# and what consumers on Rust 1.85 to 1.87 need:
cargo +1.71 check -p forma-ir --all-targets
CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo +1.85 generate-lockfile
cargo +1.85 check -p forma-server --all-targets

# Measurement harnesses (not gates — see tests/list_scaling.rs for those):
cargo run --release -p forma-ir --example list_scaling   # timing/alloc table
cargo run --release -p forma-ir --example list_corpus    # byte-identity corpus
```

Before you open a PR, read [CONTRIBUTING.md](CONTRIBUTING.md) — and if the PR
adds or changes a test, [docs/TESTING.md](docs/TESTING.md), which is what a
reviewer will hold it to.

## License

MIT
