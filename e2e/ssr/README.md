# Native SSR/Browser fixtures

`build.sh` compiles each admitted case with this checkout, renders paired typed SSR and explicit Browser documents through `forma-server`, and stores each real `PageResponse` header beside its HTML. `serve.mjs` replays those headers unchanged. The root Playwright configuration runs Chromium; release qualification may supply the same configuration with all three engine projects.

The fixture is served over HTTP, so its `RenderCtx` names `PolicyExtensions::report_uri("/__csp-reports")`. Both policies retain Trusted Types; the extra debug Report-Only policy now has a real destination. The receiver bounds each body to 64 KiB and stores at most 1,024 normalized reports, preserving only document pathname, effective directive and disposition. Append-only cursors and unique control document paths avoid resetting another parallel test's evidence. It stores no sample, query, fragment or raw body.

`csp-reporting.spec.ts` serves a second local origin, proves it is reachable, then requires native CSP to prevent an image request to it while delivering both a browser violation event and a real HTTP report. This intentional violation is separate from the positive cases, whose console/page/activation error observers remain strict. No external network is used. Receiver bounds and normalization run under `scripts/ssr-csp-reports.test.mjs` in `scripts/check.sh`.
