# Reactive development measurements

Build core, then run from the repository root with the pinned Node version:

```sh
npm run build -w packages/core
node packages/core/scripts/signals-bench/run.mjs > signals.json
node packages/core/scripts/signals-bench/island.mjs > island.json
```

`run.mjs` preserves FORMA-254's nine workloads and fourteen behavioral checks.
It starts Forma and the exact installed alien-signals dependency in separate
processes, with five warmups and nine measured rounds by default. It reports every
sample, means, standard deviations, ratios, and the geometric mean. `--warm` and
`--runs` can select the original two-warmup/five-run protocol. `--entry` selects a
preserved baseline `index.js` (keep its sibling chunks and resolvable dependency).
Node's `--cpu-prof` flags are forwarded to both measured workers.

`island.mjs` uses headless Chromium and the built self-contained browser module.
It adopts 1,000 server-rendered text bindings, proves zero initial DOM writes,
updates one shared signal, verifies retained text-node identity, and proves that
disposal stops updates. Parsing and fixture creation are outside the timed
region. Its output separates adoption and update time; `--entry` can select a
preserved `forma.esm.js`. The default is five warmups and fifteen measured rounds.

These text bindings use the strict planner's `AdoptionLifecycle.observe` path.
Public effects and new internal bindings created by a live adopted callback use
the public effect generation path; do not attribute all initial island adoption
time to `createEffect`. Compare both measurements in the same session, record the
machine and background load, and keep raw results. They are development evidence,
not a quiet Linux release baseline or a substitute for the ownership/adoption
correctness suites.
