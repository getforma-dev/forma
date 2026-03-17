# {{project-name}}

A Forma dashboard — Rust server + TypeScript frontend with islands architecture.

## Quick Start

```bash
# Build the frontend
cd admin && npm install && npm run build && cd ..

# Start the Rust server
cargo run
```

Open [http://localhost:3000](http://localhost:3000)

## What This Demonstrates

| Feature | Island | Trigger | Forma APIs |
|---------|--------|---------|------------|
| **Stats cards** | StatsCards | `load` | `createSignal`, `onMount`, fetch, error states |
| **Sidebar** | Sidebar | `visible` | `createSignal`, conditional rendering, collapse |
| **Activity feed** | ActivityFeed | `idle` | `createList`, auto-refresh (30s), `onMount` cleanup |
| **Data table** | DataTable | `interaction` | `createComputed`, `createList`, `batch`, debounced search, sort |

## Architecture

```
Rust Server (src/main.rs)              TypeScript Frontend (admin/src/)
├── GET /          → SSR page          ├── app.tsx           → island registry
├── GET /api/stats → JSON stats        ├── islands/
├── GET /api/activity → JSON feed      │   ├── StatsCards.tsx
├── GET /api/users → JSON users        │   ├── Sidebar.tsx
├── GET /_assets/* → hashed assets     │   ├── ActivityFeed.tsx
└── GET /sw.js     → service worker    │   └── DataTable.tsx
                                       ├── components/      → reusable UI
                                       ├── lib/             → API + formatting
                                       └── styles/          → CSS
```

## Project Structure

```
├── src/                    Rust server
│   ├── main.rs             Routes, middleware, startup
│   └── data.rs             Mock data (replace with your database)
├── admin/                  TypeScript frontend
│   ├── src/
│   │   ├── app.tsx         Island registry (activateIslands)
│   │   ├── islands/        One file per island — self-contained
│   │   ├── components/     Reusable UI components (no state)
│   │   ├── lib/            Utilities and API wrappers
│   │   └── styles/         CSS
│   ├── build.ts            @getforma/build pipeline
│   └── tsconfig.json       JSX config (jsxFactory: "h")
└── Cargo.toml              Rust dependencies
```

## Key Patterns

**Islands hydrate independently** — each island has its own signals, effects, and lifecycle. A broken island never crashes its siblings.

**Hydration triggers** — not all islands load JavaScript immediately:
- `load` — stats cards hydrate on page load (above the fold)
- `visible` — sidebar hydrates when scrolled into view
- `idle` — activity feed hydrates during browser idle time
- `interaction` — data table hydrates on first click/focus

**Separation of concerns:**
- `islands/` — stateful, self-contained interactive regions
- `components/` — stateless, reusable presentational components
- `lib/` — pure functions, no DOM, no rendering

**Error handling** — every island handles loading, error, and empty states.

## Customizing

- **Replace mock data:** Edit `src/data.rs` with real database queries
- **Add API routes:** Add handlers in `src/main.rs`
- **Add islands:** Create a new file in `admin/src/islands/`, register in `app.tsx`
- **Styling:** Edit `admin/src/styles/dashboard.css`

## Part of the Forma Stack

Built with [@getforma/core](https://www.npmjs.com/package/@getforma/core) (signals, islands), [@getforma/build](https://www.npmjs.com/package/@getforma/build) (pipeline), and [forma-server](https://crates.io/crates/forma-server) (Rust SSR).
