# create-forma-app

Scaffold a new [Forma](https://getforma.dev) application — Rust + TypeScript SSR framework with fine-grained reactivity and no virtual DOM.

## Usage

```bash
npx create-forma-app my-app
```

You will be prompted to choose a template:

- **minimal** — Counter example with `createSignal` and `h()` for real DOM elements
- **dashboard** — Sortable data table using `createList` with fine-grained reactivity

## What you get

```
my-app/
  Cargo.toml          # Rust server (axum + forma-server + forma-ir)
  src/main.rs          # Server entry point with SSR rendering
  admin/
    package.json       # Frontend dependencies (@getforma/core, @getforma/compiler)
    build.ts           # Build script using @getforma/build
    src/home/
      app.ts           # Mount point
      HomeIsland.ts    # Interactive island component
```

## After scaffolding

```bash
cd my-app

# Build the frontend
cd admin && npm install && npm run build && cd ..

# Run the server
cargo run

# Open http://127.0.0.1:3000
```

## License

MIT
