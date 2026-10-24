# {{PROJECT_NAME}}

Built with Forma: an Axum server, a TypeScript page and a typed Rust handler.

## Quick start

```bash
cd admin && npm ci && npm run build && cd ..
cargo run
```

Open [http://localhost:3000](http://localhost:3000). The server listens on
loopback only. This build explicitly selects Browser routes and serves page shells.
The home counter starts at 0; `/about` shows a simple information page.
Set `FORMA_PORT` to choose another port (0 asks the OS to assign one). The
server prints `FORMA_LISTENING` with its address after successfully binding.

The distributed `admin/package-lock.json` and `Cargo.lock` pin the exact
archives tested with this template. `npm ci` preserves the npm lock. Cargo's
`rust-version = "1.85"` and `resolver = "3"` keep later updates within the
consumer toolchain floor. Commit both locks.

## Server rendering with declared props

```bash
cd admin && npm run build:ssr && cd ..
cargo run
```

`Home(props: HomeProps)` in `admin/src/home/app.tsx` declares
`type HomeProps = { count: number }`. The compiler emits that contract and the
page into FMIR. Rust declares the matching `#[derive(PageProps)] HomeProps`
with `count: u32`, loads the modules, binds `pages.bind::<HomeProps>("home")`
once and calls `pages.finalize()` before opening the listener.

Each native home request calls `home.render(&HomeProps { count: 7 }, &ctx)`.
The heading, paragraphs and count 7 are already in the HTML. `Counter(props)`
is the only registered island; its local signal starts from the validated
server props. Increment changes 7 to 8 and Reset changes it to 0. The surrounding
heading, paragraph and navigation remain server-rendered markup.

The standalone `mount` in the source selects Home for the compiler. Native
builds remove that invocation from browser JavaScript and retain
`activateIslands({ Counter })` with the paired metadata. Do not call `mount`
on a server-marked root yourself. An explicit Browser build keeps ordinary
mounting with its independent zero default.

`/about` declares no props or interactive regions. Rust binds its empty
`AboutProps` handle before startup. The native build preserves its module and
shared stylesheet, but publishes no browser entry or module preload for it.
It therefore needs no JavaScript to display its content. The inert JSON state
block is data, not executable code.

Missing or corrupt modules and incompatible declared props stop startup with
a route and diagnostic code. A request-time failure returns `RenderError`;
the handler logs its code and route and sends a non-cacheable 500. It never
substitutes a browser shell for a failed SSR response. Running `npm run build`
again selects the explicit Browser route on the next startup.

## Strict builds

Both build scripts pass `--strict`. Unsupported source constructs fail with
code, file, line and column; `FORMA_STRICT=1` also enables strict mode without
the flag. The compiler reads declared source; it does not execute arbitrary
JavaScript to discover a handler's contract. Keep the page props explicit.
See the [diagnostics catalogue](https://github.com/getforma-dev/forma/blob/main/docs/DIAGNOSTICS.md).

## Styling and response policy

The typed handle and `render_browser_shell` return `PageResponse`. Return
`page.into_response()` so its fresh nonce, CSP, `Cache-Control: no-store` and
document headers remain attached. Trusted Types directives are enforced;
external script and stylesheet tags carry manifest SHA-384 integrity and
`crossorigin="anonymous"`.

Put styles in `admin/src/styles/app.css`, or add a CSS entry in `build.ts`.
For request-specific metadata use `RenderCtx`; extend the typed policy rather
than assembling CSP headers or scripts by hand.

## Service worker

Workers are off. `/sw.js` serves Forma's retiring worker, which removes the
application's old caches and unregisters it. Enabling a worker is an explicit
application choice using the manifest identity; see `forma_server::sw`.

## Files

- `src/main.rs`: typed startup, handlers, assets and response errors.
- `admin/src/home/app.tsx`: declared page props, Counter island and native root selector.
- `admin/src/about/app.tsx`: empty-props static page and native root selector.
- `admin/build.ts`: explicit browser/SSR build selection and CSS entries.
- `admin/src/styles/app.css`: page styling.

## CI and release builds

The included `.github/workflows/build.yml` builds the frontend before the release
server. It caches npm downloads and Rust dependencies in `target/`, keyed by the
lockfile and compiler. A page-only change still recompiles the app crate because
release builds embed the page assets; the dependency cache avoids compiling the
whole Rust dependency graph again. Cache writes are restricted to the default
branch. A cache miss is valid and builds from the committed locks.

Keep `admin/dist` and the release binary from the same build. Build assets before
`cargo build --release --locked`; then deploy the resulting binary atomically.
Do not restore a server binary as the completed output of a different page build.
See the [deployment guide](https://github.com/getforma-dev/forma/blob/main/docs/DEPLOYMENT.md).
