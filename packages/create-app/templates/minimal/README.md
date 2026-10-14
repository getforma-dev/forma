# {{PROJECT_NAME}}

Built with the [Forma Stack](https://getforma.dev) — an Axum server in Rust, a
TypeScript frontend, and (once you run `build:ssr`) a Rust renderer that turns
your JSX into HTML before the browser gets it.

## Quick Start

```bash
# Build the frontend (Phase 1 — client mount)
cd admin && npm install && npm run build && cd ..

# Start the Rust server
cargo run
```

Open [http://localhost:3000](http://localhost:3000). The server binds to
`127.0.0.1` only.

`admin/package-lock.json` and `Cargo.lock` pin the versions this template was
built and tested with; `npm ci` installs exactly those. Commit both.

## Server-side rendering

```bash
cd admin && npm run build:ssr && cd ..
cargo run
```

That is the whole upgrade. `build:ssr` emits `admin/dist/home.ir` alongside the
JS; `main.rs` already calls `load_ir_modules`, so the route switches itself to
Phase 2 and the server logs which mode it picked:

```
INFO forma_server::ir_compat: Loaded IR module for SSR route=/ ir_file=home.<hash>.ir
INFO {{PROJECT_NAME}}: / is Phase 2 (server-rendered from IR)
```

View source and you will find the markup — `<h1>`, the paragraphs, the buttons
— already in the response, inside `<div id="app" data-forma-ssr>`. FormaJS then
adopts that DOM instead of rebuilding it. Run `npm run build` again to go back
to Phase 1; the server follows.

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

`main.rs` sends each page through `PageOutput::headers()`: the
Content-Security-Policy that `render_page` generated, with
`Cache-Control: no-store`, because the policy's nonce is fresh on every request
and a cached page would replay one nonce to every visitor. Keep that line when
you add pages. The policy's `style-src` carries a nonce and no
`unsafe-inline`, so inline `<style>` blocks and third-party stylesheets are
refused; a separate `style-src-attr 'unsafe-inline'` permits `style="..."`
attributes. Prefer a stylesheet anyway —
put styling in `admin/src/styles/app.css` (or add another entry to `cssEntries`
in `admin/build.ts`) so it is cached, hashed and served from `/_assets`.

## Learn More

- [FormaJS documentation](https://getforma.dev/docs)
- [@getforma/core on npm](https://www.npmjs.com/package/@getforma/core)
- [forma-server on crates.io](https://crates.io/crates/forma-server)
