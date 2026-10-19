# FORMA-215: Bound the post-publication release-inventory visibility retry

| Field | Value |
|---|---|
| Status | Done |
| Epic | E7 |
| Priority | P1 |
| Release | Before rc.1 whole-release audit; beta.4 record-only recovery is complete |
| Repos | getforma-dev/forma only |
| Assignee | indexed_measurement_review; independent review recover_ci_fixes and root |
| Related | FORMA-187, FORMA-189 |
| Branch / PR | Exact7126fc6e independently and root approved;42finite controls pass and original delayed-visibility control fails. Pending RC composition/CI; current immutable beta unchanged. |

## Finding

Trusted beta.4 Release39046246527 attempt1 published all seven packages and acknowledged GitHub Release415924154, published2026-10-17T16:21:03Z, then record job117443467798 failed: `release-record: current publication absent from complete inventory`. The direct tag lookup succeeded but the first complete-inventory response body was not retained, so backend cause is unproven. A later original API read contained the current publication. Root authorized one failed-job-only recovery; attempt2 record117444107402 succeeded16:23:55Z without rerunning any engine, pack, P17 or publisher. DS12 preserves original P17 producer attempt1 and all DS11 fields. All seven registry archives and normal RC comparable-baseline reader independently verified.

Original logs, original failure and final receipt: `work/FORMA-beta4-publication/run-39046246527/RESULT.txt`. Actual outer release clock2461.377s misses1800s; P17's separate1165.054s passes. Neither outcome is rewritten.

## Repair and acceptance

Handle only the valid, just-written current publication absent from an otherwise valid complete inventory, after actual write acknowledgment. Bound attempts and delay; default history/preflight readers stay strict. Do not retry or suppress transport errors, malformed/draft/mismatched releases, missing prior stable records, digest errors or unrelated validation failures. Fetch prior-record assets only after current metadata is visible. Never fabricate publication metadata or change P17 attempt/source identity.

Finite tests must demonstrate delayed visibility succeeds, persistent absence fails at the bound, and unsafe variants fail immediately. Preserve full history, support-window, archive/digest and publication ordering rules. Independent source review and normal composed CI are required before RC/final use. No repeated beta workflow, retag, personal-token publication, new benchmark, threshold waiver or diagnostic hash manifest.

## Log

- 2026-10-17T16:31:03.222031+00:00: Root opened this actual regression ticket after verified one-time record-only recovery. Author implementing isolated bounded handling; reviewer assigned. RC P17 independently running39049587766 on frozene75; source stays unchanged until its evidence completes and the reviewed closure batch is ready.

- 2026-10-17T16:48:42.957405+00:00: Source7126fc6e/tree dde27411 approved independently and by root. Actual42/42finite controls pass, originalsource positivecontrol fails; strict errors/history/producer identity preserved. Six added controls change timedR17; root authorizes one later finalcomposed20 run using existing immutable0c donor and newsource input. Product/P17/native-build/full252 subject inputs unchanged by reviewed50d+215. No newcampaign dispatched yet.

- 2026-10-19: Closed after PR112 merge ee7e5751 and successful exact-main CI39056716276. Source integration and applicable checks completed; original source review/negative controls retained. This closure does not claim whole-release audit, soak or final publication.
