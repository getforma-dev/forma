# FORMA-301: 3.2 candidate qualification

Observed **2026-10-27 UTC**. The release and gate statuses below describe this
checkpoint; later outcomes require their own evidence.

The coordinated source is prepared as **3.2.0-rc.1**. It has not been published,
and these results do not approve a stable release or a production deployment.
This supplement records later evidence for the same **57 frozen RT IDs** without
changing [the design acceptance matrix](acceptance-matrix-design.md) or rewriting
[the historical feature ledger](qualification.md).

## Evidence boundaries

The first completed native and supplementary campaigns below measure source
`862d18dc1e2eb06f9b7f947cc22f020d6fa646e9`, DS11 SHA-256
`db107da977429f6df8d323b96f19b3dc111f5df3d018ae4122cc314589db26d7`.
All eight package archives are authenticated; the native fixture executes the
installed npm products and packed Rust crates. Chromium 156.0.8078.4,
Firefox 157.0 and WebKit 27.2 are the recorded engines. Packing, native90 and size
use Node 24.22.0; the resource and API/model harness receipts record 24.22.1.
Those distinct tool identities are retained.

The later `4c59db070575591c1e4be300bafb5c07552970fa` commit changes six reviewed
monitor/documentation files. Independent comparison found the other 4,993
tracked entries unchanged, including product, build and existing oracle inputs.
That supports the applicability of unchanged-product evidence; it does **not**
make new archive bytes identical or turn an old run into a current-source run.
Fresh 4c59 pack authentication records DS11
`573866aafb8bfebbf3a0f50eea9dbf4d24deb95d5ce28d8d58468b4c0f212869`.
A fresh native90 campaign (N4) separately passes against those exact archives,
with no source/artifact drift and complete cleanup. Every archive member was also
compared with 862d (EQ4): core/compiler/build/router archives are byte-identical;
the remaining crate and CLI differences are exact Git provenance and the
corresponding Forma archive checksum cascade, with dependency versions unchanged.
The fresh current paired-size replay (M4) also passes at 12,287 B incremental and
40,715 B whole-group gzip against the unchanged ceilings, linked to N4 and its
eight original archives. The [complete hosted P17](https://github.com/getforma-dev/forma/actions/runs/40423336544)
remains pending. All five current 4c59 pull-request CI planes pass: full CI
(including the Windows candidate starter), three-engine E2E, budgets, scaffold
release cache and security mutation probes. These are current branch results,
not future main/tag CI or the separate full Nightly mutation campaign.

The [machine-readable evidence index](evidence/acceptance-3.2.json) records exact
raw receipt paths, SHA-256 hashes, scopes and all 57 row dispositions. Raw local
campaigns remain under `qualification/ecosystem` beside this checkout; a path or
summary is not represented as a publicly hosted artifact. `N4` and `N32` are separate actual native
Rust integrations. `H32` and `O32` are public BrowserAdapter consumers with
controlled outcomes/faults. `L32`/`LS32` are API/model checks; `LB32` uses real HTTP
and browser clocks with synthetic native protocol responses. These scopes are
not interchangeable.

## Completed observations

| Evidence key | Actual result | Scope limit |
|---|---|---|
| N4 / N32 | Separate 4c59 and 862d campaigns each pass 90/90 native cases across three engines; no input/output drift; owned processes stopped | No screen reader, physical device or production claim |
| M4 / M32 | Separate current and earlier archive measurements each report 12,287 B incremental gzip; 40,715 B whole group | Unchanged 12,288/65,536 B ceilings; one byte incremental headroom |
| H32 | 117/117 URL/history/blocker/redirect/click cases across three engines | Actual BFCache restoration remains unobserved |
| O32 | 1,500 ownership cycles and 18 causal negative controls | Tracked application resources, not a global/native-worker leak proof |
| L32 / LS32 | 44 API/model limit cases and two corrected scroll-bound regressions | HappyDOM, fake clock/simulated POP and diagnostic instrumentation are explicit |
| LB32 | 45 real-browser/HTTP recovery/clock cases across three engines | Synthetic protocol admission is separate from Rust/proxy attestation |
| PF32 | Four fixed timing cells pass; bounded heap observation retained | Document-control comparison; no physical-device or global leak claim |
| SK32 | 54/54 scroll/prefetch checks: 48 positive assertions and six causal negatives | Public HTML adapter, controlled readiness/action admission, actual browser coordinates |
| CI4 | Five current 4c59 PR CI planes pass, including platform starters | Future main/tag CI, whole P17 and full Nightly mutation remain separate |
| MAC32 | User confirms the six Mac keyboard/VoiceOver/Reduce Motion tasks: “ok done all good” | No per-step notes; iPhone and genuine BFCache remain pending |
| ASC32 | 90/90 strict-CSP native action/security cases, including all 15 new form/error assertions | Actual fixture handlers; not production authorization or proxy acceptance |
| ADF32 / PEER32 | Separate duplicate-core diagnostic 3/3 and strict-peer lock-only resolution 2/2 | Diagnostic CSP exception is separate; peer resolution is not another full install |
| AS8 | Earlier 8ee: 75 sealed-profile cases, three separate duplicate-core diagnostic cases and peer-resolution controls | Historical product identity, preserved after the separate complete ASC32 replay |

N32 uses actual Document, layout and island object identities plus main-frame
request counts. A real HTTP reload must fail the retention oracle. The earlier
988 campaign remains 89/90 failed; its WebKit clock-conversion diagnosis did not
rewrite that result. The separate 8ee manual-preview staging incident also
remains recorded: an original fixture binary was overwritten after measurement,
and no successful byte-for-byte restoration was claimed. N32 uses a fresh,
isolated target and its retained binary was independently authenticated.

O32 runs 100 cycles per engine for normal navigation, preparation cancellation,
activation cancellation, setup failure and post-commit failure. It observes
application effects/listeners, Resize/Intersection/Mutation observers, timers,
Workers and pending activations. Baselines return after settlement and disposal;
omitting cleanup makes the negative controls fail. These deterministic counts
remain separate from the bounded heap observation below.

The finite fallback catalogue combines fresh Rust, real-HTTP and model witnesses
for the documented recovery categories. It distinguishes one method-safe GET
with local state loss from journal/storage refusal with zero automatic GET.
It does not claim every internal error string was separately exercised. The
1,000-entry scroll bug and callback-failure path are corrected; both installed
regressions pass without raising the bound.

## Supplemental scroll, prefetch and action status

SK32 passes 54 checks in the three engines: 48 positive assertions and six causal
negative controls. It observes actual encoded/empty-fragment positions and proves
older delayed readiness cannot scroll or focus a newer view. Real HTTP cases
exercise one-GET shared in-flight claiming, retry after failure, no completed
reuse, actual POST invalidation and accepted/rejected context checks. Save-data
is an explicit navigator.connection property control; offline uses real browser
network emulation. Its custom application action admission tests coordinator
behavior rather than native Rust wire policy. The first fixture attempt remains
13 passed/one failed because its custom action endpoint omitted `Vary: Accept`;
the router correctly refused that response before the corrected complete replay.

The fresh sealed action/security campaign passes **90/90** with strict CSP
unchanged, including all 15 added F02/X01 assertions: constraint-validation
zero-send behavior, a genuine submitter URL/method override, and typed GET
410/500/503 boundaries. The first 89/90 campaign and unchanged focused failure
remain preserved. Independent evaluations found zero active owners while the
external driver's default rAF polling stalled during deliberately held WebKit
document navigation. Changing only that external polling to 25 ms, with the same
20-second deadline and safety assertions, produced a full 90-case pass. No
framework runtime, fixture application or fixed framework harness changed.

Separate final duplicate-core diagnostics pass 3/3; their CSP header removal is
confined to those diagnostics. Offline strict-peer **package-lock-only resolution**
passes both compatible and incompatible controls, the latter refusing with
ERESOLVE. These commands are not a second full installation. The native proof
separately authenticates actual installed runtime/public exports. Original failed
attempts, exact commands and scope-specific execution bindings are retained.

## Current timing and heap observation

PF32 authenticates the separately staged installed npm products and all three
packed crates executed by the unchanged fixed runner. Each direction and mode
retains 30 warm samples after five warmups. Maximum conservative commit p95 is
0.5 ms in desktop Chromium, 3 ms in Firefox and 1 ms in WebKit, against 16 ms.
Chromium at four-times CPU slowdown and the fixed mobile network profile measures
3.10 ms against 50 ms. No samples or outliers are removed. Three cold entries per
route/mode are descriptive; two requestAnimationFrame callbacks measure scheduling,
not compositor paint or physical-device performance.

Chromium used heap changes from 2,132,376 to 2,392,492 bytes (+260,116) after
10 warmups, 100 transitions and two bounded GC requests. History intentionally
grows; no leak threshold or global zero-leak conclusion follows. No other
agent-owned browser/build workload ran during timing, while ordinary host
processes and AC power state remain recorded. Source/artifact drift checks and
owned-process cleanup pass. The first attempt failed before measurement because
`dist-next` was missing; its receipt is preserved. The unchanged application
build supplied those files before the successful complete second attempt.

## Retained hosted qualification failure

The [862d P17 run](https://github.com/getforma-dev/forma/actions/runs/40421106022)
remains **failed: 70 of 71 reached checks passed**. N1's 300-node shape measured
3,164,657.78 nodes/s, below the strict greater-than-half predecessor floor of
3,383,518.40 nodes/s. All five shapes exceeded the absolute 1.5 million floor,
but that does not satisfy the relative floor. Cleanup completed without remaining
owned processes.

The failed run recorded an AMD EPYC 7763; the published 3.1 baseline and the
[earlier d3 75/75 P17 run](https://github.com/getforma-dev/forma/actions/runs/40418844218)
recorded EPYC 9V45. The d3/862d producer and input comparisons support hardware
variation as a possible explanation, not a controlled causal proof. No hardware
normalization, threshold change or result substitution is applied. A new current
whole-P17 pass must stand on its own.

## Disposition of the 57 frozen requirements

Each row states observed scope and remaining work. An observed scenario is not
an independent closure of the release, manual, application or operational gates.
Historical/source keys refer to the unchanged links in the previous ledger.

| ID | Evidence | Observed scope | Remaining requirement or limit |
|---|---|---|---|
| RT-E01 | historical-design | The frozen research manifest/map retains 105 questions, 49 snapshot files, immutable upstream pins, licenses and failed/bounded REA attempts. | Source inspection remains distinct from upstream execution; preserved research is not re-certified as a new browser run. |
| RT-P01 | N4, N32, ADF32, PEER32 | N4/N32 install isolated public exports and one Cargo identity per Forma crate. Offline strict-peer lock-only resolution accepts compatible packages and refuses published 3.1 core with ERESOLVE; all engines refuse an independent duplicate core while the original succeeds. | Peer-resolution commands are not a second full install. Duplicate-core diagnostics remove CSP only in separate contexts; strict-policy behavior is qualified independently by ASC32. |
| RT-P02 | historical-compatibility | Actual published 3.1 reader refuses the planned 3.2 writer before binding; the feature-disabled new reader rejects reserved navigation metadata. Prepared package versions are now 3.2.0-rc.1. | The historical reader receipt keeps its own identity. Current coordinated archive/platform qualification is still required. |
| RT-P03 | N4, N32, PACK4, CI4 | Optional groups, no-JavaScript behavior and current eight-package/three-starter inventory retain source and packed fixture coverage. Historical 3.0/3.1 inventory remains seven packages/two starters. | Current 4c59 PR platform/starter CI passes; complete hosted P17 remains pending. A successful pack or platform lane does not substitute for whole P17. |
| RT-U01 | H32 | Real browsers exercise encoded slash/Unicode, repeated keys, plus versus space, prototype-like parameters and malformed encoding refusal. | The declared grammar/profile is covered; no new grammar or universal URL-normalization claim is made. |
| RT-U02 | H32 | Real browsers exercise static/parameter/splat rank, pathless/index branches and complete child consumption; existing source tests retain duplicate/ambiguous grammar refusals. | No optional, named-outlet, matrix or regex expansion is admitted. |
| RT-U03 | H32, N4, N32 | Relative, root-relative, fragment and imperative links under a non-root base resolve from the committed view during a pending POP. N32 covers POP repair before revalidation and mutation. | The d3 fix and prior failing controls remain preserved; current H32 is a complete 117-case pass, not selected results from failed attempts. |
| RT-U04 | H32, L32 | Malformed/out-of-base input refuses before commit; API/model controls cover route count 1,000 and depth 32 at the boundary. | Route-boundary models are identified as models, not actual Rust transport or resource-allocation benchmarks. |
| RT-U05 | H32, N4, N32 | Same URL, query, fragment and explicit revalidation have distinct outcomes; fragment navigation cancels held page work without replacing owners. | Scroll-coordinate coverage for encoded/empty fragments is tracked separately under A02. |
| RT-H01 | H32, N4, N32 | Actual PUSH/REPLACE/Back/Forward, distinct duplicate-URL keys, unrelated state retention, multi-entry traversal and redirected POP are exercised without an extra PUSH. | Physical-device gestures remain under A04/A05. |
| RT-H02 | H32, N4, N32 | Real unsaved-form link/API cancellation and confirmation, known traversal compensation/replay and two foreign-entry forms are exercised; foreign recovery records one document GET. | This is the finite supported history matrix; genuine BFCache restoration is a separate H03 obligation. |
| RT-H03 | H32, N4, N32 | Disposal/reinstall restore scrollRestoration and avoid duplicate handlers; foreground checks and persisted-pageshow dispatch exercise revocation/recovery. | Actual BFCache restoration was not obtained in two bounded browser attempts. Synthetic persisted events and ordinary Back/Forward do not close that gate. |
| RT-H04 | H32, N4, N32 | Relative/internal/external/out-of-base redirects, cycles, hop limit and redirected POP are exercised with final destination semantics. | No intermediate successful UI commit or reused historical success is credited. |
| RT-L01 | H32 | Trusted modified/non-primary clicks, target/download, opt-out/external/unsafe/defaultPrevented links and nested/composed-path anchors are exercised in all three engines. | Engine-specific native behavior is compared with its actual native control; physical gestures are not inferred from automation. |
| RT-C01 | N4, N32, O32, LB32, SK32 | Held GET races, ignored-abort deadline and preparation/activation cancellation preserve the newer view; application resources from cancelled work are released. | SK32 additionally observes stale readiness/scroll and prefetch revocation through public wrappers; source/native/application scopes stay distinct. |
| RT-C02 | N4, N32, O32 | Late preparation/activation faults cannot retain active application resources; actual native context revocation prevents stale owner acquisition. | Groups admit a verified eager asset tuple. Dynamic cross-route stylesheet preparation is outside this version’s capability. |
| RT-C03 | historical-source, O32 | Source re-entry/authority controls and their counterfactual failures remain preserved; O32 checks cleanup across normal, cancellation and fault cycles. | Application wrappers supply O32 faults; that campaign does not replace each source callback control with a native Rust transport claim. |
| RT-C04 | N4, N32, H32, LC32 | Scheduled readiness and finite committed/cancelled/blocked/failed/document-navigation outcomes are observed; the catalogue distinguishes failed recovery from one-GET recovery. | No unbounded all-error-string or universal exactly-once settlement claim is made; the finite catalogue states each tested outcome. |
| RT-O01 | N4, N32, O32 | Real typed A-B-A retains layout node/input/selection identity while replacing interactive leaf islands; departed owner work is released. | BrowserAdapter resource ownership and native owner adoption are separate authenticated witnesses. |
| RT-O02 | N4, N32, O32 | Each engine runs 100 cycles of normal navigation, preparation cancellation, activation cancellation, setup failure and post-commit failure: 1,500 total. Effects, listeners, three observer classes, timers, workers and pending activations return to baseline; 18 omitted-cleanup controls fail as intended. | These are tracked application resources with explicit cleanup in the BrowserAdapter profile, not a universal global leak or native-worker transport proof. |
| RT-O03 | N4, N32, ASC32 | Typed props/context and layout identity drive native owner replacement; the fresh native application campaign adds real auth/session outcomes. | Production application context and read-after-write consistency remain distinct obligations. |
| RT-N01 | N4, N32 | Two actual typed Rust routes and distinct islands pass A-B-A link/API navigation with the same Document/layout and freshly adopted interactive leaves. | N4 separately measures the authenticated 4c59 archive set; earlier N32 retains its 862d identity. These native campaigns do not replace whole P17. |
| RT-N02 | N4, N32, historical-source | Malformed scoped state refuses activation; source ownership controls preserve original claims, captured outlets and deferred/departed-host authority. | The source controls are not relabeled as new browser cases. |
| RT-N03 | N4, N32, L32, LB32 | Actual Rust malformed-state refusal complements installed-API state/body/owner/island bounds and real-HTTP schema/media/asset negatives. | Synthetic native HTTP admission controls do not attest Rust PageResponse or deployed proxy headers. |
| RT-N04 | N4, N32, historical-source | Scheduled readiness preserves original served nodes and early input; source deferred-owner controls prevent later activation after revocation. | Initial-adoption and deferred-authority source controls keep their own evidence identity. |
| RT-N05 | N4, N32 | Direct URL, refresh and JavaScript-disabled native forms return meaningful typed HTML and fresh props. | Current starter/platform P17 and production direct-route checks remain separate. |
| RT-N06 | LB32, historical-source, historical-site | Browser/generated-HTML boundaries, unregistered HTML and adapter switching recover explicitly; historical source/pilot controls refuse native state or executable claims in the HTML adapter. | The full updated consuming-site campaign with real registry pins is pending; a local portal pilot is not production. |
| RT-S01 | N4, N32, ASC32 | Fresh nonces under the sealed profile navigate; changed policy takes one document boundary. ASC32 exercises exact action-policy admission with strict CSP intact. | Final deployed middleware/proxy policy attestation remains pending. |
| RT-S02 | N4, N32, LB32 | A second actual compiled build requires a document boundary; an asset-identity mismatch is refused by the real-HTTP client admission harness. | Synthetic envelope checks remain distinct from compiled build and production deployment identity. |
| RT-S03 | N4, N32, historical-source | N32 executes the emitted registration group; build/source controls enforce closed executable dependencies and integrity-bearing entry semantics. | No new lazy JavaScript discovery or cross-route executable graph capability is claimed. |
| RT-S04 | N4, N32, historical-source | Actual hostile markup is refused before upgrade/activation under strict policy; source parser and ownership counterfactuals remain preserved. | The separate duplicate-core diagnostic has a deliberately relaxed CSP and is never used to qualify strict policy. |
| RT-S05 | N4, N32, ASC32 | Native no-store/context/foreground barriers, held stale checks and actual two-tab session revocation pass in the complete fresh campaigns. | Genuine BFCache restoration and deployed application cookie/cache/proxy review remain pending. Dispatched persisted events are not a BFCache witness. |
| RT-S06 | L32, LS32, LB32 | Boundary controls cover payload/state, routes, owners/islands, branches, parser tokens/depth, registry entries, two prefetches, 32 recovery keys and 1,000 scroll entries. Real clocks exercise the 15-second ignored-abort deadline and 60 writes/10 seconds. | API/model clock/Map instrumentation is explicit. Scroll failures found in older products are fixed and pass both installed regressions; no allocation benchmark is implied. |
| RT-F01 | N4, N32, ASC32 | Actual enhanced/native GET and POST handlers, including multipart POST files and fields, revalidate typed data and remain usable without JavaScript. | The consumer is an explicit fixture application, not production session/authorization acceptance. |
| RT-F02 | N4, N32, ASC32 | Real multipart file bytes/repeated/disabled/named controls, constraint-validation zero-send behavior and a genuine submitter URL/method override all pass in the complete 90-case strict campaign. | Browser serialization is observed in three engines; physical-device usability is a separate manual gate. |
| RT-F03 | N4, N32, MAN32, MAC32 | Automated validation preserves entered values/history and focuses the summary; the user confirms the six Mac tasks, including associated field-error/VoiceOver checks, with “ok done all good”. | No individual speech transcript or per-step notes were supplied. Physical iPhone validation/gesture checks remain pending. |
| RT-F04 | N4, N32, historical-source | Competing and reentrant submissions reserve one active slot; busy does not queue a later send, and serialization-time disposal transmits nothing. | The in-document latch is not backend exactly-once execution or a transaction lock. |
| RT-F05 | N4, N32, historical-source, SK32 | Mutation settlement revalidates the current or pending destination; held POP repair precedes POST and old reads cannot win. | SK32 additionally observes stale readiness/scroll and prefetch revocation through public wrappers; source/native/application scopes stay distinct. |
| RT-F06 | N4, N32 | Navigation completes during a delayed POST and known settlement refreshes the newer destination without stealing it. | Production application read-after-write consistency is reviewed separately; client fencing cannot freshen stale replicas. |
| RT-F07 | N4, N32, MAN32, MAC32, UX009 | Lost action result causes one-send uncertainty that survives GET/reload; the user confirms the Mac delayed/unknown-save checklist. Independent installed-package control preserves uncertainty and repeat-submit refusal. | Known low-severity D14-3.2-009: visible/live-region unknown-outcome text repeats with doubled punctuation. Not fixed; no speech-output failure is inferred. Test reset is not a production transaction-resolution protocol. |
| RT-F08 | N4, N32, ASC32 | Real fixture CSRF/session/context refusals, 401/403 and held foreground/multi-tab principal changes reject unsafe writes and revoke private owners. | Final consuming-application/session/proxy verification remains pending; the framework does not supply production authorization. |
| RT-F09 | N4, N32, ASC32 | Typed 303 follows one GET; real raw 307/308 responses refuse POST replay and latch uncertainty. Undeclared endpoints never transmit as enhanced actions. | Unsupported native forms remain document behavior, separate from enhanced POST recovery. |
| RT-F10 | ASC32 | The complete strict campaign preserves 409/422/500/503 and 401/403 semantics and refuses endpoint/context/policy/action-set/transport-envelope mismatches before UI admission. | The separate duplicate-core diagnostic is not used as CSP evidence; production authorization and policy remain application obligations. |
| RT-X01 | N4, N32, LB32, ASC32 | Typed GET 404/410/500/503 boundaries and matching direct/no-JavaScript statuses pass. Real HTTP socket/media/JSON/schema/body failures recover explicitly rather than becoming not-found. | Synthetic malformed-envelope controls and actual Rust typed statuses retain their separate scopes. |
| RT-X02 | LC32, N4, N32, H32 | The finite recovery catalogue combines unsupported profile/adapter, foreign history, build/policy/assets/context, auth, malformed transport/state, adoption/readiness and storage limits. Admitted recovery asserts one GET and state loss; refused journals assert zero GET. | Genuine BFCache restoration and production rollback remain open. The catalogue is a documented category map, not an exhaustive list of every internal error string. |
| RT-A01 | N4, N32, MAN32, MAC32, UX009 | Automated title/summary/heading focus and retained selection checks pass; the user confirms the requested Mac keyboard/VoiceOver tasks. | No per-step spoken transcript was supplied. D14-3.2-009 records repeated DOM live-region text; the Mac confirmation does not prove repetition absent. iPhone remains pending. |
| RT-A02 | N4, N32, H32, SK32 | Actual Back/Forward entry scroll, new-route top, encoded/empty-fragment coordinates and delayed older readiness that cannot scroll or focus the newer page pass; negative controls detect deliberately wrong scroll coordinates and a real document reload. | Real browser coordinates and retained-view identity are measured. Physical gestures and genuine BFCache restoration remain separate. |
| RT-A03 | N4, N32, MAC32, historical-source | Three-engine reduced-motion routing requires no View Transitions; the user confirms the Mac Reduce Motion task. Immutable same-group assets or a document boundary define CSS behavior. | Physical iPhone Reduce Motion review remains pending; dynamic CSS/visual choreography is outside the admitted profile. |
| RT-A04 | MAN32, MAC32, UX009 | The actual staged native/form preview passed automated smoke; the user confirms all six requested Mac Safari keyboard/VoiceOver/Reduce Motion tasks. | iPhone HTTPS/gesture acceptance remains pending. The broad confirmation supplies no individual notes and does not refute the known repeated warning text; no whole A04 closure is claimed. |
| RT-A05 | N4, N32, H32, MAC32 | Native/forms/history/lifecycle run in Chromium/Firefox/WebKit at the recorded mobile viewport; the user separately confirms the Mac manual checklist. | Emulated viewport and Mac confirmation do not establish physical iPhone gestures or genuine BFCache restoration; both remain pending. |
| RT-K01 | L32, SK32 | Installed-browser cases cover default-off/denied prefetch, save-data/offline refusal, two-task API/model concurrency and absence of completed reuse. | Save-data uses an explicit navigator.connection property control; offline uses real browser network emulation. This is not mobile data-plan or native Rust transport measurement. |
| RT-K02 | SK32 | Real HTTP proves shared in-flight claim without another GET, failed fresh retry, no completed reuse, actual POST invalidation and accepted/rejected context cancellation. | A custom application action admission and controlled context-check result test coordinator ownership; native Rust wire/security behavior remains in N32 and the action campaign. |
| RT-M01 | M4, M32 | Separate current 4c59 and earlier 862d archive measurements each report 40,715 B whole-group gzip and maximum increment 12,287 B, against unchanged 65,536/12,288 B ceilings. Plain baseline is 28,456 B; candidate controls are 28,428/28,429 B. | Each outer receipt authenticates its own installed archives and intentionally staged view. The original source/artifact outputs remain unchanged; no ceiling is raised. |
| RT-M02 | PF32, PFR32 | All four fixed cells pass with 30 samples per direction per mode after five warmups. Maximum commit p95 is 0.5/3/1 ms for desktop Chromium/Firefox/WebKit and 3.10 ms for throttled mobile Chromium, below unchanged 16/50 ms budgets. | Cold n=3 per route/mode is descriptive; two rAF callbacks measure scheduling, not compositor paint. Ordinary host processes remain recorded; this is not a physical phone or hosted P17. |
| RT-M03 | O32, PF32 | O32 deterministic resource baselines complement Chromium heap observation: used heap 2,132,376 to 2,392,492 B (+260,116 B) after 10 warmups, 100 transitions and two bounded GC requests. | Browser history intentionally grows. No heap threshold, zero-leak or universal untracked-resource conclusion is claimed. |
| RT-D01 | PACK4, CI4, historical-scaffold | Current 4c59 PR CI passes its platform/candidate-starter lanes and release-cache checks for the version-aware inventory; minimal, dashboard and native-router remain the three starters. | Complete current-source hosted P17 remains pending; future exact main/tag CI is required separately. Historical scaffold results are not relabeled current-source runs. |
| RT-D02 | historical-site | The preserved bounded site pilot authenticates original packed runtime inputs and local build rollback. Updated portal/lab/download work has separate local evidence. | Real registry pins, complete final site/container qualification, OVH deployment identity, live routes and production rollback verification remain pending. |

## Publication and stable acceptance remain separate

Before RC publication, the current candidate still needs complete hosted P17,
required final-source/main CI, complete audited mutation accounting, truthful
non-audit gate closures and the actual final independent D14 review. Pack success,
partial old runs and this document do not complete those gates.

The user confirmed the six requested Mac Safari keyboard/VoiceOver/Reduce Motion
tasks with **“ok done all good.”** That actual confirmation is retained with the
original checklist and preview hashes; no individual speech transcript or per-step
notes are invented. A read-only lookup afterwards found macOS 26.1 (25B78) and
installed Safari 26.1 (21622.2.11.11.9); those versions were not supplied by the
user. Physical iPhone checks still require HTTPS, and genuine BFCache restoration
must be observed separately from synthetic events and ordinary reload/history.

Known low-severity observation **D14-3.2-009** remains disclosed: the installed
router repeats the visible/live-region unknown-outcome sentence with doubled
punctuation. The independent HappyDOM control observes one POST send and persistent
uncertainty; retry refusal remains correct. This is not an observed speech-output
failure, and the Mac confirmation does not prove repetition is absent. No runtime
change or false “fixed” claim is made for this nonblocking RC usability issue.

Stable acceptance also requires actual published registry identities, router
trusted-publisher and monitor enrollment, final registry-pinned site/lab/download
qualification, the deployed OVH proxy/build identity and rollback checks, and a
same-line published RC soak with at least 3,600 fault-free credited active seconds.
The historical 3.0 deferral is not transferred to 3.2. No pending criterion is
waived by a local fixture result.
