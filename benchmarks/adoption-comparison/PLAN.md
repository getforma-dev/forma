# FORMA-259: fixed 1,000-binding adoption comparison

This is a separate workload from the Grand Prix counter-island track. No score or
new no-regression threshold is defined here; the runner does not waive the
ticket’s original no-adoption-regression criterion. The complete observed results
support that assessment and the user-authorized product tradeoff decision. The measured script and its timing/correctness oracle stay
unchanged.

## Frozen inputs and sequence

- A: `f5be8647439e560c71c27b8c5f4bde26507b8bbb` (public baseline).
- B: `44835efa2f13d694ff32f0dc56f4e5f0aa413eb3` (public selected candidate).
- Harness: B's `packages/core/scripts/signals-bench/island.mjs`, SHA-256
  `270545637abacebc678d61f9bdd07496eee945d0a6806f376be5ea6c270d01f1`.
  A predates this file. Both builds use this same unmodified B script.
- Build both exact archived sources, each with its own committed `npm ci` lock,
  then `npm run build -w packages/core`. Retain source archives, locks, build
  logs, package archives, installed package identities and all package-file hashes.
- One fixed **A, B, B, A** sequence on the same fresh Ubuntu GitHub Actions VM.
  Each leg starts a fresh Node/Chromium process and runs the original
  `--rows 1000 --warm 5 --runs 15 --entry <exact built forma.esm.js>`.
  There are no retries, selection of best samples or adaptive stopping.
- Node is the repository's pinned 24.22.0. Playwright, its browser registry and
  download revision come from the committed npm lock. Use its default headless
  shell, not a substituted Chrome. Record the actual launched executable bytes,
  actual version, launch options, child affinity and memory control.

## Isolation and evidence

Require native Linux x64 on GitHub Actions with exactly four allowed/available
CPUs. Builds finish before measurement. The first CPU is left outside the timing
service; all four legs use the other three CPUs and a 2 GiB cgroup memory limit,
zero swap. A run-owned transient systemd service enforces those limits and owns
its browser descendants. Retain the actual Node and browser process affinity,
cgroup memory settings, campaign/VM fingerprints and CPU/hardware metadata.
This is a dedicated allocation, not a claim of Grand Prix profile equivalence.

A small preload observes only browser launch/close plumbing: it calls the
original `chromium.launch` with the original options, records the actual process
and checks its identity/limits before the measured page is created. It does not
wrap the page, modify evaluation, install observers or change measured code.
Preserve its source hash alongside the unchanged harness hash. Retain stdout,
stderr and launch/cleanup metadata for every attempted leg, including failures.
On failure, stop the fixed campaign and keep already completed output; do not
replace a failed leg. Scoped cleanup stops only pre-recorded units with this
campaign's ownership description and removes only its recorded temporary tree.

Summaries report per-leg means, medians, sample standard deviations and all raw
samples, plus descriptive A/B pooled summaries and absolute/relative deltas.
Pooling 30 samples per source does not create 30 independent VM replications;
ABBA reduces order bias but cannot establish universal performance or uncertainty
across machines. A zero baseline mean makes a percentage delta unavailable.

## Unchanged harness limits

The original script checks zero initial mutation records and its accumulated
`onError` list after adoption, verifies original connected text nodes update,
and verifies disposal stops their later update. A successful process means those
checks ran for all five warmups and fifteen measured rounds. The script discards
warmup timing values, so only the fifteen emitted sample values can be retained.
It has no pageerror listener and does not separately check reported errors after
the final update/disposal. Do not claim broader browser-error coverage. On a
thrown mid-run failure it emits no partial sample array; retain its original
stdout/stderr and failure without inventing missing samples. Fixture creation,
HTML parsing and instrumentation setup are outside the original timing regions.

## Before dispatch

Run only non-timing controls locally: source/lock/harness binding, fixed sequence,
strict JSON/sample/statistic validation, launch identity/affinity/memory refusal,
output overwrite and cleanup ownership refusals. Independently review the frozen
source diff and manifest. Commit/push/dispatch only after that review. No private
candidate source is read, copied, built or published by this workflow.

## First campaign trigger

The new workflow runs the fixed comparison only when this reviewed PR is opened
from `codex/forma-259-island-comparison`. It listens to pull_request `opened`,
not push or synchronize, so later pushes do not silently create repeated trials.
Opening the PR is therefore the dispatch action and occurs only after exact
source review. No branch-only workflow_dispatch registration is assumed. The
driver checks out the PR head commit, not the merge ref, so later main changes
cannot alter the lock or harness binding; it cannot change the pinned A/B source
targets, frozen harness hash or selected-source tooling lock. Once any leg's
`harness.stdout` holds measured samples, the campaign's outcome stands, whether
completed, failed or cancelled, and is not authorization to rerun it. Only a run
in which no leg's `harness.stdout` holds samples has produced no timing; it is
retained, and only after a reviewed plumbing fix may the campaign be opened
again from a new PR.
