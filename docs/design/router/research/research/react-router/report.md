# React Router: client navigation from source, shipped assets and a live sample

Snapshot: **2026-10-26**. Library baseline: **React Router 8.5.0**, tag `react-router@8.5.0`, commit `4fe4525102870a2b21a4a0568a651d118f5e5dbb`. Website source snapshot: `remix-run/react-router-website`, commit `e9b619c5b05209d1eaf0ba02218633732347c789`. This report does not substitute v6/v7 recollections for the selected v8 source.

## Findings that determine the design

React Router is a component-tree router with an optional data/navigation coordinator. In Framework mode it also has a server data protocol and a build-produced route/module manifest. A navigation usually matches a branch, prepares route code and data, and commits React state and history. It does **not** fetch a new HTML document and transplant its body into the current document.

Its most reusable idea is the separation between a **committed location/view** and an **in-flight navigation**. That separation supports pending UI, interruptible requests, redirects, nested error boundaries and a deliberate history commit point. The matching algorithm is only one part of this contract.

The documentation website is a useful concrete application of the model: a persistent docs layout surrounds a route that loads Markdown from the framework repository; the server turns it into HTML data; React renders that HTML into the article. Delegated link handling then makes links inside that generated HTML participate in the same router. This is a particularly relevant pattern for a documentation portal. [W1][W2][W3][W4]

### Evidence labels used here

- **Observed HTTP/artifact:** directly retained response bytes, headers, parsed inert JSON, or REA output.
- **Source-derived:** implementation read at the pinned commit; it establishes what that revision implements, not that every path executed on the live site.
- **Observed browser:** the parent's Chromium experiment, with exact URLs and network request types retained.
- **Design inference:** an engineering lesson or suggested reconstruction, distinguished from an upstream API guarantee.

The immutable source inventory, hashes, original URLs and REA run paths are in [sources.json](sources.json). The [question ledger](questions.md) states what is answered and what remains open. Short, attributed code passages are in [upstream-excerpts.md](snippets/upstream-excerpts.md).

## 1. Which GitHub repositories actually own this system?

| Layer | Repository / pinned source | What it owns |
|---|---|---|
| Router and docs content | [`remix-run/react-router`](https://github.com/remix-run/react-router/tree/4fe4525102870a2b21a4a0568a651d118f5e5dbb) | `packages/react-router` owns matching, history, navigation/data state, DOM/React adapters and server runtime; `packages/react-router-dev` owns framework build tooling; `docs/` contains the versioned prose. |
| Documentation application | [`remix-run/react-router-website`](https://github.com/remix-run/react-router-website/tree/e9b619c5b05209d1eaf0ba02218633732347c789) | Site route tree, article loader, Markdown rendering, navigation menu, server, CSS and deployment configuration. |
| Website hosting | Website `fly.production.toml`, `server.ts`, captured response headers | Repo configuration targets the Fly app `reactrouter`; the sampled response also has a Fly server/header chain. This identifies a configured and observed serving platform, not account ownership or a complete infrastructure topology. [W5] |

The library clone is detached at the release tag. The website clone is a snapshot of its then-current `main`. Its `package.json` pins React Router and `@react-router/dev` to 8.5.0. Public `/home` identifies the docs version as 8.5.0 and its serialized loader data points to the version-tagged `docs/index.md`. The public asset manifest is build `b63cec8d`. **No live source-commit receipt was found**, so structural agreement between the website source and live assets is not claimed as byte-for-byte deployment identity.

Both repositories use MIT licenses, retained under [licenses/](licenses/). Source clones remain intact under `.local/upstream`; they were not installed or built.

## 2. The three modes are different contracts

| Mode | Main entry | Client responsibilities | What it does not imply |
|---|---|---|---|
| Declarative | `BrowserRouter`, `Routes`, `Route` | Subscribe to browser history; match URLs; render nested components; provide links/navigation/active state. | No built-in loader/action coordinator simply because a route exists. Data and pending UI can be app-owned. |
| Data | `createBrowserRouter` and `RouterProvider` | Route objects exist outside rendering; router coordinates loaders, actions, fetchers, navigation state, errors and revalidation. | A server protocol, build pipeline and automatic SSR are not supplied merely by using a loader. A browser loader can call any application API. |
| Framework | `HydratedRouter` / `ServerRouter` plus Vite tooling | Adds route-module compilation, code splitting, type generation, manifest, SSR/SPA/prerender support and server-loader/action transport. | It is not identical to every React SPA or to RSC. RSC entrypoints in this release remain a separate unstable surface. |

This taxonomy is backed by the pinned [mode guide][R0] and the source adapters. The website uses Framework mode: `entry.client.tsx` hydrates `document` with `HydratedRouter`, its server calls `createRequestHandler`, and the captured boot context says `ssr: true`, `isSpaMode: false`, `routeDiscovery.mode: "initial"`. [W2][W5]

**Reconstruction decision:** choose the rendering/data contract before implementing interception. A portable Forma document navigator, a Forma browser-component router, and a native FMIR page router cannot all use React Router's rendering adapter unchanged.

## 3. How matching actually works in 8.5.0

### Default route matching

The default data matcher is `V6RegExMatcher`; the name describes its matching lineage, not the installed package major. It caches flattened/ranked branches on `update(routes)` and reuses them on `match()`. Public `matchRoutes()` also enters this branch-matching implementation. [R1][R2]

The algorithm:

1. Parse pathname/search/hash and strip the configured basename. Reject paths outside that base.
2. Flatten the nested route configuration into possible leaf branches. Each branch retains its ancestor route metadata; pathless layout routes participate as ancestors without independently becoming leaf matches.
3. Expand optional path segments into alternatives; validate that index routes have no children and that absolute child paths contain the combined parent prefix.
4. Precompile each branch segment matcher. Rank possible branches.
5. Decode pathname segments while protecting encoded slashes from accidentally becoming new route boundaries.
6. Try branches in descending score order, then build the ordered match chain, merging params and consuming pathname prefixes.

The selected release scores static segments at 10, fully dynamic params at 3, partial dynamic segments at 3.5, empty segments at 1, gives an index bonus of 2 and a splat penalty of -2, on top of segment count. Equal sibling branches use declaration order; equal non-siblings do not receive the same sibling index preference. Therefore `/teams/new` wins over `/teams/:id` even if the dynamic route was declared first. This is materially different from a simple first-match route array. [R2]

A URL is more than a pathname. Route matching mainly uses the pathname, while search changes can trigger data revalidation and hash changes may short-circuit loading. Params, basename, relative route resolution and history encoding must remain separate concerns. `decodePath` decodes each segment and re-escapes `/` as `%2F`; matching then restores encoded slashes inside the param value. Invalid percent encoding is warned about rather than silently becoming an unrelated route. [R3]

### Experimental alternative in this exact release

`future.unstable_routePatternMatching` selects `RoutePatternDataRouteMatcher`, backed by `@remix-run/route-pattern` and specificity ordering. It constructs matchers, validates supported terminal splats, and converts matching results back to React Router's match representation. It is **not the default** and is documented as an unstable Data-mode flag. Neither the current website config nor the captured boot context enables it. Do not describe this experimental implementation as the deployed default. No performance comparison was run. [R1][R4]

## 4. Click interception, relative URLs and history

The library `Link` renders a real `<a href>`. It determines whether the target is external or requests `reloadDocument`, preserves the caller's `onClick`, and invokes the internal navigation handler only if that handler did not prevent default. `shouldProcessLinkClick` checks left button, `_self`/unspecified target, and absence of Ctrl/Meta/Shift/Alt modifiers. The hook resolves relative paths and defaults to **replace** for an identical resulting URL unless the caller explicitly supplies another preference. [R5]

This layered structure matters: the small click helper alone is not a complete same-origin/eligibility filter. `Link` does some target normalization before it reaches the helper. A new delegated anchor interceptor should also consider `download`, explicit opt-out, `defaultPrevented`, origin/scheme and links to application boundaries.

History entries contain a generated key, an index, user state and—in this release—optional masking information. `pushState`/`replaceState` do not themselves provide the browser `popstate` event for an in-app push, so the adapter must explicitly notify its consumer where needed. The browser history adapter subscribes to `popstate` for Back/Forward and computes the delta from entry indexes. Direct unrelated `window.history.pushState()` calls can break blocker assumptions by producing entries without the router's index. [R6]

For Data-mode navigation, `completeNavigation()` performs PUSH/REPLACE at the commit boundary after loading. POP is different: the browser already changed the URL, so completion does not push or replace another entry. A blocked POP uses the recorded delta to restore the prior entry, then can replay the original delta if the user proceeds. This is why “just intercept popstate and return false” cannot block browser traversal correctly. [R7][R8]

## 5. Navigation as a transaction

The source models navigation as `idle`, `submitting`, or `loading`; revalidation also has a separate state. The committed `state.location`, rendered matches and data are distinct from the pending navigation's target. [R9]

Typical link navigation:

```text
click/programmatic navigate/POP
  → normalize target and history intent
  → evaluate blocker
  → abort prior navigation request
  → save current scroll position
  → match routes / optionally discover missing routes
  → handle hash-only fast path, no-match error or data request
  → resolve route code and required loaders
  → ignore aborted results; follow redirect if returned
  → merge loader data and route errors
  → commit history + router state
  → React adapter renders matching outlet tree
  → restore scroll; application handles focus/announcements
```

A mutation submission inserts an action before loader selection/revalidation: `idle → submitting → loading → idle`. An action redirect can change the target and its method semantics. A hash-only navigation can commit without loaders; an uninterrupted revalidation intentionally leaves history untouched. Initialization and partial hydration take special paths so they do not create duplicate history entries or flash ordinary pending-navigation UI. [R7][R9][R10]

The core is renderer-independent enough to own data state, but React rendering is an explicit adapter. `_renderMatches` folds the match list from the leaf outward, wrapping each level in route context and exposing the nested child as an outlet. Errors trim the render chain to an appropriate boundary; hydration fallbacks can stop rendering at the deepest available fallback. React reconciliation determines which component/DOM instances survive. This is not a guarantee that arbitrary article or component nodes retain identity across every route change. [R11]

The original educational [transaction pattern](snippets/transaction-pattern.mjs) distills abort-plus-generation-check behavior without pretending to reproduce the entire router. Its tests exercise ignored aborts and stale completions. It does not implement matching, history, blockers, React, redirects, loaders/actions or hydration.

## 6. Loaders, actions, fetchers and revalidation

**Loaders** belong to matched route IDs. The coordinator decides which need execution; the default strategy resolves selected loaders in parallel. New route instances, missing hydration data, search changes, explicit revalidation and actions affect the decision. Reused parents can preserve loader data instead of refetching it on every child transition. `shouldRevalidate` can adjust the default; it is not an excuse to retain stale or unauthorized data indefinitely. In this selected version an action error response with status ≥400 skips the ordinary revalidation default unless overridden. [R12]

**Actions** handle mutation submissions on the targeted route. Router state exposes the submission while work is pending. After an action, matched loader data can be refreshed before committing the next UI. A GET form submission produces navigation/search semantics, while mutation methods take the action path. For conventional no-JS enhancement, server routing still has to support ordinary HTML GET/POST semantics; PUT/PATCH/DELETE browser forms need enhancement or an explicit server convention. [R9][R12]

**Fetchers** are keyed, non-navigation operations. They can submit to an action or load data without changing the current location. Each fetcher has independent state/controllers; one fetcher does not automatically cancel all other fetcher instances. A new operation on the same fetcher can supersede its older work. Fetcher mutations can trigger revalidation of page loaders, so fetcher and navigation concurrency intersect. [R13]

**Cancellation is not rollback.** `startNavigation` aborts the prior request; `handleLoaders` tests `request.signal.aborted` after awaiting work, before committing. Fetcher revalidation additionally uses monotonically increasing load IDs and aborts older loads when a newer result lands. If application server code already processed a POST, aborting the browser's request does not undo that write. Server-side ordering, idempotency and authorization remain application concerns. [R10][R13][R14]

**The cache is not one thing.** Separate reused loader data, browser HTTP caching, module caching, manifest/discovery caching, application caches and prefetch hints. React Router's revalidation coordinator is not a general TTL query cache. The website independently caches fetched/processed Markdown on its server; its response headers and module URLs have their own HTTP policy. [W5][W6]

## 7. Framework-mode wire protocol

The Framework client is configured with a data strategy that invokes server loaders/actions through a single-fetch transport. `singleFetchUrl` makes `/path.data`, preserving a trailing slash as `/path/_.data`. A filtered request may include `_routes`; actions and client loaders have additional targeting rules. The request retains method/body/signal through the transport helper. The response is decoded through the framework's Turbo Stream representation and demultiplexed into route results. This is not interchangeable with `fetch(url).then(r => r.json())`, nor with fetching an entire HTML page. [R15]

Response handling distinguishes upstream/CDN errors that did not reach the React Router server, no-body statuses, route errors, redirects and transport decoding failures. Redirects are represented so `fetch` does not invisibly consume semantics the router must manage. The core checks redirect destination origin/basename and explicit reload headers: external or reload-document targets use normal document navigation, while internal redirects re-enter the routing pipeline. HTTP 307/308 mutation redirects preserve the method; other redirect paths can become loader navigation. [R15][R16]

**Rebuild implication:** choose and version a request/response contract before borrowing loader patterns. A Forma HTML navigator may intentionally fetch complete HTML; a future data router might fetch typed JSON. Either can borrow abort, matching and commit principles without emulating React Router's private wire format. Preserve HTTP status, redirects, cache and security policy rather than reconstructing them from a body alone.

## 8. Route discovery, route code and prefetching are separate

Framework route discovery controls when the browser learns route metadata. The default lazy system begins with initial-render metadata, discovers additional records through `/__manifest`, and patches the route tree. It includes ancestors so pathless/index branches remain matchable. Rendered links/forms can trigger batched eager discovery via DOM observation. The implementation uses a bounded discovered-path set, URL-length limits, debouncing and manifest version checks. A version mismatch during eager discovery does not immediately interrupt reading; navigation recovery is bounded to avoid endless reload loops. [R17]

That metadata is not the route implementation. Dynamic imports load actual modules, and route loaders fetch data. `Link`'s `discover` and `prefetch` settings therefore mean different work. Prefetch modes include `none`, `render`, `intent`, and `viewport`; the selected implementation debounces intent for 100 ms and uses an IntersectionObserver threshold of 0.5 for viewport hints. Prefetch output can contain data `prefetch`, module `modulepreload`, and route stylesheet/link descriptors. It is a hint/caching path, not a guarantee that a later load requires no request. [R18]

The **docs website explicitly disables lazy manifest discovery** with `routeDiscovery: { mode: "initial" }`. The captured boot context agrees. Its menu still uses `prefetch="intent"`, so full initial metadata and intent-driven asset/data prefetch coexist. This distinction prevents incorrectly attributing every prefetch request to lazy route matching. [W7][W4]

## 9. Scroll, focus, transitions and lifetime

`ScrollRestoration` coordinates with router state and session storage. It switches browser scroll restoration to manual while mounted, saves positions on pagehide, handles bfcache restoration, and restores a saved position after data is ready. Otherwise it tries the URL hash, respects `preventScrollReset`, then scrolls to the top. Entry keys are the default identity; applications may choose a custom key. Different visits to the same pathname need not share scroll state. [R19]

Focus is a separate application decision. The accessibility guide explicitly calls out focus management and live-region announcements after client navigation. A navigation framework cannot infer which heading, panel, dialog or input should receive focus in every application. A rebuild should specify these rules rather than treating preserved document identity as accessibility correctness. [R20]

View Transitions are an optional rendering enhancement. `RouterProvider` detects support, coordinates the browser transition with state updates/flushSync or React transitions, and retains transition information for relevant POP navigations. React `startTransition` is scheduling; the browser View Transition API is visual capture/animation. Neither is route matching or data transport. [R7][R21]

Each layer owns cleanup: history listeners, pagehide listeners, timers/observers, route component effects, fetcher registrations and aborted requests. The website's delegated Markdown handler is mounted through a React effect and removes its exact listener during cleanup. Any Forma adaptation must bind equivalent work to its actual component/page lifetime. [R8][W3]

## 10. Errors, blockers, SSR and hard-navigation boundaries

- A missing match creates a route error/boundary result rather than treating an empty component render as success. Loader/action errors and render errors follow related but distinct paths. Closest matched error boundaries can preserve a parent layout while showing a child failure. [R9][R11]
- Blockers are client navigation state, not authorization. They support leaving-page UX; server access checks must still exist. POP restoration depends on history deltas. `beforeunload` is a separate hard-document boundary with browser restrictions. [R8]
- Deep links and refreshes must be handled by the server/hosting configuration. A client-only SPA needs suitable shell fallback; an SSR framework server must match and render the initial request. The website does the latter. [W5]
- SSR boot data, route modules and manifest must describe a compatible application. `HydratedRouter` constructs the browser router from the document's state/module manifest; partial hydration clears selected loader values when a client loader/fallback requires client work. It does not imply a zero-write island adoption contract like Forma's native adopter. [R22]
- Normal document navigation remains appropriate for external links, explicit reloads, downloads, unavailable client behavior, some redirected destinations and release recovery. Progressive enhancement means the server route remains a working destination, not that all browser-only application code works with JavaScript disabled. [R5][R16]

## 11. What the documentation website specifically does

The pinned app route tree has a root, splash/brand/healthcheck/color-scheme routes, a pathless shared docs layout and article routes including `home`, `changelog`, `.md` variants and a splat. Legacy version-index routes coexist with that tree. The captured inert manifest contains **13 route records**, including loader/action flags and module URLs. Those records are retained in [site-manifest-summary.json](site-manifest-summary.json); boot configuration is in [site-context.json](site-context.json). This extraction used Python's JSON decoder on an object assignment, without evaluating JavaScript.

The doc loader resolves a version/ref from the URL and available tags, requests the corresponding repository document, and returns parsed HTML, headings and GitHub source/edit links. The parent layout loads the docs menu and version header. The article component renders HTML, then `useDelegatedReactRouterLinks` intercepts applicable internal Markdown links and calls `navigate`. The navigation menu uses ordinary library Links with intent prefetch and a delayed loading indicator. [W1][W2][W3][W4][W6]

The source's Markdown interceptor is an example to **review**, not copy blindly: it compares `host` rather than full `origin`, does not explicitly check `download` or an already prevented event, and starts from an `HTMLElement` target. These are source observations, not a tested live vulnerability claim. A reusable interceptor should have an explicit contract and tests for SVG descendants, modified clicks, downloads, opt-outs and cross-protocol destinations.

Fresh sampled browser evidence lives in [browser-react-router.json](../../evidence/browser-react-router.json): in Chromium 155, `/home → /start/modes` with JavaScript enabled preserved document identity and produced five network requests with **zero document requests**, including `/start/modes.data`. With JavaScript disabled the transition used a document request. The corrected probe waits for the destination heading and then, after Back, the original `React Router Home` heading; both modes restored the original content. The enabled-JS Back remained in the same document and requested `/home.data`.

The first probe captured Back after the URL changed but before its content settled. That initial observation remains in [browser-react-router-initial.json](../../evidence/browser-react-router-initial.json); the focused rerun corrected the wait condition rather than treating URL equality as completed navigation. The recorded URLs/request types are more authoritative for the precise sampled request mix than a general description of Framework mode. This is one browser and one link, not a cross-browser or race-correctness campaign. Navigation API events in the probe are observation signals, not evidence that the framework uses that API instead of History API calls.

## 12. What REA actually contributed

Seven public script assets referenced by the sampled home document were downloaded with hashes and a 2 MiB per-response cap. They are a selected application sample, **not the full dependency graph**: React/React DOM and other module dependencies were not all downloaded.

| Run | Selected files | Result | Evidence |
|---|---:|---|---|
| `react-router-doc-chunks` | manifest, root, article, utils (4) | Exit 0; 4 parsed; 80 findings; zero parse failures; 2.553 s | [run](../../.local/rea/react-router-doc-chunks/run.json), [full evidence](../../.local/rea/react-router-doc-chunks/evidence.json) |
| `react-router-layout-chunks` | docs layout, supporting library (2) | Exit 0; 2 parsed; 71 findings; zero parse failures; 4.363 s | [run](../../.local/rea/react-router-layout-chunks/run.json), [full evidence](../../.local/rea/react-router-layout-chunks/evidence.json) |
| `react-router-entry` | 190,898-byte entry/runtime bundle (1) | `provider_timeout`; exit 1; one skipped source, zero completed parses; partial evidence retained; 18.011 s including cleanup | [run](../../.local/rea/react-router-entry/run.json), [failure + partial evidence](../../.local/rea/react-router-entry/evidence.json) |

The analysis used a 15-second per-source deadline, 512 MiB analyzer heap and explicit semantic caps. Runs were serialized by the project helper. The successful runs establish syntax-derived import/export relationships and other source observations for **six distinct sampled assets**. Unselected/missing modules remain unknown. The findings counts are reported tool counts, not a count of proven runtime behaviors or unique routing facts.

Concrete retained observations are summarized in [rea-observations.json](rea-observations.json), which keeps each selected observation's ID, source location and limitations:

| Shipped asset | Syntax-derived observation | Interpretation limit |
|---|---|---|
| `root-CmiqwOFp.js` | Exports `ErrorBoundary`, `Layout`, `default`, `meta`; 14 import relationships | Supports the route-module shape; does not prove which boundary rendered. |
| `doc-CVbegNQE.js` | Exports `ErrorBoundary`, `default`, `meta`; 16 import relationships | An observed `fetch(e)` target remains the unresolved expression `e`; it is not an established network URL. |
| `docs-layout-CTqBlNNw.js` | Default export; 19 import relationships | Minified names and absent dependencies limit semantic reconstruction. |
| `manifest-b63cec8d.js` | Graph observations include literal route-like fields such as `home`, `changelog`, `/healthcheck`, `*` | These literal facts do not by themselves reconstruct parent relationships or demonstrate route execution. |

Missing imports such as the JSX runtime and icon chunk are explicitly unresolved in the sampled container. This is missing coverage, not a claim that the deployed browser fails to load those resources.

A useful negative result: REA's generic route inventory in the four-file run reported low-confidence favicon path candidates; it did **not** reconstruct the manifest's 13-route application tree. Calling those candidates real pages would be wrong. The manifest table was recovered separately from its known inert JSON format. The entry timeout means this study cannot claim that REA reconstructed the complete navigation state machine. That state machine was investigated in the pinned TypeScript implementation instead. No source code was executed by these static analyses.

This separation is the practical research method: use REA to inventory shipped artifacts and expose evidence/coverage; use the source owner to explain named algorithms; use browser observations to check selected live behavior. None of those substitutes for the other two.

## 13. A reconstruction plan

1. **Write the contract.** Select component-tree routing, HTML-document/region navigation, or a deliberately hybrid adapter. Define which URLs belong to it and which require normal navigation.
2. **Make matching pure.** Give route IDs, parent relationships, base path, params, search/hash and ranking explicit types. Test ambiguous routes, optional segments, encoded separators and splats before adding network work.
3. **Centralize history.** Preserve state, keys and traversal semantics. Treat PUSH, REPLACE and POP as distinct intents. Do not let every feature call `pushState` independently.
4. **Model pending versus committed state.** Abort superseded work and also prevent stale completion from committing. Give errors and redirects explicit outputs. Define when URL, UI, metadata and data become committed.
5. **Add a renderer adapter.** React uses outlet trees and reconciliation; Forma must use its actual ownership/adoption contracts. Parent reuse must not retain stale child resources.
6. **Add data deliberately.** Separate mutation, revalidation and background fetchers. Decide whether the transport is HTML, JSON, or another typed protocol. Backend authorization and mutation ordering remain server responsibilities.
7. **Add document UX.** Scroll, hash targeting, focus, title, announcements, pending UI and error display need their own rules and tests.
8. **Optimize after the behavior is reliable.** Prefetch route metadata/code/data independently; scope caches by relevant URL/session/version dimensions; add bounded release recovery and visible network-error behavior.
9. **Preserve progressive enhancement.** Deep links, reloads, no-JS forms and external links must still work according to the selected rendering model.

### Test matrix to carry into an implementation

| Category | Cases that reveal real bugs |
|---|---|
| Matching | static versus dynamic ambiguity; identical siblings; pathless layout; index route; optional segment; trailing slash; basename boundary; encoded slash; malformed encoding; unknown path |
| Interception | left/modifier/middle click; `_blank`; external origin; download; caller prevented event; nested SVG/icon; same URL; hash-only; explicit reload |
| History | PUSH/REPLACE/Back/Forward; repeated pathname with distinct state; blocked POP followed by proceed/reset; foreign entry without index; first-load hydration |
| Concurrency | slow A then fast B; A ignores abort; stale rejection after B; mutation followed by navigation; same fetcher superseded; different fetchers; revalidation arriving out of order |
| Rendering | parent shell retained; removed-child cleanup; error at parent versus child; lazy-module failure; redirect; data missing during hydration |
| HTTP | direct deep link; GET/POST without JS; 307/308 versus 302; cross-origin redirect; CDN error payload; malformed data stream; unavailable code chunk; release mismatch |
| UX | restore each entry's scroll; hash after data arrival; no reset during mutation/revalidation; bfcache; keyboard focus; screen-reader announcement; reduced motion/unsupported View Transition API |

Upstream tests covering these concerns include `navigation-test.ts`, `interruptions-test.ts`, `fetchers-test.ts`, `navigation-blocking-test.ts`, `scroll-restoration-test.ts`, `redirects-test.ts`, `should-revalidate-test.ts`, and `route-matcher-comparison-test.ts`. Their source was used as a test-design index; **the upstream test suite was not run**. The local original transaction example has its own small executed tests, documented beside it.

## 14. Remaining uncertainty and deliberate limits

- The exact live deployment commit cannot be established from the captured headers/manifest alone.
- The entry bundle did not finish REA analysis under the chosen budget. No claim is made about all shipped code or every route.
- No production mutation/action was submitted. Action/fetcher behavior is source-derived and not a live docs-site exercise.
- No cross-browser, assistive-technology, offline, high-load, adversarial or performance campaign was run for the upstream site.
- The default 8.5.0 matcher was inspected. The unstable route-pattern/RSC/custom-discovery surfaces require separate compatibility/performance qualification before adoption.
- A reconstruction can borrow contracts and small patterns; recreating complete React Router behavior is a substantially larger task than intercepting links or implementing one successful transition.

## Pinned source references

[R0]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/docs/start/modes.md
[R1]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/router.ts#L964-L982
[R2]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/utils.ts#L1104-L1505
[R3]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/utils.ts#L1712-L1891
[R4]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/matcher-route-pattern.ts#L38-L130
[R5]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/dom/lib.tsx#L1321-L1433
[R6]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/history.ts#L552-L765
[R7]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/router.ts#L1542-L1685
[R8]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/router.ts#L1324-L1436
[R9]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/router.ts#L1943-L2183
[R10]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/router.ts#L2442-L2748
[R11]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/hooks.tsx#L1231-L1420
[R12]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/router.ts#L5538-L5799
[R13]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/router.ts#L2784-L3425
[R14]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/router.ts#L3856-L3876
[R15]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/dom/ssr/single-fetch.tsx#L588-L735
[R16]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/router.ts#L3428-L3568
[R17]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/dom/ssr/fog-of-war.ts#L17-L426
[R18]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/dom/ssr/components.tsx#L87-L158
[R19]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/dom/lib.tsx#L3060-L3190
[R20]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/docs/how-to/accessibility.md
[R21]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/components.tsx#L393-L554
[R22]: https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/dom-export/hydrated-router.tsx#L56-L236
[W1]: https://github.com/remix-run/react-router-website/blob/e9b619c5b05209d1eaf0ba02218633732347c789/app/routes.ts#L1-L30
[W2]: https://github.com/remix-run/react-router-website/blob/e9b619c5b05209d1eaf0ba02218633732347c789/app/pages/doc.tsx#L21-L124
[W3]: https://github.com/remix-run/react-router-website/blob/e9b619c5b05209d1eaf0ba02218633732347c789/app/ui/delegate-markdown-links.ts#L4-L41
[W4]: https://github.com/remix-run/react-router-website/blob/e9b619c5b05209d1eaf0ba02218633732347c789/app/components/docs-menu/menu.tsx#L153-L198
[W5]: https://github.com/remix-run/react-router-website/blob/e9b619c5b05209d1eaf0ba02218633732347c789/server.ts#L1-L104
[W6]: https://github.com/remix-run/react-router-website/blob/e9b619c5b05209d1eaf0ba02218633732347c789/app/modules/gh-docs/.server/docs.ts#L14-L145
[W7]: https://github.com/remix-run/react-router-website/blob/e9b619c5b05209d1eaf0ba02218633732347c789/react-router.config.ts
