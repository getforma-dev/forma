# Firefox missing commit: bounded source investigation

2026-10-16. Read-only investigation of the captured dca P17 reproducer. No installed browser/package edits, preference changes, browser launches, dependency installs, timeouts, extra navigation, or retries were performed. The official new browser binary has not yet been downloaded or inspected.

**Disposition: use the official stable Playwright 1.64.1 toolchain for a reviewed qualification proposal.** Its source contains the specific upstream Firefox channel-identity repair absent from the installed 1.62.1/Firefox1538. This is a causal driver fix proposal that retains COOP and existing drill behavior; actual new-artifact inspection and the unchanged drill still need to pass. It is not a claim that changing a version string already repaired this local run.

## Local facts

The stopped bounded reproducer's failed session is `d37de7e7-5fc2-4897-afa5-34353a5ff59f`, mainframe37. Its original about:blank navigation82 commits. The single subsequent `Page.navigate` to `/csr` returns navigation83; that navigation starts twice, but never produces `Page.navigationCommitted`. Between the two starts, another `Page.frameAttached` appears for the same frame. The response is200 with `Cross-Origin-Opener-Policy: same-origin`; new execution contexts, DOMContentLoaded/load and a real SKEW event follow. Evaluating the actual document reports the correct `/csr` URL and complete state, while Playwright still reports about:blank and zero frame navigations. This reproducer failed in the blocked-storage Browser case after10 complete checks; it is distinct from the preceding full P17's canceled SSR case after8 checks.

`EVIDENCE-MANIFEST.json` authenticates original protocol/diagnostic inputs and read-only snapshots. Installed `node_modules/playwright-core` is1.62.1 and declares Firefox1538/153.0. Installed `firefox-1538/.../Resources/omni.ja` contains `chrome/juggler/content/content/main.js` byte-identical to the official1.62.1 tag source. Cached Firefox1543 has the same vulnerable process-only channel construction and is not a fix.

## Mechanism in the installed source

- `1538/content/JugglerFrameChild.jsm`: top-level agent state is keyed by browsing context. A new context initializes a new channel; rebinding an actor for the same context reuses the existing one.
- `1538/content/main.js:64`: each new channel receives a UID derived only from the content process ID.
- `1538/SimpleChannel.js:15`: each new instance resets its message counter. Lines164–179 clear buffered responses only when the peer UID changes. Lines210–216 answer a repeated request ID from the cache before looking up its namespace or method.
- `1538/content/PageAgent.js:315` sends the commit notification through this channel; `1538/protocol/PageHandler.js:120` exposes it as `Page.navigationCommitted`.
- Installed Playwright `coreBundle.js:44917` updates the frame URL/document navigation only when that commit event arrives. Lifecycle events use a separate handler and cannot substitute for it.

Thus, when COOP replaces a browsing context within one process, the new channel can reuse the old UID and request IDs. A retained old response can consume a new notification before it reaches the protocol. The captured duplicate attachment/start and absent commit are a close causal match. Our protocol capture is outside SimpleChannel, so it does **not** directly record the internal cache hit; that final internal attribution remains an inference supported by matching installed source and the independently reproduced upstream defect.

## Upstream repair, distinct from the test-only PR

[Issue42731](https://github.com/microsoft/playwright/issues/42731) reports the same COOP first-navigation signature. Its author instrumented mismatched cached responses and demonstrated a channel-instance UID repair. The issue also discusses disabling COOP as a workaround; that changes the security behavior being tested and is not proposed here. [Issue42183](https://github.com/microsoft/playwright/issues/42183) is the broader earlier report; its closure alone did not establish a fix.

The actual shipped-source repair is [Firefox roll42843 / e5d880b05f9a1d7fb5d17dd031b53739e5e39c0e](https://github.com/microsoft/playwright/commit/e5d880b05f9a1d7fb5d17dd031b53739e5e39c0e), merged2026-09-22. It rolls Firefox1549 to1551 and appends `helper.generateId()` to the channel UID at construction. UID stays stable for the lifetime of that instance, so same-instance transport replacement retains the existing duplicate-dispatch protection; a genuinely new instance clears the stale cache.

[PR42788](https://github.com/microsoft/playwright/pull/42788), merge `b30584c2c8a9c0fc57423f352f7afbd744cc58cd`, adds21 lines of regression tests only. It covers COOP with/without COEP and history-state evaluation. It is **not** the implementation patch.

Official tag source was fetched and retained separately:

| Tag | Exact commit | Firefox revision/version | Unique per-instance UID in tag source |
|---|---|---|---|
|v1.62.1|Installed source identity verified against tag file|1538 /153.0|No|
|v1.64.0|606ecd8b34bac100db32561b6278ffd76e5eb3cd|1555 /157.0|Yes|
|v1.64.1|cfe490d941f992655948eee8fd4fd94e1c4234bf|1555 /157.0|Yes|

The first stable fixed source is1.64.0;1.64.1 is the current stable patch and uses the same browser revisions. Sources: [1.64.1 main.js](https://github.com/microsoft/playwright/blob/cfe490d941f992655948eee8fd4fd94e1c4234bf/browser_patches/firefox/juggler/content/main.js#L64), [1.64.1 browser manifest](https://github.com/microsoft/playwright/blob/cfe490d941f992655948eee8fd4fd94e1c4234bf/packages/playwright-core/browsers.json), [1.64.0 source](https://github.com/microsoft/playwright/blob/606ecd8b34bac100db32561b6278ffd76e5eb3cd/browser_patches/firefox/juggler/content/main.js#L64), and [1.64.1 release](https://github.com/microsoft/playwright/releases/tag/v1.64.1). Source snapshots and upstream API responses are under `upstream/`.

## Proposed qualification scope

1. Review the exact locked1.64.1 toolchain change; keep shipped package/runtime source, response headers, navigation counts, event assertions, refusals, cleanup and all timeouts unchanged. Avoid a hand-patched cached browser or unsupported mixed Playwright/browser pair.
2. After the exclusive performance lane ends, obtain the official1555 browser artifact and inspect its actual `omni.ja` channel construction, preserving source/package/archive hashes. Source-tag proof alone is not this artifact-byte check.
3. Run the already reviewed bounded reproducer against that fixed toolchain, preserving protocol and any first failure. A successful finite sample supports the repair but is not a full P17 pass or proof of absence of every navigation race.
4. Qualify the coherent toolchain through the unchanged three-engine drill and required full gates.1.64.1 also changes Chromium151→156 and WebKit26.5→27.2 compared with the old root toolchain; timing evidence must retain its actual browser versions and must not be relabeled. Keep historical failures intact.

Do not remove COOP, add COEP merely to force a process swap, alter Firefox isolation preferences, issue a second navigation, synthesize a commit notification, accept document-ready as a substitute, or suppress the timeout. Each would change the test or its proof rather than deliver the missing driver event through the supported transport.
