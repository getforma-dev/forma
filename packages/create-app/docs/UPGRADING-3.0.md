# Moving a 0.6.x template to Forma 3.0

The 3.0 templates use declared props, startup binding and island activation.
Use the released seven-package set together and rebuild the frontend and Rust
server from the same commit. This guide describes the template changes; it
does not claim an existing application has been migrated.

## Dependencies and install policy

The set contains `@getforma/core`, `@getforma/compiler`, `@getforma/build`,
`@getforma/create-app`, `forma-ir`, `forma-ir-derive` and `forma-server` at one
version. Applications consume the matching runtime/build dependency closure;
create-app generates a new project. The minimal template imports the
`PageProps` derive re-export from `forma-ir`,
which already depends on the matching `forma-ir-derive` package.

Use Node 22 or newer and Rust 1.85 or newer. A stable template's manifests use
`^3.y.z` and its shipped lockfiles pin the exact tested archives. Prerelease
manifests pin their exact prerelease. Keep `admin/.npmrc` with
`ignore-scripts=true`, run `npm ci`, then `npm audit signatures`, and retain
both `admin/package-lock.json` and `Cargo.lock`. An update is a deliberate
change to the coordinated dependencies and both locks, followed by a full
build; a successful install alone does not prove compatibility.

The dashboard's Tailwind executable comes from its local `@tailwindcss/cli`
development dependency. The build does not fetch a missing tool. Its README
records the separate watcher advisory in that template's locked graph.

## Minimal: native page, interactive counter

Compare the preserved [previous handler](../../../docs/archive/2026-10-15-template-slice1/packages/create-app/templates/minimal/src/main.rs)
and [previous entry](../../../docs/archive/2026-10-15-template-slice1/packages/create-app/templates/minimal/admin/src/home/app.tsx)
with the current [handler](../templates/minimal/src/main.rs) and
[entry](../templates/minimal/admin/src/home/app.tsx).

Declare `type HomeProps = { count: number }` and accept it in the page.
Register `Counter` as an island with `activateIslands({ Counter })`; initialize
its local signal from `props.count`. The page passes its declared count to
the island. Keep the one standalone `mount(() => Home({ count: 0 }), '#app')`
as the compiler's page selector. A native build removes that page mount from
the browser output. Calling `mount` on served SSR markup now throws
`FORMA_E_MOUNT_SSR`; it no longer hydrates a whole page.

In Rust, derive `PageProps` for `HomeProps { count: u32 }`, load every declared
module, bind `pages.bind::<HomeProps>("home")` once, and call `pages.finalize()`
before opening the listener. Bind the empty `AboutProps` route too. A missing
module, incompatible props shape or unbound SSR route refuses startup.

Each request calls `home.render(&HomeProps { count: 7 }, &ctx)` and returns
the resulting `PageResponse` through `into_response()`. This keeps the fresh
nonce, enforced CSP/Trusted Types policy, integrity metadata and no-store
headers together. Handle `RenderError` as an error response; do not replace
failed SSR with a browser shell. The compiler and core validate the island
state and identity before adopting existing nodes without initial writes.

`npm run build:ssr` selects native rendering. Home serves count 7 and activates
only Counter; the static About page has no browser entry or module preload.
`npm run build` explicitly selects Browser mode and starts the counter at 0.
Changing a served route's mode requires rebuilding and restarting the server.

## Dashboard: keep the explicit Browser route

The dashboard entry declares `ssr: false`, and its handler uses
`render_browser_shell`. Preserve that declaration while updating the APIs.
Turning on native rendering requires a separate declared page/island design.
The dashboard's sample `/api/*` routes remain unauthenticated; its README
describes the deployment boundary and loopback default.

## Build and rollback checks

The strict native compiler refuses unsupported source with a code, file,
line and column. Follow the [native subset](../../compiler/docs/subset.md)
and [diagnostics catalogue](../../../docs/DIAGNOSTICS.md), rather than relying
on the former placeholder output. Keep worker registration off unless the
application explicitly enables it. The retirement `/sw.js` endpoint remains
needed for clients with an old worker.

Test both template route modes, the native counter’s 7 → 8 → 0 updates, retained
nodes and input state during activation, a static About navigation without
script requests, and distinct response nonces with `Cache-Control: no-store`.
Inspect the emitted size report at the current 28,100-byte Forma-code ceiling.
Forma's release P17 repeats the packed-template checks against authenticated
candidate archives; this source guide does not replace that evidence.

For an application rollback, restore its prior source, both prior lockfiles
and the matching build/deployment artifacts together. Do not feed FMIR3 to
the earlier reader or combine a new browser bundle with an old manifest.
See the [server and deployment migration](../../../docs/UPGRADING-3.0.md)
for typed request limits, complete asset digests and previous-release retention.
