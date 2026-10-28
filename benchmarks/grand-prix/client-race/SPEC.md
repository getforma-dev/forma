# DOM race spec (event 9) and bundle (event 10)

The js-framework-benchmark keyed table, idiomatic in each framework, production build, served as
static files. Cars: `forma`, `vanilla`, `react`, `preact`, `solid`, `svelte`, `vue`.

- Page: buttons with ids `run` (create 1,000 rows, replacing any), `runlots` (create 10,000),
  `add` (append 1,000), `update` (every 10th row: label += " !!!"), `clear`, `swaprows` (swap rows
  at index 1 and 998 when there are more than 998); a `<table><tbody>` of rows
  `<tr><td class="col-id">{id}</td><td><a class="lbl">{label}</a></td><td><a class="remove">x</a></td></tr>`;
  clicking a label selects its row (the row gets class `danger`, the previous loses it); clicking
  `remove` deletes the row. Rows are keyed by id.
- Data: ids from 1 upward across the session; labels from the jfb word lists (adjectives, colours,
  nouns) chosen by a seeded generator (mulberry32, seed 42) so every car builds the same labels.
- Build: each car's normal production build (Vite unless the framework's own CLI is the normal path),
  output in `client-race/apps/<car>/dist/` with `index.html`.
- Runner `client-race/run.mjs` (Node, `puppeteer-core` driving the installed Google Chrome,
  headless, 1280x800, no throttling): serves each `dist/` from one local static server; for each
  operation, prepares the state it needs, then measures from the click to a forced layout after one
  task boundary (`performance.now()` inside the page; PROTOCOL.md Amendment 1 replaced the first
  clock, the second `requestAnimationFrame` after the click, which measured 60 Hz frame pacing); two warm-ups and five
  timed runs per operation, fresh page per car. Writes `results/raw/dom/<car>.json`.
  Finite zero readings are retained as clock-quantized observations after the same result checks;
  negative or non-finite timings fail. Geometric summaries use the existing 0.1 ms resolution
  floor without changing raw samples, sample counts or the operation boundary.
- Bundle: the Brotli and gzip size of all JavaScript the built `index.html` loads, written to
  `results/raw/bundle/<car>.json`.

## Maintained laboratory checks (2026-10-28)

New DOM records identify `correctnessVersion: full-state-keyed-v1`. Outside each timing
window the harness compares every row ID, label, selected row, and surviving DOM node
identity with a fresh seed-42 reference model. This detects skipped replacement work,
wrong data and unkeyed recreation that row counts alone cannot detect. MessageChannel
ports close after each measurement. Existing zero-duration clock observations remain
unchanged; only the geometric summary uses the established 0.1 ms resolution floor.

Raw outputs refuse overwrite, including failed attempts. Use a fresh run directory;
`GP_RESULTS_DIR` routes default output under its `raw/dom` and `raw/bundle` folders.
Car IDs must be distinct known adapters and repetition counts must be valid integers.
The execution order is recorded. The order remains the frozen requested order; vary
it only as an explicitly versioned protocol change, not in response to results.

Bundle measurement covers initial static JavaScript, excluding dynamic imports, CSS,
HTML and network protocol overhead. It is not a full browser-transfer measurement.
Historical records retain their original check strength and are not retrospectively
promoted to the stronger correctness contract.

The bundle collector parses static module imports and re-exports with Node's built-in
module parser in a bounded subprocess; it does not evaluate application code or add
a parser dependency. Missing references, remote/non-file modules, bare imports,
syntax errors and paths or symlinks outside `dist` fail the measurement. Import maps,
HTML base URLs, `nomodule` branches, and query/fragment script references currently
require a separate supported protocol and are refused rather than undercounted.
Inline static imports and modulepreloads are included; dynamic imports remain
intentionally excluded. Failed bundle attempts retain JSON with `verified: false`,
`status: failed` and a readable error, without fabricated byte totals.
