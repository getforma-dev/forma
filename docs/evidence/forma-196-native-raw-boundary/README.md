# FORMA-196 focused source qualification

Based on exact227, with original R17 success retained separately. This patch changes native compiler admission only: script elements use BUILD-623; srcdoc values without a supported absence proof use BUILD-624. Core runtime, native walker and wire format are unchanged.

Before correction the new34-control file had27 genuine refusal failures,6 passing near misses and1 mistaken test assumption: lowered JSX undefined is already a strict BUILD-207 refusal. That original test/source/log is retained. Corrected after-gates pass322 compiler/HTML-context/catalogue controls, compiler source types, and5 normal-build/watch controls. Both refusal codes are fatal even with direct-plugin strict:false; watch keeps accepted manifest/IR bytes and recovers.

First orchestration failures are separate: the initial Vitest command combined a root with a duplicate relative config path and did not collect tests; the first after-gate still contained the mistaken void expectation (33/34). No production emitter expansion was made to satisfy that test. Original direct reproduction fixture setup errors are recorded in the archive.

All commands used Node24.22.0 and Vitest --maxWorkers=2. Scripts-off exact-lock install reported zero vulnerabilities. No package/native/browser rebuild, browser execution, performance qualification, whole R17 or packed P17 was repeated here. Rebuilt-package/native replay remains pending source review. `qualification.json` identifies the complete changed source and original commands/results.
