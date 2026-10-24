# Protocol: FORMA-254, the Framework Grand Prix

Fixed 2026-10-23 before any timed run. Forma 3.0.0 against the web stacks people choose instead,
on server rendering, startup, memory, weight, build and compile, client DOM work and signals.
Every timed number is the mean of at least three runs, reported with its spread; nothing is tuned
after a result is seen. The report is `report/index.html`.

## The grid

| ID | Car | What runs |
|---|---|---|
| `forma` | Forma 3.0.0 | Rust server (`forma-server` 3.0.0) rendering a page compiled to FMIR by `@getforma/build` 3.0.0, data through typed props |
| `vanilla-node` | Baseline | Node 22, `node:http`, template strings with an escape function: the floor a framework adds to |
| `react-node` | React 19 | Node 22, `react-dom/server` `renderToString` |
| `preact-node` | Preact 10 | Node 22, `preact-render-to-string` |
| `solid-node` | SolidJS 1.9 | Node 22, `solid-js/web` `renderToString`, compiled for SSR |
| `svelte-node` | Svelte 5 | Node 22, `svelte/server` `render`, compiled component |
| `vue-node` | Vue 3 | Node 22, `vue/server-renderer` `renderToString` |
| `react-bun`, `vanilla-bun` | Bun 1.x | the same React and vanilla servers on Bun (`Bun.serve`) |
| `react-deno`, `vanilla-deno` | Deno 2.x | the same React and vanilla servers on Deno (`Deno.serve`) |
| `next` | Next.js 15 | App Router, a server component page, `next build` then `next start` |
| `react-router` | Remix, now React Router 7 | framework mode, SSR loader and route, `react-router build` then `react-router-serve` |
| `astro` | Astro 5 | SSR with `@astrojs/node` standalone, an `.astro` page |

Versions are pinned in each car's lockfile and recorded in the results.

## Fairness

- **One machine, one VM.** Every server runs in Docker Desktop's Linux VM (arm64, 10 CPUs, 8 GB)
  on the same Apple M1 Pro, one car at a time, nothing else timed alongside. Background apps that
  load the CPU are paused for the timed runs.
- **Same limits.** Class A: the server container gets `--cpus=1 --memory=1g`. Class B: `--cpus=4
  --memory=2g`, and each car runs as its stack ships for several cores: plain Node servers with
  `node:cluster` and 4 workers, Bun with 4 `reusePort` processes, Deno with `deno serve
  --parallel`, Forma's Rust server with its default threads, and Next.js, React Router and Astro
  with their own production server (one process, as shipped; the report says so).
- **Same work.** Every car renders `shared/PAGE-SPEC.md` from `shared/dataset.mjs` or its exact
  port, per request, no HTML caching, production mode. The harness verifies every car's body before
  any timed run (row count and totals); a car that fails is out of that event, not fixed by hand.
- **Same load.** The load generator runs in its own container (`--cpus=4`) on the same Docker
  network, never on the server's CPUs. Throughput: concurrency 64 for 10 s after 5 s of warm-up.
  Latency: concurrency 1 for 10 s. Three runs each.
- **Disclosed differences.** A framework that adds its own payload or scripts to the page keeps
  them, because that is what it serves; the report shows each car's response size.

## Events and points

Formula 1 points by position, 25, 18, 15, 12, 10, 8, 6, 4, 2, 1; ties share their positions'
points. A car scores only in events it can enter.

| # | Event | Measure (better) | Cars |
|---|---|---|---|
| 1 | SSR Sprint | requests/s, 100 rows, class A (higher) | all servers |
| 2 | SSR Endurance | requests/s, 1,000 rows, class A (higher) | all servers |
| 3 | Multi-core | requests/s, 100 rows, class B (higher) | all servers |
| 4 | Reaction time | p99 latency at concurrency 1, 100 rows, class A (lower) | all servers |
| 5 | Fuel | peak resident memory under the Sprint's load (lower) | all servers |
| 6 | Grid start | container start to first 200 on `/ssr`, five starts (lower) | all servers |
| 7 | Weight | runtime image size (lower) and response bytes for 100 rows, gzip (lower), scored apart | all servers |
| 8 | Pit stop | production build or compile time, three runs, `--cpus=4` (lower); Forma's FMIR compile scored, its Rust compile reported beside it | all servers |
| 9 | DOM race | keyed table in headless Chrome: create 1,000, replace 1,000, update every 10th, select, swap, remove, create 10,000, append 1,000, clear; five runs each after two warm-ups; geometric mean of times (lower) | client: forma, vanilla, react, preact, solid, svelte, vue |
| 10 | Bundle | JavaScript shipped for the DOM race app, Brotli (lower) | client cars |
| 11 | Signals | reactive core in Node 22 (`--cpus=1`): signal create, read, write with effect, computed cache hit, chain of 100, diamond, fan-out to 100 effects, effect create and dispose, batch of 100; five runs; geometric mean of ops/s (higher) | forma, alien-signals (reference), solid, preact-signals, vue-reactivity |

Championships: **Server** (events 1 to 8), **Client** (9 to 11), and **Overall** as points per event
entered, so a car is not rewarded for entering more events. Podiums for each event and each
championship.

## Runs and outputs

Every timed run is written raw to `results/raw/<event>/<car>.json`; `results/summary.json` holds
means, spreads and points; `report/index.html` renders podiums, per-event tables with every run,
the method, and a commentary per event. The machine's state (CPU, load average, Docker limits,
versions) is recorded with each event.

## Docker hygiene

All images are `gp/<car>` with label `grandprix=forma-254`, built with the dedicated builder `gp254`.
Afterwards: remove every container and image with that label, remove the builder and its cache
(`docker buildx rm gp254`), remove pulled base images that were not present before
(`results/docker-before.md`), and record the host's free disk before and after in the report.

## Amendment 1 (2026-10-23, after the first full run): the DOM race's clock

The first run timed each DOM operation from the click to the second animation frame after it.
Headless Chrome paces frames at 60 Hz, so every operation rounded to about two frames (20 to 35 ms
for all cars, a row selection as slow as a 1,000-row create, vanilla JavaScript behind React): the
ranking measured frame pacing, not the frameworks. Event 9 is re-run with the clock stopped at a
forced layout after one task boundary (every microtask drained, a `MessageChannel` task queued after
the framework's own): script, style and layout, paint excluded. The first run's raw files are kept
in `results/raw/dom-frame-paced/` for the record and are not scored.

## Amendment 2 (2026-10-23, after the first full run): the Overall standings rank stacks

Scored as first written, Overall (points per event entered, every car alone) put alien-signals and
the vanilla DOM car first: each entered one or two events and won them, which says nothing about a
stack. Overall now ranks the fourteen server cars as stacks: each server car is credited with the
DOM race and bundle points of the UI library it ships to the browser, and the signals points of that
library's reactive core where one raced. Forma: forma, forma, forma. Vanilla on Node, Bun and Deno:
vanilla. React on Node, Bun and Deno, Next.js and React Router: react (no signals entry). Preact:
preact, preact-signals. Solid: solid, solid. Svelte: svelte (no signals entry). Vue: vue,
vue-reactivity. Astro ships no script on this page and enters only the server events.
alien-signals is a reference and appears only in the Client championship. Points per event
entered still decides, so a stack is not rewarded for entering more events. Event 7's two parts are
half an event each in every standing; the first scoring counted them whole by mistake.

## Amendment 3 (2026-10-23, after the first full run): Forma's pit stop

The first run scored Forma's FMIR build alone (about 1.1 s) and reported its Rust compile beside it.
The Forma car's binary is the app's own: its Rust ports the dataset, computes the props and embeds the
FMIR, so a Forma production build is both steps, and scoring the FMIR alone flattered it. The cold
compile (24 s from an empty `target/`) is not the counterpart either: it compiles every dependency
from source, which the Node, Bun and Deno cars never do, because `node_modules` arrives prebuilt.
Forma's scored pit stop is now the FMIR build followed by a release compile of the app's own crate
with its dependencies already compiled in the build image (the counterpart of an installed
`node_modules`), three runs, each in a fresh container. The cold compile stays reported apart.
