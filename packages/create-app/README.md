# @getforma/create-app

Scaffold a new [Forma](https://getforma.dev) application — Rust server + TypeScript frontend, fully wired.

## Usage

```bash
npx @getforma/create-app my-app
cd my-app
```

Then:
```bash
# Build the frontend
cd admin && npm install && npm run build && cd ..

# Start the Rust server
cargo run
```

Open http://localhost:3000.

## Options

```bash
npx @getforma/create-app my-app --template dashboard
npx @getforma/create-app --help
npx @getforma/create-app --version
```

## Templates

| Template | Description |
|----------|-------------|
| `minimal` | Counter with signals and JSX — simplest starting point |
| `dashboard` | Sortable data table with `createList` — demonstrates list rendering |

## What You Get

A full-stack project with:
- **Rust server** (`src/main.rs`) — Axum + forma-server with SSR, asset serving, CSP headers
- **TypeScript frontend** (`admin/src/`) — FormaJS with JSX, signals, components
- **Build pipeline** (`admin/build.ts`) — @getforma/build with content hashing, compression, manifest
- **Everything wired** — manifest pipeline, asset serving, and development scripts ready to go

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
| [forma-ir](https://crates.io/crates/forma-ir) | FMIR binary format: parser, walker, WASM exports |
| [forma-server](https://crates.io/crates/forma-server) | Axum middleware: SSR, asset serving, CSP headers |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://www.npmjs.com/package/@getforma/create-app) | **This package** — scaffolds the full stack |

## License

MIT
