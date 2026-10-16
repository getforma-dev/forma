# Expression campaign foundation

This repository-internal harness executes real parsed/validated expressions and handlers, compares their values or state changes with a bounded generative semantic model, and checks actual charged units against an independent table of minimum native-call costs. It does not import production cost functions to calculate its oracle. The production row-name inventory is checked only after numerical assertions, so it cannot replace the removed-cost mutation control.

`node scripts/fuzz-expressions.mjs --seed=1290300 --cases=100000` from packages/core bundles an internal Node worker and writes `fuzz/expressions/out/report.json`. The launcher bounds time and output, records source/worker hashes and clean status, and preserves failures and per10,000-case progress. An actual timeout is failure, never an expected interpreter refusal. Every normal campaign must exercise all13 expression and4 statement AST kinds, all38 native cost rows, admitted cases and coded refusals.

The70 mandatory families include12 operator, nested/cumulative and allocation/step-boundary controls. A fresh engine captures a native witness before restoring the host intrinsic: an admitted four-slot `Array.from` must call it once; its over-budget four-slot twin must report `FORMA_E_BUDGET` without another call and without consuming the rejected charge. Both results are bounded even when the check is broken.

The per-merge test replays committed bounded regressions and a1,160-case fixed sample. The expanded pilot passed1,016 admitted cases and144 known refusals. Its real removed-registration mutant failed at seed1290300 case37: an admitted32-slot `Array.from` charged0 against independent floor42. The deliberately bounded timeout also failed as intended. The old foundation pilot had1,020 admitted and140 refusals before these12 families were added; it remains historical evidence.

`node scripts/qualify-expression-mutation.mjs` runs the same100,000-case campaign before, with, and after removing the actual `Array.from` registration in an owned scratch copy. It requires a numerical undercharge failure on the bounded input, records both source hashes and the unchanged-source replay, and cannot pass by an inventory check alone. The nightly expression job requires this independently of the aggregate mutation floor and retains all reports on failure.

The full100,000-case qualification, named residual record and hostile-widget browser matrix remain pending. No production budget or grant is changed here.
