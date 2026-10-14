# @getforma/create-app

[![npm version](https://img.shields.io/npm/v/@getforma/create-app.svg)](https://www.npmjs.com/package/@getforma/create-app)
[![CI](https://github.com/getforma-dev/create-forma-app/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/create-forma-app/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Scaffold a new [Forma](https://getforma.dev) application — Rust server + TypeScript frontend, fully wired.

> **Where this sits.** One product, four repos:
>
> ```
> TS/JSX → @getforma/compiler → FMIR (binary) → forma-ir walker → HTML → @getforma/core adopts it
>          forma-tools                          forma                    formajs
>                              THIS REPO scaffolds a project that uses all three
> ```
>
> **You are here:** the front door. New to the stack? Read
> **[the stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE.md)**
> — it explains the whole pipeline and the reasoning behind it. Neighbours:
> [formajs](https://github.com/getforma-dev/formajs) (client runtime) ·
> [forma-tools](https://github.com/getforma-dev/forma-tools) (compiler + build) ·
> [forma](https://github.com/getforma-dev/forma) (Rust parser, walker, server).

## Usage

```bash
npx @getforma/create-app my-app
cd my-app
```

Then:
```bash
# Build the frontend
cd admin && npm ci && npm run build && cd ..

# Start the Rust server
cargo run
```

Open http://localhost:3000. Both templates bind to `127.0.0.1` by default; the
dashboard can opt in to a wider bind with `FORMA_HOST`, and warns when you do,
because its `/api/*` routes have no authentication.

## Options

```bash
npx @getforma/create-app my-app --template dashboard
npx @getforma/create-app my-app --template minimal
npx @getforma/create-app my-app --dry-run
npx @getforma/create-app --help
npx @getforma/create-app --version
```

Project names must be lowercase alphanumeric with hyphens or underscores, at
most 64 characters, and must not be a Windows device name. The CLI refuses to
write into a path that already exists.

## Templates

| Template | Rendering | Description |
|----------|-----------|-------------|
| `dashboard` | Phase 1 (client mount) | DevOps admin panel — 4 pages, 8 API routes, SVG chart, Tailwind CSS, Gruvbox theme, 16 Playwright tests |
| `minimal` | Phase 1, or Phase 2 SSR with `npm run build:ssr` | Rust server + a single-file JSX page, ready to build on |

The dashboard is client-rendered on purpose. The FMIR compiler walks source
rather than executing it, so a construct it cannot prove — with the compiler
version the templates install, that includes component tags — degrades to an
empty island shell, and serving those as Phase 2 is worse than not serving them
at all. The dashboard's README documents the measurement behind that choice;
the minimal template is where a working Phase 2 setup lives; and
[docs/RENDERING-PHASES.md](docs/RENDERING-PHASES.md) is the rule itself, for
whoever writes the next template.

## What You Get

- **Rust server** (`src/main.rs`) — Axum + `forma-server`: page rendering, asset serving from `rust-embed`, a per-request CSP nonce, and a `tracing` subscriber so render fallbacks are visible
- **TypeScript frontend** (`admin/src/`) — FormaJS with JSX, signals, components
- **Build pipeline** (`admin/build.ts`) — `@getforma/build`: bundling, content hashing, Brotli/gzip, manifest, service worker
- **A `.gitignore`** that covers build output, secrets and (for the dashboard) Playwright artifacts — and deliberately does not ignore `Cargo.lock`
- **Lockfiles** (`admin/package-lock.json` and `Cargo.lock`) holding the exact versions this repo's scaffold gate built and served, so a new project starts from a tested set rather than whatever resolves that day

## Development

```bash
npm test        # structural tests — builds the CLI first via `pretest`
npx tsc --noEmit
```

The real gate is opt-in because it needs a network and a Rust toolchain:

```bash
FORMA_SCAFFOLD_E2E=1 npx vitest run
```

That scaffolds each template into a temp directory, installs from the
template's lockfile with `npm ci`, builds the frontend, runs
`cargo check --locked`, then starts each compiled server and reads its
responses: the minimal template must serve real server-rendered markup after
`build:ssr`, the dashboard must serve a Phase 1 shell whose CSP nonce matches
the script tag, and every page of both must answer `Cache-Control: no-store`
with a fresh nonce on each fetch. CI runs it on Linux and Windows, and again before
`npm publish`.

| Document | What it is |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, the gates, and what a reviewer will ask |
| [docs/TEMPLATES.md](docs/TEMPLATES.md) | Template anatomy, what the scaffolder rewrites, how to add one |
| [docs/RENDERING-PHASES.md](docs/RENDERING-PHASES.md) | Phase 1 vs Phase 2, and the compiler rule that decides it |
| [Stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE.md) | The whole pipeline and its reasoning. **Start here if you are new.** |
| [Testing policy](https://github.com/getforma-dev/forma/blob/main/docs/TESTING.md) | The standard every test in this stack is held to |

## Part of the Forma Stack

### Frontend (TypeScript)

| Package | Description |
|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | Reactive DOM library — signals, h(), islands, SSR hydration |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | Vite/esbuild plugin — h() optimization, server transforms, FMIR emission |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | Production pipeline — bundling, hashing, compression, manifest |

### Backend (Rust)

| Package | Description |
|---|---|
| [forma-ir](https://crates.io/crates/forma-ir) | FMIR binary format: parser, walker, WASM exports |
| [forma-server](https://crates.io/crates/forma-server) | Axum middleware: SSR, asset serving, CSP headers |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://www.npmjs.com/package/@getforma/create-app) | **This package** — scaffolds the full stack |

## License

MIT
