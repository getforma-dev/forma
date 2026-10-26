# Reconstructing a client router from explicit contracts

This is an original design synthesis of the three [source studies](COMPARISON.md),
not a copied implementation or a claim of compatibility with their APIs. It
provides a staged specification and executable evidence for the common core.

## First choose the rendering product

| Product | Initial response | Subsequent navigation | Appropriate first scope |
| --- | --- | --- | --- |
| Browser component router | App shell or separately hydrated page | Match branch, prepare data/code, reconcile component owners | A client-rendered application |
| HTML document navigator | Complete server/static HTML | Fetch trusted same-origin HTML, validate compatibility, replace declared regions | A documentation/marketing portal |
| Native SSR plus islands navigator | Typed server HTML with state/identity envelope | Requires a defined protocol for next-document claims and island activation | A framework feature, after server/compiler/browser lifecycle design |

Keep the browser/history machinery reusable, but make the rendering adapter
explicit. Treating every destination as an untyped string of HTML removes
contracts the runtime may rely upon. Treating every page as a browser component
can discard useful server behavior.

## Module boundaries and interfaces

| Module | Input → output | Required invariant |
| --- | --- | --- |
| URL policy | Raw destination + committed base → normalized URL | Defined encoding, base/origin/scheme policy; no accidental segment decoding |
| Matcher | URL + route configuration → ordered owner chain/params | Deterministic precedence; full branch consumption; coded refusal of unsupported grammar |
| History adapter | Push/replace/traverse intent ↔ entry metadata | POP never creates another entry; preserve unrelated state during owned replacement |
| Navigation coordinator | Intent → preparing/committed/cancelled/failed outcome | Only the current owner can commit; failures do not impersonate success |
| Data/code preparation | Match + AbortSignal → detached candidate | Cancellation-aware; obsolete results lose commit authority and late owned resources are disposed; no early view/history writes |
| Renderer | Candidate + previous owner → synchronous commit | Defined retained nodes/owners and cleanup; no undocumented script execution |
| Data mutation layer | Submission → action result + refresh policy | Distinct from navigation; explicit idempotency, server ordering and revalidation |
| Experience policy | Committed entry + navigation type → focus/scroll/announcement | Entry identity is distinct from URL; completion phases are explicit |
| Speculation/cache | Eligible intent → reusable prepared result | Bounded, correctly keyed, failure-aware, release-compatible |
| Recovery | Error + navigation phase → fallback or error boundary | Avoid POST resubmission and redirect loops; preserve server semantics |

A possible vocabulary, deliberately independent of Angular/React types:

```ts
type Intent = {
  destination: URL;
  kind: 'push' | 'replace' | 'traverse';
  entryKey?: string;
  trigger: 'link' | 'form' | 'api' | 'history';
};
type Navigation = {
  id: number;
  intent: Intent;
  controller: AbortController;
  phase: 'preparing' | 'committing' | 'settling';
};
type PreparedView = {
  // Defined by the chosen renderer, not arbitrary interchangeable HTML.
  commit(): void;
  dispose(): void;
};
type Outcome =
  | { kind: 'committed'; entryKey: string }
  | { kind: 'cancelled'; reason: 'superseded' | 'blocked' }
  | { kind: 'redirected'; destination: URL }
  | { kind: 'failed'; error: unknown };
```

This is a design sketch. The runnable reference has a smaller API and intentionally
omits guards, redirects and a general mutation layer.

## Navigation transaction rules

1. **Classify the event before preventing default.** Preserve modified clicks,
   non-primary buttons, downloads, alternate targets, external origins, unsupported
   schemes, already-handled events and explicit opt-outs. Resolve actual anchors
   through the composed path when supporting shadow DOM. Real hrefs remain useful
   for copying, opening new tabs, no-JS operation and accessibility.
2. **Resolve against the right location.** Pending traversal may make
   `location.href` disagree with the rendered page. Decide which base belongs to
   links in that still-visible view. Handle `<base>` explicitly in a document
   navigator; rejecting it is a valid restricted contract.
3. **Create an owner and cancel the previous attempt.** Keep the committed view
   intact while preparing. Aborting is a signal, not proof that external work or
   a server mutation stopped. [DOM abort contract](https://dom.spec.whatwg.org/#aborting-ongoing-activities).
4. **Run matching/guards/loading under that owner.** Re-check ownership after
   asynchronous work and callbacks that can re-enter navigation. A failure in a
   stale attempt must not erase a newer loading state or navigate the document.
5. **Prepare resources offscreen.** Create a detached candidate and a disposer.
   If cancellation wins while preparation ignores its signal, dispose the late
   candidate when it eventually arrives.
6. **Commit in a controlled critical section.** Define when history moves,
   when the DOM changes, and when the old scope is disposed. Avoid arbitrary
   awaits inside the irreversible swap. If an animation schedules the update
   callback later, check ownership inside that callback as well.
7. **Settle the experience separately.** Restore scroll, update title, move or
   preserve focus, announce completion and clear pending UI only for the current
   owner. Identify which promise means data ready, DOM committed, widgets ready,
   or animation finished.

The [reference kernel](reference-router/kernel.mjs) demonstrates generation
checks, abortable waits, detached preparation and cleanup. Its
[Node tests](reference-router/kernel.test.mjs) include a loader that ignores
AbortSignal and a preparer that produces a late resource after cancellation.

## History decisions that need tests

| Operation | URL timing | Entry operation | Scroll policy |
| --- | --- | --- | --- |
| New managed link | Design chooses eager or commit-time; reference uses commit-time | PUSH after accepted preparation | Save outgoing entry; new page top or fragment |
| Replace | Same timing policy, no new stack slot | REPLACE owned fields without deleting unrelated state | Explicit destination policy |
| Back/Forward | Browser has generally already traversed when legacy `popstate` arrives | No PUSH; reconcile view to selected entry | Restore that entry's position |
| Fragment-only | Usually no data/render work; cancel obsolete pending work | New entry only when fragment target actually changes | Fragment or saved traversal position |
| Revalidation | Current route remains committed | No history write | Usually preserve scroll |
| Blocked POP | URL may already differ from view | Restore/replay a known traversal delta, or use a suitable Navigation API contract | Restore view/URL/entry consistency |
| Unowned/missing history metadata | Cannot safely invent a previous index | Restricted fallback or explicit recovery | Let the document recover coherently |

An entry key is not the URL: two visits to the same URL can have different scroll,
form values and user state. `pushState` does not stand in for the whole routing
transaction. [HTML history/navigation standard](https://html.spec.whatwg.org/multipage/nav-history-apis.html).

## Additional protocol for fetched-document navigation

The [Astro report](research/astro/report.md) provides the most concrete study of
this model. A restricted navigator should specify all of the following:

- **Response admission:** same-origin final URL, media type, server status policy,
  redirect limits, required document marker, exactly one expected content region,
  compatible build/asset identity, and a response-policy boundary.
- **Head reconciliation:** title, canonical and metadata policy; CSS readiness;
  font/style persistence; removal of obsolete managed nodes. Define whether new
  executable scripts are rejected or activated under a controlled module registry.
- **DOM ownership:** which shell persists; which content is replaced; whether
  persisted nodes move as live objects; how nested keys and missing placeholders
  fail; when temporary disconnection becomes permanent unmount.
- **State and hydration:** reject or explicitly handle server state envelopes and
  hydration identity. A generic `innerHTML` swap does not extend a framework's
  island contract. Parsed HTML is not automatically trusted or sanitized.
- **Lifecycle hooks:** distinguish prepare, before-swap, after-swap, page-ready
  and final visual completion. Page-local listeners, timers, observers and workers
  must have an owner and disposer. Hooks can re-enter; their ownership matters.
- **Script policy:** imported script elements are not a complete execution plan.
  Replaying every script duplicates initialization; replaying none can break
  widgets. Astro defines a policy; a smaller app can reject scripts and use an
  explicit page-feature registry instead.
- **Response security:** a fetched next page cannot simply replace the current
  document's HTTP CSP/nonce context by swapping markup. Preserve appropriate
  document boundaries when policies differ.
- **Mutation fallback:** a failed enhancement after a POST must not casually
  resubmit the mutation through a native fallback. Keep redirects and response
  ownership explicit.

The [Forma adaptation note](FORMA-IMPLICATIONS.md) explains why its current portal
navigator deliberately accepts a narrower set than general native SSR pages.

## Data loading, prefetch and cache design

Do not combine these into one map of URL → Promise without deciding semantics.
Different loaders may depend on params, search, user identity, locale, request
headers, release ID or application data version. A rejection cached forever can
make a transient outage permanent for that tab. A cancelled navigation must not
abort a request another live owner still needs. A resolved prefetched document
can become stale across a deploy or authentication change.

A reasonable first portal scope is bounded intent prefetch sharing only while a
request is in flight, with normal HTTP revalidation afterward. A data router may
need route-ID-indexed results, per-loader revalidation, action-driven refresh,
independent fetcher keys and stale-load counters. Those are separate product
features. Speculative requests must use endpoints safe for speculative GETs.

## Implementation stages and acceptance gates

| Stage | Deliverable | Evidence required before expanding scope |
| --- | --- | --- |
| 1. URL/history contract | Pure parser/matcher and event classification | Encoding/base/relative/precedence fixtures; no accidental native-link interception |
| 2. Coordinator | Pending versus committed state; cancel and commit | Slow A/fast B; abort ignored; late preparation cleanup; stale errors |
| 3. Browser adapter | Hrefs, history, shell/content ownership | Push/replace/Back/Forward/hash; actual node identity; disposal after repeated visits |
| 4. UX/recovery | Focus/scroll/status and error paths | Keyboard, entry scroll, missing metadata, offline/non-HTML/redirect and deep-link tests |
| 5. Chosen renderer | Component branch or admitted document swap | Layout reuse or head/style/script/persistence protocol tests |
| 6. Speculation/data | Only the required caching/action features | Stale-data and mutation races, budget/eviction, cross-release and auth changes |
| 7. Framework integration | Versioned public API and server/compiler contracts | Cross-layer corpus/compatibility tests; full supported-browser validation |

The local reference reaches a deliberately restricted part of stages 1–4. It
does not make stages 5–7 unnecessary.

## Test matrix beyond the reference's coverage

Already exercised locally: ordered/ranked precedence choice, nested index owner
chain, encoded-slash params, malformed escapes, splats, invalid route definitions,
native-link exclusions, obsolete loaders, late preparer cleanup, failed preparation,
POP intent, explicit cancellation, browser shell/input identity, stale-response
races, fragments, Back, scroll restoration, full reload, native GET forms, loader
failure fallback, teardown, direct links and no-JS navigation.

Still required for a production implementation: Forward after multiple races;
blocked POP and history repair; browser process restart and session restoration;
BFCache eligibility/lifecycle; streaming and partial hydration; cancellation in
every stylesheet/animation/module phase; nested persistence and custom elements;
iframe/shadow-root routes; long-lived cache and release skew; redirects with
method changes; repeated submissions/idempotency; multi-fetcher revalidation;
scroll containers and virtual lists; focus during interrupted navigation;
screen-reader/manual accessibility checks; Firefox/WebKit and mobile gesture
traversal; CSP/Trusted Types deployment behavior; resource and memory measurements.

These are named gaps and future acceptance criteria, not claims that the source
frameworks fail them or that this study executed their upstream test suites.
