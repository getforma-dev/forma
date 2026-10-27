# @getforma/router

Optional client navigation for Forma: ranked routes, persistent layouts, owned
cleanup, browser history and progressively enhanced typed Rust actions.

The router is published in **[Forma 3.2.0-rc.3](https://github.com/getforma-dev/forma/releases/tag/v3.2.0-rc.3)**.
Stable 3.1.0
does not contain this API or core's `/navigation` entry. Use one coordinated
published candidate or the sealed packed candidate for qualification; do not
mix a 3.2 router with 3.1 core. The [release records](../../docs/release/README.md)
keep source validation, publication and stable acceptance separate.
Start with the [routing guide](../../docs/ROUTING.md) for rendering choices and a
connected application, or the [3.2 upgrade guide](../../docs/UPGRADING-3.2.md).

The router is a separate package with one peer instance of `@getforma/core`.
Installing core does not enable routing. Ordinary SSR, native anchors/forms and
static routes continue to work without a router bootstrap.

Islands and routing are complementary. With `createNativeAdapter`, Rust renders
destination HTML, islands supply interactivity, and the router preserves
compatible layouts while replacing changed owners. Client-side navigation does
not require whole-page client-side rendering. Use `createBrowserAdapter` for
routes rendered in JavaScript, and never mount it over existing native owners.
An application can use both paths in different sections; crossing between them
loads a new document. The [rendering guide](../../docs/ROUTING.md#islands-and-navigation-work-together)
explains the supported combinations and current native-group build constraints.

## Install the published candidate

For an existing browser application with the matching 3.2 toolchain:

```sh
npm install --save-exact @getforma/core@3.2.0-rc.3 @getforma/router@3.2.0-rc.3
```

Native applications also coordinate compiler, build and Rust crate versions;
follow the [upgrade guide](../../docs/UPGRADING-3.2.md). For a complete connected
example, use the published [native-router starter](../../docs/ROUTING.md#start-with-a-connected-application).
Core-only applications can keep their existing graph without installing router.

## Browser routes

```ts
import { createRouter, createBrowserAdapter, Link, Outlet } from '@getforma/router';
import { h, createSignal } from '@getforma/core';

const router = createRouter({
  root: document.querySelector<HTMLElement>('#app')!,
  adapter: createBrowserAdapter(),
  routes: [{
    id: 'layout',
    render({ outlet }) {
      const [count, setCount] = createSignal(0);
      return h('section', null,
        h('button', { onClick: () => setCount(count() + 1) }, () => count()),
        Link({ href: '/projects/alpha', children: 'Alpha' }),
        Link({ href: '/projects/beta', children: 'Beta' }),
        Outlet({ outlet }));
    },
    children: [{
      id: 'project', path: 'projects/:name',
      render({ params }) { return h('h1', null, params.name); },
    }],
  }],
});
await router.ready;
await router.navigate('/projects/beta?tag=one&tag=two');
```

Components run once in separately disposable Forma roots. Reactive callbacks
must use accessors, following core's usual rules. `render({ url })` receives a
fresh destination URL snapshot for one-time initialization, such as
`createSignal(url.searchParams.get('filter'))`. Mutating that snapshot cannot
change navigation or another owner's input. `location()` remains the reactive
committed location: detached preparation sees the previous committed view until
commit, and a retained layout observes subsequent commits. Put effect cleanup in
`createEffect(() => { ...; onCleanup(dispose); })`. Returning the supplied exact
`outlet` inside a parent establishes child ownership; it is not a second mount.
Parameters belonging to children do not invalidate their parent. A changed
`reuseKey(match)` replaces that browser owner and its descendants. Explicit
revalidation recreates the leaf. Children are disposed before their parent.
`render({ signal })` receives the owner's lifetime signal. Cancelled preparation
aborts detached owners; committed owners keep their signal until release, so a
retained layout's work survives later navigation.

Routes have unique ASCII `id`s, relative literal paths, `:parameters`, terminal
`*`, pathless parents and explicit `index: true` leaves. `/` is an empty root
path. Static segments rank before parameters, then splats. Equal overlapping
branches are errors. Optional/regex/matrix syntax, duplicate parameters and
nonterminal splats are refused. Limits are 1,000 declarations and 32 levels.
URLs split into segments before percent decoding; `%2F` stays in one parameter.
Params have a null prototype. Query repetition remains in `URLSearchParams`.

## Native Rust pages

Use a build navigation group, the generated bootstrap registry, and typed server
owners together. Do not copy registration records or assemble a response by hand.

```ts
// build.ts (normal @getforma/build pipeline)
await build({
  app: 'example', ssr: true,
  entryPoints: [
    { entry: 'src/shell.tsx', outfile: 'shell.js' },
    { entry: 'src/home.tsx', outfile: 'home.js' },
    { entry: 'src/about.tsx', outfile: 'about.js' },
  ],
  routes: {
    '/_shell': { js: ['shell'], css: [], fonts: [] },
    '/': { js: ['home'], css: [], fonts: [] },
    '/about': { js: ['about'], css: [], fonts: [] },
  },
  navigationGroups: [{ id: 'public', owners: ['shell', 'home', 'about'], client: './router.ts' }],
  outputDir: 'dist',
});
```

```ts
// router.ts — called once by the closed, integrity-checked group bootstrap
import { createRouter, createNativeAdapter, type NavigationBootstrap } from '@getforma/router';
export default async function start(bootstrap: NavigationBootstrap) {
  const router = createRouter({
    root: document.querySelector<HTMLElement>('[data-forma-router-root]')!,
    adapter: createNativeAdapter(bootstrap),
    recoveryKey: bootstrap.build,
    routes: [{ id: 'shell', children: [
      { id: 'home', index: true }, { id: 'about', path: 'about' },
    ] }],
  });
  await router.ready;
  return router;
}
```

Enable Rust's `forma-server` feature `navigation`. Bind and finalize each compiled
page with its typed `PageProps`, as in ordinary native SSR. Render each owner with
its declared props and a server-owned reuse identifier:

```rust,ignore
let policy = SealedNavigationPolicy::page_response_only(["/save"])?;
let navigation = NavigationConfig::new("public", "layout-v1", context_generation)?
    .with_sealed_policy(policy);
// Apply navigation to the normal RenderCtx with_navigation builder.
let branch = NavigationBranch::new(request_pathname, vec![
    shell.render_owner(&shell_props, &ctx, "shell")?,
    home.render_owner(&home_props, &ctx, "home")?,
])?;
// Choose by the request's Accept representation; never vary only the body.
let response = branch.into_navigation_response()?; // enhanced GET
// A normal/direct/no-JS request uses branch.into_document_response() instead.
```

The executable [native-router starter](../create-app/templates/native-router/)
and [typed fixture](../../experiments/forma-router-native/) contain complete
binding, negotiation, response and asset-serving code. The public client does
not select authority: Rust derives contract/props/reuse digests, and core captures
exact original hosts before activation. Only a compatible common prefix survives.
Immutable props changes replace the owner; fetched claims cannot expand a retained
owner's authority. Immediate islands participate in readiness; deferred jobs stay
revocable and are not falsely reported as already interactive.

The first profile requires an explicit sealed policy declaration: all effective
CSP/TT/header policy must be represented by the typed response, with no additional
route-dependent proxy/middleware/meta policy. It enforces `form-action 'self'` and
an exact declared action list. If the application cannot guarantee that, keep
ordinary navigation. CSS/fonts are identical across a group; all executable
imports are bundled into its initial SRI artifact. New scripts are never replayed.
Literal import dependencies are bundled eagerly; computed dynamic imports,
independent group watch builds and code splitting are explicitly unsupported
in this first group product.

## Generated HTML

`createHtmlAdapter({head, pages})` is an explicitly registered static-document
adapter. Each `HtmlPage` has `path`, `sha256` of the complete UTF-8 HTML file,
`title`, and an identical build-owned `head` identity. The application attests
that the registered pages share effective HTTP policy and immutable head/assets.
It emits exactly one `<!--forma:region:start-->…<!--forma:region:end-->` pair
around a single element. Only that region is parsed and imported. Generate the
registry **after** rendering documents; a same-origin data registry tied to the
initial build can be loaded before creating the adapter, avoiding a document/hash
cycle inside its executable bootstrap. Deploy documents, registry and bootstrap
as one set. Keep title changes in the registered descriptor.

The adapter verifies each whole-document hash before region parsing, refuses
search-dependent documents and native state/SSR markers, and never parses or
replays fetched head scripts. Ordinary HTTP(S), mailto and tel anchors remain
links; unsafe schemes and foreign form destinations are refused. Native markup
has the narrower same-origin URL profile. Both profiles reject executable tags,
event/style attributes, custom elements, SVG/MathML, shadow roots, resource-loading
nodes and malformed/deep markup before import. Unsupported content uses a bounded
GET document boundary. This deliberately does not replace arbitrary website
lifecycle code: wrap the adapter's session to own page features and their disposal.

## Outcomes, forms and lifetime

There is one coordinator per Document. `base` defaults to `/`; a non-root base
must start/end with `/`. Relative destinations resolve from the committed URL,
even during pending Back/Forward. An imperative destination outside the base
returns `failed/ROUTER_URL`; an ordinary out-of-base anchor stays native. `location()` and `pending()` return defensive
URL snapshots. PUSH/REPLACE reserve fallible history work before disposal. POP
never pushes; blocked known entries are repaired with their actual traversal
delta. Foreign/evicted entries use document recovery. Same-URL navigation is
`cancelled/unchanged`; `revalidate()` performs a GET without creating a visit.
Hash-only navigation preserves owners. Switching native/generated adapters takes
a document boundary, preventing a browser mount over native owners.

`navigate()` resolves to `committed`, `cancelled`, `blocked`,
`document-navigation` or `failed`. A committed result contains its location and
`ready` promise. It settles after immediate activation; visible/idle jobs can
remain deferred. Newer generations cancel stale preparation even if a loader
ignores AbortSignal. Cleanup-triggered navigation is queued until the synchronous
commit ends; only the latest queued intent survives. Disposal/context revocation
inside cleanup cannot resurrect a candidate.

Links remain ordinary anchors. Modified, non-primary, downloaded, targeted,
external and `data-no-router` links stay native. Early links/forms stay native
until initial readiness. The router manages title, `aria-busy`, a polite status
region, entry-key scroll, and focus. Mark a destination heading with
`data-forma-route-heading`; a retained focused control keeps its selection.
No animation or View Transitions API is required.

`beforeLeave((next, signal) => boolean | Promise<boolean>)` returns an unregister
function. Blockers are application UX, not authorization. `dispose()` removes
listeners, aborts owned work, disposes sessions and restores scrollRestoration.

Native forms require a declared canonical same-origin endpoint. Constraint
validation and submitter overrides run before transmission. GET forms preserve
repeated fields; POST supports URL encoding and platform multipart boundaries.
Unsupported methods/targets/encodings remain native. The slot is reserved before
FormData construction; a synchronous `formdata` callback cannot send a second
POST or transmit after disposal. `mutation()` reports idle/submitting/revalidating/
uncertain. Native Rust `ActionResponse` constructors require bound `ActionContext`
and preserve HTTP 422 or error statuses. Enhanced redirects are HTTP 200 envelopes
with semantic 303 followed by GET; fetch never follows a POST redirect.

Validation/error results preserve status and application data; `onAction` can
render field errors. A `[data-forma-form-error]` summary receives a plain-text
message and focus. Framework code does not echo secret inputs. Known completion
invalidates older reads and revalidates the latest destination, including a newer
pending GET. A late old form never redirects a newer page back.

Before transmission, the router writes one opaque attempt identifier to
sessionStorage. An occupied slot or unavailable storage prevents another enhanced
POST; the record contains no form data. Timeout, unreadable/mismatched response
or an authentication boundary means **unknown outcome**, not rollback. The latch
survives document recovery and blocks resubmission; no POST is automatically
retried. Only an admitted response or explicit resolution for the same identifier
can clear it; a late document cannot clear a newer attempt's latch.
Use `await router.resolveUncertain(check)` only with application status/idempotency
evidence that resolves the earlier transaction. A successful GET alone is not
that evidence. The server remains responsible for authentication, CSRF,
authorization, transaction semantics and read-after-write consistency.

## Context, bounds and fallback

Call `invalidateContext()` before login/logout/account/role changes can retain
private owners. It revokes immediately and starts one bounded document GET.
`contextChannel` optionally broadcasts that invalidation across same-origin tabs.
`checkContext(signal)` performs a fresh no-store foreground check. While held,
enhanced requests/transmission wait; false/timeout revokes. Without it, native
foregrounding takes a fresh document boundary. Persisted pageshow always revokes.
No router can instantly observe an arbitrary server-side revocation.

`prefetch(url)` is off unless `canPrefetch(url)` explicitly attests a safe GET.
It runs at most two native/HTML preparations, respects data saving, and shares
only in-flight work with navigation. Completed private responses are never cached.
Mutation, context change, navigation or disposal revokes speculative work.

Limits: 15s navigation/preparation, 30s mutation, 1 MiB decoded response, 10,000
markup tokens, depth 64, 200 islands across the entire final owner branch, 1,000
scroll records, 32 automatic recovery keys per public build identity and 60
history writes per 10s. Error codes contain no private query/form values. Storage
failure or an exhausted recovery journal stops automatic recovery visibly.

Document GET boundaries include unsupported routes/profile/adapter switches,
unknown history positions, build/policy/assets/context mismatch, 401/403, invalid
native responses, failed adoption after history commit and BFCache restoration.
They can lose in-memory page/layout state. A fallback is never counted as a
passing smooth native transition. Public exports and source tests are described
in [implementation and evidence](../../docs/design/router/README.md).
