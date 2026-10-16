# Deployment drill

This lane builds five real distributions with the current build package, embeds them in five
native servers, and places a deterministic HTTP balancer in front of them. The servers load real
FMIR, bind typed `Props`, finalize every native route, return `PageResponse`, and serve hashed assets
through `serve_asset`. The Browser route has its own explicit entry and empty shell.

`A` is the initial release. `B` retains A; `B2` rebuilds the identical B inputs and must reproduce
every output byte. `C` retains B and drops A. `S` is a security release that retains nothing.
Eight panels are loaded only on user clicks. Their hashed URLs come from the page's own manifest
through typed props, so a stale tab cannot silently switch to a new release's panel. The application's
retry increments a query parameter to avoid the browser's cache of a failed module fetch; core
does not own this import or retry.

`runSkewDrill` exports eleven named checks consumed by both the repository spec and P17. They keep
two old tabs alive through rolling deployment, rollback and re-upgrade, compare retained HTTP bytes
and immutable cache headers, and check third-generation and security revocation. A deliberate proxy
fault changes only the root's identity attribute; bundle bytes, SRI and document policies remain
unchanged. The guard must leave the native page or Browser shell inert, dispatch its cancelable event,
reload exactly once with usable storage, and never reload when storage is blocked or the event is
canceled. Missing identity and normal positive interaction are also required.

Run after `npm ci --ignore-scripts`:

```sh
npm run build
CARGO_BUILD_JOBS=3 bash e2e/skew/build.sh
npx playwright test --config e2e/skew/playwright.config.ts --workers 2
```

R17 runs the Chromium spec with the other lanes. P17 builds the same sources with its isolated
packed libraries and locked packed crates, then runs all three engines. The source commit and hashes,
build identities, exact check inventory and HTTP observations are recorded in the packed report.
The helper is repository infrastructure and is not a published package export.

The packed server uses the committed standalone `Cargo.release.lock`, authenticated against the
candidate commit along with its sources. Its feature graph excludes the unrelated workspace's
optional `tracing-core` → `valuable` edge. Every retained third-party version and checksum matches
the workspace seed; the packed build changes only the Forma set version and runs `cargo build --locked`.
The original workspace-pruned seed's locked-build refusal is preserved as qualification evidence.

The packed drill installs all three npm libraries and their pinned dependency closure in a fresh
project outside the checkout, with lifecycle scripts disabled and unchanged lock bytes. Each
library's dependencies and peers must resolve inside that project; candidate archives and registry
signatures are audited before any deployment is built. Merely unpacking core beside the harness
can miss a nested dependency, as the preserved first P17 failure demonstrated.

## Qualification on 2026-10-15

At source `46cffd6bead960a9265f0dbe328e998f56cffa4f`, the actual packed P17 run
passed all 52 checks in 164.424 seconds with all four workspace package `dist` directories
removed. Each of Chromium, Firefox and WebKit passed all eleven deployment checks.
Five deliberately broken products were detected at their intended checks: missing retained
assets, an extra retained generation, security retention, a removed skew guard and a guard
blind to its reload marker. [The qualification record](qualification.json) records package,
report and lock hashes plus the exact check inventory and mutation method. The failed first
packed run and mutation setup failures remain preserved in the release work evidence.
This is evidence for this source; the final integrated release still requires its own P17 run.
