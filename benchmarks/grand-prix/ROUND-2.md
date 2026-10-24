# Grand Prix round 2: frozen protocol

This protocol is committed before implementing or building an island car. It
extends FORMA-254; its original raw data and report remain unchanged in the local
experiment. `baseline-source.json` identifies every imported source file. Any
later amendment must be dated, justified, and applied to every affected car.

## Server and client reruns

Use the original dataset, semantic output checks, event definitions, limits,
warmups, sample counts and durations in `PROTOCOL.md`. Run the fourteen server
cars sequentially on one otherwise idle Linux VM. Record its CPU model, available
CPUs, kernel, RAM, container engine, load averages and CPU pressure before and
after every event. Record exact image IDs, dependency locks and source commits.
Do not describe Docker Desktop results as native Linux measurements. Require
eight available CPUs for the four-CPU server plus four-CPU load generator;
results from a smaller machine are diagnostic only, not the requested baseline.

### Dated amendment: GitHub Actions four-CPU baseline (2026-10-24)

The user selected GitHub Actions for the Linux baseline. The public repository's
available standard Ubuntu x64 VM has four vCPUs and 16 GB RAM. No self-hosted
runner is configured, and the organization's larger-runner API reports that the
feature is unsupported. GitHub's [standard-runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
and [larger-runner requirements](https://docs.github.com/en/actions/how-tos/manage-runners/larger-runners/use-larger-runners)
confirm that an arbitrary eight-core label is not an available standard runner.

The original allocation above remains `native-8-v1`. A new, separately named
`gha-4-v1` profile is frozen before its first measurement. It requires native
Linux on GitHub Actions, exactly four CPUs in the process's actual allowed CPU
list and available parallelism, and a four-CPU Docker engine. CPU numbers come
from `/proc/self/status`; they are not assumed to begin at zero or be contiguous.
The first through fourth allowed CPUs are assigned as follows:

| Workload | CPU quota and affinity | Memory / workers |
| --- | --- | --- |
| Class A server | 1 CPU, first allowed CPU | 1 GiB / one worker |
| Class B server | 2 CPUs, first two allowed CPUs | 2 GiB / two workers where the native server exposes worker count |
| HTTP load generator | 2 CPUs, last two allowed CPUs, disjoint from both server classes | unchanged |
| Build-only event | 4 CPUs, all four allowed CPUs | unchanged |
| Signals | 1 CPU, first allowed CPU | 1 GiB |
| Island server | 1 CPU, first allowed CPU | 1 GiB / one worker |
| Island and DOM browser process trees | last three allowed CPUs | unchanged |

The host coordinator and operating system still share the VM; the profile does
not claim physical-core exclusivity. Record CPU model, allowed IDs, image/kernel,
load and CPU pressure, exact container quota/affinity, and observed browser or
signals process affinity. Incorrect or missing affinity fails closed. Builds,
installs and measurements remain serial, and timing begins after load settles.

This changes the multicore event to a disclosed **two-core** comparison and the
load generator to two CPUs. The dataset, semantic checks, warmups, durations,
sample counts, browser pin, source identities and all three strength budgets
remain unchanged. Rerun all entrants and all compared Forma source revisions
fresh under this same profile on the same job/VM for each paired campaign.
Profile identity and allocations are retained in the raw evidence. No speedup
or ranking may combine different profiles, different hosts, or old diagnostics.
Cross-host figures may be displayed only as separately labelled observations.

All prior four-CPU diagnostics remain diagnostic forever. They used the original
four/four quotas without the new CPU affinity contract and cannot be relabelled
as `gha-4-v1`. Workflow defaults retain `native-8-v1`; a new qualified campaign
must explicitly select `gha-4-v1` with diagnostic mode disabled. The original
eight-CPU profile remains available and its data remains a separate comparison.

Rerun the Forma server at the unmodified 3.0.0 tag, after FORMA-257, and after
FORMA-258 for events 1–4 and 7, using the same machine and protocol. Rerun client
events 9 and 11 before/after FORMA-259 and FORMA-260. Retain each raw run separately
under its exact source commit, never overwrite a baseline. Run the signals race
inside its one-CPU container; host execution does not qualify. Timing collection
must not overlap compilation, browser installation or another benchmark.

## Island track

Entrants are Forma, React on Node/Bun/Deno, Preact, Solid, Svelte, Vue, Next.js,
React Router and Astro. Plain Node/Bun/Deno are server-only controls and do not
have a hydration model. Each entrant serves `/island` with the same 100-row
dashboard, plus one server-rendered interactive counter above the table. The
counter has one button `Increment`, an output initially `0`, and increments by
one per click. The rows and summary remain unchanged. The counter uses each
framework's normal state and native adoption/hydration/activation API. Frameworks
whose application model hydrates the whole route retain that behavior. Standalone React, Preact, Solid, Svelte and Vue must activate only the counter
root, since their native APIs support that directly. Next.js and React Router
retain their native route application behavior. This fairness clarification was
recorded before scored runs; earlier local diagnostics do not count as races.
No manual DOM handler may stand in for a framework's state, hydration or update path.

The server HTML must already contain all 100 rows, the button and the initial
counter value. The browser must reuse the server-rendered counter elements;
replacing them fails the adoption check. Record identity before application
scripts execute. A readiness hook runs only after the framework has installed
the event handler and completed its initial commit. Record an internal duration
from immediately before the native activation call to that readiness hook when
the framework exposes this boundary; otherwise report that metric as unavailable
and retain the common end-to-end readiness measurement. Do not equate unlike
internal timing boundaries.

For each car, run two warmups then five measured fresh browser contexts, in one
locked headless Chromium binary, against its production server with one CPU and
1 GiB. Use a loopback connection without artificial network or CPU throttling.
Measure response HTML bytes (including hydration data), transferred JavaScript
bytes, navigation-start to readiness, native activation duration where available,
and click-to-updated-output duration. Verify `0 → 1 → 2`, unchanged row content,
preserved counter node identity, and no console/page errors. Retain every sample;
report median and range rather than a single fastest result. Do not score a car
that fails correctness. Keep this track separate from the existing standings.

Measurement clarification before racing: transferred JavaScript uses Chromium
CDP's `encodedDataLength`, which includes HTTP response overhead, through
readiness, the two verified clicks and 500 ms of network idle. Record this exact
boundary and do not label it pure minified bundle size. The runner first verifies
the server output with JavaScript disabled. A qualified run authenticates the
Chromium executable hash and checks the server container's one-CPU/1-GiB limits.

## Strength budgets and resource ownership

The Forma check fails above 8 MiB peak under Sprint load, a 50 ms readiness
remainder after `docker run` returns, or 150,000,000 bytes for the runtime image. Memory uses the original Docker-stats
sampling definition; image size uses Docker's uncompressed image size. Boot is
the mean of five first-200 times minus their corresponding `docker run` return
times, exactly as in the original telemetry. It includes the host probe and
network overhead and is not a direct process-to-listen instrument. Missing samples, failed requests or unknown
measurement units fail closed. Demonstrate each gate with a deliberate failing
control, without changing the thresholds. Record release executable bytes and a
distroless/static-base comparison separately from the original Debian-slim car.

All new containers, networks, images and builders carry round-2 ownership. Cleanup
may remove only resources owned by this run. Never prune unrelated Docker caches
or reuse FORMA-254's cleanup labels. Record available disk before and after; stop
if fewer than 4 GiB remain. Cleanup runs on success, failure and interruption.


### Campaign identity (2026-10-24)

A resource profile specifies allocations; it does not identify a machine. Each
host driver now writes an immutable campaign JSON before starting measurements.
The record has a fresh UUID, timestamp, a host fingerprint, and hashed machine
and runner identities. GitHub Actions records also retain the run ID, attempt,
job and repository. Campaign records contain no raw machine or runner tracking
IDs. Original Docker/system inspection records may contain public ephemeral
runner hostnames and container IDs. A child driver refuses an inherited campaign from a
different host or job. A native invocation gets a unique UUID and host hash.

One paired server campaign spans the published car and every exact candidate;
one full-grid server campaign spans all cars. A client campaign spans all client
and signal cars and all before/after trials. Island cars likewise share one
campaign. The exact record accompanies every raw measurement and the separate
RenderCounts instrumented run. Browser subprocesses verify the host-bound file;
the signals container receives only the validated record containing hashes.
Resource-profile equality cannot substitute for campaign equality. Prior raw
artifacts remain unchanged and cannot acquire a new qualified campaign merely
by being rescored. Server and client jobs may contribute normalized points to
the same overall view, but raw speed comparisons require the same campaign.

### Explicit transport evidence (2026-10-24)

The first full server campaign exposed differing probe/load representations for
React Router. That archive remains unresolved and unchanged. From harness
`be858597a42c3fbcbd0146d111c2f3bc7bc8d67a`, every server probe and oha request
explicitly sends `User-Agent: oha/1.16.0`, `Accept: */*` and the selected
`Accept-Encoding` (`identity` for the ordinary race). Retain encoded response
bodies, hashes and raw headers at 10/100/1,000 rows and each event preflight.
Every warmup and timed sample retains its complete oha output and exact arguments,
including malformed output and failures. Decoded probes must satisfy the shared
row/content model. No framework-specific byte normalization is permitted.

For identity responses, smoke, event preflight and every load sample must agree
on body length, and `totalData` must equal that length times completed responses.
This checks exact byte accounting; it does not capture every individual timed
body. Deadline cancellations are excluded from oha's successful-byte denominator.
Compressed lengths can vary with a fresh nonce, so record their actual aggregate
wire-byte means separately from a retained probe's encoded length. Validate
encoded integrity, headers, decoded content and raw arithmetic without claiming
that each timed compressed body has the probe's length. Historical archives must
be read with their recorded harness; they cannot acquire these new proofs.
