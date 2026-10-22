# Forma

[![CI](https://github.com/getforma-dev/forma/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/forma/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Forma combines TypeScript UI, fine-grained signals and optional native Rust
rendering. Write components with TSX or `h()`. Use the browser runtime on a
static site, or compile supported components to FMIR and render them in Rust
with typed request data. Interactive islands adopt the server's existing DOM.
The Rust rendering path needs no JavaScript server runtime.

**[Forma 3.0.0 is released](https://github.com/getforma-dev/forma/releases/tag/v3.0.0).**
One repository ships seven coordinated packages. Start with the
[documentation](docs/README.md), [3.0 upgrade guide](docs/UPGRADING-3.0.md), or
[release results and limits](docs/release/V3-AS-BUILT.md).

## Start an application

With Node 22+ and Rust 1.85+:

```sh
npx @getforma/create-app@3.0.0 my-app --template minimal
cd my-app
```

Follow the generated README to build the frontend and run the Rust server.
The minimal template demonstrates Browser rendering and an explicit native SSR
build; the dashboard template uses Browser rendering. See
[scaffolder usage](packages/create-app/README.md) and
[rendering modes](packages/create-app/docs/RENDERING-PHASES.md).

For a browser-only application or static landing page, install
`@getforma/core@3.0.0` and follow the [core quickstart](packages/core/README.md).
That path does not require Rust or FMIR.

## Choose what runs where

| Mode | Build and runtime |
|---|---|
| Browser UI on static hosting | Bundle core with your TSX/JavaScript; serve HTML, CSS and JavaScript. Signals update the browser DOM. |
| Native Rust SSR with islands | Compile the admitted TSX subset to FMIR. Rust supplies declared props and renders a complete HTML response per request; core activates declared interactive regions. |
| Native static route | Render an island-free FMIR page in Rust with no executable JavaScript entry. This is a server-rendered route, distinct from hosting prebuilt static files. |
| Explicit HTML runtime | Mount reviewed markup through a runtime owner with an explicit security tier and capability grants. |

Native compilation accepts a [defined subset](packages/compiler/docs/subset.md),
not arbitrary TypeScript execution. Unsupported native source fails with a coded
diagnostic; Browser mode is an explicit choice. Forma 3.0 does not provide React
component compatibility, JavaScript SSR, streaming native pages or an integrated
server-component caching layer. Application APIs, authentication and storage
remain application responsibilities. See [architecture](docs/ARCHITECTURE-3.0.md).

## Packages

| Package | Purpose |
|---|---|
| [`@getforma/core`](packages/core) | Signals, DOM components, island adoption and the explicit HTML runtime |
| [`@getforma/compiler`](packages/compiler) | TypeScript/TSX subset, declared schemas and FMIR emission |
| [`@getforma/build`](packages/build) | Bundling, assets, manifests, integrity and deployment retention |
| [`@getforma/create-app`](packages/create-app) | Minimal and dashboard starters |
| [`forma-ir`](crates/forma-ir) | FMIR validation, typed props and native HTML walking |
| [`forma-ir-derive`](crates/forma-ir-derive) | Rust `PageProps` derive |
| [`forma-server`](crates/forma-server) | Typed pages, complete responses, assets and Axum integration |

## Work on the framework

Use the Node version in [`.node-version`](.node-version), stable Rust with
`rustfmt` and `clippy`, and Playwright Chromium. Then run:

```sh
git clone https://github.com/getforma-dev/forma.git
cd forma
npm run check
```

This is the integrated build/test command. Additional platform, scaffold,
security and release checks run in [Actions](.github/workflows).
[CONTRIBUTING.md](CONTRIBUTING.md) covers setup and verification;
[SECURITY.md](SECURITY.md) covers reporting and support windows.

`packages/` and `crates/` hold the implementation; `e2e/` holds cross-package
fixtures; `docs/` holds guides, contracts and retained evidence. The former
standalone repositories are maintenance sources for older lines, not the place
to develop 3.x. See [repository and documentation layout](docs/REPOSITORY-LAYOUT.md).

## License

MIT
