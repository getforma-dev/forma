# Native owner integration fixture

This is the FORMA-301 integration fixture for the public compiler, build, core
navigation, router and typed server APIs. It preserves the earlier
`../forma-router` experiment and its receipts. The default runner uses source-built
products; the isolated packed runner below qualifies authenticated release archives.
Neither runner publishes a package or deploys an application.

The compiler emits three independent typed owners: `shell`, `a`, and `b`. The
shell contains a real persistent layout island and a compiler-checked outlet.
A/B contain distinct counter islands and a server-backed form. Rust binds and
finalizes every owner before opening its listener. Every GET composes opaque
owners through `NavigationBranch`; normal requests receive complete SSR HTML,
and admitted requests receive the same typed branch as native JSON. Client code
uses only public `@getforma/router` imports and the build-generated registry.

`dist-next` is a second actual compiled application build with the same owner
contracts and a different initialization module. The `build=changed` fixture
selector serves its separately bound handles and real hashed assets, exercising
the build boundary without editing a manifest or forging a response identity.
`plain-a.tsx` and `plain-b.tsx` are fixed full-document equivalents using the same
layout and leaf island source for paired size measurement.

## Run

Use the repository's pinned Node 24 toolchain. From the repository root:

```sh
npm ci --ignore-scripts
node scripts/run-router-native-proof.mjs
```

The owned-process runner builds the packages and real application, compiles the
typed Rust server, selects an available loopback port, runs all three engines,
and stops its server before returning. It writes a unique evidence directory
under `test-results/router-native`, including every command, process cleanup and
browser result. `--engines chromium` selects a CI subset; `--skip-package-build`
uses already built package artifacts. Both the full check and release browser
matrix run this fixture. To debug the individual steps instead:

```sh
npm run build
node experiments/forma-router-native/build.mjs
CARGO_BUILD_JOBS=3 cargo build --locked \
  --manifest-path experiments/forma-router-native/server/Cargo.toml
experiments/forma-router-native/server/target/debug/forma-router-native-fixture
```

The last command prints an available loopback origin and keeps running. In a
second terminal, substitute that exact origin and choose a **new** receipt name:

```sh
node experiments/forma-router-native/browser.mjs \
  http://127.0.0.1:PORT \
  experiments/forma-router-native/evidence/browser-run-N.json
```

The runner executes Chromium, Firefox and WebKit with a 390×844 viewport and
reduced motion. Install the repository's Playwright browser binaries if missing.
For diagnosis, `NATIVE_ENGINES=chromium` selects one engine and `NATIVE_CASE=text`
selects matching scenario names. The scenario result includes the design's
`RT-*` identifiers, exact artifact and source hashes, browser/tool versions,
server executable hash, git identity/dirty state, and source/artifact drift flags.
Do not overwrite a failure when rerunning. A source integration receipt is not a
packed qualification receipt.

Normal-transition cases explicitly preserve `Document`, performance time origin,
layout nodes, layout island and live input/signal state. Recovery cases instead
count one document request, inspect revocation or refused candidate activation
before that request can return, and assert the resulting full document. A reload
cannot satisfy a native-transition assertion.

## Sealed packed products and final results

The final [outer packed receipt](evidence/packed-native-final.json) records **90/90
passing scenarios** across Chromium, Firefox and WebKit against sealed production
commit `9d4aafee0c99cde4faff3f39a8fca2705e70a398`. It authenticates all eight npm/crate
archives, installs the shipped template's integrity-locked npm graph, extracts
the three crates unchanged, verifies resolution paths and checks installed bytes
before and after the campaign. The app and browser harness remain unchanged.
The [inner browser receipt](evidence/packed-native-final-browser.json) retains its
original source-integration label; use the outer receipt for the packed execution
claim and the inner receipt for individual scenarios and served artifact hashes.

Reproduce that isolated boundary with a sealed candidate and a fresh output
directory; substitute its authenticated record digest and producer commit:

```sh
node experiments/forma-router-native/packed-proof.mjs \
  "$PWD" /absolute/candidate-directory RELEASE_SET_SHA256 PRODUCER_COMMIT \
  /absolute/fresh-output-directory
```

The final [timing report](performance-report.md) and [raw receipt](evidence/performance-final.json)
record four complete source-integration cells, 30 samples per direction/mode after
five warmups. Worst directional synchronous-commit p95 was 0.90 ms Chromium,
2.00 ms Firefox and 1.00 ms WebKit against the 16 ms desktop budget, and 3.30 ms
for Chromium's specified 4× mobile emulation against 50 ms. Network-inclusive
readiness, document controls, cold entries and heap observations remain separate.
Its eight archive identities are provenance references; the outer packed receipt
above establishes actual archive execution. Manual screen-reader and physical-device
qualification remain pending release gates.

## Scope and limits

The loopback-only server is a test application, not a production authentication
example. It uses a real HttpOnly/SameSite session cookie, Origin check and CSRF
value and counts real accepted mutations. `/__native/reset` and the mutable
`/__native/context` endpoint are test controls and must not be deployed. A lost
response after the mutation produces one client send and persistent uncertainty;
it does not prove exactly-once execution under arbitrary network failures.

The context verification cases use real no-store HTTP to check a server-owned
generation. Foreground and persisted-pageshow events are dispatched explicitly
to test their handlers; this is not a claim about actual BFCache eligibility,
manual mobile gestures or assistive-technology behavior. Cross-tab channels are
configured; their full multi-tab application policy requires separate coverage.

The 100-cycle case counts actual island listener registration/removal, pending
window timers, current island hosts, and inactive detached controls. It does not
claim heap stability or cleanup of workers/observers that this fixture does not
create. Those resource classes require their own exercised cases. Build/profile
limits, server negative controls and core claim-isolation unit tests complement
this browser fixture; no individual row represents the entire 57-row matrix.

## Retained evidence

- `build-original-budget-failure.log` records the initial ordinary-route N2
  classification failure. The reviewed design has separate N3 incremental and
  N4 complete-group limits; the explicit navigation-group class now enforces
  those without changing ordinary route limits. The original failure remains.
- `browser-chromium-first.json` records 17 passed and 3 failed assertions. Two
  expected `failed` where native refusal deliberately returns a method-safe
  document recovery; one inspected the browser-mount `active` attribute that
  successful adopting islands remove. Their corrections do not change runtime.
- `browser-three-engine-first-termination.json` preserves a terminated campaign
  with known provisional-document assertion timing failures. Assertions now
  inspect captured old roots in the initiating/settling JavaScript turn, before
  document replacement, and count the held recovery request separately.
- `browser-three-engine-second.json` retains 72 passes and 9 failed assertions,
  with stable source and artifacts. The repeated failures exposed harness ordering
  (POST had not transmitted yet after readiness became awaited), the intended
  per-route recovery limit, and native AbortSignal listener cleanup that the first
  counter did not observe. The corrected case waits for the real POST request,
  asserts later recovery refusal, and counts signal-driven removal explicitly.
- Rust receipts cover default mode (216 passes), all features (243 passes), strict
  release/debug lint, and a deliberate occurrence-offset mutation caught by the
  full-document integration test. The raw mutation failure is retained. Later
  resource-profile controls additionally refuse image inputs and background
  attributes before initial document emission.
- `browser-three-engine-third.json` records 81/81 before the later history repair
  correction. `browser-history-final.json` records the three new pending-POP
  regressions in all engines (9/9).
- `browser-final.json` retains 89/90: Firefox observed the old document's completed
  load event during same-URL recovery. The corrected harness arms the main-frame
  navigation event before releasing the held GET, then awaits the new document.
  `browser-final-recovery-sync.json` records 90/90. Served artifacts did not change;
  its source-drift flag records a concurrent edit only to the unexecuted size
  measurement helper. It is not presented as a source-stable campaign.
- The current runner fails source/artifact drift and closes owned browsers on
  interruption. `browser-harness-drift.json` is an intentional source-edit
  negative control (exit 1); `browser-harness-interrupt-corrected.json` is an
  intentional SIGTERM control (exit 1, browsers disconnected). The first
  interruption attempt's mistyped scenario filter selected zero tests; its
  receipt remains, and zero selected scenarios now fail instead of passing.

The matrix-to-scenario mappings live directly in `browser.mjs` and each receipt.
Final results and remaining gaps must be read from the latest complete receipt,
not inferred from the presence of tests or earlier passing subsets.

## Timing and heap observations

The prospective protocol is `design-doc-factory/tasks/forma-router/measurement-protocol.md`.
Build separate measurement assets and an optimized server, then run serially on
AC power after other builds/tests have stopped:

```sh
node experiments/forma-router-native/perf-build.mjs
CARGO_BUILD_JOBS=3 cargo build --release --locked \
  --manifest-path experiments/forma-router-native/server/Cargo.toml
node experiments/forma-router-native/performance.mjs \
  experiments/forma-router-native/evidence/performance-run-N.json
```

The runner owns both servers and all browsers. It measures desktop Chromium,
Firefox and WebKit at 1365×900 and a separate Chromium 390×844 profile with 4× CPU
slowdown, 1.6 Mbit/s download, 750 kbit/s upload and 150 ms latency. Each direction
has five discarded warmups and 30 retained samples, with 250 ms between intents.
Three fresh-context cold entries per route are descriptive samples only. Warm
HTTP caches are retained equally; private responses remain no-store. Raw samples,
source/assets/server hashes, host/browser versions, power and cleanup evidence
are saved, including failures. `NATIVE_PERF_CELLS=chromium-desktop` and `--smoke`
are diagnostic subsets, never substitutes for the full campaign.

`bench-client.ts` wraps public adapter boundaries without changing router code.
The N5 interval conservatively covers the final post-permit validation through
entry to activation, including history write, the complete owner commit and
synchronous coordinator signal/title/scroll bookkeeping. `ownerCommitMs` also
reports the narrower `PreparedView.commit` call. Preparation, preparation-to-history
interval, history write, island readiness and navigation settlement stay separate.
Two in-page animation-frame callbacks provide a scheduling proxy; they do not measure
the compositor's actual paint. The control uses the same typed owners and public
initial hydration, with a new document for each transition. Its browser readiness
timing is separate from driver-inclusive wall time.

The Chromium heap observation records CDP heap usage after two bounded garbage
collections surrounding 100 transitions. Browser history intentionally grows.
This has no invented leak threshold and does not replace deterministic resource
checks or exercise uncreated observers/workers. Manual screen-reader and actual
device gesture qualification remain separate release gates.
