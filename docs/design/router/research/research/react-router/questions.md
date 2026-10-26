# React Router question and evidence ledger

Baseline: **8.5.0**, library commit `4fe4525102870a2b21a4a0568a651d118f5e5dbb`;
website snapshot `e9b619c5b05209d1eaf0ba02218633732347c789`. These questions were
answered locally from pinned source, retained public assets, bounded REA analysis
and one browser experiment. The [report](report.md) gives the explanation and
immutable source links; [sources.json](sources.json) records hashes.

Evidence codes: **S** = source-derived; **A** = observed HTTP/artifact; **R** = REA
static output; **B** = observed browser sample; **D** = design inference;
**U** = not established. An answer marked S does not assert that the live site
executed that code path. R does not imply runtime observation.

## Ownership and version

1. **Where is the router implemented?** **S:** `remix-run/react-router`, chiefly
   `packages/react-router/lib/router`, with React/DOM adapters in neighboring
   directories. It is not implemented in the documentation application's route
   files. [Ownership](report.md#1-which-github-repositories-actually-own-this-system)
2. **Where is the docs website application implemented?** **S:** the separate
   `remix-run/react-router-website` repository. Docs Markdown is fetched from the
   library repository, but the shell, menu, article renderer and server live in
   the website repository. [Site behavior](report.md#11-what-the-documentation-website-specifically-does)
3. **Which release is being explained?** **S/A:** selected release 8.5.0; website
   dependencies pin 8.5.0 and the sampled page advertises 8.5.0. The website commit
   is a separately pinned main snapshot. Neither default-main source nor older
   version guides were silently substituted. [Provenance](sources.json)
4. **Can we prove the website's deployed Git commit or whole hosting topology?**
   **U:** no source-commit receipt was exposed. **S/A:** Fly deployment config and
   Fly-serving headers agree on that platform; this does not establish account
   ownership, all proxies or the deployed source revision. [Limits](report.md#14-remaining-uncertainty-and-deliberate-limits)

## Runtime and matching

5. **Is this one routing mode?** **S:** Declarative mode matches/renders around
   history; Data mode adds loaders/actions/navigation coordination; Framework
   mode adds build and server transport/hydration integration. The website uses
   Framework mode. [Mode contracts](report.md#2-the-three-modes-are-different-contracts)
6. **Does navigation replace the HTML document body?** **S/B:** the general model
   commits a matched React outlet tree and data. The sampled enabled-JS docs
   navigation retained document identity and fetched `.data`. Article HTML is
   data rendered inside that tree. It is not a whole-body HTML transplant.
   [Navigation](report.md#5-navigation-as-a-transaction)
7. **Why does `/teams/new` beat `/teams/:id`?** **S:** branch scores rank static
   segments above dynamic ones; branch declaration order is not the only rule.
   Index and splat scoring and sibling tie breaks also matter.
   [Matching](report.md#3-how-matching-actually-works-in-850)
8. **How do nesting, index and pathless routes work?** **S:** flattening builds
   possible leaf branches while retaining ancestor metadata. Pathless ancestors
   provide layouts; index routes represent the parent's default child and cannot
   have children. Rendering folds the matched chain into nested outlets.
   [Matching](report.md#3-how-matching-actually-works-in-850), [rendering](report.md#5-navigation-as-a-transaction)
9. **What about optional segments, splats and encoded separators?** **S:** the
   default matcher expands optional patterns, penalizes splats and decodes
   segment-by-segment while protecting encoded slash boundaries. Search/hash
   are distinct from the pathname matcher. Malformed escapes need explicit
   handling. [Matching details](report.md#3-how-matching-actually-works-in-850)
10. **Is the new route-pattern engine the deployed default?** **S/A:** no. The
    release defaults to `V6RegExMatcher`; the name is historical, not a package
    version claim. `unstable_routePatternMatching` selects an alternative. The
    inspected website does not enable it. [Version-specific branch](report.md#experimental-alternative-in-this-exact-release)

## Links and history

11. **Which clicks should remain browser actions?** **S/D:** library Link leaves
    modified/non-primary clicks and non-self targets to the browser and handles
    external/reload targets separately. A reusable delegated implementation must
    additionally define download, opt-out, already-prevented event and protocol
    rules. [Interception](report.md#4-click-interception-relative-urls-and-history)
12. **Are generated Markdown links handled the same way as JSX Links?** **S:**
    the site has a separate delegated handler around the HTML article. It calls
    `navigate` after its own eligibility checks. That code checks `host`, not full
    `origin`, and has no explicit download/defaultPrevented check. These are
    source limitations to test before reuse, not tested live exploit findings.
    [Site interceptor](report.md#11-what-the-documentation-website-specifically-does)
13. **Why do entries need keys and indexes?** **S:** keys identify entries for
    state/scroll; indexes give a POP delta. User data is stored separately in the
    history state wrapper. Foreign `pushState` entries without indexes weaken
    blocker handling. [History](report.md#4-click-interception-relative-urls-and-history)
14. **When is the URL committed?** **S:** Data-router PUSH/REPLACE happens at
    `completeNavigation`, after preparation. POP starts with the browser's URL
    already changed; completion must not push another entry. Declarative history
    and pending display have different timing contracts. [Commit](report.md#5-navigation-as-a-transaction)
15. **How can Back be blocked if popstate cannot be canceled?** **S:** the router
    restores the previous entry by the inverse known delta; proceeding replays
    the original delta. This is not implemented by returning false from a
    popstate listener. [Blockers](report.md#4-click-interception-relative-urls-and-history)
16. **Does observing the browser Navigation API mean the router uses it?**
    **B/S:** no. The probe recorded Navigation API events as observation; source
    inspection shows the history adapter using pushState/replaceState/popstate.
    APIs visible in a browser can observe navigation caused by other mechanisms.
    [Browser evidence](../../evidence/browser-react-router.json)

## Transactions, data and failures

17. **What states must the UI distinguish?** **S:** committed location/data,
    pending target and `idle/loading/submitting` navigation, plus revalidation
    and keyed fetcher states. One global boolean cannot represent these
    independently. [Transaction](report.md#5-navigation-as-a-transaction)
18. **Is AbortController alone enough to avoid stale UI?** **S/D:** no. The
    implementation checks aborted request state after asynchronous work;
    fetcher paths also track load IDs. An application promise can ignore abort.
    The original example uses generation identity as a second guard.
    [Concurrency](report.md#6-loaders-actions-fetchers-and-revalidation), [tested pattern](snippets/README.md)
19. **Are loaders always sequential or always rerun?** **S:** default selected
    loaders run in parallel; selection can reuse parent data. Missing data, new
    route instances, actions, search changes and explicit revalidation affect
    the default; `shouldRevalidate` can adjust it. [Loader policy](report.md#6-loaders-actions-fetchers-and-revalidation)
20. **What is an action versus a loader?** **S:** actions handle targeted mutation
    submissions and can be followed by loader revalidation. GET submissions
    produce navigation/search behavior. Mutation redirect status can preserve
    or change method behavior. [Actions](report.md#6-loaders-actions-fetchers-and-revalidation)
21. **What is a fetcher?** **S:** a keyed non-navigation loader/submission with
    independent state and cancellation. Same-key work can supersede itself;
    independent fetchers need not cancel each other. Mutations can revalidate
    page loaders, so their ordering interacts with navigation. [Fetchers](report.md#6-loaders-actions-fetchers-and-revalidation)
22. **Does request cancellation undo server writes?** **S/D:** no. A server may
    already have processed the mutation. Idempotency, validation and mutation
    ordering need server contracts. No live mutation was sent in this study.
    [Cancellation](report.md#6-loaders-actions-fetchers-and-revalidation)
23. **Are error boundaries just 404 pages?** **S:** no. Missing routes, loader/
    action failures and rendering failures have boundary paths. The selected
    matched boundary can preserve an ancestor layout while replacing a failed
    descendant. [Errors](report.md#10-errors-blockers-ssr-and-hard-navigation-boundaries)
24. **How are redirects classified?** **S:** internal navigable redirects reenter
    the pipeline; external/out-of-base or explicit reload redirects hard-navigate.
    307/308 can preserve mutation methods. Transport must preserve redirect
    metadata rather than allowing fetch-follow behavior to erase it.
    [Redirect protocol](report.md#7-framework-mode-wire-protocol)

## Protocol, discovery and caching

25. **What does Framework mode request over the wire?** **S/B:** server data
    paths generally use `.data`, with `/_.data` for a trailing slash. Payloads
    use the framework stream protocol and route result mapping. The sampled
    transition requested `/start/modes.data`; this is not generic plain JSON
    nor a new HTML document. [Wire protocol](report.md#7-framework-mode-wire-protocol)
26. **Does every client loader go through that protocol?** **S:** no. Data-mode
    browser loaders and Framework client loaders can make application requests.
    Server-loader orchestration uses the framework transport. Identify which
    layer owns each loader before implementing an imitation. [Mode contracts](report.md#2-the-three-modes-are-different-contracts)
27. **Are route discovery, lazy modules and prefetch synonymous?** **S:** no.
    Discovery learns metadata; module import gets implementation; data requests
    get results; prefetch can hint one or more resources ahead of navigation.
    [Discovery](report.md#8-route-discovery-route-code-and-prefetching-are-separate)
28. **Is lazy manifest discovery enabled on the docs site?** **S/A:** no; config
    and captured boot context specify `mode: "initial"`. Menu intent prefetch
    still occurs as a separate capability. The captured manifest has 13 records.
    [Manifest](site-manifest-summary.json), [context](site-context.json)
29. **How does generic lazy discovery handle stale releases?** **S:** it requests
    metadata using the manifest version, patches route records and uses bounded
    reload/session-state recovery on incompatibility. The existence of this code
    does not mean this website used lazy discovery during the browser sample.
    [Discovery limits](report.md#8-route-discovery-route-code-and-prefetching-are-separate)
30. **Is loader reuse a universal data cache?** **S/D:** no. Loader reuse,
    application query caches, server Markdown caches, HTTP caching, module caches
    and manifest caches have different identities/lifetimes. They must not be
    merged into one inferred TTL policy. [Cache distinctions](report.md#6-loaders-actions-fetchers-and-revalidation)

## Rendering, SSR and document UX

31. **What survives route changes?** **S:** matched parent outlets/components may
    be reused through React reconciliation. This is not an unconditional DOM
    identity or zero-write hydration guarantee. Effects of removed children need
    cleanup. [Rendering](report.md#5-navigation-as-a-transaction)
32. **What makes deep links work?** **S/B:** the host/server must serve a valid
    destination response. The docs app has an SSR request handler; the no-JS
    browser sample obtained rendered destination content. Client interception
    cannot fix an absent server route. [SSR boundaries](report.md#10-errors-blockers-ssr-and-hard-navigation-boundaries)
33. **How is scroll restored?** **S:** saved entry-key positions, pagehide/session
    storage and manual browser restoration coordinate with navigation completion;
    hash, prevent-reset and top fallback are distinct cases. [Scroll](report.md#9-scroll-focus-transitions-and-lifetime)
34. **Does the router automatically solve focus and announcements?** **S/B:** no.
    Official guidance asks applications to address focus/live-region behavior.
    One observed focus snapshot is not an accessibility audit. [Accessibility](report.md#9-scroll-focus-transitions-and-lifetime)
35. **Are React transitions and browser View Transitions the same thing?** **S:**
    no. One affects React scheduling; the other captures/animates visual states.
    Both are separate from route matching, transport and commit correctness.
    [Transitions](report.md#9-scroll-focus-transitions-and-lifetime)
36. **Can SSR data be ignored and everything fetched again?** **S/D:** doing so
    changes hydration and pending-state semantics. Framework boot uses manifest,
    route modules and loader data; client-loader/hydration-fallback paths decide
    when initial data must be recomputed. Version alignment matters.
    [Hydration](report.md#10-errors-blockers-ssr-and-hard-navigation-boundaries)

## REA and reconstruction confidence

37. **How much did REA parse?** **R:** 6 distinct selected JS assets in 2 successful
    runs, 151 reported findings total, 0 parse failures. The seventh entry/runtime
    asset hit a 15-second provider deadline and retained partial evidence.
    Selected input is not the complete module graph. [Coverage](report.md#12-what-rea-actually-contributed)
38. **Did REA recover the complete route tree and state machine?** **R/A/S:** no.
    Generic route candidates included favicon paths; the true 13-record manifest
    was parsed separately as inert JSON. The state machine came from pinned
    TypeScript inspection because the large runtime asset timed out.
    [Negative result](report.md#12-what-rea-actually-contributed)
39. **What was actually tested?** **B/D:** one live Chromium 155 link with JS on/
    off and Back, plus 4 deterministic tests of an original cancellation pattern.
    Upstream tests were indexed for design but not installed or executed. No
    performance, production mutation or cross-browser claim follows from this.
    [Tests](snippets/README.md), [browser evidence](../../evidence/browser-react-router.json)
40. **What is the smallest useful reconstruction?** **D:** choose a renderer
    contract; build pure matching and centralized history; separate pending and
    committed state; make async preparation abortable and stale-safe; add defined
    scroll/focus/errors/deep-link behavior. Loader/action transport, discovery and
    prefetch can follow. A full React Router compatibility clone is a much larger
    undertaking. [Reconstruction and edge cases](report.md#13-a-reconstruction-plan)

## Questions to resolve when a Forma implementation is authorized

These are design decisions, not missing answers about the inspected framework.
The research does not block on asking the user to choose them now.

- Will the destination produce a full HTML document, a replaceable region, a
  component tree, FMIR, or a separately versioned data response?
- Which existing Forma owner controls route/component disposal and island
  adoption? Can it support a preparation phase that does not mutate committed UI?
- Will browser and Rust/server routing share a generated route manifest, and
  which source is authoritative for params, status codes and route access?
- Should URL commit wait for data/DOM preparation? How will POP's already-changed
  URL be represented during pending work or failure?
- What is the HTTP fallback policy for offline, malformed payload, missing chunk,
  unsupported browser behavior, authentication redirects and release mismatch?
- What state is eligible to persist between pages, and what must be reset on
  identity/authorization changes? How will stale cache entries be invalidated?
- Which local route fixtures should exercise SSR, no-JS forms, keyboard focus,
  rapid navigation and browser traversal before getforma.dev deployment?

Answer these against the current Forma implementation and local fixtures first.
Use the report's test matrix as acceptance criteria; do not infer compatibility
from superficial similarities between two click interceptors.
