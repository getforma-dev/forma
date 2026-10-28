# Working on Forma Grand Prix

This is the maintained benchmark application inside the Forma repository. Start
with `README.md`, `config/change-ledger.json` and `docs/PERFORMANCE-HISTORY.md`.
Check the relevant record's `repeatOnlyIf`, rejected designs, accepted tradeoffs
and remaining targets before proposing the same optimization again.

- Grand Prix exists to improve Forma through fair evidence, not to crown it.
  Preserve losses and original missed targets alongside gains. Do not move a
  threshold merely because the candidate missed it.
- The Grand Prix programme shipped in 3.1 and was inherited by 3.2. Source ancestry
  alone does not make an earlier timing a measurement of current released bytes.
- Use `npm run gp -- plan` and the managed CLI for new runs. Keep one measured
  campaign at a time on a quiet host; never overlap timing with builds/installs.
- Preserve frozen `evidence/`, historical protocols and original archives. New
  test semantics start a new protocol/test identity. All affected entrants get
  the same correctness, timing, resource and sampling changes.
- Reuse existing campaign, transport, source, image, browser and CPU-affinity
  validators. Missing evidence fails closed; diagnostics stay diagnostic.
- Add framework implementations through the adapter contracts. Version changes
  are explicit cohorts with exact locks, source identities and new correctness
  checks. Do not silently replace the baseline.
- Run `npm test` here for harness/application changes. Add deliberate failing
  controls when changing correctness, cleanup, provenance, comparison or recovery.
  Keep the existing CI refusal controls included.
- Cleanup may remove only proven-owned regenerable output. Never globally prune
  Docker resources, follow symlinks, discard failed measurements or age-delete
  raw evidence. Preview ambiguous cleanup and preserve its receipt.
- Every adopted performance change needs a ledger entry: finding, implementation,
  source/release, comparable before/after evidence, costs, remaining targets and
  future regression checks. Rejected/inconclusive experiments also need a record.
