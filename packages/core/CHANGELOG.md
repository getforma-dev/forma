# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

Changes after the prepared 3.0.0 set will be recorded here.

- FORMA-178: bound the long task from several bindings that are each too heavy for any task. A reported allocation-budget refusal now arms the task's cap as a wait does, and counts the cap (10,000 units) toward the per-task allowance (50,000), so the bindings after it are counted only to the cap. A binding too heavy for any task that follows one waits, is weighed in full once in a task where it runs first, and is reported there: each is still reported exactly once and weighed in full once, but several are reported one to a task, not all at once. Twenty such bindings made a 53 ms task at 4x and forty a 99 ms task; now the worst task is at most 19 ms and 6 ms (Chromium 156, 21 runs). Two tested behaviours change, deliberately: after a reported refusal a heavy binding that would have fitted the room left waits a task if it is past the 10,000-unit cap, and light bindings (a case mapping, fifty names joined) still render in the same task only while at most five bindings too heavy for any task come before them (the next entry gives the measured delays). No public API, wire-format or version change.

- FORMA-249: follow-ups to FORMA-178's review. A reported refusal now arms the task's cap only if the budget meter made it (an allocation charge or the step count; `defer` is false), so a refusal that checks a length or a count (`repeat()` past 10,000, `flat()` too deep, a string past 1 MiB) no longer delays a binding that fits to the next task, as before FORMA-178. Such a refusal arms nothing itself, but what the evaluation charged before its check stays on the task's meter: `repeat()` and `flat()` are charged their cost-table row first, and a charge before the check that does not fit (the row of `'x'.repeat(300000)`, or `Array.from`'s in `Array.from({length: 300000}).flat(99)`) is an allocation refusal and arms the cap. And the light-binding claim above is bounded, measured with twenty `label.toUpperCase()` bindings after N bindings each too heavy for any task: they render in the same task for N up to 5. From N=6 the cap is 0 and they wait. With each of the N refused at once on a charge a cost-table row sizes (six are reported to a task), they wait 1 tick for N=6 to 10, 2 for N=12, 3 for N=20 and 6 for N=40; with each a 75,000-number list converted to text (one reported per task), N-5 ticks: 1 for N=6, 5 for N=10, 35 for N=40. Before FORMA-178 they rendered in the same task in every case. Only light bindings after the heavy ones in document order wait. Measured in FORMA-249's review (Chromium 156, 4x, M1 Pro, median of 7 runs at a load average of 5 to 8; one tick about 4.3 ms): for N=40 the last light binding rendered about 152 ms after the update in the list form, against 96 ms before FORMA-178 in one blocking 96 ms task, and its longest task is now 4.5 to 4.8 ms; in the row form, 16 ms against 6.5 ms. No public API, wire-format or version change.

- **A `data-list` pass over 160,000 rows × row weight is refused** (FORMA-172). A list built a row of DOM for every item, however cheap the expression that produced them: `Array.from({length: 249990})` made 249,990 rows in one task of 3.2 to 4.0 s at 4x CPU throttling (M1 Pro). Now, before any item is read or any row is built, a pass whose rows times the weight of a row pass 160,000 is refused with `FORMA_E_BUDGET` ("a data-list of rows weighing W is refused past N rows (rows × weight is capped at 160000)"), the list is marked `data-forma-expr-error`, and it keeps the rows it had. A row weighs 1, plus 1 for each element and each attribute of the row template, the contents of a nested `<template>` included. Refused, by row shape:
  - `<li>{item}</li>` (weight 2): more than 80,000 rows;
  - a six-cell table row with five directives (weight 14): more than 11,428 rows;
  - a row of 22 elements (weight 23): more than 6,956 rows;
  - vector-studio's todo-list row as the app serves it, `data-fm` stamped (weight 144): more than 1,111 rows;
  - vector-studio's team-roster row as served (weight 150), the heaviest found: more than 1,066 rows.

  Nothing under the cap changes: a list is not charged to the task's budget, never waits, and renders in the task that hands it its items, as on 3.0.0. The refusal itself checks a length, charges nothing and arms no cap (FORMA-249); what the list's expression charged before it stays on the task's meter. The cap is per pass: the lists an outer list's rows hold are made together in one pass and are not bounded together (ten rows each holding 69,999 rows built 699,990 rows in one task of 6.8 to 14.5 s at 4x on an M1 Pro, as on 3.0.0); a per-task list allowance is FORMA-255. Remedy: show a page of the data, asked for where it is produced or sliced in the expression (`items.slice(start, start + 200)`, which is itself charged the length of the array it reads, so it serves arrays of up to about 250,000 items). Lists too big for one 50 ms task but under the cap still make one long task, as before: at the cap about 1.1 to 1.4 s at 4x on an M1 Pro and 2.2 to 4.6 s on a CI runner across runs 40032265860, 40034377741, 40040340320 and 40042343018 (SECURITY.md has the figures); FORMA-255 renders them across tasks. CDN runtime +189 B gzipped, hardened +190 B, preview frame +193 B (451 B left under its 40,000 B gate); the ESM entry is unchanged. No public API or wire-format change. Rollback: pin 3.0.0.

- **A `data-computed` that reads its own name, or is read while it is being computed, is refused with a coded diagnostic instead of throwing out of `mountMarkup`** (FORMA-268). forma-vector-studio's generated `retro-homepage` declares `data-computed="visitCount = visitCount"` over a `visitCount` state key. The interpreter resolves a name when it is read, not when the expression is compiled, so the computed read its own getter while it was being evaluated; alien-signals answers that re-entrant read with the computed's current value, `undefined` before its first evaluation, and `mountMarkup` threw `TypeError: Cannot read properties of undefined (reading 'ok')`, leaving the rest of the module unbound. The binding deleted the name's getter before compiling the computed to prevent exactly this, which did nothing once names resolved late; that deletion is removed. Now:
  - a computed whose expression reads its own name (an arrow parameter, a property or a string of that name is not a read of it) is refused when it is bound, with `FORMA_E_UNSUPPORTED` (`computed "visitCount" reads its own name`) on its element, and binds nothing: a state key of that name keeps its value, otherwise each reader reports `FORMA_E_UNRESOLVED`;
  - at run time, only a read of a computed while that computed is being evaluated is caught, through another computed (`a = b; b = a`) or through a handler that a `$dispatch` in the computed runs: it is refused with `FORMA_E_UNSUPPORTED` (`computed "a" is read while it is being computed`) on the computed's element, and the reader reports it too (a binding keeps the text it had). Two limits, stated in docs/HTML-RUNTIME.md and pinned by tests: a cycle that a later change closes after both computeds have values is not detected (`a = flag ? b : 1; b = a + 1` with `flag` turning true gives a=2 and b=2 with no diagnostic, as on 5c5a7796), and a computed that cached the refusal before reading anything that can change keeps it after the cycle breaks, until the markup is mounted again;
  - a computed may still be named like a state key, and the readers bound after it read the computed, as before (now documented in docs/HTML-RUNTIME.md, with the rule that also held before: a reader on an element before the computed's reads the state value until the key is next written). Refusing it would break real modules: of the 179 computeds found in the local app corpora on 2026-10-23 (vector-studio's generated modules, module store, replays and fixtures, forma-generative-ui's registry, forma-builder, FormaStackDev and the exported sites), 53 are named like a state key, 51 of them without reading themselves (forma-generative-ui's focus-timer-card, vector-studio's joke-card, forma-builder's pulse-saas pricing), none is written by a handler or `data-model` in its scope, no two read each other, and the only self-reference is retro-homepage's.
  - Two behaviours change. A computed named like a state key that cannot compile used to leave every reader of the declared key reporting it undeclared (`FORMA_E_UNRESOLVED`); now its readers read the state value and only the computed's element reports (none of the 179 fails to compile). And the bind-time check is by name, so it is conservative: a computed in a `data-list` row named after a row local (`item = item * 2`, where `item` reads the row's item, which wins over every getter) rendered with no diagnostic and is now refused on every row, the rows still rendering the row local (the scan found no such computed: its only self-references are retro-homepage's).

  The served retro-homepage now mounts with one diagnostic, both visit counters show 1337, and its window, guestbook and form controls work (Chromium 156, the built CDN runtime). CDN runtime +223 B gzipped, hardened +221 B, preview frame +225 B (226 B left under its 40,000 B gate); the ESM entries are unchanged. Probes: 4 added (correctness); corpus 265. No public API or wire-format change. Rollback: revert.

- **An allowlisted native that throws on its arguments is reported on its binding as `FORMA_E_CALL_FAILED`, instead of throwing out of `mountMarkup`** (FORMA-271, from FORMA-268's review). Before, `{JSON.parse('{')}`, `{(1).toFixed(500)}` and `{(1).toString(1)}` threw a SyntaxError or a RangeError out of `mountMarkup` from any binding (`data-text`, `data-show`, `data-list`, `data-bind:*`, `data-class:*`, a computed's readers), in happy-dom and in Chromium 156, and the whole module was left unbound. In a handler they were uncaught page errors with no diagnostic. Every allowlisted callable was given null, numbers, strings, objects and arrays (the test pins the result), and some natives throw:
  - on such plain arguments: `JSON.parse`, `toFixed`, `toPrecision`, `toString` with a radix, `Object.keys`, `Object.values`, `Object.entries` and `Array.from`;
  - TypeError from `reduce` of an empty array with no initial value, and from every higher-order method called with no callback;
  - RangeError on a value nested about 10,000 deep, from `join`, a default `sort`, `String`, and `JSON.stringify` in Node;
  - DOM methods given a selector they cannot parse (`$el.matches('#1')`, `':bogus'`, `'.'`, through `closest`, `querySelector` and `querySelectorAll` too);
  - in Chromium, `classList.add`, `remove`, `toggle` and `replace` given an empty token or one with a space.

  Now:
  - the interpreter makes every allowlisted call through one wrapper. An exception the native throws is refused as `FORMA_E_CALL_FAILED`, a new code, on the binding that made the call, reported like any expression that cannot be evaluated. Its message names the method and the native's error, cut at 200 characters: `number.toFixed() threw RangeError: toFixed() digits argument must be between 0 and 100`. The rest of the module binds and keeps working;
  - what Forma's own code throws while a native runs it passes through as it is, a real bug or an expression error with its own code and `defer`: an arrow callback, a handler a `click()` dispatches, the runtime magics `$dispatch` and `$refetch`. Code an application put in reach and a native runs (a `toString` of a value in state, its own override of an element method) is converted, because the native call is what threw;
  - budgets (DR-16) are unchanged. The refusal is final and arms no cap, like the refusals that check a length or a count (FORMA-249), and what the call was charged before it ran stays on the task's meter: `JSON.parse` of a 200,000-character string that is not JSON leaves its 200,000 units spent.

  The message can quote part of the argument, which may be T2 data, up to the 200-character cut. SECURITY.md says where the message goes.

  "Markup cannot throw out of `mountMarkup`" is not adopted as a guarantee, because other paths still throw. Among them:
  - a `data-bind:` with no name throws InvalidCharacterError;
  - a `data-class:` with no name throws SyntaxError in Chromium;
  - a `data-model` on a file input with a non-empty value throws InvalidStateError;
  - a value nested about 10,000 deep overflows the stack wherever something other than the native call converts it: the runtime's `data-text`, an operator, Forma's own checks before a call (a selector, an attribute or style property name, a `repeat` count), or a sort comparator's result;
  - an application-thrown value that cannot be converted to text.

  At event time, a DOM property write the browser refuses (`$el.dataset['a-b'] = 1`, `$el.value` on a file input or a `<progress>`) is still an uncaught page error, and Chromium 156's `scrollIntoView({behavior: 'bad'})` returns a rejected promise. SECURITY.md lists them under *Known gaps*; tests pin the empty-name cases and the runtime's and an operator's conversion of a nested value. The probes stay `correctness`. CDN runtime +142 B gzipped, hardened +144 B, preview frame +135 B (39,909 of 40,000 B, 91 B left); the ESM entries are unchanged. Probes: 6 added (correctness), 2 re-anchored; corpus 271. No public API or wire-format change; a diagnostic's `code` can now be `FORMA_E_CALL_FAILED`. Rollback: revert.

- **The preview frame's runtime is 1,623 B smaller gzipped, and the runtimes no longer ship a debug log nothing could switch on** (FORMA-275). The HTML runtime's `dbg()` tracing sat behind `const _debug = false`, and its switches (`FormaRuntime.debug`, `window.__FORMA_DEBUG`) went with explicit mounting, but esbuild does not fold a `const` into its uses, so its 12 calls and their strings still shipped in the standard runtime IIFE and the preview frame, and some of them in the hardened builds. They are deleted. The frame's runtime also gets tsup's Rollup pass (`treeshake`), as the hardened IIFE has. It drops what esbuild kept but the frame never reaches: the teardown of islands it never activates, the fetch-grant parser, and the branches for the tiers, grants and options its one `mountMarkup` call never passes. Its wrapper becomes `(function (exports) {…})({})`. It is still one classic script, byte-identical from build to build, with no global and with `connectFrame(window)`. Its minified copy, which an application's build writes, goes from 84,445 to 80,615 B raw. Measured with `npm run check:size`: preview frame 39,774 to 38,151 B gzipped (1,849 B left under its 40,000 B gate, from 226), CDN runtime 40,288 to 39,738 B (gate 41,500), hardened 38,756 to 38,641 B (gate 40,500). The `runtime` and `runtime-hardened` ESM/CJS entries are 106 to 109 B smaller. The core entry and browser ESM are unchanged. No gate changes. The two frame builds were run side by side in Chromium 156 over 1,164 modules (the hostile-widgets catalogue, directive fixtures and 500 seeded random expressions, each also clicked and typed into): their DOM, the messages they sent and the page errors were identical. No behaviour, public API or wire-format change. Rollback: revert.

## [3.0.0] - Prepared; publication pending

- Prepare coordinated final versions, dependency locks and template source seeds from published RC.5 at12320f43, including the reviewed packed-qualification test-fixture repair. Preserve its product, tests and qualification harness unchanged.
- RC.5 passed its independent whole-release audit, exact-main CI and tagged61/61 P17, then published all seven verified packages through trusted publishing. Bind the final preparation to those actual RC.5 records. Final-delta review, exact final CI and trusted final publication remain required; the L-66-QUOTA post-final soak remains deferred with zero active credit until a separate authenticated completion receipt.

## [3.0.0-rc.5] - Prepared; publication pending

- Correct the synthetic packed-qualification prerelease fixture so it cannot inherit a final-only soak deferral. The real guard, runtime, qualification harness and thresholds are unchanged; the regression rejects the original inconsistent fixture and preserves rejection of unnormalized deferrals.
- Published RC.4 remains immutable and qualified. This successor carries the test repair through the existing exact-source audit and final-diff rules; final publication and the actual post-release active soak remain outstanding.
- Coordinate all seven package versions, dependency locks and scaffold source seeds. Require independent review, exact-source CI, packed qualification and trusted publication.

## [3.0.0-rc.4] - Prepared; publication pending

- Bound each background island-load callback to four direct queue entries as well as its existing 12 ms deadline. Preserve whole-island adoption, synchronous input promotion, cancellation and readiness; neither bound can preempt an expensive island or additional promoted work.
- Keep the strict 50 ms mobile-task and 500 ms response gates. RC.3 failed its tagged mobile campaign and remains unpublished and immutable; this candidate requires fresh packed qualification and independent audit before publication.
- Coordinate all seven package versions and source template seeds. The actual same-RC active soak remains outstanding after final publication under L-66-QUOTA.

## [3.0.0-rc.3] - Prepared; publication pending

- Coordinate the seven-package RC.3 set and template source seeds; published RC.2 remains unchanged.
- Correct synthetic release-test fixtures to reconstruct their declared milestone states without carrying live final-soak deferral metadata. Exercise both ordinary and deferred input snapshots; production gate validation remains strict and unchanged.
- Require independent review, exact-source CI and tagged packed qualification before trusted publication. Final publication and the actual post-release active soak remain outstanding.

## [3.0.0-rc.2] - Prepared; publication pending

- Coordinate the seven-package RC.2 set and template source seeds. RC.1 remains published and immutable; no runtime behavior changes in this preparation.
- Correct the release verifier's Actions archive request media type, with a regression test reproducing the observed HTTP 415. Release asset downloads keep their binary media type, and archive identity, provenance and size checks remain enforced.
- Require independent review, exact-source CI and the new tag's packed qualification before trusted publication. Actual post-release soak remains outstanding.

## [3.0.0-rc.1] - Prepared; publication pending

The entries below describe the prepared release-candidate source, not a published release.
The release workflow and registry verification establish publication.

- FORMA-204: a component whose setup throws now runs its registered teardown, including listeners, tracked effects and context providers, before propagating the original error. Mount callbacks remain uncalled and cleanup errors do not prevent later teardown.

- Dispose completed and partial explicit-runtime bindings when initial mounting throws, including list-row work, event listeners and authorized polling/fetch requests. Mount-owned reactive scopes also stop a reader that throws before returning its disposer, without disposing an unrelated caller root (FORMA-203).

- FORMA-200: make the standalone `sanitizePropsDeep` helper refuse forbidden own keys that cannot be deleted, including frozen/sealed nested objects. Successful calls still sanitize in place and return the same value; a refusal throws `TypeError` and may leave earlier deletions applied. Compiled SSR state continues to use its separate declared-schema projection.

- FORMA-197: keep completed non-assertion mutation failures unqualified, but collect later probes after exact source restoration and a clean recovery baseline. Such a campaign always fails; infrastructure, incomplete execution and timeout failures still stop. Allow 150 minutes for the hosted 252-probe job using observed serial-run durations, without changing child deadlines, detection floors or kill criteria.

- FORMA-197: replace the `untrack-noop` compile-break sentinel with a runnable mutation that retains the public API while allowing unintended signal subscriptions. Compilation failures remain unqualified; the 252-probe corpus count, strict assertion requirement and detection floors are unchanged.

- FORMA-198: repair stale island microbenchmarks with fresh-document declared head state and registered callbacks. Retain 10/100-island payload and reactive work, await activation, and compare complete bulk/individual disposal cycles against markup parsing. These Happy DOM measurements do not replace packed N3 qualification.

- Serialize mutation-probe files and explicitly concurrent tests under fail-fast execution, so one assertion cannot interrupt another worker's completion evidence. Incomplete test results remain unqualified; the corpus, clean/restored baselines and detection floors are unchanged.

- `activateIslands()` now returns load-readiness as `Promise<void>`. After synchronous preflight and enrollment, load work starts in a timer and yields between whole island transactions after a cooperative 12 ms slice. Overlapping calls share queued ownership, input promotes pending SSR activation without event replay, and trigger setup failures remain isolated. This changes completion semantics; callers requiring all load islands must await the result. Deferred triggers settle once armed, and a single island or preflight remains atomic rather than subject to a hard duration bound.

- FORMA-193's reviewed activation stack measures 48,602 B gzip for the core entry and 48,836 B for browser ESM. Under L-58, their package gates become measured +300 B: 48,902 and 49,136 B. The three runtime bundle gates remain unchanged. At that checkpoint, L-59 kept N2 at 28,000 B per route: the Counter SSR route measured 26,213 B while indexed SSR measured 28,071 B and failed. L-64 subsequently permits 28,100 B only if the full 20-run campaign passes the original 50 ms N3 ceiling; this policy change does not itself claim that performance result, and the historical refusal remains evidence.

- Allocate detached HTML prototypes when their tags are first requested, instead of creating 40 common-tag prototypes on the first `h()` call. Later calls still return independent shallow clones; this change makes no timing-gate claim.

- Share exact `className`/`htmlFor`/`tabIndex` normalization between static/reactive `h()` writes and adoption. HTML and SVG attributes now use the same declared alias policy; ordinary browser object property order remains intact.


### Explicit HTML runtime mounts — FORMA-108

- HTML bindings now require `mountMarkup(root, trustedHtml(markup), { tier, grants, config })` and the returned update/unmount handle. Removed auto scanning, the body observer, tierless lifecycle calls and global configuration setters. Omitted grants refuse fetch and activation and confine DOM traversal to the handed root; every fetch keeps the grant's method/path/cookie/timeout policy and treats non-2xx responses as errors.
- A handle captures its scopes, so unmount also disposes a scope the application detached or moved. Unreviewed refusals retain distinct mount names, tiers and counts. The obsolete manual attribute produces one development-only migration hint; it has no binding authority.
- Monorepo fixtures and measurement helpers use actual explicit mounts. Byte-exact A2 sources and all260 old mutation records remain archived with per-ID dispositions; current qualification and its nine extra explicit-mount controls are reported separately from historical results. FMIR remains restricted to modules from the application's own build; external module admission requires the deferred M9 boundary.

- FORMA-129: skip every descendant of a detached list template when binding a captured parent scope. Nested row bindings retain their own item scope, including detached and shadow-root mounts; real forbidden row expressions still report their diagnostics.

- FORMA-129: tiered `data-fetch` refuses redirects before another URL can escape its grant. Network/redirect rejection before a response has stable generic `FORMA_E_FETCH_REQUEST` error-target text; existing HTTP, JSON and abort handling remains intact. The old tierless path remains unchanged until FORMA-108 retires it.

- Stop listener installation when a reentrant callback disposes the adoption plan. The currently installing callback is removed even if disposal happens before native attachment or installation then throws; unrelated listeners are retained.

- Reduce temporary allocation while capturing an adoption DOM snapshot. The constructor keeps the same observed fields, traversal order, template contents, opaque child boundaries and validation, without an intermediate position object or work record per node.
- Store captured attribute namespace/local/value triples without a temporary object per attribute, and reuse private property-descriptor pairs after taking the complete descriptor snapshot. Attribute checks, descriptor order, accessor refusal and symbol handling are unchanged.

### Avoid unused control-oracle startup work — FORMA-191

- Attribute snapshots use deterministic code-unit ordering without initializing locale collation. Strict adoption scans document radio peers only when it owns a named radio group, and skips detached form oracles when no control bindings can read them. Every topology, focus, captured-value and radio-peer check remains in place before empty observations are returned.

### Indexed item replacement — FORMA-181

- `createKeyedRows(initial, keyFn)` supplies a nominal keyed collection to the two-argument `createList(rows, renderRow)` overload. The callback receives a stable item getter and index getter. `set` validates and replaces an existing canonical key, notifying that item's readers without rerunning row factories or structural reconciliation; `replace` validates the whole candidate and batches retained values with membership/order changes. Missing keys, key changes, sparse arrays and duplicate canonical keys refuse before publication.
- Views retain their owned effects and listeners independently. Internal item signals grant no early-edit writeback authority. Adopted text holes check their own retained markers, parent, ownership and last-written text before a live write; detached or rewritten holes abort through the existing owner failure path. Initial whole-island validation is unchanged.
- The reviewed indexed implementation with the deployment guard measures 47,994 B gzip for the core entry (+997 B) and 48,148 B for browser ESM (+1,053 B). L-58 re-anchors their gates to measured +300 B: 48,294 and 48,448 B. All three runtime bundles remain at the prior guard stack's measured sizes and under unchanged gates. The actual typed 200/2,000-row route passes L-59 at 27,724 B Forma gzip for SSR and 27,077 B for Browser mounting, against N2's 28,000 B ceiling. The original over-budget measurement remains recorded in the qualification evidence.
- Typed native products and three-engine functional controls verify adoption, selected-row DOM writes, movement, focus, selection, current listeners, disposal and isolated tamper refusal. The serial three-engine public-set measurement passes the unchanged N3 median/p95 ratio and 16 ms limits on Apple M1 Pro: largest median ratio 1.01150, largest p95 ratio 1.01786, sampled single-edit maximum 1 ms. Raw calibrated samples and actual products are recorded in `docs/evidence/forma-181-indexed/`; final integrated release qualification remains separate.
- The final integrated local stack measures 48,063/48,209 B for core entry/browser ESM, within the existing 48,294/48,448 gates; indexed SSR/Browser Forma gzip is 27,745/27,108 B, within N2 28,000 B. The first integrated serial timing run and all six behavioral checks pass across three engines, with zero CSP violation events/reports. Full core 3,254, compiler 1,543 and build 363 tests pass. Exact products, raw timing samples and limitations are recorded separately in `docs/evidence/forma-181-indexed/integrated/`; the earlier frozen evidence is preserved.


### Integrated deployment guard package sizes — FORMA-186

- The reviewed deployment guard, F5 text branches, checkpoint D row focus and INV1 policies together measure 47,310 B gzip for the core entry and 47,398 B for browser ESM. They exceed the previous 47,297/47,395 B gates by 13/3 B. Under L-58, re-anchor these package gates to measured plus 300 B: 47,610/47,698 B. Runtime, hardened runtime and frame gates remain unchanged; their measured sizes are 41,310/40,230/39,658 B. This package-size change is separate from the per-route N2 requirement.

### Deployment identity guard — FORMA-186 S4

- The reviewed guard measures 46,997 B for the core entry and 47,095 B for browser ESM, exceeding the previous gates by 220 and 291 B. L-58 re-anchors these two gates to measured +300 B: 47,297 and 47,395 B. All three runtime artifacts are unchanged. The actual Counter route measures 25,585 B of Forma code gzip -9 (Browser mount 24,944 B), both below N2's unchanged 27,500 B ceiling.

- `activateIslands` and `mount` compare the consuming build identity against forma-server's actual root before any component, preflight or trigger. A mismatch preserves served content, marks island hosts as skew, and dispatches the cancelable Document event `forma:skew` with `{ page, bundle, reload }`. Reload happens at most once per full page identity with working session storage; cancellation or unavailable storage leaves the page inert. Absent identities remain unchecked; direct `hydrateIsland` stays caller owned. Published artifacts retain the guarded free `__FORMA_BUILD__` identifier for the consuming build to define.

### Shared attribute-name and URL policy — FORMA-140

- Native rendering and core now run one INV1 vector table for names, URL values and ordinary output payloads. Fresh core and strict adoption apply the native ASCII name rule: rejected names are omitted, and a served rejected attribute refuses that island with `FORMA_E_HYDRATE_VALUE` without repair. Existing URL, typed raw-content and event-listener policies remain explicit in `docs/INV1.md`.

### Integrated text-branch and row-focus package sizes — FORMA-016/181/182

- The reviewed F5 text branches, Rule 6 attribute fixes and checkpoint D focus preservation together measure 46,823 B gzip for the core entry and 46,833 B for browser ESM. Both exceed the previous 46,777/46,804 B limits. Under L-58, re-anchor these two package limits to measured plus 300 B: 47,123/47,133 B. Runtime, hardened runtime and frame sizes and limits remain unchanged. This package-size adjustment is separate from the founder's L-59 per-route N2 decision, which lands with indexed rows.

### Retained row focus — FORMA-181 checkpoint D, first slice

- A keyed row relocation previously blurred its focused input in Chromium, Firefox and WebKit even though the input node and selection survived. The private live reconciler now uses state-preserving `moveBefore` for retained rows where supported. Its `insertBefore` fallback restores lost focus and text selection only while the owner remains live and no callback has focused another control. Detached new rows still use ordinary insertion.
- Three-engine controls move exactly one existing row in 2,000, preserve its focused input and backward selection, keep the original row factories and listeners, and prove disposal removes those listeners. Forced fallback and callback focus-redirection controls run alongside the existing keyed-adoption matrix. This establishes row-move behavior; indexed row-edit performance and actual-product qualification remain separate checkpoint D work.
- The low-level unkeyed adoption path shares the client key cache's domain: fractions and lone surrogates refuse before row callbacks or writes; safe integers and valid Unicode strings remain admitted. The guide and refusal/near-miss tests now state this explicitly.
- Production sizes on checkpoint C base `8aec868`: core entry 46,720 B gzip (+243 B), browser ESM 46,746 B (+242 B), inside the existing 46,777/46,804 B gates. Runtime, hardened runtime and frame sizes are unchanged; no gate is raised.
- FORMA-182 review: HTML boolean attributes consistently use scalar truthiness. Empty strings and numeric zero (including -0) are omitted; nonempty strings and nonzero numbers are bare. This preserves the existing browser behavior and prevents an empty signal default from unexpectedly enabling `disabled`, `hidden` or `checked` in served HTML. Compiler defaults, the native writer, strict attribute adoption and the checked/selected control oracle share the expanded vectors. Empty strings on ordinary attributes remain present.

### Rule 6's attribute table: findings F2 and F3 — FORMA-182

- **Rendered output changes with no source change.** `true` is bare only on an HTML boolean attribute (`BOOLEAN_ATTRS`, now exported from `src/dom/element.ts` for adoption); on any other attribute it is the word `"true"` on every writer: `h()`'s static path wrote it bare (`aria-hidden: true` gave `aria-hidden=""`, which ARIA reads as no value; `class: true` gave `class=""`), and adoption expected and wrote it bare (FORMA-188's `aria-pressed=""`), where `h()`'s reactive path and now the walker write `"true"` (`docs/parity-rules.md`, rule 6's attribute table). Verified by `src/dom/__tests__/value-rule-6-attributes.test.ts` and `e2e/value-rules.spec.ts` in three engines; `element.test.ts` and `hydrate-svg.test.ts` migrated from the bare expectation; probes `el/static-class-true-bare`, `el/static-true-bare`, `adoption/true-bare-off-boolean-set`.
### A control-flow branch may be text — FORMA-016 F5

- `createShow` (both branches), `createSwitch` (cases and fallback) and `createList` (rows) accept a function that returns a string or a number and write it as a Text node under rule 1, as `h()` writes the same value as a child and as the server walker writes the branch's `DYN_TEXT`; `null`, `undefined` and booleans write nothing. Before, `createShow(() => props.user.active, () => props.title)` threw a `TypeError` on `insertBefore` in the browser while the compiler accepted it and the server rendered the text (found by FORMA-183's parity harness). Strict adoption of a served text branch writes nothing (the server's Text node is kept; zero mutation records in Chromium, Firefox and WebKit). The `Branch` type widens `thenFn`, `elseFn`, `SwitchCase.render`, the switch fallback and the list `renderFn`. A list row that returns `null` is still not supported (a row is exactly one node). Core's entry grows by 68 B gzip (46,295 to 46,363 B of its 46,500 B cap) and the browser ESM by 60 B (46,288 to 46,348 B); no cap changes. Shared vectors: `crates/forma-ir/tests/fixtures/parity/show-text-branch.json`, read by `walker.rs` (`show_text_branch_vectors`) and `src/dom/__tests__/show-text-branch.test.ts`; browser spec `e2e/show-text-branch.spec.ts`.

### Integrated package size gates — FORMA-181/182

- Keyed adoption (FORMA-181 checkpoint C) and the value rules (FORMA-182) together measure 46,477 B gzip for the core entry and 46,504 B for browser ESM. The latter exceeded the previous 46,500 B gate by 4 B. Under decision L-58, the two package gates are re-anchored to the measured sizes plus 300 B: 46,777 and 46,804 B. The runtime gates remain 41,500, 40,500 and 40,000 B; the route budget remains 27,500 B gzip -9 of Forma code. Measurements come from the actual production build's import graph via `scripts/check-size.mjs`.

### Value rule 6: a boolean in text writes nothing — FORMA-182

- **Rendered output changes with no source change:** strict adoption maps a boolean text value to the empty string, as `h()` does (`docs/parity-rules.md`, rule 6). A reactive child returning `false` or `true` over a served range used to be expected, and later written, as the word, so an adopted page showed `false` where a fresh render showed nothing, and the empty range the walker now serves for `() => ready() && 'Go'` at `false` was refused with `FORMA_E_HYDRATE_VALUE`. A page compiled by an earlier compiler, which served the word there, is now refused at that idiom: compiler and core move together in 3.0.0. Verified by `src/dom/__tests__/value-rule-6-boolean-text.test.ts` and `e2e/value-rules.spec.ts` in three engines; mutation probe `adoption/boolean-text-word`.

### Value rule 5: `null` writes nothing — FORMA-182

- **Rendered output changes with no source change:** `h()`'s `class`/`className` writer follows the attribute presence table, static and reactive (`docs/parity-rules.md`, rule 5): `null`, `undefined` and `false` remove the attribute, `true` writes it bare, anything else its string. In the published `3.0.0-alpha.2` and earlier, a reactive class getter returning `null`, `undefined` or `false` wrote `class="null"`, `class="undefined"` or `class="false"` (and since rule 1's normalizer it threw inside its effect and kept the previous class); it now removes the attribute, as the walker does. A static `class: true` wrote `class="true"` and now writes the bare attribute the walker writes. Verified by `src/dom/__tests__/value-rule-5-null.test.ts` and `e2e/value-rules.spec.ts` in three engines.

### Keyed rows: adoption by key — FORMA-181

- Strict adoption binds a keyed list's rows by key (checkpoint C). When a served list range's row roots carry `data-forma-key` (the native renderer writes it on every row of a list the compiler keys), each client item adopts the served row whose decoded attribute equals the item's canonical key, in any order, through a cursor bounded to that row; nothing moves, the served order is kept until the list source changes, and a row's index starts at its client position. A registered child that is a row keeps its own served host, state and occurrence. A key on one side only, a repeated served key, a row without a key beside keyed rows, two client keys with the same canonical text, or a key outside the domain refuses the island with the new `FORMA_E_HYDRATE_KEY` before any row runs; text or a range beside keyed rows is `FORMA_E_HYDRATE_STRUCTURE`. FORMA-123's row-count check is no longer the criterion for keyed rows; unkeyed rows keep it (`FORMA_E_HYDRATE_LIST_COUNT`). The pre-181 initial key-order limitation is retired. Later keyed updates cache rows by canonical key text, so a type-only change (1 to `"1"`) keeps the row. Size: core ESM entry 46,295 to 46,466 B gzip, CDN ESM 46,288 to 46,488 B, the minimal template's Counter route 25,101 to 25,195 B.
- `src/dom/key-text.ts` (private) builds the canonical text of a list key: a safe integer prints as its decimal integer (`-0` as `0`), and a string without an unpaired surrogate goes through FORMA-182's shared `normalizeDomText` (CRLF and CR become LF, NUL becomes U+FFFD), so `"a\r\nb"` and `"a\nb"` are the same row and `1` and `"1"` are too; any other value gives undefined (adoption's `FORMA_E_HYDRATE_KEY`). `src/dom/__tests__/key-text.test.ts` runs 182's `values` vectors (`crates/forma-ir/tests/fixtures/parity/normalization.json`) and 181's shared key vectors (`keys.json`, the same ones forma-ir's walker reads) through `canonicalKeyText`, and asserts the module carries no normalizer of its own and returns `normalizeDomText`'s result.

### Documentation

- **The preview frame's runtime in an application's output (FORMA-190).** `docs/HTML-RUNTIME.md`'s frame section says core's `dist/formajs-frame.global.js` stays readable and that `@getforma/build` writes a minified copy of it into the application's output (about 85 KB raw against 164 KB), which is what forma-server inlines and hashes. No change to this package's files.

### Value rule 1: line endings and NUL — FORMA-182

- Every ordinary text and scalar attribute writer (`createText`, `h()` children and attributes, form-control text and value writes, adoption text and attribute expectations and later writes, the control oracle's expected defaults, the materializer) now applies rule 1 per value: CRLF and CR become LF, NUL becomes U+FFFD, everything else is preserved. This is what the browser does to the served HTML, so strict adoption matches a server-rendered `"\0"` label instead of refusing it. Props, state and keys are untouched; raw HTML, `srcdoc`, style and event sinks keep their own paths. The URL guard classifies the raw value and refuses a NUL anywhere in a URL attribute (normalized it would be a fetchable same-origin relative reference); the normalized value is what is written. `h('pre', null, '\nline')` now agrees with the walker's `<pre>\n\nline</pre>` in every engine. Private helper `src/dom/normalize-text.ts`; shared vectors in `crates/forma-ir/tests/fixtures/parity/normalization.json`; rules in `docs/parity-rules.md`.

### Size: the safe cuts, the ratcheted package gates and N2 restated — FORMA-021

- **Every development warning is folded out of every production artifact (C1).**
  The warnings of `h()` (a dropped prop), `createStore` (a prototype-polluting
  key), `createList` (a duplicate key, a non-array), `createSignal`'s debug
  name, the instance registry and `reportError`'s console fallback are now guarded at their sites by the build flag, in the shape esbuild
  folds while parsing, instead of by an imported `__DEV__` constant that esbuild
  never inlines and that Rollup folds only inside one chunk. The code-split
  entries (`dist/index.js` and its chunks) shipped ten such guards with their
  warning bodies, dead but paid for, and the runtime IIFEs a `__DEV__` binding; no production artifact binds `__DEV__` now. The development build (the `development`
  condition) keeps every warning; `scripts/verify-dist.mjs` now checks the
  texts themselves, present in the development twin's graph and absent from
  each production file, where it used to look for a `__DEV__` binding.
- **The `__FORMA_DEBUG__` console tracing is gone (C2).** `createShow` and
  `createSwitch` logged their transitions, and `h()` warned about nested arrays
  in a function child, when a page set an undocumented `globalThis.__FORMA_DEBUG__`;
  no document, test or application referenced it. Behaviour is unchanged.
- **The duplicate-instance registry is development-only (C3).** The
  `Symbol.for('@getforma/core#instances')` counter and its 467-byte warning no
  longer ship in production builds, the CDN bundles included; the development
  build keeps them and warns once for a second development copy. Two physical
  copies of core in one bundle remain `@getforma/build`'s `BUILD-816`
  diagnostic, found on the bundler's metafile. A page mixing two production
  copies gets no console line from core (`docs/CDN-AND-EXPORTS.md`).
- **Measured** (`npm run check:size`, gzip; the Counter route at gzip -9 by
  `@getforma/build`'s model of the minimal template's page): core entry 47,546
  to 46,097 B, browser ESM 47,203 to 46,115 B, HTML runtime 41,648 to 41,254 B,
  hardened runtime 40,509 to 40,175 B, frame runtime 39,997 to 39,603 B, the
  Counter route 25,759 to 25,101 B (Brotli 23,004 to 22,482 B). The three runtime
  gates (41,500, 40,500, 40,000 B) are unchanged and pass again.
- **The core and browser-ESM gates ratchet to 46,500 B each** (L-51; decision
  brief L-55). The growth from 2.1.0's 29,515 and 28,369 B is two accepted
  contracts, not dead code: strict island activation (FORMA-104, DR-5: +19,043 B
  gzip on the core entry) and the declared island state block (FORMA-103, DR-4:
  +3,620 B), minus the retired repairing walker.
- **N2 restated** (DR-35's fallback, decision brief L-55): Forma's code per
  route, `@getforma/core` and `alien-signals` as bundled, at most **25,500 B
  gzip -9** (1 KB = 1,000 B), Brotli reported beside it; `@getforma/build`
  reports it per route and fails the build over it (`BUILD-819`). The 10 KB of
  v2 appendix C is unreachable under strict adoption: the floor without it is
  11 to 12 KB, and 2.1.0's island was 13.9 KB.

### Strict island activation — FORMA-104 development integration

- Connect the checked transaction to compiled SSR activation. It requires one matching owned Element, validates before publication, and makes zero initial DOM writes on success. Private phase replaces success-status/SSR-marker writes. Empty SSR, imperative Node/void returns and mismatches no longer select a repair or client fallback.
- Defer owned effects, refs and listeners until validation. A refused owner preserves original content, makes one error-status write and emits one bubbling `forma:error` with bounded identity/binding context and no props or payload. Earlier state preflight remains entirely write-free. Later failures dispose owned work without claiming rollback of application side effects.
- Preserve early edits only through compiler-proven local signal associations and reversible codecs; validate server defaults first, reject conflicts and hold seed notifications until commit. Literal initial controls preserve edits without seeding. Public `hydrateIsland()` uses strict caller-owned preparation but grants no compiled setter authority.
- Keep textarea/title text exact: no marker stripping or initial default repair. List diagnostics report known client items and actual DOM extent, not an inferred row count. Initial key-order parity remains required until FORMA-181.
- Materialize later branches and rows in their actual parent namespaces, with owned list/conditional ranges and template content. Construct a replacement before retiring its previous reader resources; failed construction retains the preceding DOM. Scalar Text identity and controlled textarea live/default writes stay shared with ordinary rendering.
- Preserve old tests/docs in the exact retirement archive and migrate current controls to matching preparation or explicit refusal. Historical benchmark figures remain historical; no fresh timing, bundle-size acceptance or overall FORMA-104 completion is claimed.

### Staged whole-page mount retirement — FORMA-105

- `mount()` refuses a `data-forma-ssr` target with `FORMA_E_MOUNT_SSR` before component/root/effect/listener creation or DOM writes. Ordinary Browser mounting, explicit browserOnly islands and public caller-owned `hydrateIsland()` are retained.
- Adoption-specific regression tests now call the retained public hydrator under explicit roots; the old mount/fallback assertions are archived exactly. Strict activation is now connected; compiler/static entry selection, the template successor and final packed qualification remain separate acceptance gates.

## [3.0.0-alpha.2] - 2026-10-15

Supersedes `3.0.0-alpha.1`, whose tag never published (its release run stopped in P17, the verification harness, before any publish job: the packed build's optional compiler peer resolved through the unbuilt workspace instead of the packed set; nothing reached the registries). The harness now resolves packed libraries inside the packed set and proves it. Version only; the alpha.1 notes below stand.

## [3.0.0-alpha.1] - 2026-10-15

The first 3.0.0 pre-release (milestone M2), published on npm under the `next` dist-tag; `latest` stays 2.1.0 and plain ranges exclude it (L-41). Part of the seven-package set 3.0.0-alpha.1 with `@getforma/compiler`, `@getforma/build`, `@getforma/create-app`, `forma-ir`, `forma-ir-derive` and `forma-server`. The breaking changes below (FORMA-109, 110, 112, 185) are the alpha's gates; island props, adoption, the literal registry, keyed rows and the marker rules (FORMA-103, 104, 105, 181, 182) are pending before the beta on the integration branch. N2 is restated per L-55 to 25,500 B gzip per route with the package caps ratcheting to 46,500 B after the safe cuts; this alpha still ships under the 30,000 (graph) and 29,000 (browser ESM) B gzip caps, which it passes. See the root CHANGELOG for the whole set.

### Typed raw boundaries — FORMA-109

- Raw markup APIs require `trustedHtml()` and reject strings and look-alikes before DOM writes or cache shortcuts, in both development and production. This includes `dangerouslySetInnerHTML`, `srcdoc`, `setAttr`, `setHTMLUnsafe`, `template`/`templateMany`, `reconcile`, `mountMarkup` and its update operation. Null/false clears remain supported; `h('script')` is refused.
- Runtime `data-bind:srcdoc` and row srcdoc interpolation produce a coded diagnostic instead of entering the native sink. Reused rows continue updating ordinary attributes with the same URL/event checks as first render.
- Browser controls exercise Report-Only and enforced policies, including native refusal, in Chromium, Firefox and WebKit. The shared `forma` mint remains callable by any page script and is not a sanitizer or caller-isolation boundary. See [migration](../../docs/TRUSTED-TYPES.md).

### Removed — FORMA-110

- Removed `@getforma/core/server`, `@getforma/core/ssr` and `@getforma/core/wasm`, their implementations, and their development warnings. Use authenticated Rust routes, forma-server's native walker and browser `h()` respectively. These subpaths no longer resolve in any export condition or TypeScript resolver.
- Preserved the 2.x guides in `docs/archive/2026-10-15-legacy-apis/`; the live API and security guides describe the remaining browser runtime. Tierless `reconcile()` retirement remains separate work (FORMA-108); raw-string retirement is FORMA-109 below.


- FORMA-185 stages the shared development version at `3.0.0-dev` for the FMIR
  compiler/reader contract. This is not a publication: CDN examples and support
  history still name the latest shipped core release. The documentation gate
  distinguishes the explicit `-dev` staging suffix from a release version.

### Changed

- FORMA-117: pin the runtime dependency `alien-signals` to exactly 3.1.2. Upgrades require an explicit reviewed dependency change.

### Documentation

- **A2 audit follow-ups, group 1 (FORMA-180).** `docs/HTML-RUNTIME.md`'s
  frame section says the inlined frame runtime is unminified and
  uncompressed, about 160 KB raw, so the application compresses the frame
  responses (F1; the minified build is FORMA-118). The 2.1.0 Upgrading list
  names `FORMA_W_INNER_HTML_CHILDREN`; `SECURITY.md` counts three IIFE
  globals, not two, and says outright that any script on the page can mint a
  `forma` value through the Trusted Types registry, and which boundary the
  directive does enforce (F12); `docs/STABILITY.md` no longer claims the
  `FORMA_W_` codes are listed nowhere else; `CSP.md`'s sink row names
  `templateMany()`, `mountMarkup()` and `srcdoc`, its code list gains
  `FORMA_E_CALL_DENIED`, `FORMA_E_UNSUPPORTED` and the two grant codes, and
  it describes the frame document's hash-allowed script (F10).

### Tests

- `src/expr/__tests__/string-growth.test.ts` > "converting a 4,096-character
  numeric string charges at least PARSE a character" pins the rate an
  operator's parse of a long string is charged at; a mutant charging a 256th
  of it survived the suite in FORMA-179's runs (F15).

### CI

- `release.yml`'s `test` and `pack` jobs run `npm audit signatures` after
  `npm ci`, so an installed package whose registry signature or attestation
  does not verify fails the run before anything is built; the SR43
  lint's new rule S1 requires the audit as the step after every `npm ci` in
  the workflow and nowhere else, with eight seeds (F11). The packed bytes are unchanged.
- The Playwright system-package retry in `e2e-engines.yml` and `ci.yml`
  tolerates a failing `dpkg --configure -a` and waits out the dpkg lock (up to
  60 s) before its second attempt; under errexit the failure ended the step
  before the retry ran. The step's bound rises from 9 to 11 minutes for the
  wait (F17a).

## [2.1.0] - 2026-10-14

Release A2, the bridge to 3.0.0: additive, with deprecations. Every 2.0.3 call
keeps working; the old forms warn in development builds and go in 3.0.0. What
an application may meet on upgrading is listed first, then the sizes, then
each change. Rollback: pin 2.0.3.

### Upgrading from 2.0.3: what an application may meet

- **The HTML runtime's expressions are charged per task and per event, and
  operators that build strings are charged** (Security). Some computations
  2.0.3 answered are refused with `FORMA_E_BUDGET`: building a string with
  `reduce` and `+` past about 1,200 rows of 20 characters, for one. Bindings
  that together pass the budget in one task render over several tasks, so a
  frame or two may show a binding's previous text, and `data-forma-expr-budget`
  now sets a task's budget, not each evaluation's. The full list is under
  Security, "Behaviour change: what a task can no longer compute".
- **List adoption: a row-count mismatch leaves the island inert** (Changed,
  FORMA-123). Unkeyed server rows whose count differs from the client array
  (an empty array included) are no longer removed or rendered fresh: the
  island is marked `error`, and `FORMA_E_HYDRATE_LIST_COUNT` is logged in
  every build. A list the client computes for itself inside a server-rendered
  island now needs its signal started empty, or rendering in the browser only.
  Adoption also runs in a batch: effects a write during adoption triggers run
  when the walk ends.
- **`data-fetch` aborts a request after 30 seconds** (`data-fetch timed out
  after 30000 ms` in the `error:` target), and `createWebSocket` waits a
  random delay up to its backoff cap before each reconnect (Changed,
  FORMA-132).
- **Development builds now warn.** The package's `development` export
  condition (Added, FORMA-169) is what Vite's dev server, webpack in
  development mode, Vitest and Bun's bundler pick by themselves, so core's
  development warnings reach them for the first time: the deprecations below
  (`FORMA_W_RAW_*`, `FORMA_W_SCRIPT_ELEMENT`, `FORMA_W_DEPRECATED_*`), hydration
  mismatches, dropped props. A test suite that fails on console output fails
  on them; run it with `NODE_ENV=production` to keep it on production files.
  Production files are unchanged by this.
- **Trusted Types.** Core's own writes pass Trusted Types through two
  policies it creates, `forma` and `forma-runtime`, where the browser has
  them. Under forma-server 0.2.2's Report-Only header, a string an
  application writes to a raw sink is reported, not blocked; a page whose own
  enforced `trusted-types` directive leaves out either name makes core write
  strings it then refuses (`FORMA_W_TT_POLICY_REFUSED` in development).
- **Client-rendered SVG and MathML** take the namespace of the content they
  are built in where `h()` knows the parent (Fixed, FORMA-026): a `title`,
  `a`, `script`, `style` or `font` that 2.0.3 created as HTML inside an SVG is
  now SVG, which changes what CSS and `instanceof` see.
- **A reactive `dangerouslySetInnerHTML` is adopted as content** (Fixed,
  FORMA-176), where 2.0.3 wrote it as an attribute. Children given beside the
  prop (a function, or a value that is not `null`, `undefined` or `false`)
  log `FORMA_W_INNER_HTML_CHILDREN` once in a development build, from h() and
  from adoption, and adoption binds none of them where 2.0.3 adopted them:
  give the element one or the other.
- **Two type changes.** `RuntimeDiagnostic.kind`, which `getDiagnostics()`
  returns, gains `'grant-denied'`, so an exhaustive `switch` with a `never`
  check stops compiling under `strict` until it handles it. JSX's
  `dangerouslySetInnerHTML.__html` and `srcdoc` are typed `RawMarkup`
  (`string` or a `trustedHtml()` value), so a component that reads
  `props.dangerouslySetInnerHTML.__html` or `props.srcdoc` as a `string` no
  longer compiles; writing a string still does. Nothing is removed or
  renamed.
- **Bigger runtimes.** The CDN runtimes grow by about 7.2 KB gzipped, the core
  entry by about 1.8 KB (Size, below).

### Size: 2.1.0 against 2.0.3

Measured on the release tree with `npm run check:size` (gzipped, each entry
with every chunk it imports), and for a page with one island bundled from the
core entry with esbuild 0.28.1 (minified, gzip -9). Each change's own Size
line below is its merge against its first parent on `main`, re-measured for
this release (FORMA-138); three were corrected to those measurements
(FORMA-026, FORMA-123 and FORMA-173 had been measured on an earlier base).

| Entry | 2.0.3 | 2.1.0 | Change | Gate (headroom) |
|---|---|---|---|---|
| core entry + its chunks | 27,703 B | 29,515 B | +1,812 B | 30,000 B (485 B) |
| CDN runtime | 33,861 B | 41,094 B | +7,233 B | 41,500 B (406 B) |
| CDN hardened runtime | 32,873 B | 40,106 B | +7,233 B | 40,500 B (394 B) |
| CDN browser ESM | 26,614 B | 28,369 B | +1,755 B | 29,000 B (631 B) |
| preview frame runtime (new) | none | 39,705 B | new | 40,000 B (295 B) |
| a counter island page (`docs/ISLANDS.md`'s `Counter`) | 12,974 B | 13,820 B | +846 B | none |
| a `createShow` and `createList` island page | 12,986 B | 13,842 B | +856 B | none |

The runtime gates rose under L-51, from 34,000 and 33,000 B, with each
change that passed them (FORMA-132, FORMA-028 and FORMA-025, FORMA-126 and
FORMA-127, FORMA-173, FORMA-128, and FORMA-128's follow-up for the audit,
formajs#35, which also raised the frame runtime's gate to 40,000 B).

### Security

- **The preview frame mounts no `<link>` and no `srcdoc`** (FORMA-128's
  follow-up; the A2 audit, S1; formajs#35's review, B1 and S2). WebKit opened
  a TCP connection to any host a previewed module's `<link rel="preconnect">`
  named, its `href` written or bound, from inside the sandboxed frame:
  `connect-src 'none'`, `default-src 'none'` and the sandbox do not govern
  preconnect. An unreviewed mount (`tier: 'unreviewed'`, which the frame
  runtime uses) now parses its markup once, in the root's own context, removes
  every `<link>` and every `srcdoc` attribute from those nodes, nested
  templates included, and writes the nodes themselves: the root is never given
  a string, because a strip done in an inert `<template>` and then written
  through `innerHTML` was a second parse in another insertion mode, and
  foreign content and foster parenting (nested `<form>`, `<math>`, `<mglyph>`,
  `<style>`) re-created in it a `<link>` the first parse had not seen, in all
  three engines, with WebKit connecting (B1). After every write the live
  subtree is checked again, and a `<link>` or `srcdoc` found there is removed,
  reported, and the render refused with the root cleared. `srcdoc` goes too
  because an `<iframe srcdoc>` parses a child document the strip cannot see
  into, and WebKit connected for a `<link>` in it (S2): the attribute is
  removed from the markup, and `data-bind:srcdoc` is refused in this tier
  before it runs. Each removal is a coded diagnostic (`FORMA_E_UNREVIEWED_LINK`,
  `FORMA_E_UNREVIEWED_SRCDOC`; kind `markup-refused`, reported whatever any
  diagnostics switch says; the frame forwards it to its host). Under the
  frame's policy no `<link>` did anything else, and a binding cannot create an
  element. Measured with a TCP listener: without the strip this repository's
  frame spec counted 1, 1 and 4 connections in Chromium, Firefox and WebKit,
  and with the template strip alone the foreign-content payloads still placed
  a `<link>` in the document in all three and connected in WebKit; now none.
  Tests: `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount
  renders no <link>: each is removed before the markup reaches the document",
  "an unreviewed mount parses its markup once, in the root's context, and
  writes no string to the root", "an unreviewed mount renders no srcdoc: the
  attribute is removed, a binding that would write one is refused, and each is
  reported", "an unreviewed mount fails closed: a <link> that reaches the root
  after the strip is removed, reported, and the markup refused";
  `src/__tests__/runtime-frame.test.ts` > "a module's <link> never reaches the
  frame document, and the host hears why", "a module's srcdoc never reaches
  the frame document, and the host hears why"; `e2e/frame.spec.ts` > "a
  module's <link> opens no connection: preconnect, dns-prefetch, prefetch,
  preload, a bound href", "a module's <link> survives no second parse: foreign
  content and foster parenting open no connection, after render and after
  update()", "a module's iframe srcdoc renders no document: the attribute is
  removed, written or bound, and nothing connects" (three engines). Size
  (L-51): the CDN runtime 40,329 to 41,094 B (gate 41,500), the hardened
  runtime 39,344 to 40,106 B (gate 40,500), the frame runtime 38,953 to
  39,705 B (gate 40,000); the review's one parse, live check and `srcdoc`
  refusal are 454, 449 and 441 B of that.

- **The tiered mount: markup a generator wrote mounts under a root it is
  handed, with grants** (FORMA-128; decision brief DR-14, DR-15, L-36, L-47;
  v2 TH11, SR16, SR31, SR37's runtime half). The script-tag runtime binds
  every `data-forma-state` that reaches the document, and an expression can
  reach any element `closest()` and `querySelector()` reach and send
  `data-fetch` with the user's cookies. `mountMarkup(root, markup, { tier,
  grants, config })` (under *Added*) is the path for markup the build did not
  compile:
  - it binds only under its root, never by watching `body`, and none of the
    tierless paths (the auto-mount, the observer, `mount()`, `unmount()`,
    `destroyRuntime()`, `reconcile()`) binds or disposes anything under it, nor
    binds the mount's elements from a scope around it;
  - its configuration comes only from its call: a script tag's
    `data-forma-expr-budget` (up to 100 times the step budget), the page's
    diagnostics switch and the server's directive map do not reach it;
  - every hop from `$el`, `$event` or `$refs` that yields an element is
    checked against the root, and one past it is refused with
    `FORMA_E_GRANT_DOM` unless the mount grants `dom`; without `dom`,
    `closest()` walks only up to the root and answers `null` past it, never
    testing an element outside it (so `$el.closest('body')` reaches nothing,
    and no answer can read an outside ancestor's attribute a character at a
    time: formajs#30's review, B1), and a selector given to `matches()`,
    `closest()` or `querySelector(All)()` must be local (no combinator, which
    would ask about an ancestor or a sibling, and no `:has()`, `:scope` or
    `:host`);
  - `data-fetch` sends only what the `fetch` grant names (methods, path
    prefixes checked on the normalised path, cookies or not, a timeout up to
    30 s), and `click()` needs `navigate`, as does `$dispatch` of an
    activation event (`click`, `auxclick`, `DOMActivate`, `submit`,
    `reset`), which WebKit or Firefox run as activation (review S1); a status
    outside 200-299 is an error in the `error:` target, never data;
    `$refetch` reaches only its own mount's fetches;
  - every denial is a coded `formajs:diagnostic` (`kind: 'grant-denied'`,
    `FORMA_E_GRANT_FETCH`, `_DOM` or `_NAVIGATE`, with the grant, the mount's
    name and its tier), whatever any diagnostics switch says, counted per
    mount;
  - an `unreviewed` mount refuses every origin but an opaque one, and takes no
    grants;
  - a page turns every tierless path off with `data-forma-mount="manual"` on
    the runtime's own `<script>` (a CDN build) or on the module script that
    loads the application (an ESM build): no auto-mount, no `body` observer,
    and `mount()`, `initRuntime()` and `reconcile()` throw
    `FORMA_E_MOUNT_MANUAL`, so only `mountMarkup()` binds and markup injected
    outside a tiered root stays unbound (SR16, in 2.x). The switch is read
    once, before the first bind; only `manual` counts and one element is
    enough, so it can only take binding paths away; it needs no inline script.
    The default stays 2.0.x's auto-mount.

  Leaving out `grants` gives every grant, the bridge to 3.0.0's none
  (FORMA-108); a development build reports what each mount used. Without the
  switch, the tierless paths still bind markup injected outside a tiered root
  wherever a page loads the runtime, until 3.0.0 removes them. SECURITY.md lists what a mount does not bound
  (`$dispatch`, focus and scroll, `data-persist`'s shared keys, inherited
  pseudo-class bits, redirects). Tests: `src/__tests__/runtime-tiered-mount.test.ts`
  (SR16: "binds only under the root it is handed: markup injected outside it
  stays unbound", "no tierless path binds markup under a tiered root";
  L-36: "$el.closest('body') reaches nothing without dom", "no hop from $el
  reaches past the mount root: %s" with its completeness check over the
  allowlist, "a selector that reads past the element needs dom: %s"; SR31:
  "with explicit empty grants a generated tree binds neither data-fetch nor
  $el.click()", "a 404 with a JSON body lands in the error: target, not the
  data target"; SR37: "a seeded denial raises one coded diagnostic, whatever
  the page's diagnostics switch says"), `src/expr/__tests__/selector.test.ts`,
  and 55 new mutation probes (`probes/corpus.json`: 47 `tiered/*`, 7
  `selector/*` and `runtime/reconcile-no-deprecation`), all caught. The allowlist snapshot
  gains `element:needs-navigate.click` and the four `element:selector.*`
  methods: a restriction recorded where the capabilities are, not a new one.
- **Size** (L-51): measured on `main` with FORMA-126/127 and FORMA-173, the CDN
  runtime grows by 3,753 B gzipped (36,576 to 40,329 B) and the hardened
  runtime by 3,745 B (35,599 to 39,344 B); their gates rise from 37,000 to
  40,500 B and from 36,000 to 39,500 B. The bytes are the
  mount, its grant checks, the selector check (about 450 B), the page's
  mount switch (about 215 B), and the review's confined `closest()` and gated
  `$dispatch` (about 225 B). The core entry and the browser ESM bundle are
  unchanged.

- **Operators that build or read strings are charged before they run**
  (FORMA-028, DR-16). Core 2.0.3 charged every built-in call but no operator,
  and the engine keeps a joined string as a rope that its first read copies
  whole, so an expression with no state could build a 524,288-character rope in
  19 steps and read copies of it for 0.6 to 4.3 s at 4x CPU throttling (the
  cases of formajs#14's second review). Now:
  - `+`, `+=` and template literals pay a 128th of a unit for each character
    they build past 511 (a string under 512 characters is free: the step
    budget bounds how many one evaluation builds);
  - comparing two strings of 128 characters or more pays a 128th a character
    compared (`===` and `==` only when the lengths match), and an array search
    for such a string pays for every element of the same length;
  - an operator that parses a string of 32 characters or more as a number
    (`s * 1`, `-s`, `s < 1`, `s == 1`) pays an eighth a character: parsing
    digits measured 11 ns a character, and a thousand conversions of a million
    digits ran for eleven seconds;
  - comparing, or reading a character of (`at`, `charAt`, `charCodeAt`,
    `s[i]`), a string the same expression has just built with `+` or a
    template pays for copying it: 8 units plus a 32nd a character, to 512;
  - a default `sort()` adds each string element's length, at a 128th, to every
    level of its comparisons.

  Each case of the review is refused with `FORMA_E_BUDGET` before the long
  task: at 4x, in Chromium 151 on an Apple M1 Pro, the slowest of 41 runs took
  27 ms. A loop of character reads is otherwise bounded by the step budget, as
  before. `+=` now keeps the 1 MiB result cap that `+` has.
- **The budgets are one per task and per event, not per evaluation**
  (FORMA-028). The runtime keeps a meter of what the evaluations of the
  current task have spent, and every evaluation it starts counts on from it,
  for the 250,000 units and the 100,000 steps alike; an evaluation started
  inside another (a `data-computed` a binding reads, a handler `$el.click()`
  or `$dispatch` reaches) spends the running one's budget. Ten bindings at the
  cap in one widget used to run in one 382 ms task. A binding refused only
  because the bindings before it in its task spent the budget is not reported:
  it renders in the next task, where it starts first, so those ten render one
  task at a time, none over 42 ms at 4x. A binding over the budget on its own
  is reported as before. A computed refused inside a heavy reader is evaluated
  alone at the start of the next task, so its refusal is not cached as its
  answer. A handler cannot be re-run, so an event the runtime has not seen
  (and a `data-model` input) starts a fresh meter, unless an evaluation
  dispatched it, and the handlers one event reaches as it bubbles share it. A
  binding refused for allocation waits for the next task if the task had spent
  allocation units before it (steps do not change whether a charge fits);
  otherwise it is reported at once. A charge that a cost-table row sizes
  directly (such as `Array.from`'s length) and that is larger than the whole
  budget is reported at once, whatever the task had spent; a weighed value too
  heavy for any task that arrives late in a busy task is counted only to the
  room left, so it waits once, is weighed in full when it runs first, and is
  then reported once. Once a binding waits, each later charge in that task is
  counted only to 10,000 units: a light binding (a case mapping, a formatted
  number, fifty names joined) still fits and renders now, and a heavier value
  is refused after counting that far and waits too, so a waiting binding costs
  little however heavy its value (FORMA-173: ten or twenty bindings each
  weighing most of the budget, or twenty each a little heavier than the room
  left after 5,000 units, made tasks of 53 to 65 ms p99 at 4x when every
  waiting binding weighed its value in full in every retry; those three now at
  most 24 ms). Together, the refusals after a wait count at most 50,000 units
  in a task, and one cap more: past that every later charge in the task is
  refused at once, so a light binding that charges anything waits a tick too
  (FORMA-173 review: 400 bindings after a wait, each a little over or under
  the cap, made tasks of 66 and 69 ms p99 at 4x with the cap alone; now 24 and
  15 ms).
- **The runtime's own conversions of a result to text are charged before
  they run** (FORMA-025). `data-text`, `data-bind:*`, `data-model`,
  `data-persist`, and a `data-list` row's `{item.x}` placeholders and
  `data-key` are charged, inside the binding's budget, for the `String()` or
  `JSON.stringify` they are about to make of the value (an array or object at
  its text weight; a string a row places, at a 128th a character). A list of a
  thousand references to one 300,000-character string costs 2,000 units to
  build and would be 300 million characters as text: `data-text` of it is
  refused in 2 ms at 4x, and `String()` never runs.
- **An ordinary search answers in Greek, Cyrillic, CJK and Latin Extended as
  2.0.1 does** (FORMA-028, L-50). Core 2.0.3 charged lowercasing any text with
  a character above Latin-1 at half a unit a character, so the text filter
  `rows.filter(r => (r.title + ' ' + r.body).toLowerCase().includes(q))` over
  260-character records was refused past about 1,716 records of such text.
  Lowercasing two-byte text measured 4 to 19 ns a character at 4x in Latin
  Extended, Greek, Cyrillic, Armenian, Hebrew, Arabic, the Indic scripts,
  Thai, Vietnamese, CJK, kana, Hangul and emoji, and 17 to 40 ns beyond them.
  Text whose first character above Latin-1 is in one of those scripts now costs
  1/16 a character, so the search answers 9,090 records, where the step budget
  stops it in every release, as it does for ASCII; Georgian, Cherokee, Greek
  Extended or fullwidth Latin text keeps 1/2 (about 2,280 records, 2,170 in
  2.0.3). Latin-1
  text answers as in 2.0.3. A string method now reads a string argument (a
  search pattern, a separator) for a 32nd of a unit a character instead of a
  whole unit. `src/expr/__tests__/ordinary-search.test.ts` holds the corpus:
  900 and 9,000 records in seven scripts.
- **Case mapping past the 1 MiB result cap is refused before it runs**: 2.0.3
  lowercased 8 million two-byte characters (115 ms at 4x) before refusing the
  result.
- **SR33 is checked in a browser**: `e2e/sr33.spec.ts` gives every allowlisted
  native a hostile size, in Chromium at 4x and then in Firefox and WebKit, and
  asserts that each is refused before the native runs, that no task reaches
  50 ms and, in Chromium, that the heap grows under 16 MB. Its table is the one
  `native-cost.test.ts` checks in Node.
- **Still not bounded to 50 ms**, and listed in SECURITY.md ("What the budgets
  do not bound"). The meter is zeroed by each event the runtime has not seen,
  so the several events one task can deliver (those of one click or keystroke,
  one per control of a submitted form) each get a budget: a widget that
  handles all of them spends a budget per event in that task. Under A14 every
  widget is the founder's reviewed code, and this is carried with the rest.
  Each of the following is bounded to one evaluation per task: a string search
  whose pattern's first characters fill the text (`'ab'` in `'aaaa…'`, 39 ns a
  character where ordinary text takes 1; one evaluation ran up to 315 ms at
  4x); case mapping of text stored two bytes a character but all Latin-1
  (charged as one-byte text, up to about four times under: 56 ms for seven
  calls on a million characters, 100 ms for alternating-case text); and text
  whose first character above Latin-1 is in a `1/16` script but whose rest is
  costlier (all-capital Greek 73 ms for four calls on 960,000 characters; a
  Greek letter followed by Cherokee 90 ms), because a full scan of two-byte
  text measured 6 to 7 ns a character, most of what lowercasing it costs. Its
  bound is a task's 4 million characters at 1/16 lowercased at about 40 ns,
  the costliest measured: about 160 ms. Turkish `İ` (U+0130) is a Latin
  Extended-A letter, so text with it is priced 1/16 though it measured 27 to
  30 ns a character: one call on a million ran 76 ms before the 1 MiB cap
  refused its two-million-character result. Nor does the budget price
  `data-list`'s rows: about 14 µs each at 4x, in 2.0.3 as here (FORMA-172).
  The largest ordinary evaluation is near the line as well: the 9,000-record
  search measured 24 ms median at 4x in ASCII and up to 50 ms in Greek, where
  2.0.1 measured 19 and 42 ms in the same session.
- **Behaviour change: what a task can no longer compute.** Measured with this
  release's engine against 2.0.3's:
  - Building a string with `reduce` and `+`, accepted by the lead (L-50):
    `rows.reduce((s, r) => s + r.name + ', ', '')` over names of 20 characters
    is refused past about 1,200 rows, where 2.0.3 answered about 14,300. Each
    `+` is charged the whole length it builds, so an accumulator pays the
    square of its length. `rows.map(r => r.name).join('')` stays cheap: it
    answers about 11,360 rows of 20 characters, as 2.0.3 does, in 7 ms median
    at 4x for 11,000; with separators, `rows.map(r => r.name).join(', ')`
    answers about 10,400.
  - Comparing two strings a callback has just built, or reading a character of
    one: `(s + 'y') === (s + 'z')` over 100-character strings past about
    10,280 iterations, `(s + 'y').charCodeAt(0)` past about 15,470 (2.0.3:
    about 12,500 and 16,700, where the step budget stops them). A string read
    from state, or held in a variable, costs what it did.
  - A default `sort()` of 10-character strings past about 6,280, counting
    everything else the evaluation does (numbers: about 6,400, as before).
  - Bindings that together pass the budget in one task render over several
    tasks: until its turn, a binding shows what it showed before, so a frame
    or two may show a binding's previous text. Once one waits, a later binding
    in that task whose charge is past 10,000 units waits too; a lighter one
    renders at once, until the refusals after the wait have counted 50,000
    units, when any binding that charges anything waits too.
  - `data-forma-expr-budget` now sets the step budget of a task (of an event,
    for a handler and the bindings it updates), not of each evaluation. A page
    that set it low renders its bindings over more tasks than before, where
    2.0.3 gave each binding the whole of it.
  - A computed read inside a binding spends that binding's budget.
  - Among the handlers one event reaches as it bubbles, one that finds the
    budget spent by the handlers before it is refused with `FORMA_E_BUDGET`.
  - A handler's `x += s` that would build a string past 1 MiB is refused, as
    `x = x + s` was.
  - What the runtime converts to text is charged as an expression converting it
    would be (FORMA-025), so a value heavier than the budget is not written:
    `data-text` (or `data-bind`, `data-model`) of an array of 20-character
    strings past about 11,360 elements, counting what built it (2.0.3: about
    33,000, where the step budget stops `map`); `data-persist` of a value past
    about 250,000 characters as JSON, which is reported and leaves the stored
    copy as it was; a `data-list` whose row template places a whole object
    (`{item}`) past about 250,000 characters across its rows (2,500 rows of
    100-character records). A string a row places costs a 128th a character,
    so ordinary lists are not affected.

  More is answered than in 2.0.3, too: the non-Latin search, and a string
  method given a long string argument. Rollback: pin 2.0.3.
- **Size** (L-51): measured on `main` with FORMA-132, the CDN runtime grows
  by 1,479 B gzipped (34,061 to 35,540 B) and the hardened runtime by 1,470 B
  (33,072 to 34,542 B); their gates rise from 34,500 to 36,000 B and from
  33,500 to 35,000 B. This change leaves the core entry and the browser ESM
  bundle as they were.
- **Size** (L-51, FORMA-173): measured on `main` with FORMA-126 and FORMA-127,
  deferral decided per budget, the cap on a charge after a binding waits and
  its per-task allowance grow the CDN runtime by 202 B gzipped (36,374 to
  36,576 B) and the hardened runtime by 203 B (35,396 to 35,599 B); their
  gates rise from 36,500 to 37,000 B and from 35,500 to 36,000 B. The core
  entry and the browser ESM bundle are as they were (29,515 and 28,369 B).
- **What core writes of its own passes Trusted Types, and its raw sinks take
  them** (FORMA-126, FORMA-127; DR-19, DR-20). Under a page policy with
  `require-trusted-types-for 'script'`, which forma-server 0.2.2 sends as
  Report-Only and 3.0.0 enforces, a string written to an HTML or script sink
  is reported, and refused where enforced.
  - `mount()`, the function it returns, and a reactive
    `dangerouslySetInnerHTML` that becomes `null` emptied an element with
    `innerHTML = ''`; they now call `replaceChildren()`, which no policy
    checks.
  - The raw sinks (`dangerouslySetInnerHTML`, `setHTMLUnsafe()`, `template()`
    and `templateMany()`, the runtime's `reconcile()`, and a `srcdoc` value on
    `h()`, in adoption and in `./ssr`) write a `trustedHtml()` value as the
    `TrustedHTML` it is. Anything else is written exactly as before: a string,
    and a non-string where the sink converted one (`setHTMLUnsafe()`,
    `template()`, `srcdoc`); `dangerouslySetInnerHTML` and `reconcile()` still
    refuse a non-string with a `TypeError`.
  - Only a trusted `srcdoc` is written as itself. An attribute value is
    otherwise converted to a string once, for the URL guard and the write
    alike (formajs#29's review, B1: an object whose string changed between
    the two would have written `javascript:`).
  - `reconcile()` trims what it is given before parsing it, so markup that
    arrived as a browser `TrustedHTML` is minted again, trimmed, through core's
    second policy, `forma-runtime`, and parsed by it; a string is never
    minted. The diff of trusted markup mints a changed `srcdoc` of an iframe
    that markup parsed into, and writes no `on*` attribute or script `src` (or
    `href`): a changed one is removed, as h() and adoption write no `on*` name.
    The diff of a string writes every changed attribute, those included, as
    2.0.3 did (formajs#29's second review, R1: L-18). It records
    markup as current only once the write succeeded, so after a write the page
    refused, the same markup as `trustedHtml()` is not skipped as unchanged.
  - Each policy is made once per page, on first use, since an enforcing page
    refuses a second policy of one name, and every copy of core on the page
    (the runtime's IIFE beside core's ESM build) shares it through a registry
    on `globalThis` (`Symbol.for('@getforma/core#trusted-types')`, a record
    with no prototype). The registry holds no policy object: it holds the mint
    `trustedHtml()` is, which a consumer's SR8 lint lists as a raw entry, and
    a `forma-runtime` parser that takes only a browser `TrustedHTML`, so on an
    enforcing page no script can mint a `forma-runtime` value from a string.
    If the page refuses
    a name, core writes strings (which the page then refuses), and a
    development build logs `FORMA_W_TT_POLICY_REFUSED` once per name. An
    element clobbered onto `window.trustedTypes` is not taken for Trusted
    Types.
  - In Chromium, Firefox and WebKit, served with `require-trusted-types-for
    'script'; trusted-types forma forma-runtime` Report-Only and enforced,
    core's own test pages and every raw sink given `trustedHtml()` raise no
    violation, a `reconcile()` diff that changes an iframe's `srcdoc` and a
    button's `onclick` included; a string written to `innerHTML` raises one
    report and still renders under Report-Only (`e2e/trusted-types.spec.ts`).
  - Not covered: the HTML runtime's own `srcdoc` bindings
    (`data-bind:srcdoc`, `{item…}` in a list row's `srcdoc`) write an
    expression's value or a row's data as a string that such a page reports or
    refuses; see *Deprecated*.
- **Size** (L-51, FORMA-126 and FORMA-127), measured against `main` with
  FORMA-123 and FORMA-169: `trustedHtml()`, the two policies, the typed
  `reconcile()` and its parser grow the CDN runtime by 834 B gzipped (35,540
  to 36,374 B) and the hardened runtime by 854 B (34,542 to 35,396 B). Both
  passed their gates, which rise to the measured size rounded up to the next
  500 B: 36,000 to 36,500 B and 35,000 to 35,500 B (`scripts/check-size.mjs`,
  the README's size table). The core entry grows by 509 B (28,776 to 29,285 B
  of its 30,000 B gate) and the browser ESM bundle by 517 B (27,626 to
  28,143 B of 29,000 B); the runtime's parser is a module of its own
  (`src/dom/runtime-parser.ts`) that only `reconcile()` imports, so the core
  entry does not carry it. The production files that changed are the ones that
  reach a raw sink: the entries `index`, `runtime`, `runtime-hardened` and
  `ssr/index` (ESM and CJS), the shared chunks holding the DOM and the URL
  checks (which now hold `trustedHtml()` too), and the CDN bundles; `http`,
  `server`, `storage`, `tc39-compat`, `wasm` and the reactive chunks are
  byte-identical. No development warning reaches a production artifact: each
  sits behind the build flag inside `src/dom/trusted-html.ts`, which the build
  folds in every artifact and chunk.

### Added

- **`mountMarkup(root, markup, { tier, grants, config })`, the tiered mount,
  from `@getforma/core/runtime`** (FORMA-128; DR-14, DR-15). The markup is a
  string or `trustedHtml(markup)`, as `reconcile()` takes. Tiers
  `'compiled'`, `'reviewed'` and `'unreviewed'`; grants `fetch` (`methods`,
  default `['GET']`; `paths`, prefixes on the page's origin or absolute
  `http(s)` ones; `cookies`, default false; `timeoutMs`, at most and by
  default 30,000), `dom` and `navigate`; configuration `name`, `exprBudget`,
  `diagnostics` and `autoContainment`. It returns a handle: `update(markup)`
  reconciles, `unmount()` disposes and empties the root, and
  `grantsUsed()` returns, in a development build, the grants the mount has
  used, written as grants (`null` in production), so a reviewer writes grants
  from observed use. Misuse throws a `FORMA_E_MOUNT_*` code at the call.
  `docs/HTML-RUNTIME.md` has the reference and the shared responsibility: the
  application chooses the tier and passes grants only for content whose hash
  was reviewed (L-47). Tests: `src/__tests__/runtime-tiered-mount.test.ts`
  ("the development report lists exactly the grants a fixture widget used",
  "a request sent without cookies is reported without them", "a fetch grant
  admits only its methods and path prefixes: %j %s", "a fetch grant's cookies
  decide the request's credentials", "a fetch grant's timeout shortens the
  abort", "$el.click() is denied without navigate and runs with it", "a tiered
  mount takes its step budget from its call, never from a script tag", "a
  mount call names a known tier, an element and markup, and mounts a root
  once", "unmount() disposes every binding and empties the root; update()
  after it throws", "bindings a tierless path made under the root go first,
  with what they rendered").

- **The preview frame's runtime, `dist/formajs-frame.global.js`** (FORMA-128;
  DR-14 tier (c), L-12, L-33, L-44; v2 SR32). Content nobody reviewed renders
  only in an opaque-origin frame with no network, whose document
  forma-server's `PageResponse::frame` writes (FORMA-125) with this runtime
  inline. It is one classic, self-contained script, the same bytes from the
  same sources (a policy allows it by its SHA-256 hash), with no `</script`,
  `<!--`, `import` or source map comment, and it creates no script of its own;
  built with a frame flag, it never mounts the page on load or watches `body`.
  It renders into `<div id="forma-frame">`: it takes one `MessageChannel` port
  from the first message its parent posts carrying exactly one, accepts on it
  only `{ type: 'module', html }` (mounted with `tier: 'unreviewed'`, no
  grants; later ones update it), and sends only `ready`, `resize` (the
  document's height) and `error` (`FRAME_E_MESSAGE`, `FRAME_E_RENDER`, and the
  diagnostics the runtime raised for the module, by code; never a module's own
  `$dispatch('formajs:diagnostic', …)`, though a diagnostic quotes the
  module's expression, so a host treats `error` text as untrusted). A module
  styles itself with `style` attributes only: under the frame's nonce-only
  `style-src` its `<style>` blocks do not apply. `scripts/verify-dist.mjs` checks the
  published file can be inlined as it is. Copying it into an application's
  assets as `forma-runtime.js` is the build's half (FORMA-175). It mints the
  module with `trustedHtml()`, so the frame's policy may require Trusted Types.
  Size: 38,953 B gzipped, gated at 39,000 B (`scripts/check-size.mjs`, the
  README's table).
  Tests: `src/__tests__/runtime-frame.test.ts` ("takes one port from its
  parent, renders each module in tier (c) and answers only ready, resize and
  error", "ignores a port from any window but its parent, and every port after
  the first", "refuses every message but the module, and changes nothing", "on
  an origin that is not opaque it renders nothing and says so", "the frame
  runtime is one classic script a server can inline as it is" and its control,
  "two builds of the frame runtime are byte-identical"), `e2e/frame.spec.ts`
  (a sandboxed iframe under a hash-only `script-src` and `connect-src 'none'`,
  in three engines), ten new probes (`frame/*`), all caught.

- **`browserOnly(component)`, the browser-only marker** (DR-1, L-1, FORMA-119).
  Wraps a component that renders in the browser alone; one name, so a search
  finds every use. `@getforma/compiler` 0.3.7 and later emit
  `const X = browserOnly(Impl)` as a registered island whose server output is
  its empty host element with its declared props (`data-forma-props`).
  Registered as it is (`activateIslands({ X })`), activation calls it with the
  island's element and props, and it renders `Impl(props)` in the host's place;
  called as a component in a client-rendered tree it renders `Impl(props)`;
  with no document it renders nothing. Additive: no existing export changes.
  The core entry grows 103 B gzipped (27,703 to 27,806 B of its 30,000 B gate)
  and the browser ESM bundle 99 B; the CDN runtimes do not change.
- **A development build, behind the `development` export condition**
  (FORMA-169; L-18's A2 bridge, whose old paths "warn in development builds").
  Every published file folds `__DEV__` to `false`, so no development warning
  in core reached anyone who installed the package: not FORMA-131's
  deprecations, not the hydration-mismatch, dropped-prop or raw-HTML-sink
  warnings. Each `exports` subpath's `import` and `require` branch now has a
  `development` key, after `types` and before `default`, that selects a twin
  of its file under `dist/dev/`: the same sources and options, with `__DEV__`
  folded to `true`. The type declarations are shared. Vite's dev server,
  webpack in development mode, Vitest and Bun's bundler select it by
  themselves; esbuild with `conditions: ['development', 'module']`, Rollup with
  `exportConditions: ['development']`, Node with `--conditions=development`,
  and `@getforma/build` in watch mode (forma-tools, FORMA-169).
  `docs/CDN-AND-EXPORTS.md` (*Development build*) has every resolver checked,
  and `docs/STABILITY.md` (*Development builds*) says the CDN bundles have no
  development build. Additive; rollback is removing the condition.
  - **Test suites log core's warnings.** Vitest (4 and 5) asks for
    `development` by default, for a test's own imports and for the
    dependencies it leaves to Node, so a suite on this release loads the
    development build and its output shows `[forma]` warnings; a suite that
    fails on console output fails on them. To keep a suite on production, run
    it with `NODE_ENV=production`, or drop the condition with the
    `configEnvironment` plugin in `docs/CDN-AND-EXPORTS.md` (*Vitest*).
    Setting `resolve.conditions` or `ssr.resolve.conditions` does not do it:
    Vitest appends its own list, which carries the condition.
  - **Bun's bundler selects it even when minifying.** `bun build --minify`
    and `Bun.build({ minify: true })` ship `dist/dev/` unless given
    `--production` or `NODE_ENV=production`; that is Bun's convention, and
    the package cannot override it.
  - **Production is unchanged.** A resolver that does not ask for the
    condition resolves the same files as before, and all 87 production files
    under `dist/`, maps and declarations included, are byte-identical to
    `main`'s build before this change. `node scripts/dist-baseline.mjs [ref]`
    (new, `npm run check:baseline`) builds a ref in a temporary worktree and
    compares, through `scripts/verify-dist.mjs --baseline`. No size gate moves.
  - **Package size** (`npm pack`, against `main` at FORMA-123's merge):
    1,477,609 to 1,656,308 B packed (+178,699 B, +12.1%), 5,978,199 to
    6,783,862 B unpacked (+805,663 B, +13.5%), 90 to 120 files. The
    JavaScript behind `exports` (802,129 B) ships twice. The twins carry no
    source maps, which would have added another 2.7 MB unpacked (0.64 MB
    packed): their code keeps its names and one statement a line. A
    development bundle's own source map therefore reaches core's `dist/dev/`
    files, not its TypeScript sources.
  - **One build per process.** A resolver applies one set of conditions to
    every specifier, and a development file imports only development files,
    so one resolver loads one copy of core's reactive state. Two resolvers in
    one process that disagree (Vite's server-side rendering with
    `ssr.resolve.externalConditions: ['development']` while Node loads an
    external dependency without `--conditions=development`) load both
    builds, and the existing duplicate-instance warning says so. A bundler
    that inlines core while Node loads it for an external dependency (Vite's
    `ssr.noExternal`, Vitest's `server.deps.inline`) loaded two copies before
    this change and still does; only which build each copy is can differ.
    `sideEffects` lists the twins' runtime files and chunks as it lists
    production's.
  - **Checks.** `scripts/verify-dist.mjs` fails a build in which a subpath's
    branch lacks its twin or orders it after `default`, a twin is
    byte-identical to its production file, a development graph reaches a
    production file or the reverse, a production file binds `__DEV__` to
    anything but `false` or a development one to anything but `true`, a
    deprecation code is missing from a development entry, or Node, with and
    without `--conditions=development`, resolves any subpath, imported or
    required, to the wrong file. `npm run check:pack` also runs publint and
    attw over a copy of the package whose development leaves replace the
    defaults (`scripts/check-pack-development.mjs`), since attw takes no
    conditions.
  - Tests: `src/__tests__/development-build.test.ts` (the real tsup configs,
    built into a scratch package and resolved by Node) > "every subpath
    resolves to production files without the condition and to their
    development twins with it", "a process resolving with the development
    condition loads one copy of core, and it is the development build", "a
    process resolving without the condition loads one copy of core, and it is
    the production build", "a process that loads both builds is told so by the
    duplicate-instance warning"; `src/__tests__/build-config.test.ts` >
    "builds a development twin of every config the exports map reaches,
    differing only in the dev flag, the directory and the declarations", and
    "hard-defines the dev flag in every artifact", "keeps dependencies external
    for the Node-facing entries" and "ships a build entry for every dist file
    the exports map promises", extended to the twins;
    `src/__tests__/package-exports.test.ts` > "gives every import/require
    condition a development twin between types and default". The ticket's
    acceptance test, in Chromium on every merge (and Firefox and WebKit before
    a release): `e2e/development-build.spec.ts` packs the package, bundles one
    application from the tarball with esbuild twice, and loads each: "a
    development bundle of the packed package resolves the development build
    and logs a known warning once", "a production bundle of the same
    application resolves the production files and logs nothing".
- **`trustedHtml(markup)`, the one raw-HTML entry** (DR-19, L-37, FORMA-126),
  exported from `@getforma/core` and `@getforma/core/runtime`
  (`FormaRuntime.trustedHtml` in the CDN bundles), with its type `TrustedHtml`.
  Every raw sink takes it beside a string: one name, so a search, or a
  consumer's CI allowlist (SR8), finds every raw entry. Where the browser has
  Trusted Types it returns a `TrustedHTML` made by Forma's policy `forma`;
  elsewhere a frozen stand-in that core's sinks recognise and write as its
  markup. A `TrustedHTML` from an application's own policy is accepted too.
  It sanitizes nothing. `./ssr`'s renderers write its markup as they write a
  string. `template()` and `templateMany()` are now documented as raw sinks
  (`docs/API.md`, `SECURITY.md`), and `CSP.md` gains a Trusted Types section.
  Additive: every sink still takes a string.

### Changed

- **List adoption fails the island on a row-count mismatch instead of deleting
  rows** (FORMA-123, DR-8). Server rows without `data-forma-key` are matched by
  index. Before, a client array shorter than the server's rows had the extra
  rows removed and a longer one had rows rendered fresh, silently (ksx's #5 lost
  the server rows absent from a list's array before its state was seeded). Now,
  when the counts differ (including an empty array, or an empty server region
  with items), no row is adopted, removed or rendered: the island keeps the
  server's rows and is marked `error`, and `FORMA_E_HYDRATE_LIST_COUNT`, naming
  both counts, is logged in every build and passed to `onError` handlers
  (source `'hydration'`). An island in `error` is inert: the listeners attached
  during adoption are removed, on the server's elements and on any adoption
  built through `h()` before the failure, and the bindings it adopted are
  disposed, also for a direct `hydrateIsland()` caller whose root lives on.
  This holds for any adoption that fails part-way.
  **Adoption now runs in a batch.** A signal written during adoption (in a
  `ref`, say) takes its new value at once, but the effects that write
  triggers, wherever they are (the island's own bindings included), run when
  the walk ends, not during it. Adoption's
  own bindings still run when they are created. So a failing island detaches
  nothing that another island or `mount()` root built. Such a root's new rows
  are no longer owned by the failing island either; before, they were disposed
  with it, also on 2.0.x for an island failing by a throwing reactive child. Nodes adoption replaced or
  added before the failing list (a tag mismatch, a fresh keyed row) stay as it
  left them. `mount()` and `hydrateIsland()` keep `data-forma-ssr` and do not
  throw, as for `FORMA_E_HYDRATE_NODE`. Equal counts adopt as before, and rows
  that carry `data-forma-key` keep matching by key. Applications whose state
  reaches the island from the server's data see no change.
  **Migration:** the server writes an empty list region when the list's data
  is not an array, so a list the client computes for itself inside a
  server-rendered island was rendered fresh on 2.0.x and now leaves the island
  inert. Start that list's signal empty and fill it after activation (an empty
  array adopts the empty region), or render the list in the browser only.
  Core's ESM entry grows by 365 B gzipped (28,411 to 28,776 B, gate 30,000 B
  unchanged) and the CDN ESM bundle by 333 B (27,293 to 27,626 B, gate
  29,000 B). A page with one island, bundled from the core entry with esbuild
  (minified, gzip -9) as DR-35 counts N2, grows by about 205 B (`docs/ISLANDS.md`'s
  counter from 13,417 to 13,619 B, a `createShow` and `createList` page from
  13,433 to 13,644 B). The CDN runtimes, which do not include adoption, are
  unchanged (35,540 and 34,542 B).
- **`createWebSocket` reconnects with full jitter** (FORMA-132, L-46). The n-th
  reconnect used to wait exactly `reconnectInterval * 2^(n-1)`, so after a
  deploy every client of a server reconnected in the same instant. The delay is
  now drawn uniformly between 0 and that cap, still for at most
  `maxReconnects` (5) attempts, and a successful open still restarts the count.
  A new option, `random`, replaces `Math.random` as the source of the draw (a
  test passes a seeded one); a value that is not a function, or a draw outside
  [0, 1), falls back to `Math.random`.
- **`data-fetch` aborts a request after 30 seconds** (FORMA-132, L-46),
  `createFetch`'s default timeout. Before, a request the server never answered
  held its `loading:` target true forever. Now the abort lands in the `error:`
  target as `data-fetch timed out after 30000 ms` in every engine (WebKit
  rejects an aborted fetch with its own message, so the runtime writes this
  one; `createFetch` reports no error on its timeout), and `loading:` turns
  false. Each request of a `poll:` fetch has its own 30 seconds. Tearing a
  scope down (`unmount()`, or removing its element) clears each in-flight
  request's timer and aborts it. A shorter timeout
  granted per mount comes with the tiered mount (FORMA-128).
  **Size (L-51):** the CDN runtime grows by 200 B gzipped (33,861 to 34,061 B)
  and the hardened runtime by 199 B (32,873 to 33,072 B). Both passed their
  gates, which rise to the measured size rounded up to the next 500 B: 34,000
  to 34,500 B and 33,000 to 33,500 B (`scripts/check-size.mjs`, the README's
  size table).

### Deprecated

Each keeps working through 2.x, warns in a development build, and goes in
3.0.0 (`docs/STABILITY.md`, *Deprecated entry points* and *Deprecated forms*):

| Deprecated in 2.1.0 | Code | Use instead (3.0.0's form) |
|---|---|---|
| `reconcile()` from `@getforma/core/runtime` | `FORMA_W_DEPRECATED_RECONCILE` | `mountMarkup(root, markup, { tier, grants })` |
| the runtime's auto-mount of `data-forma-state` (on load and through a `body` observer) | none in 2.x | `mountMarkup()` with a tier; `data-forma-mount="manual"` turns the auto-mount off now |
| a string as `dangerouslySetInnerHTML`'s `__html` | `FORMA_W_RAW_INNER_HTML` | `{ __html: trustedHtml(markup) }` |
| a string to `setHTMLUnsafe()` | `FORMA_W_RAW_SET_HTML` | `setHTMLUnsafe(el, trustedHtml(markup))` |
| a string to `template()` or `templateMany()` | `FORMA_W_RAW_TEMPLATE` | `template(trustedHtml(markup))` |
| a string to `reconcile()` | `FORMA_W_RAW_RECONCILE` | `mountMarkup()`, as above (`reconcile(container, trustedHtml(markup))` until then) |
| a string as a `srcdoc` value | `FORMA_W_RAW_SRCDOC` | `srcdoc: trustedHtml(markup)` |
| `h('script')` | `FORMA_W_SCRIPT_ELEMENT` | a script in the page, or a module the build bundles |
| the runtime's `data-bind:srcdoc`, or `{item…}` in a list row's `srcdoc` | `FORMA_W_RAW_RUNTIME_SRCDOC` | the frame built with `h()` and `trustedHtml(markup)` |
| `@getforma/core/server` (server functions: `"use server"` RPC, `createAction`, the revalidation helpers) | `FORMA_W_DEPRECATED_SERVER` | a route in the application's Rust server |
| `@getforma/core/ssr` (`renderToString`, `renderToStream`) | `FORMA_W_DEPRECATED_SSR` | the Rust walker: forma-server's `try_render` |
| `@getforma/core/wasm` | `FORMA_W_DEPRECATED_WASM` | core's `h()`, which islands already re-render with |

- **`reconcile()` from `@getforma/core/runtime`, and the runtime's auto-mount,
  are deprecated, and are removed in 3.0.0** (FORMA-128, FORMA-108; DR-14).
  Both bind with every power wherever markup lands; mount with `mountMarkup()`
  and a tier instead. `reconcile()` behaves as at 2.0.x (a 404's body is still
  its data) and, in a development build, logs `FORMA_W_DEPRECATED_RECONCILE`
  once on its first call; production files carry neither the line nor the
  grant report. `docs/STABILITY.md` lists the code. Tests:
  `src/__tests__/runtime-tiered-mount.test.ts` > "reconcile behaves as at
  2.0.x and warns once in development", "a production build carries neither
  the grant report nor reconcile's warning" (the real tsup config) and its
  control.

- **A value that is not `trustedHtml()` given to a raw sink, the HTML
  runtime's `srcdoc` bindings, and `h('script')`** (DR-19, L-18, FORMA-126).
  All keep working through 2.x, written exactly as before, and 3.0.0 refuses
  them (FORMA-109). In a development build the first such value each sink
  receives (a string, a look-alike object or a `String` object) logs one
  coded line: `FORMA_W_RAW_INNER_HTML` (`dangerouslySetInnerHTML`),
  `FORMA_W_RAW_SET_HTML` (`setHTMLUnsafe()`), `FORMA_W_RAW_TEMPLATE`
  (`template()`, `templateMany()`), `FORMA_W_RAW_RECONCILE` (`reconcile()`)
  and `FORMA_W_RAW_SRCDOC` (`srcdoc`, on h(), in adoption and in `./ssr`), as
  `[forma] FORMA_W_RAW_SRCDOC: …`. The runtime's `data-bind:srcdoc`, and
  `{item…}` in a list row's `srcdoc`, write an expression's value or a row's
  data as a document, a raw entry no `trustedHtml()` can reach: they stay
  strings and log `FORMA_W_RAW_RUNTIME_SRCDOC`. `h('script')` logs
  `FORMA_W_SCRIPT_ELEMENT` once. Each is logged once per page or process,
  whichever copy of core asks. `docs/STABILITY.md` lists what replaces each
  under *Deprecated forms*. The `srcdoc` line replaces the uncoded warning
  `h()`, adoption and `./ssr`'s `renderToString` logged for every `srcdoc`,
  `trustedHtml()` or not.
  The development build (FORMA-169) carries them, so an application bundled
  from the npm package in development logs them; production builds carry
  none, and `scripts/verify-dist.mjs` fails a build in which a production
  file holds one or a development entry lacks one. The CDN bundles have no
  development build, so a page loading the runtime from a CDN logs none.
  - Tests: `src/dom/__tests__/trusted-html.test.ts` (twenty-four, under a
    simulated Trusted Types engine where it matters, among them "a string to
    each raw sink still renders, and warns once with the sink's code in
    development", "core's own writes raise no Trusted Types violation: mount,
    unmount, the null clear, and every sink given trustedHtml()", "reconcile()'s
    diff mints a changed srcdoc of trusted markup and writes no on* or script
    src", "a string reconcile()'s diff writes a changed on*, script src and
    srcdoc as 2.0 did" and "the shared registry holds no policy, and its forma-runtime handle
    mints nothing from a string"); `src/__tests__/renderer-contract.test.ts` >
    "writes %s as the string the URL guard checked, not a second conversion"
    (static, reactive, adoption and SSR); `src/__tests__/runtime-srcdoc.test.ts`
    (three); `src/dom/__tests__/trusted-html-build.test.ts` > "a production
    build carries none of the raw-HTML warnings, in any artifact" (the real
    tsup configs) and its control; `e2e/trusted-types.spec.ts` (fifteen per
    engine); `e2e/development-build.spec.ts` > "a development bundle of the
    packed package logs a string at a raw sink once, with its code, and
    trustedHtml() never".
- **`@getforma/core/server`, `@getforma/core/ssr` and `@getforma/core/wasm`
  are deprecated, and are removed in 3.0.0** (FORMA-131; DR-22 to DR-24). They
  keep working through 2.x. Server functions give way to routes in the
  application's Rust server, `./ssr` to the Rust walker, and `./wasm` to
  core's `h()`, which islands already re-render with. `docs/STABILITY.md` marks
  each row **Deprecated** and lists the codes under *Deprecated entry points*;
  `SECURITY.md` and `docs/CDN-AND-EXPORTS.md` mark the entries too.
  - The first time one of them is loaded where core runs from source, it logs
    one line with a stable code: `FORMA_W_DEPRECATED_SERVER`,
    `FORMA_W_DEPRECATED_SSR` or `FORMA_W_DEPRECATED_WASM`, as
    `[forma] FORMA_W_DEPRECATED_SSR: …`, naming 3.0.0 and the replacement. Once
    per process: a second copy of the module stays quiet.
  - The line logs only in a development build, as every `__DEV__` diagnostic
    does: the installed package resolved with the `development` condition
    (FORMA-169, under *Added*), or core from source (in Node with `NODE_ENV`
    other than `production`, in a browser with the global `__FORMA_DEV__`
    set). The production files log nothing. An installed package also shows
    the deprecation in its types: every function the three entries export
    carries `@deprecated`.
    Every `.js` and `.cjs` file under `dist/` is byte-identical to the build
    before this change (all 33), so no size gate moved; the files that differ
    are the three entries' type declarations and their source maps.
  - The deprecated SSR row links to *SSR form controls* (FORMA-017) for how
    `./ssr` differs from the walker, which that section states; it is no
    longer a row of its own.
  - `scripts/verify-dist.mjs` fails a build in which a deprecation code reaches
    any published artifact.
  - Tests: `src/__tests__/deprecated-entries.test.ts` > "$subpath logs its
    deprecation once in development, with its code", "$subpath stays quiet when
    NODE_ENV is production", "decides a development build as __DEV__ does,
    under every NODE_ENV", "a production build of each deprecated entry carries
    no warning" (the real tsup configs) and its control, "a build without the
    production flag keeps the warning". The exact export-surface test still
    lists all three entries until 3.0.0 removes them.

### Fixed

- **A reactive `dangerouslySetInnerHTML` is adopted as content, and A → null
  → A shows A again** (FORMA-176; DR-5, DR-9, DR-19). Adoption treated the
  prop as an attribute: a reactive one wrote `dangerouslysetinnerhtml="[object
  Object]"` and never touched the content, where client rendering writes it,
  and a static one was skipped though a walker can ship such an element empty.
  It now binds the prop as h() does, through one writer (`bindInnerHTML` in
  `src/dom/element.ts`):
  - the content goes through the raw sink (a `trustedHtml()` value typed, a
    string with `FORMA_W_RAW_INNER_HTML` in development), never an attribute;
  - a static `null`, `undefined` or `false` (the `cond && { __html }` pattern)
    is no prop, as in h() and `./ssr`: the server's children are adopted and
    bound;
  - adoption writes nothing where the server's element already holds the
    markup, judged by parsing the markup through a `<template>` and comparing
    it with the server's content as the browser serialises both, so markup
    `./ssr` wrote as given (`<br/>`, single quotes, `&#39;`, an unclosed `<p>`,
    a `<table>` without `<tbody>`) is not rewritten: an iframe in it does not
    reload, and text typed into it before activation survives. An empty
    element (the walker's) is written without the parse, so a string raises
    one Trusted Types report, as client rendering does;
  - a reactive prop whose first value is `null` keeps the server's content
    (its children, adopted and bound) until markup arrives, as h() shows its
    children until then;
  - markup is recorded as current only once written, so a string a page
    enforcing Trusted Types refused does not block the same markup sent later
    as `trustedHtml()`.

  A reactive value going A → null → A left the element empty, in h() as in
  adoption: the `null` branch kept A's markup as the current one, so A again
  read as no change; `null` now forgets it.

  **Children given beside the prop** are a mistake the renderers disagree on:
  h() renders the markup and then the children, until the markup next changes
  and replaces them; `./ssr` renders only the markup; the compiler's walker
  renders only the children. Adoption keeps the markup and binds none of the
  children (in 2.0.3 it adopted the children and wrote the prop as an
  attribute). h() and adoption now log `FORMA_W_INNER_HTML_CHILDREN` once in
  development; give the element one or the other.

  Tests: `src/dom/__tests__/adopt-inner-html.test.ts` (both server outputs,
  the walker's empty element and `./ssr`'s markup, matched against client
  rendering through every transition; the three falsy values with a bound
  child; sixteen non-canonical markups not rewritten; typed text kept; the
  `null`-first fallback child; the children warning);
  `src/dom/__tests__/trusted-html.test.ts` > "an adopted island's
  dangerouslySetInnerHTML writes trustedHtml() typed, as content and never as
  an attribute" and "a refused string does not block the same markup sent
  later as trustedHtml(), client-rendered and adopted"; `e2e/adoption.spec.ts`
  (four tests, among them twenty-one non-canonical markups, the review's
  among them, adopted without one DOM write) and the Trusted Types sink test's adopted
  island, in Chromium, Firefox and WebKit. Size: the core entry grows by 230 B
  gzipped (29,285 to 29,515 B of its 30,000 B gate) and the browser ESM bundle
  by 226 B (28,143 to 28,369 B of 29,000 B); the CDN runtimes, which do not
  adopt, do not change.
- **SVG and MathML namespaces where `h()` knows the parent** (FORMA-026,
  DR-9). A tag that is both HTML and SVG (`title`, `a`, `script`, `style`,
  `font`) now takes the namespace of the content it is built in. Where its
  parent is known, that is the parent's, as the HTML parser gives it: a
  reactive child, a `createShow` branch, `createList` row or `createSwitch`
  case rendered once the helper is in the document, a portal into an SVG,
  `mount()` into an SVG element, and what adoption creates (a show branch it
  repairs, a fresh keyed row). Before, all of these created such a tag as
  HTML inside an SVG. Content at the parser's HTML integration points is HTML:
  a `foreignObject`, `desc` or `title`, a MathML token element, an HTML
  `annotation-xml`. `h()` also creates MathML Core's elements (`math`,
  `mrow`, `mi`, …) in MathML, and more SVG names (`feDropShadow`, `mpath`,
  `view`, the remaining filter primitives) in SVG.
  A child passed to `h()` is still built before its parent exists. In
  `h('svg', null, h('title'))` the `title` is HTML, as before; build such a
  tree inside `svg()`, where a helper's first render is SVG too. Shared namespace vectors (`src/__tests__/vectors/namespaces.json`)
  run through `h()`, `renderToString`, and each browser's parser and adoption
  in Chromium, Firefox and WebKit.
  **Size (L-51, DR-35):** core's ESM entry grows by 605 B gzipped (27,806 to
  28,411 B, gate 30,000 B) and the CDN ESM bundle by 580 B (26,713 to
  27,293 B, gate 29,000 B); no gate is passed and none rises. A page with one
  island, bundled from the core entry with esbuild (minified, gzip -9) as
  DR-35 counts N2, grows by about 445 B: `docs/ISLANDS.md`'s counter from
  12,974 to 13,417 B, a page with a `createShow` and a `createList` from
  12,986 to 13,433 B. The CDN runtimes build nothing through `h()` and are
  unchanged (34,061 and 33,072 B).

### Documentation

- **`docs/ISLANDS.md` states what adoption skips today** (FORMA-016): a plain
  array child (`.map()` without `createList`), `createErrorBoundary`,
  `createSwitch`, `createPortal` and `createSuspense`, and a reactive child
  that returns an element; what a server-rendered page gets with each,
  measured in Chromium (on a `mount()` root, `createErrorBoundary`,
  `createSwitch` and `createSuspense` make activation throw and nothing after
  them activates; `createPortal`'s content never appears; a reactive `.map()`
  shows its elements as `[object HTMLLIElement]` text), the build code
  compiler 0.3.7 reports for it, and what to write instead. It also documents
  `browserOnly()`.
- **`./ssr`'s form controls are documented as a known gap** (FORMA-017, DR-24).
  `renderToString` writes a `textarea`'s and a `select`'s `value` as a `value`
  attribute, which the HTML parser ignores, where forma-ir 0.2.1 writes the
  textarea's text and `selected` on the option. The renderer is unchanged
  until `./ssr` is removed in 3.0.0; `docs/STABILITY.md` says what the served
  page shows and how to write these controls instead, and two tests pin it.
- `docs/STABILITY.md`'s footnote on `./wasm` said the subpath first resolves
  "in the next release". It first resolved in 2.0.0 (npm's 1.5.0 has no
  `./wasm` key; 2.0.0 has it), and the footnote now says so.

### CI

- **Actions pinned to commits; every job declares its token** (DR-32, SR21,
  FORMA-010). Each `uses:` names the commit its tag pointed to on 2026-10-14,
  with the tag in a comment, so moving a tag no longer changes what runs. Every
  job in `ci.yml` declares `contents: read`; `release.yml`, `docs.yml` and
  `e2e-engines.yml` already declared their permissions and keep them. Every
  install was already `npm ci`. The published package is unchanged.
- **Only the release's publish job can mint the publish credential** (SR43,
  L-34, L-42, FORMA-134). `release.yml` splits into `engines`, `test`, `pack`
  and `publish`. Tests and builds run in jobs without `id-token: write`; `pack`
  restores no cache, packs the tarball and records its SHA-256; `publish`, the
  only job holding `id-token: write`, restores no cache and installs nothing,
  checks the downloaded tarball against that record (whose own hash travels as
  a job output) and runs `npm publish <tarball> --provenance --ignore-scripts`.
  The create-forma-app dispatch moves to a `notify` job with no permissions.
  The tag stays the only trigger. CI's new `release-workflow` job runs
  actionlint (binary checked against a pinned SHA-256),
  `scripts/check-release-workflow.rb --self-test` and
  `scripts/test-release-artifacts.sh`. The published package is unchanged.
  The lint also refuses a publish job that could go on after a failed check
  (`continue-on-error`, an `if:` on a step up to the publish, `always()`,
  `failure()` or `cancelled()` in the job's `if`, a check line that can
  swallow its failure, a shell without errexit), `container:` or `services:`
  on the publish or pack job, and a checkout of another repository or ref;
  every rule has a seed in `--self-test`, which fails if one does not. The
  artefact test flips a byte instead of writing one that may already be there.
- **No permanently skipped job, no flaky timing test, a bounded browser
  install** (FORMA-179, FORMA-177). The nightly mutation-probe run leaves
  `ci.yml` for its own workflow, `nightly-probes.yml` (schedule and
  `workflow_dispatch` only, the same pins, token, timeout and artefact), and
  `ci.yml` drops its `schedule`, so no PR or push shows `probes` as skipped.
  `e2e-engines.yml` (and so the release's `engines` gate) and `ci.yml`'s
  Chromium `e2e` install each engine in two steps, its system packages and
  then the browser, each restored from a cache keyed on the Playwright version
  (the packages' also on the runner image) and each bounded, with one retry;
  a slow apt mirror once held WebKit's install past the job's 10 minutes.
  `publish` and `pack` still restore no cache. The three heaviest task-budget
  tests and a native-cost test get explicit timeouts about 3x their slowest
  CI run (one had timed out under coverage on Node 20). Two unit tests stop
  timing themselves: native-cost's 50 ms bound goes (the native never reached
  and the heap not grown are its deterministic checks; `e2e/sr33.spec.ts`
  keeps the 50 ms in three browsers), and string-growth's 200 ms ceiling
  becomes a count: a refused loop stops before a tenth of the interpreter
  steps it takes over short strings. `e2e/expr-cost.spec.ts` mounts each
  widget on a fresh task, as `e2e/sr33.spec.ts` does: in WebKit two evaluates
  could run before the runtime's task timer, so the second widget counted on
  from the first one's spending and its refusal waited for a retry instead of
  being reported (three WebKit failures of "each round-2 rope case is refused
  before the long task"). `resource.test.ts`'s "sets error on fetcher
  rejection" waits for its own read instead of a fixed 10 ms, which raced the
  read's 0 ms timer and lost once in 100 runs under load. The release's
  `pack` job uploads `release-packed` with `overwrite: true`, so re-running
  all jobs after a failure replaces the earlier attempt's artefact instead
  of failing on its name (A2 audit S7); `publish` still checks every file
  against the record whose hash `pack` passes as a job output. The SR43
  lint's new rule K4 requires it, with two seeds in `--self-test`. WebKit's
  e2e tests get 30 s, 3x the default: a worker fixture shares the timeout of
  the test that starts it, and on a slow runner the first test of each worker
  timed out setting up WebKit's page, twice. "data-text of a value heavier
  than the budget is refused before it is converted" mounts its widget three
  times and bounds the least at 50 ms: one noisy sample took 169 ms in
  Firefox, where a conversion that ran would take seconds each time. The
  published package is unchanged.

## [2.0.3] - 2026-10-14

### Security

- **A built-in call in an expression is charged before it runs** (FORMA-004,
  DR-16). `Array.from({length: 12000000})` used to build a 139 MB array in a
  300 ms task and only then be refused; it now costs nothing. Every allowlisted
  native is charged, against one budget per evaluation (`LIMITS.ALLOC_BUDGET`,
  250,000 units, one unit being about an `Array.from` slot), the weight of its
  arguments as text (or, for the natives that read arguments as data, such as
  `Object.keys`, `Array.from` and `concat`, their element count) and then its
  row in `src/expr/cost.ts`, and is refused with `FORMA_E_BUDGET` before it runs
  once the evaluation would pass the budget. Rows that copy or produce cost a
  unit per element; string rows that amplify nothing are weighted by their
  measured cost per character, tiered by the costliest character of the text:
  lowercasing Latin-1 and the self-mapping punctuation, currency and
  letterlike symbols costs 1/32 of a unit a character and any other text 1/2;
  uppercasing ASCII 1/16, Latin-1 and those symbols 1/2, any other text 1; a
  string search 1/32; `slice` 1/64.
  An operator that converts an array or object to text (`'' + list`,
  `` `${list}` ``, `list < 1`, `x += list`, a write to `$el`) is charged the
  same way; `x != null` and object-to-object `==` convert nothing and are not.
  The budget is sized from the tail of measurements at 4x CPU throttling with
  garbage collection counted (`scripts/measure-alloc-budget.mjs`): the slowest
  of 41 runs of the largest call any row allows took 46.6 ms (a text search
  over 9,000 records with a curly apostrophe in each; 48.0 ms at most over 81
  runs with a dash), and an evaluation that spends the budget and then exhausts
  the step budget 23.7 ms. These figures hold for strings stored one byte a
  character, and for that search's two-byte records. A string stored two bytes
  a character costs about four times its charge: one `toLowerCase` of 8 million
  such characters took 108 ms median and 115 ms at most, refused only
  afterwards by the 1 MiB result cap, and seven calls on 1 million characters
  in one evaluation 92 ms, answered. This is listed under FORMA-028. The cost
  check itself takes time: the repository's expression benchmarks
  (`scripts/bench.mjs --file expression`, 5 runs against 2.0.2) are within
  noise, but a string-heavy filter pays for it. The text search over 9,000
  records, in Chromium at 4x, went from 22.4 to 29.5 ms median for ASCII
  (+32%), and from about 28 to 42 or 43 ms median (49 ms at most) with one `’`
  in each record (about +50%). Its 9,100-record form, refused by the step
  budget as in 2.0.2, runs 43 ms median and 65 ms at most before the refusal.
  About half the added time is the two-byte tier scan, the rest the per-call
  check (about 0.4 µs a call at 4x). The bound is **per evaluation** (one
  binding or one handler run), not per task: a widget with many bindings can
  spend one budget in each; a per-task (per-widget) budget is a design change,
  left to a follow-up ticket. Not yet bounded (FORMA-028; SECURITY.md,
  "Termination and budgets"): string `+`, template literals, reads of a long
  concatenated string, and a string search whose pattern's first characters
  fill the text (`'ab'` in `'aaaa…'`, 39 ns a character where ordinary text
  takes under 1).
- **Behaviour change: what one binding or handler can no longer compute.** As
  DR-16 accepts, the budget refuses, with `FORMA_E_BUDGET`, some evaluations
  2.0.2 answered. Measured with this release's engine and 2.0.2's on the same
  data:
  - **String work per record in a callback counts toward the one budget.** The
    text filter `rows.filter(r => (r.title + ' ' + r.body).toLowerCase().includes(q))`
    over records of about 260 characters:
    - is answered as in 2.0.2, up to about 9,090 records (where the step
      budget stops both releases), when every character of the records is
      Latin-1 or one of the punctuation, currency and letterlike symbols that
      map to themselves (U+2000 to U+20CF, U+2100 to U+2125): ASCII, `é`, curly
      quotes `’ “ ”`, dashes `– —`, `…`, `€`, `™`, `№`;
    - is refused past about 1,716 records, where 2.0.2 answered about 9,090,
      when each record holds any other character above U+00FF: a Greek,
      Cyrillic or CJK character, a Latin Extended letter such as `č`, `ł` or
      `ő`, Turkish `İ` or `ı`, an emoji, or a symbol with a case mapping such as
      the Ohm sign (U+2126). Such text measured up to about 43 ns a character
      to lowercase, against 2 ns for Latin-1.
  - A default `sort()` of more than about 6,400 strings or numbers, counting
    everything else the evaluation does (2.0.2 had no limit).
  - `rows.map(r => r.name).join(', ')` past about 18,000 rows (2.0.2: about
    33,000, where the step budget stops it).
  - `Object.keys`, `values` or `entries` of more than about 15,600 keys or
    characters.
  - `every`, `some` or `reduce` over more than 250,000 elements, even when the
    callback would stop at the first.
  - A built-in that produces a string or array longer than 250,000, such as
    `Array.from({length: 300000})` (the 1 MiB and 1,000,000-element result caps
    still apply to `+` and template literals).
  - A handler write that would grow an array past 250,000 elements, such as
    `items[999999] = x`.
  - `padStart` / `padEnd` with a negative or non-numeric length now return the
    string unpadded, as JavaScript does, instead of `FORMA_E_BUDGET`.

  Rollback: pin 2.0.2.
- **Island props are stripped of `__proto__`, `constructor` and `prototype` at
  every depth while they are parsed** (FORMA-004, DR-21), inline and shared,
  with no opt-out. 2.0.1 stripped the top level only, so a nested key reached
  any island that deep-merged its props. The pass is iterative (a JSON reviver
  would overflow the stack near 5,000 levels); `sanitizePropsDeep` stays
  exported. The strip also drops legitimate nested fields named `constructor`
  or `prototype` (a standings table keyed `constructor`, say): DR-21 accepts
  this; rename such fields on the server. Props that are valid JSON but
  neither an object nor an array (`null`, a number, a string, a boolean),
  inline or in the shared block, mark the island `error` as they did in 2.0.1,
  now with the coded message
  `FORMA_E_ISLAND_PROPS` logged in every build (2.0.1 threw an uncoded
  `TypeError`, logged in development builds only). An array reaches the island,
  as before, stripped at every depth. Rollback: pin 2.0.2.

## [2.0.2] - 2026-10-14

### Changed

- **Bound `value`, `checked` and `selected` are live properties.** `h()` and
  adoption write them to the control itself, not only to its attribute, and a
  `select` is bound after its options exist. A bound `value` on a `select` or
  `textarea` now reaches the control; before, it never did. A controlled input
  therefore follows its signal after the user edits it: an update replaces what
  they typed, where 2.0.1 changed only an attribute the browser ignores once a
  control is edited. An option's value stays its attribute, so an option bound
  to `undefined` or `null` still submits its text. (Local checkpoint `042e353`.)
- **`updateOnItemChange: 'rerender'` replaces a changed row.** A same-key row
  whose item object changed is rendered again in a fresh reactive scope, and
  the new element replaces the old one; the old row's effects are disposed.
  Before, static rows were patched in place and rows with bindings were not
  re-rendered at all. Refs and focus inside a changed row do not carry over.
  Unchanged items and keyed moves keep their DOM. `reconcileList`'s own contract
  is unchanged: a node returned by its `updateFn` is ignored. (Local checkpoint
  `042e353`.)
- **A component that returns a detached DOM node while hydrating is reported.**
  2.0.1 counted it as adopted and removed `data-forma-ssr` with nothing bound.
  Now the error `FORMA_E_HYDRATE_NODE` is logged in every build and passed to
  `onError` handlers (source `'hydration'`), and the server's DOM stays as
  served: `activateIslands` marks that island `error`, and `mount()` and
  `hydrateIsland()` keep `data-forma-ssr` (`mount()` also disposes the
  component's effects; a direct `hydrateIsland()` caller owns its root). Neither
  throws. Returning the island's own element, a node inside it, or a fragment
  the component already appended into it (now empty) works as in 2.0.1.

### Fixed

- **A Fragment is adopted.** `h(Fragment, …)` and `fragment(…)` return a
  descriptor while hydrating, and adoption walks a Fragment's children in place,
  at a `mount()` or island root, inside an element and as a `createShow` branch.
  A root JSX Fragment was inert after server-rendered activation. A root
  `createShow` or `createList` with no wrapping element is adopted too.
- **Adoption keeps what the user entered before activation.** A control whose
  live state differs from its markup's default (`value` from `defaultValue`,
  `checked` from the `checked` attribute, a select from its `selected` options)
  is not written at adoption, and a control that already holds the client's
  value is not written at all. Updates after activation are still written.
- **`textarea` and `title` text is bound by the element, not by markers,** to
  match forma-ir 0.2.1, which writes no markers inside RCDATA elements. A
  textarea's reactive text stays its default value, client-rendered or adopted,
  as in 2.0.1. For one release the marker text older servers write inside these
  elements (and the zero-width space they write for empty text) is also
  accepted, and removed on adoption when it accounts for the whole difference
  from the client's text.
- **Inline SVG and MathML are adopted, not rebuilt.** Adoption compared an
  element's `tagName` with the component's tag upper-cased, but the parser keeps
  an SVG or MathML tag's case (`svg`, `clipPath`), so every inline SVG was taken
  for a mismatch and replaced at activation, with whatever focus or state it
  held, and the replacement's `title` or `a` was an HTML element (an icon lost
  its accessible name). Adoption now matches a foreign element by its exact
  `localName`, and an HTML element in any case, as before. Where adoption must
  create an element (the server rendered another tag, or nothing) inside SVG or
  MathML, it creates it in that namespace with `createElementNS`; inside a
  `foreignObject` it creates HTML. (FORMA-020)
- **A reactive attribute the server already holds is not written at
  adoption.** Adoption set every bound attribute once, even to the value it
  had, which a `MutationObserver` records and which reloads an `iframe` whose
  `src` is bound. A change is still written. (FORMA-020)
- `createList` with `updateOnItemChange: 'rerender'` disposes a replaced row's
  effects. (Local checkpoint `042e353`.)

### Tests

- Regression fixture for the native-call cost path (FORMA-001, stage 0; DR-16):
  `src/expr/__tests__/native-preflight.test.ts` requires `Array.from({length: 12000000})`
  to be refused with `FORMA_E_BUDGET` (passes today) and to be refused before
  `Array.from` runs. The interpreter checks a native's result only after the
  call returns, so today the array is built first; that case is marked
  `it.fails` until FORMA-004's preflight lands.
- `e2e/csp.spec.ts` detects a CSP violation in Firefox. It read violations from
  console text, and Firefox words them "Content-Security-Policy: …", which the
  pattern missed, so a Firefox run would have passed with violations. It now
  also records the `securitypolicyviolation` event, and a control test proves
  a blocked inline script is seen in each engine. (FORMA-027)

### CI

- **Firefox and WebKit before each release** (DR-9, FORMA-027). The Playwright
  config has `firefox` and `webkit` projects beside `chromium`. A new workflow,
  `e2e-engines.yml`, runs the whole e2e suite in each of the three engines,
  one job per engine; `release.yml` calls it and its `publish` job needs it,
  so a tag publishes only if all three pass on the tagged commit. Run it on a
  branch with `gh workflow run e2e-engines.yml --ref <branch>`. Every merge
  still runs Chromium only: `npm run test:e2e` selects the `chromium` project,
  and `npm run test:e2e:engines` runs all three.

### Documentation

- `docs/ISLANDS.md` no longer says adoption always creates an element in the
  namespace the HTML parser would have used. It names where it does not: the
  content of MathML `mi`, `mo`, `mn`, `ms`, `mtext` and an HTML
  `annotation-xml`, of SVG `title` and `desc`, and HTML elements the parser
  moves out of SVG or MathML. A `foreignObject` is handled. (FORMA-027)

## [2.0.1] - 2026-08-08

### Fixed

- Snapshot an element's attributes before binding colon directives. A synchronous
  `data-bind:*` effect can add or remove an attribute; iterating the browser's live
  `NamedNodeMap` could therefore skip an adjacent `data-class:*` or `data-on:*`
  directive. Forma Vector Studio exposed this integration defect and now has the
  released runtime fix available through npm.
- Declare generated split runtime chunks as side effects and verify those declarations
  against the actual distribution, preventing linked consumers from dropping required
  bare side-effect imports.

## [2.0.0] - 2026-08-06

A hardening release. A five-lens audit of 1.5.0 (docs-vs-behaviour, security,
reactive-core correctness, packaging, downstream contract) produced 38 confirmed
findings; this entry is the result of fixing them. The theme is that several
things the documentation promised were not true of the shipped code — most
importantly the headline CSP promise — so behaviour was changed to match the
promise rather than the other way round.

**If you are upgrading, read "Changed — breaking" first.** The suite went from
1007 tests to 1699 — but the number that moved is the one under "Test suite —
measured, not assumed": the share of injected defects the suite actually
detects.

### Changed — breaking

- **The regex expression parser and the `new Function()` fallback are gone.**
  Every build now evaluates `data-*` expressions with an allowlist AST
  interpreter (`src/expr/`): lexer, precedence-climbing parser, validator,
  tree-walking interpreter. **No shipped artifact contains `eval`,
  `new Function` or `with()`.** `setUnsafeEval()`, `isUnsafeEvalAllowed()`,
  `setUnsafeEvalMode()`, `getUnsafeEvalMode()`, `data-forma-unsafe-eval` and
  `__FORMA_RUNTIME_CONFIG.allowUnsafeEval` are **removed** — there is no
  fallback left for them to control. Code calling them must delete the call.
- **The grammar got bigger, not smaller.** Newly supported, with no
  `'unsafe-eval'`: arrow-function callbacks in `map` / `filter` / `find` /
  `findIndex` / `some` / `every` / `flatMap` / `reduce` / `sort` (the flagship
  README example runs again), object literals, `typeof`, unary `-`,
  general computed member access (`obj[k]`, `items[i + 1]`, `a.b[0].c`),
  member and computed assignment (`item.done = !item.done`, `obj.n += 1`),
  handler statements that are a bare method call (`$el.classList.toggle('x')`,
  `$refs.myInput.focus()`, `$dispatch('selected', {id})`), and the frozen
  namespaces `JSON`, `Object`, `Array`, `Date.now`, `Number`, `String`,
  `Boolean`, `parseInt`, `parseFloat` alongside `Math`.
- **Two silent wrong answers are now correct.** Unary `!` had the LOWEST
  precedence in the regex cascade, so `!a || b` computed `!(a || b)` and
  rendered the wrong value with no diagnostic. The ternary matcher was
  string-blind, so `{ok ? 'https://a' : 'https://b'}` — the commonest
  `data-bind:href` idiom — was rejected because of the `//` inside a string.
- **Three silent `undefined`s are now either working or reported.**
  `{q = $event.target.value}` parsed, emitted no diagnostic and wrote
  `undefined`; it now works. `{JSON.stringify(o)}` and `{Object.keys(o)}`
  parsed and returned `undefined`; they now work. `{items.push(x)}`,
  `{document.title}` and every other denial now report with a stable code
  (`FORMA_E_METHOD_DENIED`, `FORMA_E_UNRESOLVED`, …) and a column, and the
  binding leaves the DOM untouched instead of writing an empty string.
- **An unknown assignment target in a handler is an error, not a no-op.**
  `{coutn = 1}` used to run `scope.setters[name]?.(val)` and do nothing at all;
  it now reports `FORMA_E_ASSIGN_DENIED`.
- **Identifiers that are not declared state are errors.** The regex parser read
  an unknown name as `undefined`. `{missing ?? 'x'}` now requires `missing` to
  be a declared key (a key holding `null`/`undefined` is fine — the error is for
  names that do not exist at all).
- **A `formajs:diagnostic` event now fires once per distinct expression**
  rather than once per occurrence; the running total stays available through
  `getDiagnostics()`. A 1,000-row list sharing one denied expression used to
  dispatch 1,000 events.
- **`h()` now drops props whose name starts with `on` in ANY casing.** Detection
  was a case-sensitive two-character test, so `ONCLICK` / `Onerror` / `ONLOAD`
  skipped `addEventListener` and fell through to `setAttribute`, writing a real
  inline handler that the browser executes (SSR dropped these case-insensitively,
  so spreading server-supplied props produced clean HTML and an executing handler
  on the client). Apps that relied on writing an `ONCLICK` *attribute* break.
- **`h()` and hydration now drop dangerous-scheme URL attributes**, matching what
  the SSR renderer has always dropped: `javascript:`, `vbscript:` and
  `data:text/html` on `href`, `src`, `action`, `formaction`, `xlink:href`,
  `poster`, `background` and `data`. Previously the SSR-blocked payload was
  *re-added* on the client at hydration. A reactive URL binding whose value turns
  dangerous now **removes** the attribute rather than leaving the last accepted
  value.
- **`createStore` refuses `__proto__` / `constructor` / `prototype` writes**
  through both `setState` and the proxy's `set` trap. Previously a `__proto__`
  key — which `JSON.parse` creates as a real own property — replaced the store's
  prototype, letting untrusted JSON forge fields the app never defined.
- **Removed `renderToStringWithHydration`** from `@getforma/core/ssr`. It emitted
  a second, undocumented marker dialect that no client code could enter (adoption
  is driven per-island by `hydrateIsland` from a `data-forma-island` shell), and
  its docstring promised hydration it could not deliver.
- **Removed the `./runtime/global` and `./runtime-csp/global` exports subpaths.**
  The files still ship and still load by URL; they were never resolvable as
  modules, because an IIFE that assigns `var FormaRuntime = …` defines nothing
  when imported.
- **Deleted `dist/formajs.global.js`** (461 KB with its map). An undocumented
  orphan: no README row, no exports subpath, no `sideEffects` entry. Use
  `dist/forma.esm.js` to load the core from a CDN.
- **`engines.node` raised from `>=18` to `>=20.19.0`**, which is what the dev
  toolchain (vite) already required and what CI actually exercises.
- **Show adoption no longer re-inserts the server's DOM after a toggle.** When
  both branches render the same tag, adoption cannot tell which one the server
  produced; the adopted nodes are now dropped on the first swap away and the
  branch is rebuilt from its factory on return. Node identity across a full
  toggle round-trip is gone — that is the price of never guessing.
- **Adopted list rows re-run `renderFn` once at hydration** (in hydration mode:
  descriptors only, no DOM), which is what makes `onClick` and reactive props
  work on server-rendered rows. A `renderFn` with side effects therefore runs
  once on the server and once at adoption.
- **`MarkerMap.show` lost its `cachedContent` field** (public type change): it
  was always `null` and never read.

### Added

- **A hot-path benchmark suite** — `bench/*.bench.ts`, run with `npm run bench`
  (`bench:doc` regenerates the table, `bench:compare` diffs against the committed
  `docs/performance-baseline.json`). It covers signal-write → effect-flush,
  `h()` attribute writes split by which guards they pay for, `createList` render
  and keyed reconciliation, SSR adoption, island activation through both props
  channels, `renderToString`, and the CSP-safe interpreter against the
  `new Function` path it replaced. Every row reports median, p95 and run-to-run
  spread, so a later comparison can tell a regression from noise. Results,
  method, and a per-guard A/B against the pre-hardening tree are in
  [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
- **Two regressions the hardening introduced are now measured and documented**
  rather than suspected: routing every list-row removal through
  `deactivateIslandsIn` costs ~15 µs per removed row (a `querySelectorAll` per
  row, +206% on a 1000-row teardown), and `handleGenericAttr` running the URL
  scheme check *before* its identity cache costs +50 ns on every no-op reactive
  URL write. Both have named fixes in the doc that keep the safety.
- **`sanitizePropsDeep(props)`** (root entry): strips `__proto__` /
  `constructor` / `prototype` at every depth, iteratively and cycle-safe. Island
  props remain **shallow-sanitized by default** — call this yourself before
  handing props to anything that deep-merges them. RPC arguments are already
  sanitized recursively without an opt-in; the two were previously documented as
  equivalent and are not.
- **`isUnsafeEvalAllowed()`** (`@getforma/core/runtime`): the live answer to
  whether the Function-constructor fallback can run.
- **`data-forma-expr-error="unsupported"`**: client-only DOM marker on an element
  whose expression could not be compiled, mirroring the existing
  `data-forma-handler-error`. Not part of the hydration wire contract; the Rust
  walker does not read it.
- **`activateIslands(registry, root?)`**: optional root, so a Shadow DOM subtree
  can be activated without touching the rest of the document.
- **`dist/forma.esm.js`**: a self-contained browser ESM bundle (alien-signals
  inlined, no code-split chunks), which is what makes the documented
  `<script type="module">` CDN recipe work. The old recipe pointed at
  `dist/index.js`, which imports the bare specifier `"alien-signals"` — a browser
  can resolve neither that nor the chunks. **Do not mix it with the npm entry in
  one app**; it carries its own copy of the core.
- **`@getforma/core/wasm`** is now built, typed and exported. `renderLocal` /
  `renderIsland` were announced as available "via direct import from the
  `@getforma/core/wasm` path" in 0.7.1 but had no build entry, no dist output and
  no exports key from 0.7.1 through 1.5.0, so the import always failed.
- **Duplicate-instance detection**: loading two copies of the core in one process
  (mixing `import`/`require`, or the browser bundle alongside the npm entry) now
  warns once. Signals, the owner tree and both registries are per-copy, so this
  used to present as "my signal updates nothing".
- `$event` and `event` now resolve in the CSP-safe handler parser, so
  `q = $event.target.value` and `if (event.key === 'Enter') { … }` compile with
  no eval. The former used to compile into an assignment of `undefined` with no
  diagnostic at all — silent data loss.
- `scripts/verify-dist.mjs` runs as the last step of `npm run build` and asserts
  properties of the real artifacts: exports targets exist, `require` conditions
  are `.cjs`, the browser bundle is self-contained, Node entries keep deps
  external, `__DEV__` is a literal, the hardened builds contain no
  `new Function`, and each file has at most one sourcemap footer.

### Test suite — measured, not assumed

The suite was mutation-probed one surgical break at a time against a corpus of
93 real defect shapes, now committed at `probes/corpus.json`. It detected
**64%** of them overall, **72%** on security-relevant code and **33%** on
`src/ssr/render.ts` — the one component whose output goes straight into a
browser. Re-run against the same corpus after the work below: **100%**,
**100%**, **100%** (three probes are marked equivalent-by-construction and
excluded, each with its proof written into the corpus entry; counting them as
survivors it is 90/93). Four of the defects the work found were live.

- **A shared renderer contract** (`src/__tests__/renderer-contract.test.ts`).
  FormaJS writes attributes through six independent sinks — SSR
  `renderToString`, `h()` static, `h()` reactive, hydration adoption, the
  `data-bind:` binder, and `$el.setAttribute()` in the CSP-safe grammar — and
  each guarantee used to be asserted thoroughly on exactly one of them. That
  habit produced 7 of the 25 code defects in `docs/archive/2026-08-05-hardening-audit.md`. Dangerous
  URLs (8 vectors x all 8 `URL_ATTRS`), safe-URL negative space, event-handler
  names, attribute-name breakout, boolean-attribute semantics and text escaping
  are now asserted once, parameterised over every sink, with a completeness test
  that fails when a new attribute-writing module appears and does not join the
  table.
- **The mutation-probe corpus is committed** (`probes/corpus.json`,
  `node scripts/run-probes.mjs`). Anchors are re-checked on every PR; the full
  run is nightly with a detection floor. Every probe written during a future bug
  investigation goes in it.
- **The testing policy is written down and enforced.** CONTRIBUTING.md gains the
  eight rules and the reviewer's checklist; `src/__tests__/test-policy.test.ts`
  fails the build on a test with no `expect()`, a test file that touches no
  production code, `it.skip` / a self-skipping `existsSync` guard, a test whose
  only assertions are presence checks, a file that is 90% one identical
  assertion, and `vi.mock` of a first-party module without `importOriginal`.

### Fixed — security

- **`$el.setAttribute()` in the expression grammar was unguarded.** It was the
  only attribute sink in the repo with no safety check at all, so a CSP-safe
  `data-on:click` handler could write the `javascript:` href that `data-bind:href`
  refuses twenty lines away in the same file — and, because the name and the
  value both come from expressions that can read state, both halves were
  attacker-reachable. `setAttribute` and `toggleAttribute` now apply the same
  `isSafeAttrName` + `isUnsafeAttrWrite` predicate as every other sink and raise
  `FORMA_E_METHOD_DENIED` instead.
- **A non-function `on*` prop is dropped instead of registered.**
  `h('button', {onclick: 'alert(1)'})` — the inline-handler shape the SSR
  renderer refuses — used to reach `addEventListener` with a string. The string
  never ran; instead the first real click threw `listener.call is not a function`
  inside dispatch and took every other listener on that element down with it. An
  object with a `handleEvent` method is still accepted, because that is a real
  `EventListener`.

### Fixed — hydration and reactivity

- **`data-bind:` writes a bare attribute for `true`.** It wrote `String(true)`,
  producing `disabled="true"` where `h()`, hydration adoption, the SSR renderer
  and the Rust walker all produce a bare `disabled`. An SSR page and its bound
  self disagreed byte-for-byte on every boolean attribute.



- **SSR tag names are validated.** A `VNode.tag` is interpolated into markup with
  no escaping, so an attacker-controlled tag could inject an attribute
  (`div onload=x`) or close the tag. All three VNode branches (`render.ts` and
  both of `stream.ts`) now drop unsafe tags.
- **`data:image/svg+xml` now has a context rule** instead of being blanket-allowed:
  permitted for image-context sinks (`<img src>`, `<image href>`, `<video
  poster>`/`src`, `<audio src>`, `<source src>`, the legacy `background`
  attribute) where the browser decodes it in image mode, blocked for document
  sinks (`<iframe src>`, `<object data>`, `<a href>`, `<use href>`) where an
  `onload=` inside it fires, and blocked when the sink is unknown.
- **`srcdoc`** is recognised as a raw-HTML sink (attribute escaping does not
  neutralize it, because the browser entity-decodes and then parses the value as
  a document). Still emitted — a sandboxed `<iframe srcdoc>` is legitimate — with
  a dev-mode warning.
- **RPC argument sanitization no longer recurses.** `deepStripForbidden` walked
  fully attacker-controlled JSON recursively, before any authorization guard and
  outside `handleRPC`'s try/catch: a ~120 KB deeply nested body overflowed the
  stack, the `RangeError` escaped into `createRPCMiddleware`'s un-caught `await`,
  and Node's default `--unhandled-rejections=throw` killed the process.
  Remote, unauthenticated process kill. The walk is now iterative and
  `createRPCMiddleware` has an error barrier that answers 500.
- **A malformed `__forma_islands` block no longer stops every island on the
  page.** The shared props block was parsed with a bare `JSON.parse` before the
  island loop and outside any try/catch, so one truncated block — or an empty one,
  since `JSON.parse('')` throws — meant zero islands hydrated, including islands
  with inline props or no props. It now degrades to "no shared props". Only a
  real `<script id="__forma_islands">` is accepted; `getElementById` alone matched
  any element with that id, so a user-controlled node earlier in the document
  could supply every island's props.
- **A blocked expression no longer aborts runtime initialization.** The
  blocklist path threw instead of degrading to the existing noop, and the
  throw propagated out of `initRuntime`, so a single offending expression left
  every directive on the page unbound.

### Fixed — hydration and reactivity

- **Hydrated list rows dispose their effects.** Rows created after SSR adoption
  were rendered bare — no `createRoot`, no stored dispose — so their bindings
  stayed subscribed forever: not on row removal, not on island dispose. They now
  match the CSR path.
- **A failed island disposes what it built.** `__formaDispose` was assigned only
  *after* `hydrateIsland` returned, so a component that threw left every effect
  created before the throw live and unreclaimable, still reacting to signal
  writes inside an island marked `status="error"`.
- **Removing a list row tears down islands inside it.** An island's root is
  created with `createUnownedRoot`, so it deliberately does not die with the
  row's root — leaving its effects (and its `IntersectionObserver` / interaction
  listeners, if it had not hydrated yet) running against detached DOM.
- **One broken binding no longer freezes unrelated islands.** A throw inside
  alien-signals' flush aborted the flush, skipping every remaining queued
  binding, and surfaced at the unrelated setter's call site. Re-run errors now
  route to `reportError`/`onError` and the flush continues; the *first* run still
  propagates to its caller, so island activation can mark the island failed.
- **Reactive `className` / `htmlFor` / `tabIndex` survive adoption.** The
  hydration path wrote reactive attribute bindings using the raw prop key with no
  `PROP_TO_ATTR` mapping, producing a useless `classname="…"` attribute — the
  same component rendered correctly server-side and in CSR, then silently lost
  its class binding after hydration.
- **A show whose branch is directly a list is adopted.** `createShow(cond, () =>
  createList(…))` with no wrapper element left the SSR rows in place with no
  reconcile effect bound.
- **`unmount()` after the CSR fallback removes the right element.** When
  `hydrateIsland` replaces an empty SSR shell with the component's own root,
  clearing the detached original left the replacement in the document.
- Also fixed in adoption: `ref` props, event-handler attributes, island-shell
  skipping, digit-anchored marker parsing, duplicate-key ghost rows, and
  adopted-row rebinding.

### Fixed — packaging and build

- **`__DEV__` is a genuine build-time constant.** It is a module *export*, so
  esbuild's `define` never substituted it: no dev path was eliminated and the
  shipped bundles computed it at runtime from `process.env.NODE_ENV` — meaning
  every dev `console.warn`/`console.error` shipped and fired in any Node/SSR or
  bundler context where `NODE_ENV` was unset. The replaceable flag now has its
  own free-identifier name and the `NODE_ENV` fallback is gone from every shipped
  byte. `reportError`'s console fallback no longer re-reads the environment per
  error.
- **Syntax minification is on for all outputs**, which is what actually makes the
  build-time flags fold. Without it, `new Function(` was still present in
  `dist/runtime-hardened.js`, `.cjs` and `formajs-runtime-hardened.global.js`,
  contradicting every docstring that said otherwise. Identifiers and line
  structure are preserved, so nothing is obfuscated. This changes every shipped
  byte.
- **The build is reproducible.** `dist` is cleaned once up front instead of from
  inside parallel tsup configs, where the clean raced the other configs and
  deleted declaration files another config had already written. Two consecutive
  builds now produce 87 byte-identical files.
- **The size gate measures what the README claims.** It gzipped `dist/index.js`
  alone, a re-export shim, so moving code into a shared chunk — or growing one —
  was free. It now walks the real ESM import graph.
- **Types resolve everywhere.** `publint` reports "All good!" and
  `@arethetypeswrong/cli` reports 44 green cells / 0 problems, including node10
  resolution, which previously failed on all 8 subpaths.
- Every emitted file carried **two** `sourceMappingURL` footers (Rollup emits
  one, tsup appends another); they are collapsed to one and asserted.

### Performance

The hardening above was benchmarked after the fact (`npm run bench`,
`docs/PERFORMANCE.md`). Two of its changes cost a great deal; both are fixed with
the safety property intact, and the rest were measured and kept.

- **Removing a list row no longer scans the row for islands.** `reconcileList`
  ran `querySelectorAll('[data-forma-island]')` over **every** departing row,
  which cost ~19 µs per removed six-node row — paid by every list on every page,
  and almost none contain an island. `activateIslands` / `hydrateIslandRoot` now
  count scheduled-or-active islands and the scan is skipped when the count is
  zero; since an island cannot acquire anything to tear down without going
  through one of those paths, the guarantee is unchanged. Removing 1000 six-node
  rows went from 63.6 ms back to 45.7 ms, against 45.7 ms for the same removals
  done by hand with `removeChild` — i.e. back on the floor. Round trips over a
  1000-row list (append/prepend/remove + undo) are **~2.6× faster**.
- **A reactive URL attribute whose value has not changed no longer re-runs the
  scheme guard.** `handleGenericAttr` checked `isDangerousUrl` — an allocating
  `String.replace` plus two regexes — *before* the identity cache, so an
  unchanging `href` paid full price on every flush and then wrote nothing. The
  cache check moved ahead of the guard, which is safe because the reject path
  stores `null` rather than the refused string, so a refused value can never
  produce a cache hit. 76 ns → 28 ns per no-op write; a write whose value *does*
  change still pays for the guard and did not move.

`docs/PERFORMANCE.md` also now resolves the separate finding that `createList`'s
initial render is superlinear where the hand-built floor is linear: it is not the
per-row root, index signal or cache rebuild (3% of the gap), but happy-dom's
array-backed child lists, which make `insertBefore` before a marker and mounting
a `DocumentFragment` quadratic. Both are O(1) in a browser. Three new floors in
`bench/list.bench.ts` carry the evidence.

### Documentation

Every claim in `README.md`, `SECURITY.md` and `CSP.md` was re-checked against the
code, and the ones that assert a security or behavioural property now cite the
test that proves them.

- The flagship "single HTML file" showcase used arrow functions in
  `data-computed` and `data-list`, which the CSP-safe parser rejects — the
  example presented as proof of the zero-build CSP-safe story disproved it. It is
  replaced with markup that a test mounts against the *hardened* build.
- The `createHistory` snippet could not run: it showed a tuple return taking a
  plain initial value, while the real signature takes a `[get, set]` tuple and
  returns a `HistoryControls` object (`TypeError: source is not iterable`).
- `SECURITY.md` called the `with()` + `Proxy` wrapper a sandbox. It is not: the
  `has` trap returns `key in scope.getters`, so any undeclared identifier reports
  `false` and `with()` falls through to the real globals — `document`, `fetch`,
  `localStorage` are all reachable. Only the blocklisted names are stopped.
- The `$el` / `$refs` / `$dispatch` examples in the directive table are handlers
  whose whole body is a method call, which the CSP-safe grammar does not accept;
  they are now marked as needing the opt-in.
- Corrected: every CDN pin (was `1.0.7`), the alien-signals repository link, the
  size figures (the core entry is untree-shaken, not "~8 KB", and the runtime is
  not "~24 KB" — the table in `README.md` carries the current measurement and the
  date it was taken; the allowlist interpreter landed after that first correction
  and moved the runtime figures again), the island coverage figure, the
  `@getforma/core/tc39` shape (it exports `State` and `Computed` — there is no
  `Signal` namespace), and the Supported Versions table (it listed only `1.0.x`
  while 1.5.0 was on npm).
- Added: an *Escape hatches — the trust boundary* section naming the four
  unsanitized HTML sinks (`dangerouslySetInnerHTML`, `setHTMLUnsafe`,
  `reconcile`, `srcdoc`), which appeared in no document while `CSP.md` answered
  "innerHTML — FormaJS uses it? No"; sections for `createResource`,
  `createSuspense`, `svg()` and `createPortal`; a table covering the rest of the
  export surface; and a *Known gaps* section in `SECURITY.md`.
- `src/__tests__/docs-truth.test.ts` now checks the mechanically checkable
  claims — version pins, artifact names, export coverage, the tc39 shape, the
  coverage figure, the size limits — so this class of drift fails CI instead of
  waiting for an audit.
- **`README.md` is a landing page again — 1,183 lines down to 182.** The
  narrative moved to `docs/API.md`, `docs/HTML-RUNTIME.md`, `docs/ISLANDS.md`,
  `docs/CDN-AND-EXPORTS.md`, `docs/COMPARISONS.md` and `docs/STABILITY.md`,
  indexed from `docs/README.md`, with every `Verified by` citation carried across
  unchanged. Nothing was rewritten for style, so the move is diffable. The
  README keeps the badges, the size table, the intro example, install, the three
  entry points, the benchmark citations, the CSP promise and the index.
  All six pages joined `docs-truth.test.ts`'s `DOCS` map in the same change:
  moving a citation out of a checked file into an unchecked one would have
  quietly undone the thing this restructure exists to do. The flagship showcase
  and the directive table are still *extracted from the file at test time* and
  mounted — they now live in and are extracted from `docs/HTML-RUNTIME.md`.
- The hardening ledger moved to `docs/archive/2026-08-05-hardening-audit.md` now
  that all 55 entries are closed; a completed audit sitting next to the reference
  docs reads as current documentation. Its citations are still resolved by path.
- Dropped the README's "WASM render … unreachable before 1.6.0" claim: `./wasm`
  is an `exports` subpath now, and the release number it would first ship in is
  not decided. `docs/STABILITY.md` states the checkable part — no released
  version through 1.5.0 exported the subpath, and it needs
  `window.__FORMA_WASM__`.
- `CSP.md`'s version-history table ends in a row labelled `Unreleased` rather
  than `> 1.5.0`, and a test now pins that label and the released row below it to
  `package.json`, so cutting a release without updating the table fails CI.

### Note on 1.1.0

`getOwner`, `runWithOwner`, `getSignalName`, `value`, `Owner` and
`ResourceFetcherInfo` are listed as "Added" under 1.1.0, but were not re-exported
from the package root until commit `bf35b21` on this branch. Until then they were
reachable only by deep import.

## [1.5.0] - 2026-07-08

Storage / component / wasm robustness. Stacks on 1.4.0.

### Fixed
- **IndexedDB durability**: writes now resolve on transaction commit
  (`tx.oncomplete`), not request success, so a write whose transaction aborts
  (e.g. `QuotaExceededError` at commit) is reported as a failure, not success.
- **IndexedDB connections**: wire `onversionchange`/`onclose` (close + evict) so
  a version bump from another tab/store is not blocked forever; a blocked bump
  settles instead of leaking; a broken/store-less connection is evicted so the
  next call reopens. Concurrent creation of multiple object stores on one
  database is serialized so no store is lost or wedged.
- **`createLocalStorage`/`createSessionStorage`**: `remove()` degrades gracefully
  when storage access throws, matching `get`/`set`.
- **Component disposal**: a component that returns a `DocumentFragment` can now be
  disposed via any of its (now-detached) child nodes — the dispose handle was
  previously stranded on the emptied fragment and leaked.
- **Context**: values provided during a component's setup/mount are auto-removed
  on that component's dispose (by unique frame, so a sibling's value is never
  disturbed); a `setup()` that throws after `provide()` no longer leaks; the
  long-inaccurate "teardown pops automatically" docstring is now true.
- **WASM loader**: `getIR` checks `response.ok` (no longer caches a 404/500 error
  page as IR), and the wasm instantiate + IR fetch are memoized as in-flight
  promises (one per page) with retry-on-failure.
## [1.4.0] - 2026-07-08

Server / SSR robustness. Stacks on 1.3.0. Adds an RPC authorization hook.

### Added
- **RPC authorization guard** (`@getforma/core/server`): `setRPCGuard(fn)`
  (global) or the `authorize` option on `handleRPC`/`createRPCMiddleware`.
  `handleRPC` still performs no authentication by itself — this is the injection
  point. A guard that throws or rejects fails closed (403, no error leak).
- **`StreamOptions.suspenseTimeout`**: cap how long streaming SSR waits for each
  Suspense boundary; on timeout the fallback stays and the stream terminates
  instead of holding the connection open forever.

### Fixed
- **RPC arguments are sanitized**: deep-stripped of `__proto__`/`constructor`/
  `prototype` before the server function runs, so a deep-merging function cannot
  pollute `Object.prototype`. Safe on frozen/sealed arguments.
- **`createRPCMiddleware`** now enforces the `X-Forma-RPC: 1` header and a JSON
  content type (CSRF mitigation), resolves the endpoint path without the query
  string (a `?query` used to 404), and returns accurate status codes
  (400/403/404/415/500) instead of 500 for everything.
- **Streaming SSR** resolves a nested Suspense inside resolved content via its
  own swap (was emitted literally); a synchronous throw in a Suspense resolver no
  longer aborts the whole stream (the shell/fallback are preserved).
## [1.3.0] - 2026-07-08

DOM correctness. Stacks on 1.2.0. Adds the `svg()` helper and completes
`data-model`.

### Fixed
- **Reconciler cache is per-container.** A single reconciler instance shared one
  last-HTML cache, so reconciling a second container to the same HTML as the
  first was a no-op. Keyed per container.
- **Keyed lists no longer drop duplicate-keyed rows past 32 items.** The
  large-list diff path collapsed duplicate keys; it now consumes occurrences
  one-per-match like the small path.
- **`data-list {index}`** is the true loop index (was `indexOf`, wrong for
  duplicate/primitive items and O(n^2)).
- **Islands**: `activateIslands()` re-run no longer double-hydrates/double-binds;
  visible-trigger observers, idle timers, and interaction listeners are torn down
  by `deactivateIsland`/`deactivateAllIslands` (previously leaked and could
  zombie-hydrate); a disposed island cannot be resurrected by a stray callback.
- **Suspense** whose resolved content is a `DocumentFragment` no longer
  duplicates or loses content across re-suspend/re-resolve.
- **CSP expression parser** no longer mis-splits operators inside string literals
  (`{'a' + '-' + 'b'}`), and arithmetic/comparison are correctly left-associative
  (`10 - 3 - 2 === 5`, `12 % 5 % 3 === 2`).

### Added
- **`svg(build)`** context helper so nested `h()` calls create SVG-namespaced
  elements, including dual-use tags like `<a>`. Without it, dual-use tags default
  to HTML.
- **`data-model`** now supports radio groups, `<select multiple>`, an opt-in
  `data-model-indeterminate` companion, member-path targets (`{item.name}`), and
  guards numeric input against writing `NaN` (empty clears to `null`).

### Known limitations
- `svg()` resolves tags by explicit context (no parent-walk); `foreignObject`
  descendants stay SVG; MathML is unsupported.
- The reconciler/`parseHTML` `innerHTML` paths are a trust boundary — do not feed
  them attacker-controlled markup.
## [1.2.0] - 2026-07-08

State layer correctness. Stacks on 1.1.0. Several fixes change observable
behavior (they correct bugs), hence a minor bump.

### Fixed
- **Store array mutations are now reactive.** `push`/`pop`/`shift`/`unshift`/
  `splice`/`sort`/`reverse`/`fill`/`copyWithin`, `delete state.x`, and
  `arr.length = n` now notify subscribed effects (they previously deleted the
  path signals, orphaning subscribers). Effects reading an array itself, its
  `length`, or an index re-run correctly.
- **Store proxy identity**: an object aliased at two paths now gets a
  path-bound proxy (writes notify the correct path); the orphaning inline
  signal cache was removed; stale proxies are evicted on replace/delete.
- **Store**: re-assigning the identical object no longer orphans descendant
  subscribers; a stored function value (e.g. an array method read as a path) is
  no longer misread as a functional updater.
- **History** snapshots entries (in-place mutation can't corrupt past states),
  is batch-safe (an external set batched with `undo()` is recorded; a custom
  `equals` no longer leaks the ignore flag), clamps `maxLength >= 1`, and adds
  `destroy()`.
- **Persist**: cross-tab sync, versioned migration, an `onError` hook, and a
  disposer; JSON parsing stays prototype-pollution-safe.

### Known limitations
- Coarse array own-path reactivity: reading an array subscribes to its mutations
  (SolidJS-style), so unchanged-length mutations still re-run array-level effects
  (values are always correct).
- `createHistory` requires a signal with a stable value; a store-proxy slice that
  returns a fresh proxy per read is not supported.
- `Map`/`Set`/`Date` values and `Object.keys`/`for...in` remain non-reactive.
## [1.1.0] - 2026-07-08

Reactive-core correctness. Several fixes change observable behavior (they correct
long-standing bugs), hence a minor bump. Stacks on the 1.0.10 security release.

### Fixed
- **Effect cleanups are no longer dropped.** The `skipCleanupInfra` fast-path
  latched after a clean first run and then silently discarded — or cross-registered
  onto a sibling — any `onCleanup()`/returned cleanup registered on a later run.
- **An effect that writes a signal it depends on now re-runs** to observe the value
  (alien-signals swallowed the self-notify). Detection is precise: writes to signals
  the effect does not depend on do not cause a spurious re-run; genuine cycles are
  bounded and reported.
- **Nested effects are owned by their parent generation**, so their cleanups run when
  the parent re-runs and on disposal (previously leaked via alien's raw teardown).
  Teardown order is children-before-parents on both the re-run and dispose paths.
- **`createRoot` dispose() during setup** now defers teardown so work created after
  the call is also disposed (was a permanent leak).
- **Computed getters cache and rethrow errors** until a dependency changes (TC39/Solid),
  instead of returning a stale value; errors route through `onError`.
- **`createResource`**: a synchronously-thrown fetcher is captured (loading cleared,
  Suspense balanced); the `AbortSignal` is passed to the fetcher and aborted on
  refetch and on dispose; loading/error transitions are batched (no glitch frame).
- **`equals: () => false`** now force-notifies for identical references ("always
  notify"), not only suppresses.
- **`SignalOptions.name`** no longer breaks `isSignal()` (stored in a side table).

### Added
- `getOwner()` / `runWithOwner()` for owning work created outside the synchronous
  root scope; `getSignalName()`; `ResourceFetcherInfo`.
  **Correction:** these were reachable only by deep import until the root-barrel
  fix on the unreleased branch — see [Unreleased] > *Note on 1.1.0*.
- `onError()` supports multiple handlers and returns an unsubscribe function.

### Changed
- `__DEV__` defaults to production-safe (false) when the environment is
  indeterminate; opt into dev via a global `__FORMA_DEV__`.
## [1.0.10] - 2026-07-08

### Security
- **SSR `javascript:`/`vbscript:` URI filter no longer bypassable with control characters.** Browsers strip tabs/newlines/control chars from a URL scheme before interpreting it, so payloads like `java\tscript:alert(1)` executed despite the old contiguous-string check. Scheme detection now normalizes the value the same way the browser does before testing (`src/security/url-safety.ts`, used by `src/ssr/render.ts` and `src/ssr/stream.ts`).
- **`data-bind:*` and `data-list` row templates can no longer inject `javascript:` URLs or inline event handlers.** The `setAttribute` sinks now reject `on*` attribute names and dangerous URL schemes, in **both** the standard and hardened/CSP runtime builds (the sinks were identical in both; hardening previously only blocked `eval`).
- **SSR attribute-name handling hardened.** Event-handler filtering is now case-insensitive (`OnClick` was previously emitted), and malformed prop keys (e.g. containing whitespace/`=`) can no longer inject additional attributes. Renderer and streaming paths share one `renderAttr` helper so the rules cannot drift.

### Docs
- Corrected the inaccurate "~15 KB gzipped" size claim across `package.json`, `README.md`, and the runtime header: the core entry is ~8 KB gzipped and the full CDN runtime bundle is ~24 KB gzipped.
- `SECURITY.md` / `CSP.md` updated to match actual behavior.

### CI
- Bundle-size gate now enforces a limit on the CDN runtime bundle too (previously only `index.js` was gated; the larger runtime bundle was printed but never enforced). Limits: index ≤ 12 KB, runtime ≤ 28 KB gzipped.

### Chore
- Backfilled changelog entries for 1.0.2–1.0.9 (below).

## [1.0.9] - 2026-04-10

### Fixed
- Use `createUnownedRoot` in `mount`/`activateIslands`; auto-register `createRoot` with its parent plus disposal cleanup in primitives.

## [1.0.6] - 2026-03-31

### Fixed
- **CSP-safe style handling** — replaced `cssText` assignment with CSSOM parsing so inline styles work under a strict Content-Security-Policy.

### Docs
- Added the CSP guide (`CSP.md`) covering strict-CSP handling, common issues, and version history.

## [1.0.8] - 2026-03-27

### Fixed
- Default `elseFn` in `createShow` to prevent a crash when called with two arguments.

## [1.0.7] - 2026-03-17

### Fixed
- `createFetch` fire-and-forget `execute()` now `void`-prefixed.
- SVG `className` crash and array return from function children.
- `createFetch` uses `window.location.origin` as the default base URL.

### Changed
- CI Node matrix updated 18 → 20/22/24.

## [1.0.5] - 2026-03-16

### Fixed
- Export `template` and `templateMany` from the main barrel.
- SVG `className` crash and array return from function children; `createFetch` default base URL.

### Notes
- 1.0.2–1.0.4 were docs/packaging/CI iterations (npm keywords, issue templates, TypeDoc GitHub Pages deploy, trusted publishing (OIDC) migration) with no runtime code changes.

## [1.0.1] - 2026-03-16

### Fixed
- **IIFE global builds no longer minified** — Socket.dev flagged single-line minified files as "obfuscated code" (high severity false positive). IIFE builds are now unminified multi-line code. CDNs serve with gzip/brotli anyway so the wire size impact is negligible. Users who need minification use their own bundler.

## [1.0.0] - 2026-03-16

### BREAKING CHANGES
- **HTTP, storage, and server modules moved to subpath exports.** The main `@getforma/core` entry point no longer includes network-capable code. Import from the new subpaths:
  - `import { createFetch, createSSE, createWebSocket } from '@getforma/core/http'`
  - `import { createLocalStorage, createSessionStorage, createIndexedDB } from '@getforma/core/storage'`
  - `import { createAction, $$serverFunction, handleRPC } from '@getforma/core/server'`
- The main bundle (`dist/index.js`, `dist/index.cjs`) now has **zero `fetch`, zero `WebSocket`, zero `process.env`** — improving supply chain security scores.

### Why 1.0.0
- Subpath exports lock in the final API shape
- Security hardening complete (CSP bypass fixed, `$el` sandboxed, SSR injection fixed)
- alien-signals 3.x integrated with `SignalOptions.equals`, type guards, `trigger`
- 811 tests, full TypeDoc coverage, zero warnings
- Production-proven in GateWASM auth system

## [0.9.1] - 2026-03-15

### Changed
- **Hardened builds now have zero `new Function` in dist** — added compile-time `__EVAL_CAPABLE__` constant that esbuild constant-folds to `false` in hardened builds, enabling dead code elimination of all `new Function()` paths. Socket.dev/Snyk static analysis will no longer flag eval usage in hardened builds.
- **Exported 31 missing types** for TypeDoc — all parameter and return types of public functions are now properly exported (SignalGetter, SignalSetter, FetchOptions, SSEConnection, StoreSetter, etc.). `npm run docs` now generates with 0 warnings.

## [0.9.0] - 2026-03-15

### Added
- **`data-ref` directive and `$refs` magic** — register elements with `data-ref="name"` and access them from expressions via `$refs.name`. Refs are scoped to their `data-forma-state` parent. Supports reading properties (`$refs.input.value`), calling methods (`$refs.input.focus()`), and manipulating classes (`$refs.panel.classList.toggle('open')` via unsafe-eval path).
- **TypeDoc API reference generation** — `npm run docs` generates API documentation from JSDoc comments to `api-docs/`. Added `typedoc` dev dependency and `typedoc.json` config.

## [0.8.2] - 2026-03-15

### Docs
- Added jsDelivr CDN URLs alongside unpkg
- Added ESM import example for modern browsers (no bundler)
- Added version pinning guidance for production
- Updated runtime.ts header with all 6 design inspirations, complete file map, build output documentation, and monolith rationale

## [0.8.1] - 2026-03-15

### Added
- **Reactive introspection APIs** (from alien-signals 3.x):
  - `isSignal(fn)` — type guard: is this a signal getter?
  - `isComputed(fn)` — type guard: is this a computed value?
  - `isEffect(fn)` — type guard: is this a raw effect?
  - `isEffectScope(fn)` — type guard: is this an effect scope?
  - `getBatchDepth()` — returns current batch nesting depth (0 outside batch)
  - `trigger(fn)` — force a computed/effect to recompute even if dependencies unchanged
- **`createComputed` now receives previous value** — the getter function receives `(previousValue?: T)` for efficient diffing patterns without a separate signal
- **`createRoot` now uses alien-signals `effectScope`** — native graph-level effect tracking replaces the userland disposer array for reactive cleanup. Userland disposers (event listeners, timers) still use the array.

## [0.8.0] - 2026-03-15

### Changed
- **Upgraded alien-signals from 1.0.x to 3.1.2.** Replaced `pauseTracking`/`resumeTracking` with `getActiveSub`/`setActiveSub`. This brings the v2 Pending flag optimization (fewer intermediate recomputations) and aligns with Vue 3.6's reactivity engine.

### Added
- **`SignalOptions.equals` — custom equality for `createSignal`.** When provided, the setter reads the current value and only updates the signal if `equals(prev, next)` returns `false`. Works with both literal and functional setters. Previously declared in the type but never wired up — now fully functional.

```typescript
const [pos, setPos] = createSignal(
  { x: 0, y: 0 },
  { equals: (a, b) => a.x === b.x && a.y === b.y },
);
setPos({ x: 0, y: 0 }); // skipped — values are equal
setPos({ x: 1, y: 0 }); // applied — values differ
```

- TC39 compat `Signal.State` now passes `equals` through to `createSignal` natively instead of wrapping with its own setter logic.

## [0.7.1] - 2026-03-15

### Fixed
- **CSP parser operator precedence:** Arithmetic now correctly evaluates before comparison (`a + b > c` = `(a+b) > c`), and AND binds tighter than OR (`a || b && c` = `a || (b&&c)`). Previously produced silent wrong results for compound expressions.
- **Store `deepClone` circular reference guard:** `setState(prev => ...)` no longer stack-overflows on stores with circular references.

### Changed
- **Removed `SignalOptions.equals`:** Was declared in the type but never wired to alien-signals. Removed to prevent false API expectations. TC39 compat `Signal.State` retains its own local `equals` option.
- **Removed `renderLocal`/`renderIsland` from main exports:** These WASM-only functions throw without `window.__FORMA_WASM__` config. They remain available via direct import from `@getforma/core/wasm` path but no longer appear in the main barrel export.
- **Documented store `ownKeys` limitation:** `Object.keys()`, `for...in`, and spread are not reactive on store proxies.

## [0.7.0] - 2026-03-15

### Security
- **`$el` sandbox escape blocked:** `$el` is now wrapped in a safe Proxy that allowlists DOM properties (classList, dataset, style, value, focus, etc.) and blocks access to `ownerDocument`, `parentNode`, `innerHTML`, and any chain that reaches `window`/`document`. Applies to BOTH standard and hardened builds.
- **SSR swap script injection fixed:** `getSwapTag` now escapes `<` as `\u003c` and `>` as `\u003e` in JSON-serialized content, preventing `</script>` from breaking the inline script block during Suspense streaming.
- **Island props sanitized:** `loadIslandProps` now strips `__proto__`, `constructor`, and `prototype` keys from JSON-parsed props (inline and shared script block), matching the sanitization already done by `parseState`.
- **`escapeAttr` strengthened:** Now escapes `<`, `>`, and `'` in addition to `&` and `"`. Blocks `javascript:`, `vbscript:`, and `data:text/html` URIs in `href`, `src`, `action`, and `formaction` attributes across all SSR render paths.

## [0.6.1] - 2026-03-15

### Added
- **C1:** Tests for `suspense-context.ts` — 9 tests covering push/pop stack, LIFO ordering, empty stack safety
- **C2:** Tests for `rpc-client.ts` and `rpc-handler.ts` — 37 tests covering endpoint routing, FORBIDDEN_KEYS protection, error sanitization, fetch mocking, revalidation events
- **C7:** Tests for `reducer.ts` — 8 tests covering tuple return, reactivity, complex state, counter patterns

### Fixed
- Moved internal planning documents (hardening plan, Turbo Streams evaluation) out of public repo

## [0.6.0] - 2026-03-15

### Added
- **S6:** Real `idle` and `interaction` hydration triggers — `idle` defers via `requestIdleCallback` (with `setTimeout` fallback for Safari), `interaction` hydrates on first `pointerdown` or `focusin`. No more stubs.
- **S3:** Function components in `h()` — `h(Counter, {count: 5})` now calls the function with merged props and children. CSR-only (no hydration descriptors or SSR).
- **S7:** Turbo Streams design evaluation — documented that existing `createSSE` + `reconcile()` covers the use case without new abstractions.

### Fixed
- **C3:** Hydrated event listeners now use AbortController — `cleanup(el)` properly removes event listeners attached during island hydration, matching the pattern from `element.ts`.
- **C8:** Standardized HTTP module import paths — `forma/reactive/index.js` → `forma/reactive` in fetch, SSE, and WebSocket modules.

## [0.5.1] - 2026-03-15

### Changed
- **S1:** `createComputed` JSDoc clarified — documents that it is a lazy cached derivation (equivalent to `createMemo`), unlike SolidJS's eager `createComputed`
- **C4:** Removed `longestIncreasingSubsequence` from public API — internal algorithm no longer exported from `@getforma/core`
- **C5:** Removed deprecated `createValueSignal` — all internal usage migrated to `createSignal`. The `ValueSignalSetter` type is also removed.

### Added
- **S4:** `$el` and `$dispatch` magics in the HTML Runtime — `$el` resolves to the current element, `$dispatch(name, detail?)` fires a `CustomEvent` with `bubbles: true` and `composed: true` (crosses Shadow DOM boundaries)
- **H4:** `compiledTemplateCache` now capped at 2048 entries with FIFO eviction, matching `expressionCache` pattern

### Fixed
- **C6:** Component lifecycle errors (`onMount`, `onUnmount`, disposers) now reported via `reportError` instead of silently swallowed — surfaces through `onError()` handler with correct `source` field

## [0.5.0] - 2026-03-15

### Security
- **H2:** `findBlockedMethod` hardened against computed bracket access bypass — string concatenation inside brackets (e.g., `x['constr' + 'uctor']`) is now detected and blocked. Defense-in-depth proxy traps added to both expression and handler evaluation paths.
- **H1:** SSR streaming (`stream.ts`) now validates `dangerouslySetInnerHTML` shape — previously used a direct type assertion cast with no validation, risking runtime crashes or unexpected HTML in streamed SSR output.
- **H5:** Removed relaxed JSON parser from `parseState` — the `RE_UNQUOTED_KEYS` regex corrupted URLs and string values containing colons. `data-forma-state` now requires valid JSON (breaking change for unquoted-key users).

### Added
- `deactivateIsland(el)` — dispose a single island's reactive root and all effects
- `deactivateAllIslands(root?)` — dispose all active islands under a root element (for module swap cleanup in `<forma-stage>`)

### Fixed
- **H3:** Island memory leak — `__formaDispose` was stored on island elements but never called. Every module swap leaked a `createRoot` scope with all effects, listeners, and signal subscriptions.

## [0.4.0] - 2026-03-15

### Changed
- **BREAKING:** `IslandHydrateFn` signature changed from `(props) => unknown` to `(el, props) => unknown` — island callbacks now receive the root `HTMLElement` as the first argument for layout measurement, focus management, CSS class toggling, and third-party library integration

### Docs
- Added "Getting Started with a Bundler" section (Vite setup)
- Consolidated CDN URLs into a clear table with all filename variants
- Documented lifecycle semantics (`onMount` cleanup vs `onUnmount`)
- Added error handling section (`mount()` fail-fast, `onError()`, `createErrorBoundary`)
- Added Solid comparison table
- Added feature stability matrix
- Expanded ecosystem table with all Forma packages (Rust crates + npm)

## [0.3.0] - 2026-03-14

### Security
- SSR swap script injection: both args use `JSON.stringify` to prevent XSS
- Proto-pollution guard: `__proto__`, `constructor`, `prototype` stripped from `parseState()`
- Expanded unsafe method blocklist: `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`, `eval`
- RPC handler no longer leaks internal error messages to clients (dev-only in development mode)

### Changed
- `EventBus` constraint changed from `Record<string, any>` to `Record<string, unknown>` (stricter public API)
- `ListDescriptor` fields changed from `any` to `unknown` (stricter hydration types)
- `$$serverFunction` generic changed from `any` to `unknown`
- `alien-signals` pinned to `~1.0.0` (uses internal APIs, minor bumps could break)
- `createEffect` removed from tsup `pure` list (has side effects — tree-shakers could silently drop user calls)
- `enableAutoRevalidation()` guarded against SSR (checks `typeof window`)

### Added
- `setHTMLUnsafe()` method (preferred name), `setHTML()` deprecated with JSDoc warning
- Storage `validate` type guard option for `createLocalStorage` and `createSessionStorage`
- `parse` option for `createWebSocket` and `createSSE` custom message deserialization
- `runtime-hardened.d.ts` auto-copied from `runtime.d.ts` in post-build
- GitHub Actions CI pipeline (Node 18/20/22 matrix, Playwright E2E, bundle size check)
- GitHub Actions release pipeline (automated npm publish on `v*` tags with provenance)

## [0.2.0] - 2026-03-13

### Added
- HTML Runtime: Alpine-like declarative API via `data-*` attributes with CSP-safe expression parser
- Runtime hardened mode: `new Function()` locked off for strict CSP environments
- Playwright E2E test suite (27 tests across 10 directive groups)
- CDN global builds: `formajs-runtime.global.js` and `formajs-runtime-hardened.global.js`

## [0.1.0] - 2026-03-13

### Added
- Reactive primitives: createSignal, createEffect, createComputed, createMemo, batch, untrack
- Real DOM: h(), mount(), fragment, createText — creates actual DOM elements, no virtual DOM
- Conditional rendering: createShow, createSwitch
- List rendering: createList with keyed reconciliation
- Islands architecture: activateIslands(), hydrateIsland()
- Component lifecycle: defineComponent, onMount, onUnmount, createContext, provide/inject
- State management: createStore, createHistory, persist
- DOM utilities: $, $$, addClass, removeClass, onResize, onIntersect
- Events: createBus, delegate, onKey
- HTTP: createFetch, fetchJSON, createSSE, createWebSocket
- Storage: createLocalStorage, createSessionStorage, createIndexedDB
- SSR runtime: server-side rendering support
- WASM loader: forma-wasm integration
- Runtime hardened mode: locked-off unsafe eval
