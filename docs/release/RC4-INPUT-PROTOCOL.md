# RC.4 input-probe correction — FORMA-219

This is a prospective measurement-protocol correction. It changes neither N3's
50 ms task ceiling nor its requirement that all 100 islands respond within
500 ms of the original first paint. It does not accept any earlier failed run.

## Retained evidence

RC.3's tagged P17 failed; that immutable tag remains unpublished. RC.4 candidate
`329d565575e4d754b8abb115b0c72f1869126348` adds a limit of four direct entries to
each background activation drain, alongside the existing 12 ms deadline. Its
[packed campaign](https://github.com/getforma-dev/forma/actions/runs/39334279022)
still failed: four independent island-input observations exceeded 50 ms, at
51–53 ms. Four additional observations rounded to 50 ms. These are failures
under the original collector, not browser-internal exclusions.

The separate Lighthouse traces recorded first activation callbacks of
39.028–45.144 ms, with later callbacks at most 8.778 ms. Their complete
application tasks stayed below 50 ms. Lighthouse and independent input probes
are separate navigations; their timestamps cannot identify each other's work.

A [bounded same-navigation diagnostic](https://github.com/getforma-dev/forma/actions/runs/39338255135)
used the unchanged packed product and original input collector with CDP tracing,
without callback wrappers, CPU profiling, interception, CSP or SRI changes.
All eight first click-bearing tasks contained ten synchronous clicks inside one
animation callback. Complete task times were 51.543–60.857 ms; the first
individual click took 22.074–25.549 ms. The task also contains browser work.
Tracing can affect timing, so these diagnostic observations are not release
qualification and do not retroactively identify every historical failure.
They establish the collector's combined-input mechanism. Additional early
browser tasks in two diagnostic navigations are retained too.

## Prospective collector

`separate-input-tasks-v1` retains ten attempts per animation frame but posts
each click through a separate MessageChannel task. Inputs begin when served
hosts exist; the collector never waits for activation readiness. Every click
must still synchronously update its own retained target. All 100 responses,
the original first-paint clock, the 500 ms deadline, all forty independent
observers, raw long tasks and browser errors remain required. Ports and queued
inputs are closed or discarded on completion or the absolute timeout.

The dead-script and 110 ms startup controls remain. A new control injects
110 ms into a real click dispatch. Its observed long task must cover the
injected interval, and the task oracle must reject it independently of response
lateness. A late response or unrelated long task cannot satisfy this control.

Current performance records must declare the new input protocol and include
the new control. Only the authenticated published-baseline reader permits the
older absent protocol field and its original two controls. Historical records
are neither rewritten nor promoted to current qualification. An explicitly
unknown or downgraded protocol is rejected. Full fresh packed qualification
and independent approval remain required before publication.
