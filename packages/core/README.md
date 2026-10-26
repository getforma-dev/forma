# FormaJS

[![CI](https://github.com/getforma-dev/forma/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/forma/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@getforma/core)](https://www.npmjs.com/package/@getforma/core)
[![Socket Badge](https://socket.dev/api/badge/npm/package/@getforma/core)](https://socket.dev/npm/package/@getforma/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Reactive DOM library with fine-grained signals. No virtual DOM — signals update only the DOM nodes that changed. Components run once.

> **Where this sits.** One product, one repository, eight source packages (including the optional router):
>
> ```
> TS/JSX → @getforma/compiler → FMIR (binary) → forma-ir walker → HTML → @getforma/core adopts it
>          packages/compiler                    crates/forma-ir          packages/core
> ```
>
> **You are here:** the client runtime — signals, `h()`, islands, hydration, and the zero-build HTML runtime. It works entirely on its own; the rest of the stack is opt-in. New to the stack? Read **[the 3.0 architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE-3.0.md)** first. The [Forma workspace](https://github.com/getforma-dev/forma) also contains the compiler, build pipeline, Rust crates and scaffolder.

```tsx
import { createSignal, h, mount } from "@getforma/core";

const [count, setCount] = createSignal(0);

function Counter() {
  return (
    <button onClick={() => setCount((c) => c + 1)}>
      {() => `Clicked ${count()} times`}
    </button>
  );
}

mount(() => <Counter />, "#app");
```

No re-renders. No dependency arrays. No `useMemo`. The button text updates because it reads `count()` inside a reactive function — nothing else in the tree is touched.

---

## Install

This checkout prepares the coordinated `3.1.0` package set. The candidate
is not published yet; use the command below only after its release records
confirm publication. The latest published stable set remains `3.0.0`.
The [3.0.0 release](https://github.com/getforma-dev/forma/releases/tag/v3.0.0)
contains its qualification and publication records.

```bash
npm install @getforma/core@3.1.0
```

For the separate stable 2.1.0 runtime, the following URLs are retained only as
historical examples. They use the old automatic lifecycle, not the explicit
3.0 mount contract shown below. For current no-build usage, serve the
`dist/formajs-runtime.global.js` artifact from your qualified installed package:

```html
<!-- jsDelivr (recommended) -->
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@2.1.0/dist/formajs-runtime.global.js"></script>

<!-- unpkg -->
<script src="https://unpkg.com/@getforma/core@2.1.0/dist/formajs-runtime.global.js"></script>
```

> **Production:** Pin the qualified version instead of a moving dist-tag.

Any bundler works — Vite, esbuild, tsup, webpack, Rollup. FormaJS ships standard ESM and CJS via `package.json` exports. No plugins, no special config. For JSX, set `jsx: "react"`, `jsxFactory: "h"`, `jsxFragmentFactory: "Fragment"`.

Gzipped sizes, measured by `npm run check:size` on the FORMA-294 core candidate at `1d204ba4` on 2026-10-25 (the subsequent opt-in decision changes no core runtime bytes). That script walks the real ESM import graph, weighs shared chunks, and fails if any entry exceeds its limit:

| Artifact | Gzipped | CI limit |
|---|---|---|
| `@getforma/core` entry + every chunk it imports | 48.6 KiB (49,796 B) | 49,926 B |
| CDN HTML runtime (`formajs-runtime.global.js`) | 40.1 KiB (41,113 B) | 41,500 B |
| CDN HTML runtime, hardened (`formajs-runtime-hardened.global.js`) | 39.4 KiB (40,384 B) | 40,500 B |
| CDN browser ESM (`forma.esm.js`, inlines alien-signals) | 47.6 KiB (48,776 B) | 49,136 B |
| Preview frame runtime (`formajs-frame.global.js`, inlined by the server) | 38.9 KiB (39,867 B) | 40,000 B |

The core figure is **untree-shaken** — it is everything `dist/index.js` pulls in. A bundler that drops what your app does not import ships less. `@getforma/build` still refuses routes above 28,420 B gzip -9 of Forma code. The [3.1 performance decision](../../docs/release/3.1-PERFORMANCE-TRADEOFFS.md) records the earlier effects delivery costs. The separate [FORMA-294 decision](../../docs/release/FORMA-294-COMPILER-CANDIDATE.md) accepts 584 B of package growth and raises only its package cap by 512 B, from 49,414 to 49,926 B. The optional helper itself is excluded from main; splitting its shared dependencies creates most of the transport increase. Template compilation is off by default and remains subject to every route budget. Original failed measurements remain failed; package caps are separate from route budgets.

For historical comparison, the 3.0.0-dev build at `91a50157` on 2026-10-16 measured 48,602 B core, 39,203 B runtime, 37,629 B hardened runtime, 48,836 B browser ESM and 38,687 B frame runtime. Its Counter and indexed SSR routes measured 26,213 B and 28,071 B of Forma code. The former 28,100 B N2 gate and original 50 ms N3 condition belong to that L-64 decision; they are not retroactively changed by the 3.1 decision. The core and browser ESM figures had grown from 29,515 and 28,369 B at 2.1.0 with strict island activation (FORMA-104) and the declared island state block (FORMA-103). Measured sizes can change; a test keeps the current table's CI limits aligned with the gate script.

Verified by `src/__tests__/docs-truth.test.ts` > "the size table quotes the limits the CI gate actually enforces"

---

## Three ways to use it

All three share the same signal graph and reactive engine. Pick one, or mix them.

| | What it looks like | Needs |
|---|---|---|
| **JSX** | `<button onClick={…}>{() => count()}</button>` | a bundler with a JSX transform |
| **Hyperscript** | `h("button", { onClick: fn }, () => count())` | a bundler |
| **HTML runtime** | `<button data-on:click="{count++}">` | a runtime script and an explicit mount call |

JSX compiles to `h()` — same function, no JSX-specific runtime. The HTML runtime binds reviewed markup handed to `mountMarkup()` to the same signals. Loading the script binds nothing by itself.

```html
<script src="/vendor/formajs-runtime.global.js"></script>
<main id="counter">
  <div data-forma-state='{ "count": 0 }'>
    <p data-text="{count}"></p>
    <button data-on:click="{count++}">+1</button>
    <button data-on:click="{count = 0}">Reset</button>
  </div>
</main>
<script src="/counter.js"></script>
```

`counter.js` starts the reviewed counter explicitly (serve this script under your CSP):

```js
const root = document.getElementById('counter');
const counter = FormaRuntime.mountMarkup(root, FormaRuntime.trustedHtml(root.innerHTML), { tier: 'reviewed' });
// counter.update(FormaRuntime.trustedHtml(nextMarkup)); counter.unmount();
```

The mount grants no fetch, outside-DOM access or navigation unless requested. No build step is required. → [docs/HTML-RUNTIME.md](docs/HTML-RUNTIME.md) for every directive and the expression grammar.

Verified by `src/__tests__/readme-examples.test.ts` > "the intro counter works without eval"

---

## Why FormaJS

**Components run once.** No virtual DOM or component-tree diffing. Keyed lists still reconcile their rows. `h('div')` returns an actual `HTMLDivElement`. When a signal changes, only the specific text node or attribute that reads it updates — not the component, not the tree.

**Fine-grained reactivity.** Powered by [alien-signals](https://github.com/johnsoncodehk/signals) 3.x. The signal graph tracks dependencies automatically. No dependency arrays, no stale closures, no `useCallback` / `useMemo` ceremony.

**Three entry points, one engine.** Use JSX or hyperscript for components, or explicitly mount reviewed HTML markup.
Native SSR additionally requires declared props and the compiler’s admitted subset.

**Islands over SPAs.** Compiled `activateIslands()` validates each original SSR region before activation: successful adoption makes zero initial DOM writes, mismatches refuse without repair, and failures remain isolated per island. Load work cooperatively yields between whole islands; await `activateIslands()` for requested load completion. Deferred triggers (`visible`, `idle`, `interaction`) settle readiness once armed; disposal releases owned work. → [docs/ISLANDS.md](docs/ISLANDS.md)

**CSP-safe.** The HTML runtime evaluates expressions with an allowlist AST interpreter. **Zero `eval()`, zero `new Function()`, zero `with()` in every shipped artifact** — there is no opt-in fallback to leave switched on by mistake, because the fallback was deleted. Asserted by `scripts/verify-dist.mjs`, which greps the built files as the last step of `npm run build`, and by a Playwright spec that serves the flagship fixture under a real CSP header.

Verified by `src/__tests__/runtime-csp-default.test.ts` > "no build can reach new Function, with any configuration"
Verified by `src/__tests__/build-artifacts.test.ts` > "no build emits new Function or a with() scope wrapper"

**What FormaJS is not:** a framework with opinions about routing, data fetching or state management. It is a reactive DOM library. You bring the architecture.

### Measured, not asserted

`npm run bench` runs the hot-path suite in `bench/`. The numbers — each with the run-to-run noise floor next to it, so a later comparison can tell a regression from a bad afternoon — live in [docs/PERFORMANCE.md](docs/PERFORMANCE.md). They are historical happy-dom figures, not current browser timings. Strict adoption now uses connected, matching fixtures and a different transaction; no new measurement or comparison against the old adoption baseline is claimed.

- **A write that changes nothing does nothing.** An equal-value write never reaches an effect, and costs orders of magnitude less than one that does.
  Benchmarked by: bench/reactive.bench.ts > "write a CHANGING value, effect runs (×500)"
- **`batch()` collapses repeated writes to one flush.** It does nothing for writes to 100 *different* signals, which is the correct result.
  Benchmarked by: bench/reactive.bench.ts > "one signal, 100 writes, batched (×30)"
- **A keyed list update that changes no keys and no order takes the reconciler's fast path**, and costs a fraction of the same rows reordered.
  Benchmarked by: bench/list.bench.ts > "same keys, same order — reconciler fast path"
- **The historical adoption baseline was cheaper than its CSR control**, with HTML parsing subtracted. This measured the retired walker; it does not establish the strict transaction's current cost.
  Benchmarked by: bench/hydrate.bench.ts > "1000 rows: parse + adopt by data-forma-key"
- **The historical benchmark measured the CSP-safe interpreter faster than the `eval` path it replaced** — and it needs no `unsafe-eval` in your CSP.
  Benchmarked by: bench/expression.bench.ts > "8 count-dependent expressions: write → evaluate → text (×20)"

---

## Documentation

| Document | What it answers |
|---|---|
| [docs/API.md](docs/API.md) | `h()`, signals, control flow, stores, components, async, portals — and the four unsanitized escape hatches |
| [docs/HTML-RUNTIME.md](docs/HTML-RUNTIME.md) | Every `data-*` directive, and the CSP-safe expression grammar with its limits |
| [docs/ISLANDS.md](docs/ISLANDS.md) | Hydrating server-rendered HTML, seeding signals from server data, keyed list adoption |
| [docs/CDN-AND-EXPORTS.md](docs/CDN-AND-EXPORTS.md) | Which CDN build to load, and what each subpath export contains |
| [docs/COMPARISONS.md](docs/COMPARISONS.md) | Coming from React, and how this differs from Solid |
| [docs/STABILITY.md](docs/STABILITY.md) | Shipped APIs, experimental compatibility, and removed entry points |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Benchmarked hot paths, with noise floors |
| [SECURITY.md](SECURITY.md) · [CSP.md](CSP.md) | Threat model; running under a strict Content-Security-Policy |
| [docs/README.md](docs/README.md) | The full documentation index, including design records |

Examples: [`examples/`](./examples) — counter, counter-jsx, csp, todo, data-table.

---

## Part of the Forma Stack

### Frontend (TypeScript)

| Package | Description |
|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | **This library** — reactive DOM, signals, islands, SSR hydration |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | FMIR compiler and esbuild SSR plugin |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | Production pipeline — esbuild bundling, content hashing, compression, manifest |

### Backend (Rust)

| Package | Description |
|---|---|
| [forma-ir](https://crates.io/crates/forma-ir) | FMIR binary format — parser and native HTML walker |
| [forma-server](https://crates.io/crates/forma-server) | Axum middleware — SSR page rendering, asset serving, CSP headers |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://github.com/getforma-dev/forma/tree/main/packages/create-app) | `npx @getforma/create-app` — scaffolds a Rust server + TypeScript frontend project |

---

## License

MIT
