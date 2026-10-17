# Dashboard tooltip: typed text under the enforced policy

Different-model source preaudit D14-PRE-001 identified a shipped template defect: ordinary chart hover assigns a string to innerHTML even though forma-server enforces Trusted Types. The current API supplies benign fixed clock labels; future untrusted API values would also be parsed as markup on engines without TT. The original source and actual preaudit are retained byte-for-byte.

The repair creates the existing tooltip layout once and updates three persistent Text nodes. It preserves normal hover values, position and hide-on-leave without entering an HTML sink. Shared P17/RC interaction now checks first/last actual API points, then routes a hostile hour through the real consumer and requires exact text, no parsed attack nodes, no execution and successful original navigation. The candidate scaffold suite requires the real packed dashboard in Chromium/Firefox/WebKit under release CSP. The final burn-in reader rejects reports missing those observations.

This is a source repair record, not a browser or release pass. Actual before/after browser evidence and exact-source CI remain pending. No core runtime, CSP, dependency, size or performance threshold was changed.

Independent source review found and repaired a test-evidence gap before acceptance: navigation reruns init scripts and resets the page-owned CSP array. The shared interaction now drains, asserts and retains the ordinary-page collector before reload, then separately checks the new page after its interaction. P17 passes its own pre-navigation collector explicitly; RC verification uses the shared template collector. Missing collectors and nonempty observations fail closed, and the final evidence validator requires both navigation records.
