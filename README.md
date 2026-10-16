# Forma

[![CI](https://github.com/getforma-dev/forma/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/forma/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The [Forma Stack](https://getforma.dev): a reactive DOM library with
fine-grained signals, a compiler that turns TypeScript components into a binary
IR (FMIR), and Rust crates that render that IR to HTML on the server, so the
server never needs a JavaScript runtime. One product, one repository, seven
packages.

This checkout prepares the coordinated `3.0.0-beta.1` candidate. It is not a
publication announcement: release gates and qualification remain pending.
After publication, select the explicit `3.0.0-beta.1` version in the package
install commands; unversioned npm commands select the stable `latest` channel.

```
TS/JSX → @getforma/compiler → FMIR (binary) → forma-ir walker → HTML → @getforma/core adopts it
         packages/compiler                    crates/forma-ir            packages/core
```

## The packages

| Package | Where | Published as |
|---|---|---|
| The client runtime: signals, `h()`, islands, hydration, the zero-build HTML runtime | [`packages/core`](packages/core) | [`@getforma/core`](https://www.npmjs.com/package/@getforma/core) |
| The compiler: TypeScript components to FMIR, declared props and islands, the diagnostics catalogue | [`packages/compiler`](packages/compiler) | [`@getforma/compiler`](https://www.npmjs.com/package/@getforma/compiler) |
| The build pipeline: bundling, hashing, compression, the asset manifest, the raw-markup lint | [`packages/build`](packages/build) | [`@getforma/build`](https://www.npmjs.com/package/@getforma/build) |
| The scaffolder: `npx @getforma/create-app` | [`packages/create-app`](packages/create-app) | [`@getforma/create-app`](https://www.npmjs.com/package/@getforma/create-app) |
| The FMIR format: parser and native HTML walker | [`crates/forma-ir`](crates/forma-ir) | [`forma-ir`](https://crates.io/crates/forma-ir) |
| Derive macros for forma-ir (`#[derive(PageProps)]`) | [`crates/forma-ir-derive`](crates/forma-ir-derive) | [`forma-ir-derive`](https://crates.io/crates/forma-ir-derive) |
| Typed page rendering and Axum responses, asset serving, CSP, the service worker | [`crates/forma-server`](crates/forma-server) | [`forma-server`](https://crates.io/crates/forma-server) |

Each package keeps its own README, CHANGELOG and tests. The Rust half as a
whole is described in [`crates/README.md`](crates/README.md); the stack's
architecture, what crosses each boundary and why, in
[`docs/ARCHITECTURE-3.0.md`](docs/ARCHITECTURE-3.0.md); the binary format in
[`docs/FMIR-FORMAT.md`](docs/FMIR-FORMAT.md); the build diagnostics in
[`docs/DIAGNOSTICS.md`](docs/DIAGNOSTICS.md).

## One command

```bash
git clone https://github.com/getforma-dev/forma.git
cd forma
npm run check
```

`npm run check` ([`scripts/check.sh`](scripts/check.sh)) installs the npm
workspace, builds every package in both languages and runs every test: the
crates' lints, tests and docs, the four npm packages' builds and suites, core's
size and packaging gates, the compiler-to-walker FMIR contract, and the
browser lanes that take a page from TypeScript source through the compiler and
the Rust walker to a hydrated DOM in Chromium. CI runs the same command on
every push and pull request ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
It needs Node 24 (`.node-version`; the parity harness's step runs TypeScript by
Node's type stripping, and the script stops at once on a Node without it), a
stable Rust toolchain with `rustfmt`, `clippy` and
Playwright's Chromium
(`npx playwright install chromium`, once).

## Layout

```
crates/          the Cargo workspace: forma-ir, forma-ir-derive, forma-server
packages/        the npm workspace: core, compiler, build, create-app
e2e/             the cross-package browser lanes (compiler → walker → core), their own Cargo workspace
docs/            the stack's documents: architecture, the FMIR format, testing policy, diagnostics
scripts/         check.sh (the one command) and the release checks
.github/         one CI workflow, the crates' release workflow, the engines and nightly-probe gates
```

The repository took the four repositories' histories at the merge (FORMA-113).
An old commit is where `git log` finds it under its new path; an old tag is
`formajs/<tag>`, `forma-tools/<tag>` or `create-forma-app/<tag>`; the crates'
tags (`ir-v*`, `server-v*`) kept their names.

## Contributing and security

[`CONTRIBUTING.md`](CONTRIBUTING.md) is the way in, with each package's own
guide beside its code. [`SECURITY.md`](SECURITY.md) says how to report a
vulnerability and where each half's policy lives.

## License

MIT
