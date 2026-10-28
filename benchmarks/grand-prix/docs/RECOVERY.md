# Recovering an interrupted run

A normal failure or interrupt writes a final manifest and releases the run lock.
If the operating system kills the owner before it can finish, inspect its recovery
plan with `npm run gp -- recover <run-id>`. Apply the reviewed plan with
`npm run gp -- recover <run-id> --apply`.

Recovery requires the same hostname and proof that both the recorded owner and
worker PIDs and the recorded detached worker process group no longer exist. It refuses a live PID even if that PID might have been
reused, an inaccessible PID, another host, an unknown legacy lock, or the small
worker-launch interval where a child PID may not yet have been recorded. Time
alone is never evidence that a process has stopped.

On POSIX hosts, a managed driver starts in its own process group. Recovery tests
that group with signal 0, so an orphaned signals worker or ordinary browser child
blocks recovery even after the group's leader exits. Drivers that deliberately
detach descendants into other process groups still need their own ownership checks;
this process-group check cannot establish that unrelated or separately detached
processes have stopped. A running/finished worker with no recorded group fails
closed rather than relying only on the parent's disappearance.

The original lock and manifest are copied into a recovery receipt. The run becomes
`interrupted` and `unqualified`; partial raw data stays intact for inspection. The
CLI regenerates its report and integrity inventory. This records the interrupted
state without promoting any partial sample to a completed result.

Recovery does not stop processes or delete Docker resources. Inspect
`npm run gp -- cleanup <run-id> --docker` and apply that separate, exact-run plan
when needed. Dependency/build cleanup can be included with `--dependencies`.
Never use global Docker pruning as a recovery step.

An interrupted dependency update is deliberately refused by run recovery: source
files must be reconciled with its saved proposal and apply intent first. A lock
from another host, unresolved worker launch, malformed record, or an interrupted
recovery guard requires inspection of the recorded processes/evidence; the
application will not guess or silently steal ownership.
