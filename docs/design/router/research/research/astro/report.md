# Astro routing: source, shipped artifacts, and observed behavior

Research date: 2026-10-26. This study separates the **framework's optional ClientRouter** from **the documentation site's deployed behavior**. Astro's baseline is a multipage application: a URL addresses a complete HTML document produced from file routes. ClientRouter progressively enhances eligible navigations by fetching that HTML and swapping its document content. It is not a client route matcher that chooses a component tree.

The selected documentation link, `/en/guides/routing/` → `/en/guides/view-transitions/`, performed a full document navigation in Chromium 155.0.8059.85 with JavaScript both enabled and disabled. This observation does not establish the behavior of every link or browser. The docs site demonstrates Astro's baseline routing and prefetching; the published Astro package supplies the separate ClientRouter implementation examined here.

## Ownership and exact scope

| Surface | Official repository and examined revision | Meaning |
|---|---|---|
| Astro framework | [withastro/astro, `2fdf731428aa738d5dcf3041b4e78eb9d036968c`](https://github.com/withastro/astro/tree/2fdf731428aa738d5dcf3041b4e78eb9d036968c), tag `astro@7.2.10` | Version matching the live page's generator; implementation anchor |
| Published framework JavaScript | [npm `astro@7.2.10`](https://registry.npmjs.org/astro/7.2.10) | Downloaded tarball; registry SHA-512 integrity verified; four runtime files passed through REA |
| Documentation website | [withastro/docs, `513089031ecc63198c555cbbaec0c88d20d4c571`](https://github.com/withastro/docs/tree/513089031ecc63198c555cbbaec0c88d20d4c571) | Source snapshot on research date; **not a verified deployment commit** |
| Documentation theme | [withastro/starlight, `88ad3c2630487ba227a7b4ccbffc01a2bdf623a5`](https://github.com/withastro/starlight/tree/88ad3c2630487ba227a7b4ccbffc01a2bdf623a5), tag `@astrojs/starlight@0.42.0` | Matches the live generator, separately owned theme implementation |
| Live documentation | [routing](https://docs.astro.build/en/guides/routing/), [view transitions](https://docs.astro.build/en/guides/view-transitions/), [prefetch](https://docs.astro.build/en/guides/prefetch/) | HTML and selected first-party assets captured with retrieval times and hashes |

The [docs configuration](https://github.com/withastro/docs/blob/513089031ecc63198c555cbbaec0c88d20d4c571/astro.config.ts#L21-L75) uses Starlight, overrides several UI components, and uses trailing slashes. The [Wrangler configuration](https://github.com/withastro/docs/blob/513089031ecc63198c555cbbaec0c88d20d4c571/wrangler.jsonc#L1-L13) identifies a Cloudflare Worker serving `dist` assets through `worker.js`. Captured response headers say `Server: cloudflare`. These establish source configuration and an observed edge server; they do not independently identify every production infrastructure component.

Live generators were `Astro v7.2.10` and `Starlight v0.42.0`. The matching version names link the research targets; they do not prove a reproducible byte-for-byte build or a live Git commit. The npm metadata did not provide `gitHead`. [sources.json](sources.json) records the actual distinctions and hashes. MIT license copies, including Astro's additional notices, are in [licenses](licenses/).

## Two different route systems

**File/server routing.** The build/server side turns page and endpoint files into patterns, parameters, and generated URLs. The examined route comparator orders competing segments by static/dynamic/rest specificity, then length, endpoint/page, and name; its actual implementation is more precise than a simplistic “static always wins” slogan. Matching tests compiled patterns, and handles error routes separately. This belongs on the build/server side, independent of whether a client router is present. See [priority.ts](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/core/routing/priority.ts#L28-L104), [match.ts](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/core/routing/match.ts#L7-L24), and [params.ts](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/core/routing/params.ts#L14-L37).

**Client navigation.** ClientRouter does not need a table of all pages. It treats the server/static host as the source of the next document, tests whether the current and incoming documents opt into its protocol, and coordinates DOM, scripts, browser history, and animation. A deep link must still return the correct HTML from the server. A catch-all response containing the wrong shell is not automatically sufficient for this model.

**Animation is a third concern.** Native cross-document View Transitions can animate an ordinary multipage navigation. ClientRouter instead uses `document.startViewTransition()` around a same-document update when available, and supplies an animation/swap fallback when appropriate. A smooth visual transition is not proof of client routing. The [official guide](https://docs.astro.build/en/guides/view-transitions/) explains these choices; the [source branch selecting the native/fallback implementation](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L501-L550) makes their separation explicit.

## What the deployed documentation site actually does

1. The three saved HTML pages have no `astro-view-transitions-enabled` marker. ClientRouter emits that marker when installed.
2. The small `page.LAbJoB63.js` artifact implements prefetch strategies and DOM observation. Its optional `astro:page-load` listener is compatibility code, not proof that a router runs. The corresponding source explicitly invokes its callback eagerly because view transitions may not be enabled.
3. The TOC artifacts are custom-element UI and import a shared `starlight-toc` module. Search and code-copy behavior were downloaded for inventory but were outside the selected REA analysis.
4. Starlight's [SidebarPersister](https://github.com/withastro/starlight/blob/88ad3c2630487ba227a7b4ccbffc01a2bdf623a5/packages/starlight/src/components/SidebarPersister.astro#L1-L78) restores sidebar expansion/scroll through session storage. State surviving a navigation does not imply DOM node identity survived it.
5. The local [browser evidence](../../evidence/browser-astro.json) records a changed document ID/time origin and a document request on the selected click with JS on and off. Back returned to the routing page. Instrumentation wraps history methods and attaches listeners; this was a scoped observation, not an exhaustive accessibility or browser compatibility audit.

## ClientRouter state machine

The main implementation is [router.ts](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts); the following is source-derived behavior of the pinned version, not a claim that the docs site executed it.

```mermaid
sequenceDiagram
    participant U as Link / form / history
    participant R as Router
    participant S as HTML server
    participant D as Live document
    U->>R: Eligible navigation
    R->>R: Abort previous preparation; record scroll
    R->>D: astro:before-preparation (replaceable loader)
    R->>S: Fetch HTML with AbortSignal
    S-->>R: HTML, media type, final URL
    R->>R: Parse; validate opt-in; preload styles
    R->>D: astro:after-preparation
    R->>R: Wait previous DOM update; recheck abort
    R->>D: astro:before-swap (replaceable swap)
    R->>D: Swap document; commit history and scroll
    R->>D: astro:after-swap
    R->>D: Activate eligible scripts
    R->>D: astro:page-load; route announcement
```

### 1. Preserve native link and form semantics

The delegated click listener examines the composed event path, including shadow DOM, and recognizes anchors, SVG anchors, and image-map areas. It leaves modified/non-primary clicks, already-handled events, downloads, missing hrefs, non-`_self` targets, cross-origin links, and `data-astro-reload` alone. Eligible clicks call `preventDefault()` and pass the initiating element and optional replace-history choice to `navigate()`. This gate is as important as the swap algorithm: hijacking every click breaks ordinary browser behavior. [ClientRouter.astro lines 49–103](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/components/ClientRouter.astro#L49-L103).

Forms include the submitter in `FormData`, honor submitter action/method overrides, and avoid property shadowing by named form controls. GET forms update the query; handled non-GET forms carry form data into the loader, which issues POST. Dialog and cross-origin submissions remain native. This is not a general arbitrary-method transport API. Explicit URL-encoded enctype is handled; otherwise this implementation uses `FormData` for historical compatibility. [Component lines 105–148](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/components/ClientRouter.astro#L105-L148), [loader lines 396–421](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L396-L421).

### 2. Preparation has cancellation and ownership

Each navigation aborts the previous navigation's controller. Source-page opt-out or cross-origin destinations trigger native navigation. The router saves outgoing scroll before preparation. Same pathname/query with relevant fragment transitions takes a dedicated history/scroll path without fetching; a same URL with no hash is not universally a no-op. POST bypasses this shortcut. [Lines 328–394](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L328-L394).

`astro:before-preparation` carries mutable destination/new-document fields, an abort signal, source element, navigation type, and a replaceable `loader`. Preventing its default behavior delegates to a full browser navigation when the signal was not aborted; it should not be mistaken for a simple “stay on current page” guard. After awaiting the loader, preparation emits `astro:after-preparation` if not canceled. Custom loaders must honor cancellation and their own resource cleanup. [events.ts](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/events.ts#L11-L163).

The fetch applies adapter-provided internal headers and accepts only HTML/XHTML media types. A network failure or other media type returns control to browser navigation. It does not reject every non-2xx status: an HTML 404 can be rendered. Same-origin redirects change the committed URL while retaining the requested fragment; cross-origin redirects fall back. HTML is parsed in a detached document and parsed `noscript` nodes are removed. Incoming opt-out falls back **except after POST form data**, to avoid a second mutation. [Fetch lines 87–116](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L87-L116), [loader lines 423–470](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L423-L470).

### 3. CSS and overlapping visual updates are coordinated

New external stylesheets are preloaded unless an equivalent/persisted stylesheet already exists. Readiness settles on either load **or error**, so a failed stylesheet does not wait forever at this specific gate. The router can skip the preceding animation and waits for its DOM update callback to finish before beginning another swap; it then rechecks the new navigation's abort signal. Aborting network I/O alone is not sufficient to prevent old DOM commits. [Styles lines 238–261](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L238-L261), [transition serialization lines 472–499](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L472-L499).

Animation fallback supports animate/swap/none configuration. Native support and a user-agent-provided visual transition affect the branch; browser swipe transitions can use a swap to avoid double animation. The completion promises differ: `navigate()` awaits the DOM update callback, while script replay/page-load and animation completion have separate continuations. Do not treat `await navigate()` as “all islands hydrated and every animation finished.” [Lines 501–598](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L501-L598).

### 4. Swap a document without destroying every live object

The default swap orders script deduplication, root attributes, head reconciliation, focus capture, body transfer, and focus restoration. Head elements are matched using explicit persistence, stylesheet URL, identical inline styles, font preload URL, and development-specific rules; absent elements are removed and new ones appended. This includes the next page's title/metadata. Keeping the old head wholesale would produce stale titles, styles, and metadata. [swap-functions.ts lines 45–143](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/swap-functions.ts#L45-L143), [matching/default order lines 301–363](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/swap-functions.ts#L301-L363).

`transition:persist` matches an outgoing live element to an incoming placeholder by key. The implementation lifts matched elements to the root before replacing the body, then moves them into the new positions. It feature-detects `moveBefore()` for atomic moves; unmatched elements are discarded. This preserves object identity, listener state, and media/canvas state better than serialization or cloning. Persisted islands normally receive changed incoming props; `transition:persist-props` can retain old props instead. Declarative shadow roots are attached after the body swap. Freshly parsed media elements are recreated to activate their media controllers, while previously live/persisted media nodes are spared. [Lines 145–260](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/swap-functions.ts#L145-L260).

Persistence is also a lifecycle protocol. Astro islands delay their disconnection check until `astro:after-swap`, then emit `astro:unmount` only if still disconnected. A temporary move must not trigger irreversible teardown. A props observer can hydrate/re-render a persisted island after props change. Third-party custom elements do not automatically acquire this contract and need their own move/disconnect behavior. [astro-island.ts lines 58–61](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/runtime/server/astro-island.ts#L58-L61), [lines 193–207](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/runtime/server/astro-island.ts#L193-L207), [lines 262–269](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/runtime/server/astro-island.ts#L262-L269).

### 5. Script execution is explicit

Scripts imported with parsed HTML do not become a reliable execution sequence merely by moving nodes. The router tracks executed scripts by URL or inline text, marks duplicates, honors `data-astro-rerun`, and creates fresh script elements to activate eligible new scripts. Attributes are copied; external script load/error is awaited; an inline-module barrier coordinates module ordering. It then dispatches `astro:page-load`. Global listeners should usually initialize once; page-local behavior can use page-load plus teardown/idempotence. This is a framework script policy, not a sanitizer for arbitrary fetched HTML. [Deduplication](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/swap-functions.ts#L45-L69), [activation](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L126-L164), [completion](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L552-L572).

### 6. History, scroll, focus, accessibility

History entries carry an index and scroll coordinates. The index determines forward/back direction because `popstate` alone does not supply it. A stored `originalLocation` remembers the outgoing URL after the browser has already changed `location`. Push, replace, and traverse have different history effects; managed scroll updates preserve other state properties. Traversal restores saved coordinates; new-page navigation goes to the top; fragments temporarily use native hash scrolling with restoration adjustments. `scrollend`, or a polling fallback, refreshes saved positions. [History/scroll lines 168–236](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L168-L236), [popstate/setup lines 600–687](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L600-L687).

Focus restoration specifically protects an active element within a persisted subtree, including text selection offsets. It is not a general policy that automatically focuses every destination heading. A hidden assertive/atomic live region announces the new title, h1, or pathname after a short delay. A rebuild needs separate decisions for keyboard focus, reduced motion, and assistive technology testing; inspecting code does not prove those experiences. [Focus lines 261–285](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/swap-functions.ts#L261-L285), [announcer lines 41–57](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L41-L57).

## Prefetch, caching, and release compatibility

Prefetch supports tap, hover/focus, viewport, and load strategies. Hover waits 80 ms and viewport waits 300 ms in the pinned source. Eligibility excludes offline, slow/data-saver conditions unless overridden, cross-origin, current pathname/query, and previously attempted URLs. The fragment is stripped; a set records the attempt before work completes. This is not an application data cache with TTL, structured loader results, or invalidation semantics. Depending on feature/build options and browser support it uses speculation rules, link prefetch, or low-priority fetch; the latter swallows network failures. [Strategies](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/prefetch/index.ts#L34-L192), [eligibility/transport](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/prefetch/index.ts#L220-L317), [dynamic anchor observation](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/prefetch/index.ts#L319-L348).

The reviewed ClientRouter and swap files do not contain an explicit old-runtime/new-document release-ID compatibility fence. This is a bounded source finding, not a claim about every Astro deployment. A Forma implementation should specify version compatibility, retention of old hashed assets, HTTP cache rules, and safe refresh behavior for a long-lived tab crossing a deployment. Speculative GETs also require server endpoints without mutation side effects. These are reconstruction decisions, not capabilities REA proved.

## REA results and limits

REA 6.8.0 analyzed inert shipped JavaScript, not TypeScript source and not a live page. Normal source inspection explained control flow; browser instrumentation independently measured one live navigation. [rea-findings.json](rea-findings.json) summarizes the original run metadata without discarding limitations.

| Run | Selected input | Results | Coverage |
|---|---|---|---|
| `astro-published-transitions` | Published router, events, swap functions, prefetch | 4 parsed JS files, 5,340 visited AST nodes, 41 findings, zero parse failures; graph 50 nodes / 59 edges | Partial: 5 other inventoried JS files unselected; no graph truncation reported |
| `astro-docs-prefetch-v2` | Live page prefetch, mobile/desktop TOC, shared TOC | 4 parsed JS files, 1,491 AST nodes, 10 findings, zero parse failures; graph 19 nodes / 22 edges | Partial: 2 unselected files; alias selection expansion bounded at 512 states; no graph truncation reported |

The package graph recovers module boundaries, local import relationships, and exported navigation/swap/prefetch APIs. The adapter configuration import is external to the artifact. The docs graph recovers the TOC shared-module relation. The small page artifact was read to identify prefetch behavior; that identification is corroborated by corresponding source, not inferred solely from its filename or the word “page.” A zero route inventory in a generic navigation library is not proof that no router exists.

Full run logs, source selection, hashes, evidence IDs, and unknowns remain in `.local/rea/astro-published-transitions` and `.local/rea/astro-docs-prefetch-v2`. The initial docs preflight did not start REA because a source download failed local Python certificate verification; standard verified curl succeeded, and the failed preflight was retained at `.local/rea/astro-docs-prefetch/preflight-failure.json`. Neither successful run executed bundle bootstraps, proved runtime reachability, or measured every branch. No upstream install, build, or full test suite was run.

## Reconstruction checklist and test plan

The [original pseudocode](snippets/reconstruction-pseudocode.md) is an implementation sketch, not production-ready code. The [question ledger](questions.md) gives local answers and remaining tests. Minimum responsibilities for an HTML-swap router are:

- A correct server route for every direct URL; meaningful HTML and working links with JavaScript disabled.
- A documented opt-in marker and protocol version; complete native click/form escape rules.
- Navigation ownership, abortable fetch, stale-result rejection, and serialized DOM commits.
- Media-type/redirect/error handling, with a specific mutation-safe policy for POST fallback.
- Explicit head/root/body reconciliation; stable persistence keys; island/custom-element teardown semantics.
- Stylesheet readiness, script deduplication/re-execution policy, and well-defined lifecycle completion.
- Push/replace/traverse state, outgoing scroll snapshots, fragment behavior, focus and announcements.
- Prefetch budgeting/cache semantics, release mismatch handling, CSP-compatible scripts, and error recovery.

Tests should include modified links/downloads/targets/shadow DOM; same URL/hash/query and encoded parameters; slow A then fast B; abort during styles or custom preparation; back/forward during animation; 404 HTML/non-HTML/network/redirect cases; missing destination opt-in; submitter overrides and exactly-once POST; persisted media/canvas/input/island props; unmatched/nested persistence; external/inline/module/rerun scripts; repeated visits and listener leaks; title/head/CSS cleanup; scroll and focus with back/forward, fragments, and reduced motion; initial SSR/no-JS and direct deep links; cross-release tabs and removed assets. Include Chromium, Firefox, and WebKit where behavior depends on native DOM APIs.

Upstream [view-transitions.test.ts](https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/e2e/view-transitions.test.ts) provides existing cases: opt-in/out (135–206), styles (223–239), lifecycle (240–311), hashes (312–335), scroll (337–449), persistence (538–801), scripts (802–831), redirects (1001–1075), focus (1261–1280), forms (1281–1581), canvas (1696 onward), swaps (1742 onward), interruption (1810–1845), and module ordering (1879 onward). These tests were inspected as design evidence, **not executed or claimed passing locally**. The local live-docs browser checks establish only the narrower observations described above.
