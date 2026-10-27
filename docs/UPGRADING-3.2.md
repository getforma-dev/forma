# Upgrade to Forma 3.2

> Historical maintainer migration notes. New applications start directly with
> Forma 3.2.0 using the [scaffolder](../packages/create-app/README.md) and
> [current documentation](README.md). This is not an onboarding sequence.

3.2 introduces optional `@getforma/router`, the `@getforma/core/navigation`
ownership entry, native navigation groups and typed Rust owner/action responses.
Use the coordinated 3.2.0 packages and rebuild your complete deployment.
The [release record](https://github.com/getforma-dev/forma/releases/tag/v3.2.0)
records the published archives and qualification.

## Upgrade the coordinated set

Use one published coordinated version for core, compiler, build, create-app and
the three Rust crates. Add router only where the application opts into it. Do not mix a 3.2 router
with 3.1 core. A 3.1 reader cannot consume a 3.2 manifest.

Update and commit the npm and Cargo locks, build the frontend and native assets,
then rebuild the Rust executable. Deploy the complete result atomically. Never
update a browser group independently of its server manifest or binary.

## Select the appropriate migration

| Existing application | Change |
|---|---|
| Plain server links or no-JS pages | Keep them; routing is optional |
| Custom browser history and conditional rendering | Define browser owners and use `createBrowserAdapter` |
| Generated-HTML page swapping | Generate the adapter's hash registry and admitted content regions; attach widget cleanup to session ownership |
| Typed Rust pages needing retained layouts | Add a native navigation group, typed shell/leaf owners and `createNativeAdapter` |

Use [the routing guide](ROUTING.md) before replacing an existing navigator. Remove
its competing click, `popstate` and history bookkeeping when the router takes
ownership. Keep one coordinator per document. Preserve native behavior for
downloads, modified clicks, external links and unsupported pages.

## Native application responsibilities

Enable `forma-server`'s `navigation` feature and use finalized typed page handles.
A native group requires a single literal outlet per non-leaf owner, identical
CSS/fonts across the group and a closed eager executable graph. Literal import
dependencies are bundled into the initial group script. Group code splitting,
computed dynamic imports and independent group watch builds are not supported
by this first profile. Keep ordinary routes for content outside the admitted
contract; do not weaken CSP or manually assemble ownership metadata.

The sealed policy includes effective response policy and the declared action
allowlist. Check middleware and proxies too. Session/context generation comes
from the server, and retained owners must be revoked when that context changes.
Enhanced actions do not supply authentication, CSRF protection or idempotency.

Browser-rendered layout effects now belong to a route owner's lifetime. Use
ownership cleanup for listeners, timers, observers and workers. A retained parent
must survive child changes; a departed leaf must release its resources.

## Starters and downloads

Select `--template native-router` for a connected Rust SSR router example.
The dashboard remains an explicit Browser application and uses
the shared browser router for 3.2. Minimal remains the ordinary SSR/static example.
Always scaffold from the published 3.2 CLI or the documented sealed-pack
workflow; source template locks are seeds until release packing seals them.

Before rollout, test direct URLs, refresh, no-JS navigation, persistent state,
fresh server props, error/fallback behavior, mutation uncertainty and a complete
artifact rollback. Preserve the old deployment until the new one passes the
application's actual browser acceptance checks.
