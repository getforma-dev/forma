# Forma Grand Prix

A performance laboratory for improving Forma through fair comparisons. Every
measurement belongs to a specific workload, source revision, dependency set,
resource profile and campaign. There is no overall winner score in new reports.

**Start with [performance history](docs/PERFORMANCE-HISTORY.md)** before changing
Forma's measured paths. It records the findings, adopted changes, rejected
experiments, accepted costs and still-missed targets. The Grand Prix optimizations
shipped in 3.1 and were inherited by 3.2; earlier timings are not fresh 3.2 results.

## One entry point

From `benchmarks/grand-prix`, with Node 22+ (the repository uses its `.node-version`):

```sh
npm run gp -- dashboard
npm run gp -- changes
npm run gp -- catalog
npm run gp -- plan --suite server --cars forma --events 1,5-7 --forma-ref current
npm run gp -- doctor --suite server
npm test
```

`dashboard` prints the local HTML path. It links engineering history, reports,
run records, the audit and the original evidence. The control layer uses Node's
standard library and needs no root dependency installation. Run the tests before
committing a changed protocol or adapter.

## Run and review

For hosted runs, use the [GitHub Actions guide](docs/RUNNING-ON-GITHUB.md). It gives
the qualified four-CPU inputs and explains why PR checks remain diagnostic.

Commit the source first. Qualified measurements require native Linux, Docker,
the declared CPU allocation and a quiet machine. Browser suites also require the
existing pinned Chromium installation and executable hash. See [ROUND-2.md](ROUND-2.md)
for `native-8-v1` and `gha-4-v1`; the latter is specifically for a four-CPU GitHub
Actions host. The CLI never silently turns a failed qualification into a success.

```sh
npm run gp -- run --suite server --cars forma --events 1,5-7 --forma-ref current
npm run gp -- run --suite server --baseline
npm run gp -- run --suite client --forma-ref current --chrome /path/to/chrome --chrome-sha256 EXACT_SHA256
npm run gp -- run --suite islands --chrome /path/to/locked/chrome
npm run gp -- history
npm run gp -- verify RUN_ID
npm run gp -- report RUN_ID
npm run gp -- compare BASELINE_RUN_ID CURRENT_RUN_ID
```

`current` resolves to the **exact** source commit in `config/laboratory.json` and
is recorded in the plan. Server candidate mode substitutes Rust crates while
retaining the frozen app/compiler and external dependency controls. Client mode
compares the pinned published core to the exact candidate and verifies its
external dependency graph. These are controlled component experiments, not a
claim that every package in a complete current stack was rebuilt. A new complete
stack cohort must update all coordinated package and crate locks and rerun its
correctness gates.

All entrants share the same new correctness checks. Server rows and all cells
must match the deterministic model; the DOM track also checks surviving keyed
node identity. Signals adapters must satisfy their behavior contracts. Unsupported
batching semantics remain separately labeled. No failed or missing entrant gets
a silent zero, a discarded sample or a performance claim.

For a **local diagnostic only**, install the frozen signals dependencies with
`npm ci --prefix signals-race --ignore-scripts`, then:

```sh
npm run gp -- run --suite signals --mode diagnostic --cars forma,alien-signals
```

These host measurements cannot establish a Linux baseline, release acceptance,
or cross-host speedup. Builds/installs and measured races must be sequential.

## Evidence and the pit crew

Each unique `runs/<id>/` contains a manifest, full process log, original observations
under `artifacts/`, HTML/Markdown/JSON/CSV reports, cleanup receipts and SHA-256
integrity. Reusing an ID fails. Failed, blocked and interrupted attempts remain in
history. Read-only imported campaigns retain their original date/source/campaign;
importing or rescoring never upgrades old qualification.

```sh
npm run gp -- import-evidence evidence/2026-10-24/client-final/artifact.zip --id historic-client-20261024
npm run gp -- cleanup RUN_ID --dependencies
npm run gp -- cleanup RUN_ID --dependencies --apply
npm run gp -- cleanup RUN_ID --docker
```

Cleanup defaults to a plan. A normal managed run automatically removes its
regenerable build/dependency directories after finishing. Raw data, source,
locks, logs, reports and the change ledger are retained. Docker driver cleanup
already runs on success/failure/interruption and uses exact run ownership.
No shared image/cache pruning, name-prefix deletion, symlink traversal or active
run cleanup is permitted. `--keep-generated` is a deliberate debugging exception.
See [operations](docs/OPERATIONS.md) for recovery and long-term storage.

## Updating Forma or a competitor

```sh
npm run gp -- updates
npm run gp -- update @preact/signals-core 1.14.5
npm run gp -- update-apply UPDATE_ID
```

The first command reads registry metadata. The second resolves exact manifests
and locks under an isolated `updates/` proposal without lifecycle scripts. Review
its lock changes and resolution logs; `update-apply` refuses changed inputs and
writes a versioned receipt. All affected adapters need a new correctness run
before accepting that cohort. Coordinate related framework packages and runtime
requirements; a major-version migration is not an automatic performance gain.

The [October 28 dependency audit](docs/dependency-audit-2026-10-28.json) distinguishes
frozen pins from available releases. Forma 3.2.0 is registered as the current
candidate. Latest competitor majors have **not** been silently inserted into the
Round 2 baseline. See [adapter contract](docs/ADAPTERS.md).

## Layout and historical ownership

| Module | Responsibility |
| --- | --- |
| `src/` | Run lifecycle, immutable history, reports, pit cleanup, updates, engineering ledger |
| `config/` | Protocol identity, entrants/current source, change ledger and update receipts |
| `harness/` | Proven Linux orchestration, resource/campaign checks, transport and strength budgets |
| `contestants/`, `client-race/`, `signals-race/`, `island-race/` | Framework-specific adapters and workloads |
| `tests/` | Lifecycle, cleanup, reporting, provenance and regression refusal controls |
| `evidence/2026-10-24/` | Frozen Round 2 campaigns, original hashes and reports |
| `runs/`, `updates/`, `.grandprix/` | Ignored local state; never source or release artifacts by accident |

This is a modular application inside the canonical `getforma-dev/forma` repository.
The October 23 FORMA-254 experiment and the older 2.x showcase are historical
references, not parallel active implementations. The imported baseline inventory
is `baseline-source.json`. Original `PROTOCOL.md`, `ROUND-2.md`, evidence, and
legacy scoring/report tools remain for reproduction; new work uses the laboratory
CLI and its [methodology](docs/METHODOLOGY.md). Historical results keep their
original meaning. Audit: [2026-10-28](docs/AUDIT-2026-10-28.md).
