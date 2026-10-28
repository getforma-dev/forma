# Adapter and update contract

The application is a modular monolith: shared orchestration and evidence contracts,
separate framework implementations. Add capabilities, not shortcuts for Forma.

Register a server/island entrant in `config/laboratory.json`; the drivers read that
registry. Its directory lives in `contestants/<id>`. Follow `CONTRACT.md`, the
shared dataset and `PAGE-SPEC.md`. Each build must have locked dependencies,
production mode, explicit runtime, health route, and equal resource limits.
Document unavailable capabilities rather than emulating a competitor with plain
DOM or replacing native activation. Own exact Docker resources through the driver.

Client and signals suites retain controlled trial grids, with adapters in their
existing folders. A new signal adapter implements signal/computed/effect/dispose/
batch and reports its installed version. A library without batching reports that
operation as non-equivalent. Extend correctness tests before recording timing.
New client libraries need the exact deterministic data and keyed DOM semantics;
add the entrant to the runner and paired trial grid together. Island activation
uses its native APIs and must preserve server nodes and pass 0→1→2 interaction.

Update procedure:

1. Read the change ledger and prior rejected experiments. State the hypothesis,
   expected cost, target workloads and acceptance threshold before measuring.
2. Check registry metadata and runtime support. Stage exact versions and lockfiles;
   inspect transitive changes. Related packages (React/React DOM, React Router's
   dev/node/serve family, Forma core/compiler/build/crates) move as a coherent set.
3. Apply the reviewed change in source control. Run adapter correctness and the
   deliberate failure controls. A lock resolving is not a passing adapter test.
4. Run affected baseline and candidate on the same campaign/host/profile. Keep
   original sample counts and warmups; disclose all missing/failed workloads.
5. Add a ledger record with evidence paths and source commits, measured gains,
   losses, noise, decision and guardrails. Mark incomplete qualification explicitly.
6. Retain compact original evidence plus its SHA-256 manifest; clean only generated
   output. No dependency change reinterprets historical results.

The existing `--baseline` server mode explicitly imports frozen source recipes.
Updating current recipe files does not mutate that baseline. Published client
pins remain experimental controls unless deliberately changed as a new cohort.
Changes in clock, fixture, semantics or resource limits require a new protocol/test
identity and rerunning every affected comparator; they are not comparable speedups.
