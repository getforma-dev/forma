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

The Forma check fails above 8 MiB peak under Sprint load, 50 ms application boot,
or 150,000,000 bytes for the runtime image. Memory uses the original Docker-stats
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
