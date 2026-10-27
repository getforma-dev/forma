# {{PROJECT_NAME}}

A typed Rust application with optional `@getforma/router` navigation. The layout
counter and input keep their state when you move between Home and About. The
home counter belongs to Home and starts again when that owner is replaced.

## Quick start

```bash
cd admin && npm ci && npm run build && cd ..
cargo run
```

Open [http://localhost:3000](http://localhost:3000). Both `build` and `build:ssr`
compile native owners. The server listens on loopback; `FORMA_PORT=0` selects an
available port and startup prints `FORMA_LISTENING` after binding. Rebuild admin
and restart the server after source changes. Native group watch and dynamic
code loading are deliberately unsupported in this first release.

The distributed npm and Cargo locks authenticate the exact candidate archives.
Use `npm ci` and `cargo --locked`; commit both locks. This source template is a
release seed: it becomes installable through the coordinated release packer's
archive sealing, including the first router archive. Do not resolve an unpublished
router version against the registry or add invented checksums to a seed.

## Ownership and progressive enhancement

`admin/build.ts` independently compiles `shell`, `home` and `about` into real
FMIR modules and one verified eager navigation group. The generated bootstrap
passes the checked island registrations into `src/navigation.ts`. The client
uses `createRouter` with `createNativeAdapter`; it never fetches executable code.

The shell has one empty `data-forma-outlet="main"` outside its island. Its bound
Rust handle renders a persistent owner with unchanged declared props and reuse
key. The selected leaf renders independently and fills that outlet. Finalized
typed bindings and `NavigationBranch` validate the entire branch before a
`PageResponse` or typed navigation response leaves the server.

Ordinary anchors work without JavaScript, on direct `/about` requests and after
refresh. With JavaScript the same anchors update the leaf and browser history;
the layout retains its DOM, state and effects. Back and forward also use typed
navigation. About has no leaf islands, but belongs to the shared group and thus
loads the group's bootstrap. The separate `minimal` starter remains the example
for a standalone static page that sends no JavaScript.

The service worker is off. `/sw.js` serves the retiring worker. Strict compilation,
script-off dependency installation, the Rust 1.85 consumer floor and per-response
CSP/no-store policies remain enabled. Render errors are logged by code and route;
clients receive a non-cacheable generic 500 response.

## Application context and document policy

This example is public and has no sessions or enhanced form actions. Its fixed
`public-v1` context is valid only for that public content. When adding authentication,
derive an opaque context generation server-side and configure `checkContext` and
`contextChannel` on the router before retaining private owner state. Context
identity is not authentication or authorization. Actions still need server-side
session, permission, Origin and CSRF checks; none are demonstrated here.

`SealedNavigationPolicy::page_response_only` declares the complete effective
policy and an empty action allowlist. Serve its typed responses directly. If a
proxy, middleware, meta element or unchecked response adds policy, use ordinary
document navigation until that deployment satisfies the sealed profile. Do not
weaken CSP to enable navigation.
