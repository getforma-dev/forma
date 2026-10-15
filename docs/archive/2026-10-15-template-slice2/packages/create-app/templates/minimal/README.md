# {{PROJECT_NAME}}

Built with Forma: an Axum server, a TypeScript page and a typed Rust handler.

## Quick start

```bash
cd admin && npm ci && npm run build && cd ..
cargo run
```

Open [http://localhost:3000](http://localhost:3000). The server listens on
loopback only. This build declares a Browser route and serves its page shell.
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

Each request calls `home.render(&HomeProps { count: 0 }, &ctx)`. View source:
the heading, paragraphs, buttons and count are already in the HTML. The
whole-page browser mount currently starts from the same zero. This template
has not yet moved to an isolated counter island with server state adoption;
changing only the Rust count is not a promise that the client will retain it
after activation. That is a separate migration.

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
- `admin/src/home/app.tsx`: declared page props and current browser mount.
- `admin/build.ts`: explicit browser/SSR build selection and CSS entries.
- `admin/src/styles/app.css`: page styling.
