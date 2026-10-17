# N7 application build and visible rebuild

This manual, framework-owned qualification workload covers N7's largest-shape
full application build and save-to-updated-page metrics (v2 §4 N7, A9, and §7.1).
It is separate from R17's whole-repository command and P17's product benchmarks.
No current timing result or release acceptance is claimed by adding this runner.

## Fixed workload and public path

`workload.mjs` materializes 300 distinct reachable TSX component definitions:
12 native page roots, 24 shared components and 264 page-specific components.
Every definition has a distinct marker checked in the actual 12 native responses.
Each page includes ordinary content/forms, a declared Counter island, typed list
rows and a conditional notice. Each shared component is used by two pages.
The fixed edit changes Shared00, and must update both `/page/00` and `/page/11`.
Only `/page/00` is the timed route. The generated source and exact edit are retained.

`app/admin/build.mjs` imports the public `@getforma/build` API. Its `build:ssr`
command enables strict SSR, including the ordinary publication, IR, route-size,
manifest and integrity checks. The native application uses typed `PageHandle`
and the public asset server. Release mode embeds its output; the runner verifies
all routes with the disk output temporarily absent, then restores it. Ordinary
debug rust-embed reads the watch generation from disk; `debug-embed` is not enabled.
An interactive counter must respond correctly before the edit observation.
The watch-ready marker is printed only after the public `build()` call returns
with its complete initial manifest; all route responses are then verified.

## Declared cache condition and endpoints

The policy is **compiled dependencies, fresh application**, selected before any
measurements. Locked npm installation and framework dependency builds, toolchain
and browser installation are setup. Each sample starts with a fresh Cargo target.
The separate empty `forma-n7-dependencies` binary compiles exactly the application's
direct dependencies/features in release mode. The runner compares both resolved
dependency roots and records the setup's Cargo JSON messages. It refuses any
application package message, application-named target/fingerprint/object, or an
existing application `dist`. It does not delete an accidental application build
and call it fresh. `CARGO_INCREMENTAL=0`; the application has no build script.

The full-build clock starts before `npm run build:ssr` and ends after
`cargo build --release --locked -p forma-n7-a9` exits successfully. This includes
fresh application compilation, native linking and asset embedding, plus the
entire frontend pipeline. Output correctness is verified afterward. Dependency
setup and later debug/watch/browser setup are recorded separately and are not
claimed to meet the 30-second application budget. This is not a cold-toolchain
or cold-dependency-install benchmark. No application objects or executable are
reused at the full-build start.

The update clock starts **before** the one real source save. Polling observes an
updated HTTP 200 response from the same debug server, then performs a real browser
reload and requires the changed DOM marker followed by two animation frames.
Polling, HTTP, transport, reload and frame latency remain inside the endpoint.
The served-response milestone is retained separately; it cannot substitute for
the visible endpoint. This is a harness-initiated reload, not automatic HMR.
Both affected routes and the unaffected routes are checked after the observation.
No server restart, IR-only update or unrelated fast route can satisfy it.

## Manual campaign

`.github/workflows/n7-build-loop.yml` is dispatch-only with read permission. The
reviewed `source_commit` must be an exact 40-character lowercase commit; checkout
identity is checked. It runs 20 independent hosted jobs, one original full build
and one original edit each, at most 10 in parallel. There are no sample retries
or replacements. Setup failures and slow/failed observations remain failures.

The declared profile is Ubuntu 24.04 x64, four logical CPUs, Cargo four jobs,
Node 24.22.0 and Rust 1.99.1, with Chromium from the source's locked Playwright.
Rust 1.99.1 was observed in current CI39019953319's original R17 setup/toolchain
log; it is pinned here instead of using floating stable. Every sample records
actual image version, kernel, CPU, memory, compiler, runtime and browser versions.
Image/toolchain coherence is checked across all 20; CPU model variation within
the declared hosted class is recorded, not used to discard observations.
Cold setup steps remain in the original Actions logs, and Cargo/debug setup
commands also have individual durations and retained stdout/stderr in the sample.

The existing Linux ownership supervisor bounds each worker at 900 seconds,
retains failure logs, and requires no live descendant after producer cleanup.
The job has a 25-minute bound including setup. Each sample artifact contains the
raw result, commands/logs, original generated source, original/updated output,
served HTML and ownership report; the large Cargo target is excluded from upload.
The runner's targeted absence checks preserve accidental artifacts on failure.

Aggregation requires every sample 1–20, one source/run identity, attempt one,
correctness and owned cleanup. It retains all durations, minimum, median and
maximum and computes nearest-rank p95 (19th of 20). Qualification requires:

- Full application build p95 **strictly below 30,000 ms**.
- Save-to-visible-page p95 **strictly below 1,000 ms**.

One maximum above a threshold is still visible in the report; it is not silently
removed. An incomplete/failed sample, source/profile mismatch or cleanup failure
invalidates the campaign. No subset of successful observations can qualify.

## Bounded implementation checks

`node --test e2e/performance/build/measurement.test.mjs` exercises the actual graph,
cache guard, update loop and aggregator with finite explicitly synthetic inputs.
It is the only addition to normal `check.sh`; normal PR CI does not run 20 builds.

After independent source review, a separately authorized local correctness pilot
may use `run.mjs pilot <fresh-directory> <exact-source> 1` with Cargo at most three
jobs and one browser. It is marked `pilot: true` and cannot pass the CI aggregator.
It must use an external owned deadline/cleanup wrapper appropriate to the host.
The pilot tests the public seams; it is not N7 qualification. A full campaign needs
an independently reviewed settled source and a separate dispatch authorization.
