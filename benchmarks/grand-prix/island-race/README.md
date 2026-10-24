# Native island track

Read the frozen [round-2 protocol](../ROUND-2.md) before changing a car. This track
keeps separate standings from the original server and client events.

Every car serves `/island`: the exact 100-row dashboard and one native counter.
Forma and Astro activate their declared counter islands. The standalone React,
Preact, Solid, Svelte and Vue cars hydrate only their independently rendered
counter root with native APIs; the unchanged dashboard remains outside it. Next.js and React Router retain their normal application hydration.
The standalone cars build their island server/client separately, so the original
`/ssr` renderer keeps its compiler mode (including non-hydratable Solid output).
`contestants/sync-shared.sh` refreshes their canonical source copies.

## Browser observation

Install with `npm ci`. The portable driver starts one production container with
one CPU and 1 GiB, then invokes:

```sh
node run.mjs --car forma --url http://127.0.0.1:3000 \
  --chrome /absolute/path/to/chrome --chrome-sha256 LOCKED_EXECUTABLE_SHA256 \
  --container-id CONTAINER_ID --commit EXACT_SOURCE_COMMIT --out /absolute/result.json
```

The executable digest must match, and the container must carry round-2 ownership.
Use `--diagnostic` only for local correctness work: it explicitly records
`qualifiedProfile: false` and does not establish the container baseline.

A JavaScript-disabled navigation checks server HTML, every row and summary, and
the initial counter. Each of two warmups and five measured runs uses a fresh
browser context. An init-script observer retains the original parser-created
button/output nodes before application scripts; readiness and each update must
preserve both identities. The runner verifies `0 → 1 → 2`, unchanged dashboard
content, no browser errors, no failed or cached script transfer, and a completed
native readiness hook. It saves every sample and failures before exiting.

`readyAt` is navigation-start to the framework's initial committed counter.
`activationMs` starts immediately before an explicit native API call and ends
at the initial-commit hook; Next.js and Astro report `null` because their normal
application runtime owns that boundary. These unlike internal boundaries are
not ranked together. Click timing ends when the output text updates, without a
frame or layout delay. Zero at the browser clock's precision is retained.

Transferred JavaScript uses CDP `Network.loadingFinished.encodedDataLength` for
Script resources, including HTTP response overhead. Collection ends after ready,
two clicks and 500 ms of network idle. HTML bytes are the decoded response body,
including hydration data. All five values, median and range are retained.

Readiness hooks and selectors are benchmark-only: `#gp-increment`, `#gp-count`,
and `window.__gpIsland = {ready, readyAt, activationStart, activationMs}`. The hook
must run after the native framework has installed its event handling and finished
its initial commit. It cannot substitute a manually attached handler for native
state, hydration or updates.

The report path must be new; runs refuse to overwrite prior evidence. Test the
replacement, fake-readiness and invalid-clock refusal gates with deliberate
synthetic failures (these pages never enter the standings):

```sh
node verify-controls.mjs /absolute/path/to/chrome /absolute/new/control-results
```
