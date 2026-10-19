# @getforma/create-app

[![npm version](https://img.shields.io/npm/v/@getforma/create-app.svg)](https://www.npmjs.com/package/@getforma/create-app)
[![CI](https://github.com/getforma-dev/forma/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/forma/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Scaffold a new [Forma](https://getforma.dev) application — Rust server + TypeScript frontend, fully wired.

> **Where this sits.** One repository, seven coordinated packages:
>
> ```
> TS/JSX → @getforma/compiler → FMIR 3 → forma-ir → forma-server → HTML
>          @getforma/build joins the assets       @getforma/core adopts islands
>          @getforma/create-app supplies the templates; forma-ir-derive types props
> ```
>
> **You are here:** the front door. New to the stack? Read
> **[the stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE-3.0.md)**
> — it explains the pipeline. All seven packages live in
> [getforma-dev/forma](https://github.com/getforma-dev/forma) and publish as one set.
> Existing 0.6.x projects can follow the
> [3.0 template migration](docs/UPGRADING-3.0.md).

## Usage

These registry commands target `3.0.0-rc.4` and require its coordinated
publication. For an unpublished set, use the packed candidate workflow
described below. Release records report the qualification of each published set.

```bash
npx @getforma/create-app@3.0.0-rc.4 my-app
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
npx @getforma/create-app@3.0.0-rc.4 my-app --template dashboard
npx @getforma/create-app@3.0.0-rc.4 my-app --template minimal
npx @getforma/create-app@3.0.0-rc.4 my-app --dry-run
npx @getforma/create-app@3.0.0-rc.4 --help
npx @getforma/create-app@3.0.0-rc.4 --version
```

Project names must start with a lowercase letter and use only lowercase
letters, digits, hyphens and underscores, at most 64 characters. The name
becomes the crate's name, so the CLI also refuses what cargo refuses for a new
package (a Rust keyword such as `fn`, `test`, a build directory name such as
`build`) and a Windows device name (`con`, `nul`); its message names the rule. It checks the
name before writing anything, and refuses to write into a path that already
exists.

## Templates

| Template | Rendering | Description |
|----------|-----------|-------------|
| `dashboard` | Phase 1 (client mount) | DevOps admin panel — 4 pages, 8 API routes, SVG chart, Tailwind CSS, Gruvbox theme, 16 Playwright tests |
| `minimal` | Phase 1, or Phase 2 SSR with `npm run build:ssr` | Rust server + a single-file JSX page, ready to build on |

The dashboard explicitly uses client rendering. The FMIR compiler walks source
rather than executing it and accepts only the documented native subset. It
refuses unsupported native source with a coded diagnostic; it does not emit an
empty placeholder or silently change a native route to client rendering.
The minimal template demonstrates native rendering with declared island state;
see [the admitted subset](../compiler/docs/subset.md) and
[the template rendering guide](docs/RENDERING-PHASES.md) when choosing a mode
for a new template.

## What You Get

- **Rust server** (`src/main.rs`) — Axum + `forma-server`: page rendering with a bound `PageHandle<Props>` (or `render_browser_shell` for an explicit Browser route), each page a `PageResponse` carrying its per-request CSP nonce and `Cache-Control: no-store`, asset serving from `rust-embed`, no service worker, and a `tracing` subscriber that logs every render error by code and route
- **TypeScript frontend** (`admin/src/`) — FormaJS with JSX, signals, components
- **Build pipeline** (`admin/build.ts`) — `@getforma/build`: bundling, content hashing, Brotli/gzip, manifest, in strict mode, so a construct the server cannot render fails the build with its code and line
- **A `.gitignore`** that covers build output, secrets and (for the dashboard) Playwright artifacts — and deliberately does not ignore `Cargo.lock`
- **Lockfiles** (`admin/package-lock.json` and `Cargo.lock`) holding the exact versions this repo's scaffold gate built and served, so a new project starts from a tested set rather than whatever resolves that day

## Development

```bash
npm test        # structural tests — builds the CLI explicitly first
npx tsc --noEmit
```

The candidate gate needs a network and a Rust toolchain. From the repository
root, build and commit the source, then use a fresh artifact/work directory:

```bash
npm run build
node scripts/candidate-scaffold.mjs pack /absolute/path/to/candidate-artifacts
# Use the record SHA-256 printed by pack and this checkout's full Git commit.
node scripts/candidate-scaffold.mjs run /absolute/path/to/candidate-artifacts RECORD_SHA256 COMMIT /absolute/path/to/candidate-work /absolute/path/to/report.json
```

CI always runs the full candidate suite on Linux and Windows. The separate
registry lane runs the actual published CLI when all seven coordinated versions
exist. Missing or skipped candidate jobs fail the release gate. The source lock
seeds are never passed directly to an unpublished registry installation.

That scaffolds each template into a temp directory, installs from the
template's lockfile with `npm ci`, builds the frontend, runs
`cargo check --locked`, then starts each compiled server and reads its
responses: the minimal template must serve real server-rendered markup after
`build:ssr`, the dashboard must serve each page as its declared browser shell
whose CSP nonce matches the script tag, and every page of both must answer
`Cache-Control: no-store` with a fresh nonce on each fetch, register no service
worker, and leave `/sw.js` to forma-server's retiring worker. It also runs
`npm audit signatures` over each template's install, fails on any
`use of deprecated` warning from the template's Rust, checks that a
construct the server cannot render fails the minimal template's strict build,
and that the minimal server refuses to start on a truncated module and
answers a failed render with its own 500, carrying neither the error nor an
empty shell. A distinct handler value of 7 must appear in raw SSR HTML;
missing/wrong props and unbound routes must stop before a listener opens.
The packed native-island check adopts the server value without initial writes
and checks that the static route requests no code in all three engines. The
dashboard tooltip check keeps API values as text under enforced Trusted Types.
The gate requires all 19 heavy controls plus the structural suite, with no skips.

| Document | What it is |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, the gates, and what a reviewer will ask |
| [docs/TEMPLATES.md](docs/TEMPLATES.md) | Template anatomy, what the scaffolder rewrites, how to add one |
| [docs/RENDERING-PHASES.md](docs/RENDERING-PHASES.md) | Phase 1 vs Phase 2, and the compiler rule that decides it |
| [Stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE-3.0.md) | The whole pipeline and its reasoning. **Start here if you are new.** |
| [Testing policy](https://github.com/getforma-dev/forma/blob/main/docs/TESTING.md) | The standard every test in this stack is held to |

## Part of the Forma Stack

### Frontend (TypeScript)

| Package | Description |
|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | Reactive DOM library — signals, h(), islands, SSR hydration |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | FMIR generation, coded diagnostics and esbuild SSR integration |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | Production pipeline — bundling, hashing, compression, manifest |

### Backend (Rust)

| Package | Description |
|---|---|
| [forma-ir](https://crates.io/crates/forma-ir) | FMIR binary format, structural validation and native Rust walker |
| [forma-server](https://crates.io/crates/forma-server) | Axum middleware: SSR, asset serving, CSP headers |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://www.npmjs.com/package/@getforma/create-app) | **This package** — scaffolds the full stack |

## License

MIT

## Source staging for 3.0.0-rc.4

The checked-in templates now use the declared-props and finalized Pages APIs.
Minimal now declares a Counter island over its static home markup and a
separate empty-props About page. The native handler starts at7 while explicit
Browser mode starts at0. Source tests pair its emitted contract and browser
registration; final integrated adoption/zero-network acceptance and slice3's
release/size qualification remain required.

Source template locks are explicitly identified **seeds** at the coordinated
package version. They retain every external registry checksum and omit only
the known Forma candidate checksums, which cannot exist before the archives
are packed. Release packing seals those entries from actual archive bytes,
validates the shipped locks, and restores all ten source files. The source-only
`template-lock-seeds.json` marker is never shipped. Use the packed candidate
scaffold workflow for local end-to-end development; copying source templates
by hand does not produce an installable unpublished candidate set.

The scaffolder writes a separate application identity into `admin/build.ts`.
Valid worker names stay unchanged; accepted project names with underscores or
64 characters use a readable prefix plus a deterministic SHA-256 suffix. This
preserves accepted CLI names without merging distinct cache namespaces. The
server's enabled worker must use this `app` value with
`sw::configure_for_manifest(worker, &manifest)` before binding; templates leave
workers off. See [compatibility and migration](../../docs/compatibility.md).

Verified by: `tests/scaffold.test.ts`, `scripts/release-template-lock.test.mjs`
at the repository root, and the exact-artifact P17 template run.
