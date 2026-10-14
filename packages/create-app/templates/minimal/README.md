# {{PROJECT_NAME}}

Built with the [Forma Stack](https://getforma.dev) — an Axum server in Rust, a
TypeScript frontend, and (once you run `build:ssr`) a Rust renderer that turns
your JSX into HTML before the browser gets it.

## Quick Start

```bash
# Build the frontend (Phase 1 — client mount)
cd admin && npm ci && npm run build && cd ..

# Start the Rust server
cargo run
```

Open [http://localhost:3000](http://localhost:3000). The server binds to
`127.0.0.1` only.

`admin/package-lock.json` and `Cargo.lock` pin the versions this template was
built and tested with. `npm ci` installs exactly those and never rewrites the
lockfile; pnpm, yarn and bun do not read `package-lock.json` and resolve the
ranges in `package.json` afresh. `Cargo.toml` declares `rust-version = "1.85"`
with `resolver = "3"`, so a later `cargo update` only picks crates that still
build on Rust 1.85. Commit both lockfiles.

## Server-side rendering

```bash
cd admin && npm run build:ssr && cd ..
cargo run
```

That is the whole upgrade. `build:ssr` emits `admin/dist/home.ir` alongside the
JS; `main.rs` already loads the build's modules with
`load_ir_modules_strict`, so the route switches itself to Phase 2 and the
server logs which mode it picked:

```
INFO forma_server::ir_compat: Loaded IR module for SSR route=/ ir_file=home.<hash>.ir
INFO {{PROJECT_NAME}}: / is Phase 2 (server-rendered from IR)
```

View source and you will find the markup — `<h1>`, the paragraphs, the buttons
— already in the response, inside `<div id="app" data-forma-ssr>`. FormaJS then
adopts that DOM instead of rebuilding it. Run `npm run build` again to go back
to Phase 1; the server follows.

The mode is decided once, at start, from what the build emitted; a failure
never changes it:

- A module the build declared that is missing, corrupt or from another format
  version stops the server before it binds its port, naming the route, the
  file and a `LOAD-` code.
- A Phase 2 page is rendered by `try_render`, which returns the page or a
  coded `RenderError` (`RENDER-101` to `RENDER-399`, with the route and the
  component). `main.rs` logs the error and answers 500; it never serves an
  empty shell in its place. That `Err` arm is yours: send your own error page,
  count failures by code and route.
- A Phase 1 page is served by `render_browser_shell`: the script and style
  tags around an empty `<div id="app">`.

### Strict builds

The build scripts pass `--strict`, which `admin/build.ts` maps to
`@getforma/build`'s `strict: true`. With it, a construct the compiler cannot
render on the server fails `npm run build:ssr` with its code, file, line and
column, all of them at once, instead of becoming an empty island in the page:

```
src/home/app.tsx:24:26  BUILD-701  plain array child <expression>.map(...) (a .map() without createList) ...
```

Each code, with its fix, is in
[the build's diagnostics catalogue](https://github.com/getforma-dev/forma-tools/blob/main/docs/DIAGNOSTICS.md).
Without the flag the same diagnostics are warnings; `FORMA_STRICT=1` turns
strict mode on for a build run without it.

### What the compiler can and cannot server-render

The FMIR compiler walks the tree your `mount()` callback returns. It reads
source; it does not execute it. In practice:

| Written as | Rendered by |
|---|---|
| Literal JSX elements, static attributes, static text | the Rust server |
| `{() => signal()}` text bindings | server (empty), then the client fills it in |
| A component tag (`<Card />`), a helper call that returns JSX, a dynamic tag | the client only — it becomes an island placeholder in the HTML |

That last row is why this template keeps its page shell as literal JSX in
`admin/src/home/app.tsx` instead of splitting it into components. Splitting it
is fine — you just get less server-rendered HTML, and the parts that become
islands need a registry (`activateIslands`) to hydrate.

The build prints what it emitted, and the byte count tells you which happened:

```
IR emitted (real): home.ir (~450 bytes, 0 islands)    ← walked your tree
IR emitted (placeholder): home.ir (121 bytes)         ← fell back, nothing server-rendered
```

`0 islands` is the number to watch: each island is a subtree the compiler gave
up on, and an anonymous `island_N` has no registry entry, so nothing hydrates it.

## Project Structure

```
├── src/
│   └── main.rs             Axum routes, SSR, static assets, CSP
├── admin/
│   ├── src/
│   │   ├── home/app.tsx    mount() — the SSR root and the browser entry
│   │   └── styles/app.css  Plain CSS, hashed by the build
│   ├── build.ts            Build pipeline (@getforma/build)
│   └── tsconfig.json       JSX → h() configuration
└── Cargo.toml
```

## Styling and CSP

`try_render` and `render_browser_shell` return a `PageResponse`, which sends
the page with the Content-Security-Policy for its nonce,
`Cache-Control: no-store` and the document security headers, because the
policy's nonce is fresh on every request and a cached page would replay one
nonce to every visitor. Return it as it is when you add pages
(`page.into_response()`); to allow an image or frame source, extend the policy
through `RenderCtx::with_policy` rather than editing the header. The policy's
`style-src` carries a nonce and no
`unsafe-inline`, so inline `<style>` blocks and third-party stylesheets are
refused; a separate `style-src-attr 'unsafe-inline'` permits `style="..."`
attributes. Prefer a stylesheet anyway —
put styling in `admin/src/styles/app.css` (or add another entry to `cssEntries`
in `admin/build.ts`) so it is cached, hashed and served from `/_assets`.

**WebKit (Safari) logs one console error per page in a debug build:** "The
Content Security Policy 'require-trusted-types-for 'script'; trusted-types
forma forma-runtime' was delivered in report-only mode, but does not specify a
'report-to'". forma-server 0.2.2 sends Trusted Types in
`Content-Security-Policy-Report-Only` in development builds, and this template
names no reporting endpoint. It blocks nothing; a release build sends no
Report-Only policy without an endpoint, so the message goes. To silence it in
development too, or to collect the reports, name an endpoint the server
answers: `PolicyExtensions::new().report_uri("/csp-reports")` on the
`RenderCtx` (`with_policy`) and a route that accepts the POST.

## Service worker

None. `main.rs` configures forma-server's worker setting off
(`sw::ServiceWorker::off()`), so no page registers one, and `/sw.js` serves
forma-server's retiring worker: a browser that installed a Forma worker on
this origin before deletes its caches and unregisters it on its next visit.
The worker is opt-in, per application; see `forma_server::sw` before turning
it on.

## Learn More

- [FormaJS documentation](https://getforma.dev/docs)
- [@getforma/core on npm](https://www.npmjs.com/package/@getforma/core)
- [forma-server on crates.io](https://crates.io/crates/forma-server)
