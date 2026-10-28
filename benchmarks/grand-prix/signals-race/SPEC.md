# Signals race spec (event 11)

Adapters with one shape, `signals-race/adapters/<car>.mjs`:

```js
export default {
  name, version,
  signal(v)      // -> { get(), set(v) }
  computed(fn)   // -> { get() }
  effect(fn)     // -> dispose()
  batch(fn)      // runs fn with writes batched (or just calls fn if the library has no batch)
};
```

Cars: `forma` (the signals `@getforma/core` 3.0.0 exports), `alien-signals` (reference),
`solid` (`solid-js` browser build: import `solid-js/dist/solid.js`, since its server build has no
reactivity), `preact-signals` (`@preact/signals-core`), `vue-reactivity` (`@vue/reactivity`).
Svelte's runes need the compiler and React has no signals; both sit out and the report says so.

Benchmarks, adapted from the 2.x showcase's `races/reactive-core.ts`
(`~/dev/FormaStackDev/forma-experiments/getforma-dev/forma-code-poc-files/forma-showcase/benchmarks/races/reactive-core.ts`,
read only): signal create; signal read; signal write with one effect; computed cache hit; computed
chain depth 100 (write the root, read the tip); diamond (one root, 500 middles, one sink); fan-out (1
signal, 100 effects); effect create and dispose; batch of 100 writes with one effect. Each benchmark
reports ops/s. Runner `signals-race/run.mjs` runs every car in a `node:22-bookworm-slim` container with
`--cpus=1`, two warm-up rounds and five timed rounds, each car in a fresh process, and writes
`results/raw/signals/<car>.json`.

## Maintained laboratory checks (2026-10-28)

The runner preserves campaign and resource-affinity qualification, validates selected
adapter IDs and counts, and rejects overwriting any result. `GP_RESULTS_DIR` routes
local default output under `raw/signals`; container `/out` and explicit `--out` still
work. Worker failures, malformed output and timeouts are retained as failed JSON
records and cause nonzero exit. The default per-adapter limit is ten minutes;
`--timeout` records an operational bound in milliseconds, not a speed result.

Every adapter receives explicit garbage collection before each fixed workload.
Non-finite or nonpositive timings/rates are invalid. Vue has no public batch API:
its uncoalesced batching result carries `comparable: false`; its legacy aggregate
carries `geomeanComparable: false`. Retain those observations, but compare equivalent
individual workloads instead of ranking that aggregate against batching libraries.
The historical geometric summary is kept for reader compatibility, not endorsement.
