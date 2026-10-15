# Worker contract replay

`worker-integrity.mjs` exports `verifyWorkerIntegrity` and `verifyWorkerLifecycle`,
with explicit `WORKER_INTEGRITY_CHECKS` and `WORKER_LIFECYCLE_CHECKS` arrays. Each
function accepts `{build, browser, workDir, app}`; lifecycle also requires
`retiringWorkerSource` containing the actual Rust `serve_sw` off-worker body for
that exact `app`. A missing retirement source fails instead of skipping coverage.

The repository invokes these through `worker-integrity.spec.ts`, using the built
workspace package and the Rust `retiring_worker_source` example. P17 injects its
actual unpacked build package and actual packed-server retirement bytes. Both
callers must compare returned `results` names with the exported required array
and require each result's `passed: true`. A successful return contains every
asserted observation; exceptions fail the rehearsal.

Each call builds an ordinary tiny browser route and lazy module, holds its own
loopback listener on an OS-selected port, and creates/closes a fresh Chromium
context. Chromium's CDP HTTP-cache clear is used to distinguish CacheStorage
reads from the separate browser HTTP cache. The lifecycle replay preserves the
production waiting boundary and includes another app's cache. Build artifacts
remain under the supplied `workDir` for the caller's evidence/cleanup policy;
listeners and browser contexts close even when assertions fail.

The separate packed-server checks cover resource-tag SRI, CSP, and actual server
headers. This helper's HTTP server is a worker behavior fixture, not a substitute
for those packed-server observations.
