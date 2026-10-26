# Applying the research to Forma

This is a design analysis, not a framework change or website deployment. It uses
the site's existing source at `919af5872b3a48fa43d12ce1bf4ceedad37dcdfd` and the
published Forma 3.0 contracts already identified in the workspace. Source hashes
and the private local snapshot are indexed in
[forma-source.json](evidence/forma-source.json). No application files were changed.

## The website already has an application navigator

`src/portal/navigation.js` implements navigation for a restricted list of public
portal paths. Its owning script keeps the header/search dialog alive and mounts
page features through `src/portal/app.js`. Docs can preserve their switcher/sidebar
while replacing article content. This is application code built with Forma,
not evidence that Forma 3.0 ships a general framework router.

The existing design is closest to a **restricted HTML-region navigator**. It has
some of Astro ClientRouter's prepare/swap concerns, but a narrower acceptance
policy. It also shares the persistent-layout/article concept seen in Angular
and React Router's docs apps, while using a different transport and renderer.

Source-derived mechanisms already present:

| Mechanism | Existing behavior | Local snapshot |
| --- | --- | --- |
| Eligibility | Same-origin, enumerated portal paths; native links/targets/downloads/modifiers escape | [navigation.js](.local/forma-site/src/portal/navigation.js), lines 5–43 |
| Response policy | Fetch HTML with same-origin credentials and revalidation; reject wrong media type, destination, or response CSP | Same file, lines 197–213 |
| Compatibility | Require portal content/header and matching build/asset markers; reject base, http-equiv, native island/state/root markers, unknown scripts | Same file, lines 214–237 |
| Speculation | Up to two in-flight intent requests; completed HTML is not retained as an application cache | Same file, lines 241–272 |
| Ownership | Sequence plus AbortController; checks after fetch/preparation and inside the update callback | Same file, lines 295–401 |
| Page lifecycle | Abort old page lifetime, dispose previous features; dispose late-mounted obsolete features | Same file, lines 340–371 |
| History | Entry IDs; POP avoids a new push; pending URL and rendered URL are distinct | Same file, lines 136–166, 351–363, 451–476 |
| UX | Title/head metadata, preserved docs shell, focus, scroll and live status | Same file, lines 68–114, 274–293, 373–379 |
| Recovery | Full navigation on admitted failure; POP fallback uses replace | Same file, lines 388–397 |

These behaviors were read, not rerun as a site acceptance campaign in this task.
Line ranges refer to the retained snapshot. The research's own prototype and
public-site browser experiments have separate evidence.

## Native Forma pages require their original document contract

The native site loads manifest/modules, checks SSR/no-JS routes, binds typed
props and finalizes before listening. Its complete `PageResponse` includes the
response policy. Compiler-declared islands adopt server-created nodes whose
identity and state came with that document. The portal deliberately rejects
native markers and preserves document navigation for `/lab/` destinations.

Extending the portal allowlist to accept native pages would not by itself define
how to validate another document's state envelope, identities, nonce/CSP,
retained assets, page ownership or island activation. Manually mounting a page
over marked SSR roots would conflict with the existing contract. This is a
cross-layer design question, not a missing `fetch()` call.

Astro demonstrates that an island-capable navigator is possible when persistence,
props updates, unmount timing and scripts have explicit framework contracts.
That is evidence for what must be designed, not permission to reuse Astro's
swap policy on Forma documents unchanged.

## Practical paths forward

### A. Improve the current docs/site navigator

This is the narrowest path when the goal is getforma.dev experience. Keep its
public-page boundary and feature registry. Use the research's transaction and
test patterns to evaluate browser history races, lifecycle cleanup, keyboard
navigation and deployment mismatch behavior. Preserve real links and native
navigation to the homepage, native labs, downloads and other excluded surfaces.

Do not add a general data cache or script replay system without a product need.
The current choice to share only in-flight prefetch work avoids a class of
long-lived content-cache invalidation problems. Its build/asset equality check
is a useful compatibility fence for public portal HTML.

### B. Add a browser-core application router

If a Forma browser application needs nested components and route data, build a
separate adapter around explicit route ownership and disposal. Decide ordered
versus ranked matching, relative URL semantics, nested layout reuse, data
refresh, error boundaries, guards, loading state and history behavior. The
original reference is a test scaffold for those choices, not a Forma adapter.

Using signals does not automatically solve route-tree lifetime. Components run
once, so reactive params must update through declared accessors or the relevant
owner must be replaced. A changing URL cannot silently turn a snapshot prop
into a reactive one. Keep callbacks, list identity, resources and cleanup in the
same ownership model as the rest of the app.

### C. Design native SSR/island navigation as a framework capability

This requires a versioned contract across compiler/build, Rust response/state,
and browser adoption. At minimum decide:

1. Whether next-page data is full HTML, a typed fragment envelope, or a dedicated
   navigation response—and how ordinary direct requests still work.
2. How state claims and island identities are validated for the new page and
   which owners may persist across it.
3. How CSP/nonces/Trusted Types and response headers interact with a surviving
   document; which policy changes require a full navigation.
4. How entry bundles, native modules, manifests and retained assets stay compatible
   across deploys and long-lived tabs.
5. How no-JS routes, forms, redirects, errors and authentication preserve their
   server behavior.
6. Which promise/event signifies HTML commit, island activation, page-ready and
   visual completion, including deferred islands.
7. How cross-layer tests prove DOM identity, absence of initial repair, cleanup,
   stale-result suppression and correct refusal paths.

This study does not implement that protocol. The choice between these paths
depends on whether the desired product is a better website navigator, a browser
app router, or a new framework-level native-navigation capability.

## Questions to resolve before implementation

- Must native FMIR islands survive a route change, or is document navigation
  acceptable for native routes?
- Is the API for application developers, or only the getforma.dev portal?
- Do nested layout/data boundaries matter, or is a persistent header plus article
  sufficient?
- Are loader/actions/fetcher semantics required, or would they introduce unused
  public contracts?
- What browsers, deployment-skew behavior, accessibility and no-JS guarantees
  are acceptance requirements?

Those are product decisions. REA and upstream source can reveal mechanisms and
tradeoffs, but cannot choose the intended Forma product on their own.
