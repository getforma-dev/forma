# My Forma App

Built with [Forma Stack](https://getforma.dev) — Rust + FormaJS.

## Quick Start

```bash
# Build the frontend
cd admin && npm install && npm run build && cd ..

# Start the Rust server
cargo run
```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
├── src/                    Rust server (Axum)
│   └── main.rs             Routes, SSR, static assets
├── admin/                  TypeScript frontend
│   ├── src/
│   │   └── home/
│   │       ├── app.tsx     Mount point
│   │       └── HomeIsland.tsx  Interactive component
│   ├── build.ts            Build pipeline (@getforma/build)
│   └── tsconfig.json       JSX → h() configuration
└── Cargo.toml              Rust dependencies
```

## Upgrading to SSR (Phase 2)

This template starts with Phase 1 (client-side rendering). To enable server-side rendering:

1. Enable SSR in `admin/build.ts`:
   ```ts
   ssr: true,
   ssrEntryPoints: { '/': 'src/home/app.tsx' },
   ```

2. Rebuild: `cd admin && npm run build:ssr`

3. The `.ir` files are automatically loaded by the Rust server. Phase 2 SSR is now active — the server renders full HTML, FormaJS hydrates on the client. No other code changes needed.

## Learn More

- [FormaJS Documentation](https://getforma.dev/docs)
- [@getforma/core on npm](https://www.npmjs.com/package/@getforma/core)
- [forma-server on crates.io](https://crates.io/crates/forma-server)
