# Research-to-design map for FORMA-301

2026-10-26. This map accounts for **all 105 numbered framework research questions**: Angular 25, Astro 40, React Router 40. A disposition is a design choice, not a passing implementation result. The linked [acceptance matrix](acceptance-matrix-design.md) defines tests that must produce their own evidence. The detailed reports, snippets, exact upstream permalinks and licenses remain in the [research project](research/README.md).

## How to use this map

**Adopt** carries a finding or mechanism into the design; evidence-only findings constrain claims rather than add runtime code. **Adapt** changes the mechanism to fit Forma. **Defer** preserves an explicit future capability and its reason. **Reject** excludes an incompatible mechanism, not the entire upstream framework. RD IDs are local research decisions; the main design may map them to its own D/R/N requirements. RT IDs identify acceptance scenarios. No copied upstream implementation is implied.

## Pinned evidence and limits

| Study | Source pin | Evidence boundary |
|---|---|---|
| Angular | `angular/angular` at `ecaec13db4fde7ceb0104105ee356bf00596f3d6` (footer v22.2.3+sha-ecaec13) | Footer/source identification is not reproducible deployed-byte attestation. Source and docs share a repo. |
| Astro | `withastro/astro` at `2fdf731428aa738d5dcf3041b4e78eb9d036968c` (7.2.10); docs `513089031ecc63198c555cbbaec0c88d20d4c571`; Starlight `88ad3c2630487ba227a7b4ccbffc01a2bdf623a5` (0.42.0) | Published tarball integrity checked; docs commit not attested. The sampled docs link reloaded the document. |
| React Router | `remix-run/react-router` at `4fe4525102870a2b21a4a0568a651d118f5e5dbb` (8.5.0); website `e9b619c5b05209d1eaf0ba02218633732347c789` | Separate site snapshot; no live commit receipt. Sample used `.data` and retained the document. |

REA 6.8.0 supplied bounded static evidence across seven runs: six completed and one React Router entry run timed out. Successful runs parsed 16 selected JavaScript files, not full graphs. Angular graphs truncated; Astro alias expansion was bounded; React Router route candidates did not recover the manifest. Original failures, selections and hashes remain in `.local/rea/`. No upstream suite was executed. Public browser samples used Chromium only. The original reference tests do not qualify native adoption, enhanced forms or the supported browser matrix. See [methods](research/METHODS.md) and [validation](research/VALIDATION.md).

Angular source and the framework/site snapshots retain their MIT notices; Angular documentation is identified as CC BY 4.0 in its provenance record. Links and original summaries are preferred over copied prose. Existing excerpt files retain notices and attribution; any production reuse requires the matching notice. The [machine-readable map](research-map.json) includes SHA-256 receipts for the consumed reports, ledgers, manifests, methods and license files.

## Decisions carried into Forma

| ID | Decision and cost boundary | Owner |
|---|---|---|
| RD01 | **Optional package and coordinated release.** @getforma/router owns router policy; core remains a peer. Additive compiler/build/server contracts travel in the matching release set. | Router, build/release |
| RD02 | **Explicit bounded route grammar.** Rank complete branches, static before parameter before terminal splat; support nested/index/pathless layouts. Reject unsupported syntax; preserve search/hash and segment decoding. | Router matcher, compiler/build |
| RD03 | **Platform semantics first.** Intercept only admitted links and opted-in forms. Keep real href/action/method, browser validation and submitter behavior. | Router DOM adapter |
| RD04 | **Owned navigation transaction.** Generation identity plus abort, detached preparation, serialized synchronous commit, late-resource disposal and distinct terminal outcomes. | Router coordinator, core owners |
| RD05 | **Central history and blockers.** Commit PUSH/REPLACE after admission; POP never pushes. Entry keys/indexes, committed versus pending URL, explicit blocked/foreign-entry recovery. | Router history adapter |
| RD06 | **Persistent layout owners.** Retain only a compatible common owner chain and live nodes; replace changed identity/props boundaries; dispose departing and obsolete owners. | Router renderer, core lifecycle |
| RD07 | **Typed native transition and scoped adoption.** Same typed Rust page produces a versioned navigation response; validate incoming claims in a new scope without resetting original-document authority. | forma-server, core adoption, compiler/build |
| RD08 | **Policy, build and integrity admission.** Require compatible app/build/group/policy; no client-supplied nonce or arbitrary script replay; one bounded safe document recovery. | forma-server policy, build assets, router admission |
| RD09 | **Initial group registration bootstrap.** Aggregate registration-only products into an integrity-checked complete executable artifact; defer route-code lazy loading and lazy discovery. | Compiler/build, core registration |
| RD10 | **Enhanced Rust forms.** Progressive GET/POST with typed success/validation/error/303 outcomes, no JavaScript server runtime and no client authorization. | Router forms, forma-server action response, application handlers |
| RD11 | **Mutation/read generations.** One managed mutation, explicit busy state; invalidate stale reads, revalidate current branch after settlement, suppress obsolete redirects, never replay an uncertain POST. | Router data coordinator, application mutation policy |
| RD12 | **Observable experience and completion.** Separate commit from island readiness; owned title/focus/scroll/announcements, reduced motion and browser-native escapes. | Router experience adapter, core readiness |
| RD13 | **Bounded speculation, no private page cache.** Private/native prefetch off by default; explicitly safe intent reads, at most two in flight, no retained completed private HTML or inferred shared TTL. | Router speculation, server cache policy |
| RD14 | **Status-aware error and fallback.** Not-found/validation/cancel/redirect/failure differ. Keep valid rendered errors; fallback only through the documented method-safe matrix. | Router boundaries, Rust response transport |
| RD15 | **Evidence and source ownership.** Keep source, artifact, REA, browser and original-prototype evidence distinct; retain pins, raw failures, licenses and scope limits. | Design lead, test/release evidence |
| RD16 | **Native proof before expansion.** Original examples are scaffolds, not framework qualification. Prove native policy/adoption/forms first, then qualify the full opt-in feature. | Framework integration, independent reviewers |

## Angular: complete question disposition

Question numbers refer to the [Angular ledger](research/research/angular/questions.md); its [Angular report](research/research/angular/report.md) and [source manifest](research/research/angular/sources.json) contain the exact underlying references.

| ID / research question | Disposition | Forma decision and use | Acceptance |
|---|---|---|---|
| AG01 — Where is the actual implementation? | Adopt | RD15: Keep router/library and docs ownership pinned; no host or byte-attestation inference. | RT-E01 |
| AG02 — Where is the docs app hosted? | Adopt | RD15: Retain Firebase configuration only as hosting evidence; it does not select Forma hosting. | RT-E01 |
| AG03 — Is the docs site actually client routed? | Adopt | RD12, RD15: Use document identity and requests to prove routing; the single Chromium sample is not cross-browser credit. | RT-N01, RT-N05 |
| AG04 — Can REA recover the complete router or route table from these minified bundles? | Adopt | RD15: Keep truncated REA graphs and selected-source limits; source and executable tests close different gaps. | RT-E01 |
| AG05 — What must the URL parser preserve? | Adapt | RD02: Preserve segment encoding/query repetition/hash; do not import Angular matrix/named-outlet grammar or host-specific slash predecode. | RT-U01, RT-U04 |
| AG06 — What does “first match wins” actually mean? | Adapt | RD02: Keep full-branch recognition; choose ranked Forma precedence rather than Angular configuration-order semantics. | RT-U02 |
| AG07 — Are routes limited to flat paths? | Adapt | RD02, RD06: Adopt nested/index/pathless layouts; defer named outlets and nonterminal multi-pattern wildcards. | RT-U02, RT-U04 |
| AG08 — How are redirect loops bounded? | Adapt | RD14: Redirect is a bounded control outcome; choose a Forma limit rather than copy Angular's development/production constant behavior. | RT-H04, RT-S06 |
| AG09 — What keeps a slow earlier navigation from overwriting a later one? | Adopt | RD04: Generation checks supplement abort and cover synchronous callbacks as well as promises. | RT-C01, RT-C02, RT-C03 |
| AG10 — Are same-URL requests always ignored? | Adapt | RD04, RD12: Separate same-URL skip, explicit data revalidation and owner recreation. | RT-U05, RT-C04 |
| AG11 — Does a link click always call pushState? | Defer | RD05, RD16: Use History API first; Navigation API integration is deferred because one docs Chromium path cannot establish supported-engine behavior. | RT-H01, RT-A05 |
| AG12 — Why is cancelling Back harder than cancelling a link? | Adapt | RD05: Restore/replay known POP deltas; never repair cancellation with an extra push. | RT-H02 |
| AG13 — Which anchor actions should stay native? | Adopt | RD03: Keep real hrefs and complete native-action escapes; do not extract a site-specific click helper without negative cases. | RT-L01 |
| AG14 — When do guards, data, code, and DOM run? | Adapt | RD04, RD06: Order matching/leaving checks/preparation/commit/settling explicitly; loading code and DOM activation have different ownership. | RT-C03, RT-C04 |
| AG15 — Do all Angular loaders run in parallel? | Adapt | RD04, RD11: Document data dependencies instead of claiming every loader runs in parallel; native destination preparation is a typed server response. | RT-F05, RT-C01 |
| AG16 — How does this site get the next document body? | Reject | RD07, RD13: Do not copy the docs Promise-per-path HTML cache or its retained 404 rejection into private native routing. | RT-N06, RT-K02 |
| AG17 — Does cancellation stop the content network request? | Adopt | RD04, RD13: Cancellation of one consumer is not proof shared network work stopped; revoke commit authority independently. | RT-C01, RT-K02 |
| AG18 — What is reused during navigation? | Adapt | RD06: Reuse stable route/layout identity, not component name or URL alone; changed props/identity replace the boundary. | RT-O01, RT-O03 |
| AG19 — What DOM transformation occurs? | Adapt | RD06, RD07: Generated HTML is a controlled owned region inside an adapter; never equate it with native claim authority. | RT-N06, RT-O02 |
| AG20 — Is preloading the same as caching? | Adopt | RD09, RD13: Separate registration bootstrap, speculative data, module preload and HTTP cache. | RT-K01, RT-S03 |
| AG21 — Does this router supply form actions and mutation invalidation? | Adapt | RD10, RD11: Enhanced Rust actions are an explicit new contract, not an assumed consequence of guards or resolvers. | RT-F01, RT-F05 |
| AG22 — When can scroll restoration happen? | Adopt | RD12: Restore scroll after usable layout and only for the current owner. | RT-A02 |
| AG23 — Does updating the title guarantee accessible focus? | Adopt | RD12: Title alone does not prove accessible focus/announcements; test these separately. | RT-A01, RT-A04 |
| AG24 — Does client routing eliminate SSR, deep-link, or base-path work? | Adopt | RD03, RD07: Deep URL, base path and server normalization remain server/build responsibilities. | RT-U03, RT-N05 |
| AG25 — What is the error contract? | Adapt | RD14, RD10: Separate cancel/redirect/skip/error; preserve server auth and status rather than map every failure to 404. | RT-X01, RT-F08 |

## Astro: complete question disposition

Question numbers refer to the [Astro ledger](research/research/astro/questions.md); its [Astro report](research/research/astro/report.md) and [source manifest](research/research/astro/sources.json) contain the exact underlying references.

| ID / research question | Disposition | Forma decision and use | Acceptance |
|---|---|---|---|
| AS01 — Where is the framework implemented? | Adopt | RD15: Keep framework source distinct from docs and theme pins. | RT-E01 |
| AS02 — Where is the docs site implemented? | Adopt | RD15: Retain the separate docs snapshot without claiming it is an attested deployed commit. | RT-E01 |
| AS03 — Where is the theme and what hosts docs? | Adopt | RD15: Keep Starlight and Cloudflare evidence as provenance, not a Forma deployment dependency. | RT-E01 |
| AS04 — Is the docs site a demonstration of ClientRouter? | Adopt | RD15, RD16: The observed docs reload is not a ClientRouter runtime test; prove Forma native behavior independently. | RT-E01, RT-N01 |
| AS05 — Could persistent sidebar state mislead us? | Adopt | RD06: Stored/restored values do not prove live DOM identity; assert actual objects. | RT-O01, RT-N01 |
| AS06 — Does an `astro:page-load` listener prove ClientRouter is enabled? | Adopt | RD15: A router event listener in an asset is not evidence that routing is enabled. | RT-E01 |
| AS07 — Is there a client route tree and outlet matcher? | Adapt | RD02, RD07: Native server resolves typed destinations, while browser routes need a branch matcher; explicit adapters prevent conflation. | RT-U02, RT-N06 |
| AS08 — How do route conflicts resolve? | Adapt | RD02: Use explicit Forma ranked rules and complete-branch tests; do not copy Astro file-route tie-breaks. | RT-U02 |
| AS09 — How does a page opt in? | Adapt | RD07, RD08: Use an explicit compiler/server capability and group contract, stronger than a marker-only admission test. | RT-S02, RT-P03 |
| AS10 — What click events are intercepted? | Adopt | RD03: Adopt composed-path eligibility and native escapes with a negative case for each escape. | RT-L01 |
| AS11 — What gets fetched? | Adapt | RD07, RD14: Use a typed navigation representation for native pages; full HTML belongs only to its admitted generated-HTML adapter. | RT-N01, RT-N06, RT-X01 |
| AS12 — Can an HTML 404 be rendered? | Adopt | RD14: Valid typed 404 content is a status-preserving result, not an automatic network failure. | RT-X01 |
| AS13 — Who wins if slow A finishes after fast B? | Adopt | RD04: Newest owner wins; await/serialize the previous commit and revoke stale preparation. | RT-C01, RT-C02 |
| AS14 — Is fetch cancellation alone enough? | Adopt | RD04: Abort alone is insufficient at custom async or reentrant boundaries. | RT-C01, RT-C03 |
| AS15 — Can hooks cancel or replace the process? | Adapt | RD04, RD14: Define explicit blocked/cancelled/native-fallback outcomes; do not reuse Astro event cancellation semantics. | RT-H02, RT-C04 |
| AS16 — What are lifecycle events ordered around? | Adapt | RD04, RD12: Expose commit and island readiness separately; no page-load claim that all deferred islands finished. | RT-C04, RT-N04 |
| AS17 — What does `await navigate()` mean? | Adapt | RD12: Specify navigate outcome plus readiness; animation completion is a separate concern. | RT-C04 |
| AS18 — Are same-URL and fragment navigations identical? | Adapt | RD05, RD12: Hash, query, self-link and form navigation each have an explicit branch. | RT-U05, RT-A02 |
| AS19 — What happens after redirect? | Adapt | RD14: Commit final admitted URL; action redirects preserve method-safe semantics rather than blind fetch-follow. | RT-H04, RT-F09 |
| AS20 — Why remove `noscript` from parsed HTML? | Adapt | RD07, RD08: Detached parsing needs a typed trust boundary; no-JS markup is not blindly transplanted into the live document. | RT-N06, RT-S04 |
| AS21 — How is CSS ready before the body changes? | Adapt | RD12: Wait for admitted CSS with bounded failure handling; load-error settlement is not proof of correct styling. | RT-A03, RT-C02 |
| AS22 — How is the head reconciled? | Adapt | RD07, RD08: Manage title/metadata/styles explicitly; HTTP policy cannot be replaced by a head swap. | RT-S01, RT-A01, RT-A03 |
| AS23 — Does persistence mean copy old HTML? | Adopt | RD06: Persistence retains live nodes, not serialized copies. | RT-O01 |
| AS24 — What about canvas, media, shadow roots? | Defer | RD06, RD16: Keep stable layout nodes in place; arbitrary keyed media/canvas/shadow-root transplants are not first-release persistence. | RT-O01, RT-A05 |
| AS25 — Do persisted island props update? | Adapt | RD06, RD11: Do not silently mutate snapshot props; replace incompatible native layout owners after server revalidation. | RT-O03, RT-F05 |
| AS26 — When does an island unmount? | Adapt | RD06: Temporary movement and permanent disposal differ; scoped owners must cancel deferred activation. | RT-O02, RT-N04 |
| AS27 — How are scripts activated and deduplicated? | Reject | RD08, RD09: Do not replay/deduplicate fetched scripts. Use compiler-owned registration products and the verified initial bootstrap. | RT-S03, RT-S04 |
| AS28 — How are back/forward direction and scroll known? | Adopt | RD05, RD12: Keep entry identity, committed URL and scroll snapshots separate from the already-moved browser cursor. | RT-H01, RT-U03, RT-A02 |
| AS29 — What focus/accessibility policy exists? | Adapt | RD12: Preserve retained-control focus, announce transitions and test actual keyboard/assistive behavior. | RT-A01, RT-A04 |
| AS30 — Does animation support determine routing support? | Adopt | RD12: Routing does not depend on animation API support; reduced-motion behavior is explicit. | RT-A03 |
| AS31 — How do GET/POST forms differ? | Adapt | RD03, RD10, RD11: Preserve native GET/POST/submitter semantics, with a stronger explicit no-replay uncertain-outcome contract. | RT-F01, RT-F02, RT-F07 |
| AS32 — What is prefetch caching? | Reject | RD13: Do not copy an unbounded attempted-URL set or infer a result-cache TTL; share bounded live requests only. | RT-K01, RT-K02 |
| AS33 — Is prefetch safe for every GET? | Adopt | RD13, RD10: Only explicitly safe server reads may be prefetched; same origin does not make a mutation-on-GET safe. | RT-K01, RT-F08 |
| AS34 — Is there a release mismatch fence? | Adapt | RD08: Add explicit build/protocol compatibility; the absence found in two Astro files is not a universal upstream failure claim. | RT-S02 |
| AS35 — Does no JavaScript still work? | Adopt | RD03, RD07: Keep complete server routes and native forms usable without enhancement. | RT-N05 |
| AS36 — Does REA prove execution or exhaustive route coverage? | Adopt | RD15: REA parsed selected artifacts, not execution or exhaustive routing coverage. | RT-E01 |
| AS37 — What did the docs REA alias bound mean? | Adopt | RD15: Retain the 512-state alias bound and unknowns; missing graph edges are not negative proof. | RT-E01 |
| AS38 — Was published JS tied cryptographically to the source commit? | Adopt | RD15: Registry/package integrity and source tag alignment do not prove reproducible live bytes; preserve separate receipts. | RT-E01, RT-S03 |
| AS39 — Were upstream tests run? | Adopt | RD15: Do not report inspected upstream tests as executed; qualify the actual Forma products. | RT-E01 |
| AS40 — What should we build first for Forma? | Adapt | RD07, RD16: Ticket supersedes a generic HTML prototype: first prove typed native policy/adoption plus enhanced forms. | RT-N01, RT-S01, RT-F01 |

## React Router: complete question disposition

Question numbers refer to the [React Router ledger](research/research/react-router/questions.md); its [React Router report](research/research/react-router/report.md) and [source manifest](research/research/react-router/sources.json) contain the exact underlying references.

| ID / research question | Disposition | Forma decision and use | Acceptance |
|---|---|---|---|
| RR01 — Where is the router implemented? | Adopt | RD15, RD01: Identify library ownership separately from documentation application code. | RT-E01 |
| RR02 — Where is the docs website application implemented? | Adopt | RD15: Keep website snapshot and framework source independently pinned. | RT-E01 |
| RR03 — Which release is being explained? | Adopt | RD15: Tie claims to 8.5.0 and exact commits; no default-main substitution. | RT-E01 |
| RR04 — Can we prove the website's deployed Git commit or whole hosting topology? | Adopt | RD15: Fly config/headers do not prove the deployed commit or private infrastructure topology. | RT-E01 |
| RR05 — Is this one routing mode? | Adapt | RD01, RD07: Use explicit renderer/data responsibilities; do not clone React's mode names or rendering runtime. | RT-N06, RT-P01 |
| RR06 — Does navigation replace the HTML document body? | Adapt | RD06, RD07: Nested owner trees inform persistence; native destination HTML/state has a distinct adoption adapter. | RT-O01, RT-N01 |
| RR07 — Why does `/teams/new` beat `/teams/:id`? | Adapt | RD02: Adopt specificity ranking as a contract, without copying implementation scores blindly. | RT-U02 |
| RR08 — How do nesting, index and pathless routes work? | Adapt | RD02, RD06: Retain ancestor layout metadata; index leaves and pathless owners have explicit rules. | RT-U02, RT-O01 |
| RR09 — What about optional segments, splats and encoded separators? | Adapt | RD02: Preserve encoded segment boundaries; defer optional-segment expansion and reject unsupported grammar. | RT-U01, RT-U04 |
| RR10 — Is the new route-pattern engine the deployed default? | Reject | RD02, RD15: Do not copy an experimental matcher as the observed default or make Forma depend on it. | RT-U02, RT-E01 |
| RR11 — Which clicks should remain browser actions? | Adopt | RD03: Preserve native click behavior and define delegated HTML-link eligibility fully. | RT-L01 |
| RR12 — Are generated Markdown links handled the same way as JSX Links? | Reject | RD03: Do not copy docs host-only interception; enforce full origin, download and defaultPrevented rules. | RT-L01 |
| RR13 — Why do entries need keys and indexes? | Adopt | RD05: Separate entry key, traversal index and unrelated user history state. | RT-H01, RT-H02 |
| RR14 — When is the URL committed? | Adopt | RD04, RD05: Commit PUSH/REPLACE after preparation; POP already moved and never pushes. | RT-H01, RT-C01 |
| RR15 — How can Back be blocked if popstate cannot be canceled? | Adapt | RD05: Use known inverse/replay deltas for blockers; foreign entries have explicit recovery. | RT-H02 |
| RR16 — Does observing the browser Navigation API mean the router uses it? | Adopt | RD15: Observed Navigation API events do not prove interception by that API. | RT-E01 |
| RR17 — What states must the UI distinguish? | Adapt | RD04, RD10, RD11: Separate committed/pending route, submitting and revalidating state; omit keyed fetcher state in v1. | RT-C04, RT-F04, RT-F06 |
| RR18 — Is AbortController alone enough to avoid stale UI? | Adopt | RD04: Generation identity protects commits from promises that ignore abort. | RT-C01, RT-C02 |
| RR19 — Are loaders always sequential or always rerun? | Adapt | RD11: After mutations revalidate the active branch; do not assume universal parallel loading or unconditional parent reuse. | RT-F05, RT-O03 |
| RR20 — What is an action versus a loader? | Adapt | RD10, RD11: Separate safe GET navigation from POST actions and method-aware redirects. | RT-F01, RT-F09 |
| RR21 — What is a fetcher? | Defer | RD11, RD16: Independent keyed/background fetchers are later scope; one managed mutation is the explicit v1 concurrency boundary. | RT-F04 |
| RR22 — Does request cancellation undo server writes? | Adopt | RD11: Client cancellation cannot roll back server writes; require application idempotency/ordering for stronger semantics. | RT-F07, RT-F08 |
| RR23 — Are error boundaries just 404 pages? | Adapt | RD14, RD06: Route-local errors may preserve compatible ancestor layouts; 404 is only one error class. | RT-X01, RT-O01 |
| RR24 — How are redirects classified? | Adapt | RD14, RD10: Represent redirect metadata explicitly; enhanced mutation replay through 307/308 is not supported in v1. | RT-H04, RT-F09 |
| RR25 — What does Framework mode request over the wire? | Reject | RD07: Do not adopt .data/Turbo Stream as Forma's wire format; use its own versioned typed native response. | RT-N01, RT-N03 |
| RR26 — Does every client loader go through that protocol? | Adopt | RD07, RD10: Browser loaders and application Rust endpoints remain explicit; native rendering alone uses the native navigation contract. | RT-N06, RT-F01 |
| RR27 — Are route discovery, lazy modules and prefetch synonymous? | Adopt | RD09, RD13: Treat discovery, code loading, data fetching and speculation as separate lifetimes. | RT-S03, RT-K01 |
| RR28 — Is lazy manifest discovery enabled on the docs site? | Adapt | RD09: Use initial group metadata/registration; count its complete initial bytes rather than call it lazy discovery. | RT-S03, RT-M01 |
| RR29 — How does generic lazy discovery handle stale releases? | Adapt | RD08: Use explicit version validation and bounded recovery; no blanket reload loop or inherited discovery guarantee. | RT-S02, RT-X02 |
| RR30 — Is loader reuse a universal data cache? | Adopt | RD13: Loader reuse is not a universal private data cache; retain clear keys/lifetimes and no-store boundaries. | RT-K01, RT-K02, RT-S05 |
| RR31 — What survives route changes? | Adapt | RD06: Common route owners may persist, but Forma must prove actual DOM identity and cleanup under its own runtime. | RT-O01, RT-O02 |
| RR32 — What makes deep links work? | Adopt | RD03, RD07: Every admitted deep link must have a meaningful server response. | RT-N05 |
| RR33 — How is scroll restored? | Adapt | RD12: Entry-key scroll and page lifecycle are explicit, including hashes and no-reset behavior. | RT-A02, RT-H03 |
| RR34 — Does the router automatically solve focus and announcements? | Adopt | RD12: Focus/live announcements remain specified and tested rather than assumed from routing. | RT-A01, RT-A04 |
| RR35 — Are React transitions and browser View Transitions the same thing? | Defer | RD12, RD16: View-transition animation is optional polish after correctness; React scheduling is not a Forma dependency. | RT-A03 |
| RR36 — Can SSR data be ignored and everything fetched again? | Adapt | RD07, RD08: Initial typed SSR state is authoritative for adoption; do not refetch/remount away its guarantees. | RT-N02, RT-N04 |
| RR37 — How much did REA parse? | Adopt | RD15: Retain 6 parsed files, two successful runs and timed-out entry evidence as scoped static analysis. | RT-E01 |
| RR38 — Did REA recover the complete route tree and state machine? | Adopt | RD15: Use inert manifest/source to explain actual route structure; generic favicon candidates are not routes. | RT-E01 |
| RR39 — What was actually tested? | Adopt | RD15, RD16: Historical Chromium/example tests are not upstream, performance or cross-browser qualification. | RT-E01, RT-A05, RT-M02 |
| RR40 — What is the smallest useful reconstruction? | Adapt | RD16, RD07, RD10: Use the coordinator scaffold, but first release must also satisfy native integration and enhanced-form requirements. | RT-N01, RT-F01, RT-D01 |

## Research questions superseded by product decisions

The historical Forma adaptation note asks whether native full-document navigation is acceptable and whether this is merely a website improvement. FORMA-301 and the accepted plan answer both: the public stack feature must support smooth typed native transitions, persistent layouts and enhanced forms. The original note remains a dated research snapshot; it must not be used to downgrade the ticket. Its site source `919af…` and the ticket’s later `c69fa…` observation are distinct evidence, neither an assertion about the current release.

The native group bootstrap, fresh scoped adoption, nonce-independent policy identity and Rust action representation are **Forma design proposals**, not capabilities proven by REA. They need the proof cases in the acceptance matrix. No first-release claim is permitted until their actual artifacts pass.

## Closure rule

Every question has a disposition, decision owner and at least one acceptance/evidence check. Deferred features remain named scope boundaries. A runtime test is marked passed only with exact source/artifact identity, command, engine/toolchain, raw result and limits. The factory can complete a proposed design without claiming the ticket’s implementation is complete.
