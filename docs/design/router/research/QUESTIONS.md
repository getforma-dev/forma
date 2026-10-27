# Research questions and evidence plan

The project investigates mechanisms that are sufficient to reconstruct routing
behavior. It does not infer a complete framework from a minified vendor graph.
Each framework's `questions.md` records answers and precise evidence. The final
comparison and reconstruction blueprint reconcile those answers.

## Identity and boundaries

1. Which GitHub repository owns the router, the documentation content, and the
   deployed documentation application? Are these the same project?
2. Which exact release/commit and shipped bytes are under observation? Can the
   public site's source revision be verified, or only inferred?
3. Is navigation a component-tree update, a fetched-document swap, or a full
   document navigation? Is client routing optional?

## URL and matching

4. How are paths, base URLs, query strings, fragments, encoded separators, empty
   segments, and trailing slashes represented and normalized?
5. What determines route precedence: declaration order or a ranking algorithm?
   How do nested, index, dynamic, wildcard, relative, and named-outlet routes work?
6. Where do redirects run, and how are redirect loops and external destinations
   handled? Which requests must reach the server?

## Navigation transaction

7. Which anchor/form events are intercepted, and which retain browser behavior?
8. How do push, replace, and pop navigation differ? What lives in history state?
   How does Back/Forward avoid adding another history entry?
9. What are the prepare/load/guard/commit/settle phases? When does the URL change?
10. How are overlapping navigations cancelled? Does aborting a fetch alone prevent
    stale results or undo a server mutation?
11. How do blockers, rejected guards, loaders, actions, fetchers, errors, pending
    states, revalidation, and redirects affect the transaction?

## Rendering and lifecycle

12. Which nodes/components/layouts survive? How are removed owners disposed?
13. For document swaps, how are head metadata, styles, scripts, persistent nodes,
    custom elements, and islands reconciled?
14. How are initial SSR/hydration and later navigation separated? What changes
    when JavaScript is disabled or a deep link is opened directly?
15. How are focus, title announcements, hash targets, scroll restoration,
    reduced motion, and view transitions coordinated?

## Delivery and resilience

16. What is lazy-loaded or prefetched? What is cached, under which key, for how
    long, and with what invalidation and release-compatibility checks?
17. What happens on slow or failed requests, interrupted transitions, invalid
    content types, external redirects, missing assets, or a deployment mismatch?
18. What does server hosting need for direct URLs, HTTP status codes, headers,
    cookies, authentication, and no-JavaScript operation?

## Reconstruction and validation

19. What minimum interfaces separate URL parsing, history, route selection,
    loading, rendering, and user-experience policy?
20. Which guarantees can a small reference implementation demonstrate, and which
    require a larger framework contract?
21. Which mechanisms fit Forma's existing portal navigation, and which would
    require new compiler/server/island lifecycle contracts?
22. Which observations came from REA, direct source inspection, a live browser,
    or our own tests? What remains unknown after each method?

## Method limits

The framework ledgers contain 105 question/answer records:
[Angular](research/angular/questions.md), [Astro](research/astro/questions.md),
and [React Router](research/react-router/questions.md). They retain source links
and explicit unknowns rather than treating every answer as runtime validation.

| Shared question group | Answer location | Established scope |
| --- | --- | --- |
| 1–3: identity, ownership, model | Each report's ownership section; [comparison](COMPARISON.md) | Pinned sources/captured assets plus selected live navigation |
| 4–6: URL grammar, matching, redirects | Each detailed report and attributed snippets | Source-derived algorithms; a smaller grammar independently tested in the reference |
| 7–11: interception, history, transaction/data | Reports; [rebuild blueprint](REBUILD-BLUEPRINT.md) | Exact implementation paths, static evidence, scoped browser and original-kernel checks |
| 12–15: rendering, lifecycle, hydration, UX | Reports; [Forma implications](FORMA-IMPLICATIONS.md) | Source-derived contracts; limited DOM/history/focus/scroll/no-JS observations |
| 16–18: cache, failure, hosting | Reports' cache/deployment/recovery sections | Source/configuration and response observations; no private hosting account audit |
| 19–20: interfaces and executable minimum | Blueprint and [reference guide](reference-router/README.md) | Original implementation with explicit restricted semantics and passing local checks |
| 21: Forma fit | Forma implications | Read-only application snapshot; no new framework capability implemented |
| 22: evidence and uncertainty | [Methods](METHODS.md), [validation](VALIDATION.md), framework ledgers | Methods remain distinct; named gaps are future research/acceptance work |

REA can recover static relationships and source locations in shipped JavaScript.
It cannot prove an unexecuted path is active, recover private server behavior, or
establish visual/lifecycle fidelity from graph edges. Browser checks establish
specific interactions, not all framework guarantees. Source tests and exact
implementation paths supply the missing contracts; unverified claims stay open.
