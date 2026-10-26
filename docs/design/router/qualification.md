# FORMA-301 qualification ledger

2026-10-26. This ledger maps every one of the **57 frozen RT IDs** to current
implementation evidence or an explicit remaining gate. It does not edit
[the design acceptance matrix](acceptance-matrix-design.md), and a row pointing
to source tests is not a claim of complete packed-release qualification.

The latest retained native browser campaign is [N]: **90 successful scenarios**
across Chromium, Firefox and WebKit, with actual Rust responses and compiled
native owners. Its receipt binds its own source and artifact hashes. The later
two router guards for offline speculation and disposal inside the permission
callback are source-tested in the **90-test router suite**; they were added after
that browser artifact. The independent portal pilot [P] has **18 successful
scenarios** against actual packed core/router archives and real site pages.

**Evidence labels:** `source` means focused implementation tests; `browser` means
actual integrated behavior under the recorded artifact; `packed` means a stated
archive boundary was exercised; `partial` names the remaining part of a frozen
row. Exact-source CI, Linux/macOS/Windows qualification, the full packed P17 and
candidate scaffold lane, release performance gates and manual accessibility
remain separate requirements. Existing failed runs are retained beside later
passes. A local passing subset does not authorize publication.

## Evidence index

| Key | Evidence and scope |
|---|---|
| R | [Router tests][R]: matcher, coordinator, browser adapter, native admission and generated-HTML transport. Includes real cleanup reentrancy and ignored-abort negative controls in [mutation receipts][MU]. DOM-unit transport doubles are explicitly distinct from N. |
| C | [Core owner tests][C] and [original authority tests][CA]: original-document partition, exact captured hosts/outlets, detached preparation, deferred revocation and adoption failures. Full core suite: 245 files / 4,326 tests; unchanged default delivery caps. |
| S | [Native owner server tests][S], [action/policy tests][SA] and [manifest capability tests][SC]: typed owner/state contracts, statuses, sealed policy and opt-in admission. |
| B | [Build group tests][B] and [compiler owner tests][BC]: actual registered products, fixed empty outlets, closed executable graphs, output admission and size classification. |
| N | [Native final recovery campaign][N] (90/90), [history repair campaign][NH] (9/9), and the [actual runner][NR]. Source integration using the public compiler/build/core/router/server APIs; not a whole P17 run or manual gesture review. |
| G | [Packed router proof][G], [package inventory tests][GI], [seed/sealing tests][GS], [candidate scaffold controls][GC], and [N8 controls][GN]. Core/router archive resolution and the website pilot exercise real package bytes. These do not constitute a complete eight-archive P17/scaffold receipt. |
| T | [Native starter][T] and [shared browser verifier][TV]. The local source-linked release-server starter passed Chromium/Firefox/WebKit; the same verifier is mandatory in packed P17. Full packed starter and Linux N8 execution remain release qualification. |
| P | [Real site pilot][P]: 18/18 browser scenarios, package/document hashes, original-build rollback authentication, unchanged private checkout and [failed-attempt record][PA]. Only `/project/` and `/releases/` are enhanced. |
| V | [Actual published-reader receipt][V] and [reproducer][VR]: immutable v3.1.0 source, three executed manifest-admission cases, including future-writer refusal before binding. No generated production artifact or package version is changed. |
| M | [Paired size receipt][M] and [measurement source][MS]: complete graph, source/artifact hashes, prior published core baseline and unchanged numerical gates. Earlier wrong-class/over-budget attempts remain recorded. Browser timing/memory evidence is tracked separately below. |

## Required scenario disposition

| ID | Evidence | Proven scope and remaining requirement |
|---|---|---|
| RT-E01 | Design; [research manifest][RM], [research map][RQ] | All 49 snapshot files were rehashed successfully. The preserved map accounts for 105 questions (25 Angular, 40 Astro, 40 React Router), immutable pins, attributed excerpts/licenses and bounded/failed REA work. Source inspection is not upstream test execution. |
| RT-P01 | Packed/source: G, P | Actual packed router resolves public `core/navigation`, exports/types and nested matches; the pilot installs candidate archives in a separate dependency graph. Full clean outside-repository consumer install and explicit duplicate/incompatible-core installation matrix remain required; peer metadata alone is not that proof. |
| RT-P02 | Source/actual old reader: SC, V | Feature-disabled current readers reject reserved `navigation` metadata before binding, including null/malformed declarations; unrelated forward fields remain accepted. Enabled readers preserve schema/writer guards. Actual published 3.1 accepts old/equal/patch writers and rejects 3.2. Coordinated future-minor version preparation is mandatory; see the caveat below. |
| RT-P03 | Source/build/process: B, GI, GS | Only declared groups receive router output; ordinary and static routes retain their classes. Eight-package feature candidates and future releases include router; historical 3.0/3.1 records remain seven packages/two starters. Exact final packed no-JS/non-opt-in outputs remain P17 gates. |
| RT-U01 | Source/browser: R, N | Encoded slash is decoded after splitting; malformed percent escapes refuse; repeated queries and null-prototype parameter maps are exercised. Managed GET uses platform query encoding. Exhaustive combined plus/fragment/prototype round-trip vectors remain broader release coverage. |
| RT-U02 | Source: R | Static/parameter/splat ranking, complete branch ownership, duplicate/ambiguous grammar and scoped params are tested. Index/pathless behavior is implemented; expand explicit compound index/pathless/full-consumption vectors before claiming the entire frozen row. |
| RT-U03 | Source/browser: R, NH | Pending POP cursor repair is exercised for imperative navigation, revalidation, foreground verification and POST; generated URLs use the committed view. The full non-root-base relative/root/fragment matrix remains a separate test obligation. |
| RT-U04 | Source: R | Unsupported grammar, malformed encodings and route count/depth are refused. Current limits are 1,000 definitions and depth 32; no optional/named-outlet/matrix expansion is implemented. |
| RT-U05 | Source/browser: R, N | Same-URL cancellation, explicit revalidation, query transitions and fragment-only history/ownership are exercised. Revalidation preserves visit identity; a newer navigation cancels older preparation. |
| RT-H01 | Source/browser: R, N, NH | Actual PUSH/REPLACE/POP, retained unrelated state, distinct visit keys and pending traversal repair are tested. Redirected POP replaces its destination address without pushing. Packed/browser repetition remains required. |
| RT-H02 | Source/browser, partial: R, NH | Known traversal compensation and its serialization barrier are tested, including superseding pending POP. Foreign state has explicit document recovery. The full real unsaved-form blocker/replay and foreign-entry sequence matrix is not claimed complete. |
| RT-H03 | Source/browser: R, N | Disposal restores scroll restoration and removes owned handlers; immediate disposal cannot initialize. Foreground and persisted-pageshow invalidate or verify context, with actual document boundaries. Manual BFCache eligibility/gesture behavior remains platform qualification. |
| RT-H04 | Source/browser, partial: R, N | Typed GET redirects reach one final route; redirected POP updates address and keeps its key. Hop/cycle limits and disallowed destinations are implemented. Every external/out-of-base/relative redirect variant still needs the packed negative matrix. |
| RT-L01 | Source/pilot, partial: R, P | Real anchors, target/download/opt-out/modifier policy and document boundaries are implemented; existing target behavior and bounded pilot destinations are exercised. A comprehensive native mouse/composed-shadow-path/modifier matrix remains unclaimed. |
| RT-C01 | Source/browser: R, N | Held GET A then B, ignored abort, late candidate/error disposal and stale title/URL/layout prevention are exercised. The current navigation owns pending state. |
| RT-C02 | Source/core/browser: R, C, N | Late detached candidates dispose, deferred moved/departed hosts cannot activate, explicit context revocation prevents a stale response reacquiring owners. Groups use an already verified eager asset set; dynamic cross-route stylesheet preparation is outside this admitted profile. |
| RT-C03 | Source with mutation controls: R, MU | Commit reentry queues only the latest destination. Cleanup that disposes or invalidates cannot repopulate a root; validator callbacks cannot authorize a superseded commit. Removing the authority check makes the regression fail. |
| RT-C04 | Source/browser, partial: R, C, N | Readiness distinguishes detached preparation, synchronous ownership transfer and immediate activation; deferred work remains separately cancellable. Committed/cancelled/blocked/failed/document-navigation outcomes exist. Exhaustive one-settlement observation for every error branch remains release coverage. |
| RT-O01 | Source/browser: C, N, T | Native A-B-A retains actual layout island nodes/input/selection while replacing and disposing the leaf; browser owners dispose child before parent. Repeated full-branch identity reuse is tested. |
| RT-O02 | Browser/core, partial: C, N | 100 actual native route cycles preserve the layout and leave departed click handlers inactive; deferred jobs and throwing observer cleanup have focused controls. This does not count every global listener/effect/observer/timer/worker class under cancellation/failure cycles. |
| RT-O03 | Source/browser: S, R, N | Server-derived reuse/props digests and layout/context identity determine the common prefix; changed typed props replace the owner, not merely its markup. Context changes revoke persistent owners. |
| RT-N01 | Browser: N | Two actual typed Rust routes with distinct islands navigate A-B-A by link/API, retaining Document/layout identity, fresh props and interactive destination adoption. No reload is counted as normal-transition success. Whole packed repetition remains P17. |
| RT-N02 | Core/source/browser: C, CA, R, N | Original claims stay frozen; owner contexts capture exact hosts/outlets before assembly; child insertion cannot expand authority. Retained incoming duplicate claims do not reauthorize retained hosts. |
| RT-N03 | Source/browser: C, S, R, N | Invalid schema/state, duplicate/moved ownership, wrong transport identity, missing registration and initial/final 200-island bounds refuse admission. Actual malformed scoped state refuses before activation and triggers one document recovery. |
| RT-N04 | Core/browser: C, N | Initial native nodes survive adoption; early input and scheduled readiness are exercised; removed deferred owners cannot activate. Outlet identity remains fixed through move/rename/marker mutations. |
| RT-N05 | Browser/server: S, N, T | Actual direct requests, refresh and no-JS links/forms return typed server HTML and fresh props. Starter also verifies no-JS navigation. Packed status and direct-route qualification remain separate. |
| RT-N06 | Source/packed pilot: R, P | Browser adapter refuses server-marked roots. Registered generated HTML authenticates full documents and parses only the marked region; native state, executable/custom-element/shadow claims are refused. Real two-page portal uses packed packages without replaying head scripts. |
| RT-S01 | Server/browser: S, N | Same sealed policy with fresh response nonces is admitted; changed effective profile causes an explicit document boundary. Missing sealed profile or changed action set refuses. Applications must attest final middleware/proxy policy; no production proxy audit is claimed. |
| RT-S02 | Build/source/browser: B, R, N | Initial and incoming app/build/group/profile/assets tuples are checked. A separately compiled second build causes a document boundary. Ordinary successful cases assert the same Document. |
| RT-S03 | Build/browser: B, N | Registration-only group output has a closed executable graph and one integrity-bearing entry; external/dynamic unverified imports and unsupported entry/watch shapes refuse. Native browser tests run that actual emitted group. |
| RT-S04 | Source/browser: R, S, N | Lexical and parsed admission reject executable/resource/custom-element/shadow markup before active-document import; hostile registered constructors never execute. Actual strict policy/islands remain interactive. Generated HTML permits ordinary external anchors only after document verification. |
| RT-S05 | Source/browser, partial: R, S, N | no-store response admission, explicit context revocation, held stale reads/checks, BFCache and foreground barriers are exercised. Private completed HTML cache capacity is zero. Cross-tab plumbing exists, but a real multi-tab principal/session-change campaign remains required. |
| RT-S06 | Source/browser, partial: R, C, S, N | Byte/depth/owner/route limits, ignored-abort deadlines, two speculative requests and bounded recovery are tested. 1,000 scroll entries, 32 recovery keys and 60 writes/10 seconds are implemented; all boundary combinations and allocation/time denial controls are not yet fully measured. |
| RT-F01 | Server/browser: S, N | Real handlers support native/enhanced GET and POST; known mutation settlement refreshes typed props and no-JS remains usable. Multipart application handler qualification is not established by the URL-encoded fixture. |
| RT-F02 | Source/browser, partial: R, N | Native FormData serialization, GET queries, competing formdata reentry and serialization-time disposal are exercised. Full real file/multipart, submitter override, disabled controls and controls named submit/method/action matrix remains required. |
| RT-F03 | Source/browser, partial: R, N | Validation retains entered safe values, exposes/focuses the summary, preserves history and never repeats the action. Manual screen-reader field-error announcements and all field-level error patterns remain open. |
| RT-F04 | Source/browser: R, N | One mutation slot returns busy for competing submissions; distinct-form synchronous formdata reentry cannot transmit twice, and disposal during serialization prevents transmission. Nothing queues/replays a POST automatically. |
| RT-F05 | Source/browser: R, N, NH | Mutation generations invalidate prior reads/speculation; held newer GETs are restarted after known settlement without losing their destination. POST/revalidation repair a pending POP cursor before reading the committed branch. |
| RT-F06 | Source/browser: R, N | Navigation can complete during POST; late redirects/validation cannot steal the new route, and known settlement refreshes the current/pending destination. Applications still own read-after-write consistency across replicas. |
| RT-F07 | Source/browser: R, N | Lost/invalid/aborted action responses cause one-send visible uncertainty; GET/reload does not clear it. No automatic native POST fallback occurs. Only explicit application status/idempotency evidence can resolve uncertainty. |
| RT-F08 | Server/browser, partial: S, N | Real fixture CSRF refusal, declared endpoint restrictions, stale-context refusal and auth response revocation are exercised. The framework does not provide a production session/authorization system; its consuming application's security review remains required. |
| RT-F09 | Source/server/browser: R, S, N | Explicit typed 303 becomes one GET; automatic fetch redirects are disabled. Undeclared/unsupported forms escape before transmission. A full real-server 307/308 replay-refusal matrix remains release coverage. |
| RT-F10 | Source/server, partial: R, S | Endpoint/context/policy/action-set and transport/envelope status mismatches refuse UI admission; validation/error/redirect statuses remain distinct and 401/403 revoke private owners. Browser conflict/500/503 and all incompatible-action variants remain broader qualification. |
| RT-X01 | Source/server/browser: R, S, N | Admitted typed404 and GET redirect are exercised; server tests retain typed error status. Wrong media, malformed data and network failures follow explicit refusal/recovery rather than synthetic not-found. Complete offline/error-boundary browser matrix remains open. |
| RT-X02 | Browser/pilot, partial: N, P | Policy/build/state/hostile-markup and generated-document mismatches perform bounded method-safe document recovery; normal cases explicitly require no reload. A catalog asserting exactly one GET and state loss for every documented recovery code remains required. |
| RT-A01 | Browser/pilot, partial: N, P | Title, summary focus, heading focus and retained input selection are observed; pending/status plumbing is implemented. Independent screen-reader announcement and error UX acceptance remains manual. |
| RT-A02 | Browser/source, partial: N, R | Real entry-key scroll, Back/Forward, hash/query transitions and retained focus are tested. Full encoded/empty-fragment and stale deferred scroll callback matrix remains unclaimed. |
| RT-A03 | Browser/profile: N, P | Recorded runs use reduced motion and require no View Transitions implementation. Same-group CSS is part of the admitted immutable asset tuple; changed asset/policy takes a document boundary. Dynamic cross-route CSS preparation/transition choreography is not an admitted v1 capability. |
| RT-A04 | **Open manual gate** | No keyboard-only/screen-reader/mobile gesture session is claimed. Review actual native mutation, validation, pending/completion announcements and recovery UI with assistive technology before release acceptance. |
| RT-A05 | Browser, partial: N, P, T | Native/forms/history/lifecycle run in three engines at 390×844; portal pilot and native starter also run in all three. Automated viewport/input is not a physical-device gesture check or full packed browser matrix. |
| RT-K01 | Source: R | Native/private speculation is off by default; explicit safe-read opt-in is bounded to two requests, honors save-data/offline and keeps no completed candidate cache. Final permission-callback disposal/offline guards have source tests after the recorded native artifact. |
| RT-K02 | Source, scoped: R | Navigation can claim existing in-flight work; unrelated speculation cancels, failed/completed attempts release and retry freshly, mutation/context changes revoke ownership. This is one foreground navigation plus speculative ownership, not the deferred independent keyed-fetcher API. |
| RT-M01 | Measured source build: M | Paired complete consumer graph includes shared-core growth; group and ordinary route gates remain distinct, with frozen 12 KiB increment and 64 KiB complete-group limit. Source/artifact-bound receipts retain failures. Remeasure the final release archives; local bytes do not replace P17. |
| RT-M02 | **Pending independent measurement** | A fixed native cold/warm navigation versus document baseline runner is being prepared. Do not promote earlier functional timings or the portal gzip comparison to this percentile/sample/profile gate. Require the final raw measurement receipt before closing. |
| RT-M03 | Partial deterministic evidence: N | The 100-cycle departed-handler check is real. No browser heap observations or complete tracked-resource baseline campaign is claimed here; pending memory measurement must retain raw samples and distinguish noisy heap data from deterministic cleanup. |
| RT-D01 | Source-linked starter + packed subchecks: T, G, P | Complete native-router starter builds/runs locally and its three-engine helper passes. P17 and the candidate lane require it, preserve 24 heavy cases and add the unchanged Linux N8 limits. Execute the documented full starter from the sealed eight-archive candidate outside the repository before closing this row. |
| RT-D02 | Local packed pilot: P | Actual site pages use a bounded allowlist; a same-build registry authenticates generated HTML. Atomic rollback authenticates/restores the original browser build and navigator; homepage/native-lab links keep document navigation. No Rust server migration or OVH/proxy deployment occurred; production co-deployment rollback remains its own operational gate. |

## Writer/reader result and release consequence

The published 3.1 reader predates `navigation` metadata and ignores unknown route
fields. That behavior is retained as an **explicit observed limitation**, not a
pass for capability admission. Local development candidates still labeled 3.1
cannot be used to prove old consumers understand the new feature. The actual
old-reader control sets only a copied test manifest's writer to the planned 3.2
minor; the immutable old reader refuses it with `MANIFEST-102` before any bind.
Normal future-minor version preparation must produce that boundary before a new
public release. No version bump was performed by this task.

Independently, a new reader compiled without the feature previously dropped the
reserved field, even at a future matching version. The current raw-manifest guard
fixes that case with `MANIFEST-103` before deserialization loses the metadata.
It does not add a private field to public `RouteAssets` literals or reject all
unknown future metadata. [Default/all-feature, debug/release and Rust 1.85 checks](evidence/navigation-capability-delta.json)
cover this delta; the isolated old reader keeps the original minor/patch rules.

## Remaining acceptance, without relabeling evidence

The partial cells above remain partial even when a related source test passes.
Before publication, run the complete exact-source candidate/P17/platform lanes,
final archive size/performance and N8 gates, manual assistive-technology/gesture
review, application-specific session/CSRF/proxy-policy review, trusted-publisher
and registry-monitor enrollment, and the normal release/soak decision. The
implementation, bounded local pilot and release tooling can be reviewed now;
there is no claim that all 57 full qualification rows are closed.

[R]: ../../../packages/router/tests/
[MU]: evidence/mutations.json
[C]: ../../../packages/core/src/dom/__tests__/native-owner.test.ts
[CA]: ../../../packages/core/src/dom/__tests__/navigation-adoption.test.ts
[S]: ../../../crates/forma-server/tests/navigation_owners.rs
[SA]: ../../../crates/forma-server/tests/navigation.rs
[SC]: ../../../crates/forma-server/tests/navigation_capability.rs
[B]: ../../../packages/build/tests/navigation-groups.test.ts
[BC]: ../../../packages/compiler/tests/navigation-registration.test.ts
[N]: ../../../experiments/forma-router-native/evidence/browser-final-recovery-sync.json
[NH]: ../../../experiments/forma-router-native/evidence/browser-history-final.json
[NR]: ../../../experiments/forma-router-native/browser.mjs
[G]: ../../../scripts/release-router-package.test.mjs
[GI]: ../../../scripts/release-package-inventory.test.mjs
[GS]: ../../../scripts/template-lock-seeds.test.mjs
[GC]: ../../../scripts/candidate-scaffold.test.mjs
[GN]: ../../../scripts/n8-size-start.test.mjs
[T]: ../../../packages/create-app/templates/native-router/
[TV]: ../../../scripts/release-template-navigation.mjs
[P]: ../../../experiments/forma-router-site-pilot/evidence/browser-three-engine-final.json
[PA]: ../../../experiments/forma-router-site-pilot/evidence/attempts.json
[V]: evidence/published-reader-compatibility.json
[VR]: ../../../scripts/navigation-reader-compatibility.mjs
[M]: ../../../experiments/forma-router-native/evidence/size-v3.json
[MS]: ../../../experiments/forma-router-native/measure-size.mjs
[RM]: research-manifest.json
[RQ]: research-map.json
