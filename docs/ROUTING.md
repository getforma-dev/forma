# Routing and navigation

Forma's optional `@getforma/router` keeps compatible layouts alive while the URL
and page content change. Rust can continue rendering the destination HTML and
typed props; client navigation does not require moving rendering into JavaScript.
The router is available in the published coordinated **[3.2.0-rc.3 prerelease](https://github.com/getforma-dev/forma/releases/tag/v3.2.0-rc.3)**.
Stable 3.1.0 does not include it. The walkthrough below uses the published
candidate; [release records](release/README.md) track stable acceptance separately.

## Islands and navigation work together

Client-side **navigation** changes the URL and destination content without a full
document reload. Client-side **rendering** creates that content in JavaScript.
Forma supports the first without requiring the second: Rust can render the HTML,
islands can provide its interactivity, and the native adapter can coordinate
navigation between those pages.

| Application | Adapter | Where the destination comes from |
|---|---|---|
| Typed Rust SSR pages with islands | `createNativeAdapter(bootstrap)` | A typed, policy-bound Rust owner branch |
| Browser-rendered application | `createBrowserAdapter()` | Your route's Forma render function |
| Reviewed generated static documents | `createHtmlAdapter({ head, pages })` | A registered, hashed HTML content region |
| Ordinary links, forms or no-JavaScript pages | No router | A complete document response |

Keep one navigation coordinator for the currently loaded HTML document. Its
adapter determines how destination content is prepared and owned; it does not
choose whether the application may use islands. In a native group, compatible
layouts and their islands retain their DOM and local state. Departing owners
dispose their islands, and fresh destination owners activate their declared
islands. Do not mount the browser adapter over an existing SSR or island root.

One application can use different rendering paths in different sections. For
example, `/shop/*` can use Rust-rendered pages, islands and native navigation;
`/studio/*` can use browser-rendered routes; and `/legal/*` can use ordinary
documents with no router. Moving between native, browser and generated-HTML
profiles takes a full document navigation in the current implementation.
In-memory layout state does not carry across that boundary. Within a compatible
native group, navigation remains enhanced and islands remain islands.

Native groups currently require production SSR builds without watch mode or code
splitting. They admit declared native islands, not browser-only islands, and a
child route outlet must sit outside island-owned DOM. All owners' island code is
bundled into the initial group script: deferred island activation does not imply
per-route JavaScript downloads. These are the current
[group build constraints](../packages/build/README.md#optional-native-navigation-groups),
not restrictions on ordinary islands applications that do not opt into a group.

## Start with a connected application

Use the `native-router` template from the published 3.2.0-rc.3 candidate:

```sh
npx @getforma/create-app@3.2.0-rc.3 my-routed-app --template native-router
cd my-routed-app
cd admin && npm ci && npm run build && cd ..
cargo run --locked
```

The command above selects the published RC3 CLI and its coordinated dependencies.
For unpublished source changes, contributors use the [packed candidate workflow](../packages/create-app/README.md#development).
Open `http://localhost:3000`. Change the shell counter and input, then follow Home
and About. The shell's nodes and state survive; the Home counter belongs to its
leaf and starts again after that owner is replaced. Refresh or disable JavaScript
to see the complete Rust-rendered response.

The template provides the build configuration, client entry, typed Rust bindings,
response negotiation and package locks. Its [README](../packages/create-app/templates/native-router/README.md)
explains every source file and the deployment contract. Commit both lockfiles.

## Browser routes

For a browser-rendered app, mount the router on an unowned element. Do not mount
it over server-marked DOM or call a second whole-page `mount` on the same root.

```ts
import { h, createSignal } from '@getforma/core';
import { createRouter, createBrowserAdapter, Link, Outlet } from '@getforma/router';

const router = createRouter({
  root: document.querySelector<HTMLElement>('#app')!,
  adapter: createBrowserAdapter(),
  routes: [{
    id: 'workspace',
    render({ outlet }) {
      const [count, setCount] = createSignal(0);
      return h('section', null,
        h('button', { onClick: () => setCount(count() + 1) }, () => count()),
        Link({ href: '/projects/alpha', children: 'Alpha' }),
        Link({ href: '/projects/beta', children: 'Beta' }),
        Outlet({ outlet }));
    },
    children: [{ id: 'home', index: true, render: () => h('p', null, 'Choose a project') }, {
      id: 'project', path: 'projects/:name',
      render({ params }) { return h('h1', null, params.name); },
    }],
  }],
});
await router.ready;
await router.navigate('/projects/beta');
```

The parent owns its outlet and local state. Child parameters do not recreate the
parent. Route definitions support static segments, named parameters, a terminal
splat, pathless parents and index leaves; static segments rank first. The
[API reference](../packages/router/README.md#browser-routes) gives the grammar
and explicit bounds.

Components run once. Use accessors for reactive text and props. Each browser
owner has a lifetime signal: preparation cancellation aborts an uncommitted
owner, while a retained layout's signal survives later child navigation. Register
resource cleanup with Forma's ordinary ownership APIs. Disposing the router
releases its owned work and restores browser scroll restoration.

## Keep native rendering native

A native navigation group compiles its shell and leaves into independent owners
and one closed, integrity-checked browser bootstrap. Rust binds each owner to its
declared props and renders a `NavigationBranch`. Initial requests return the
complete document; enhanced requests return the typed navigation representation.
The browser adopts fresh destination DOM and keeps only the compatible common
prefix of owners. It never replays scripts from fetched HTML.

Enable the `navigation` feature on `forma-server`. Use the generated bootstrap
with `createNativeAdapter`; do not manufacture registration records or manually
concatenate fragments. Return the complete typed response, preserving its CSP,
nonce, `Vary` and no-store policy. The application must account for any middleware
or proxy policy before declaring `SealedNavigationPolicy::page_response_only`.
The [native API walkthrough](../packages/router/README.md#native-rust-pages)
and runnable starter show the connected build and server code.

## Generated documents and application features

Register complete-document SHA-256 hashes after generating HTML. Each admitted
document has the same build-owned head identity and one marked content region.
The adapter validates the full response before parsing that region. It admits a
bounded safe markup profile; inline styles, executable/resource-loading nodes,
SVG, custom elements and native ownership markers are outside that profile.
Generate compatible markup or retain ordinary navigation for those pages.

The router owns navigation; the application still owns search dialogs, editors,
workers and page widgets. Connect their mount/dispose lifecycle to the adapter
session. A persistent header does not justify retaining a departing page's worker.
See the [generated-document contract](../packages/router/README.md#generated-html).

## Links, forms and recovery

Ordinary anchors remain usable before readiness and without JavaScript. Modified
clicks, downloads, targets, external URLs and `data-no-router` links keep browser
behavior. Programmatic navigation returns an explicit outcome; a document
fallback is distinct from a successful smooth transition.

Native actions use declared server endpoints. The router sends at most one
enhanced POST at a time and never automatically retries it. A lost response means
the outcome is unknown; the durable attempt marker survives a document reload.
Use application status/idempotency evidence to resolve uncertainty. A successful
GET alone cannot prove that the earlier mutation failed or succeeded.

Validation needs application field markup as well as the router's summary. Give
the summary `data-forma-form-error` and `role="alert"`. Associate each field with
its error using `aria-describedby`; return the same error and `aria-invalid`
state in no-JavaScript responses. For native templates, compute that attribute
as a declared scalar prop in Rust.

For a server contract returning `fields.name`, supply this `onAction` option:

```js
onAction(outcome, form) {
  if (outcome.outcome !== 'validation') return;
  const input = form.querySelector('[name="name"]');
  const error = form.querySelector('#name-error');
  const message = outcome.data.fields?.name;
  if (input && error) {
    const text = typeof message === 'string' ? message : '';
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
    input.setAttribute('aria-describedby', 'name-error');
    error.textContent = text;
  }
}
```

The router focuses the summary; the application owns field associations and safe
value preservation. Render errors as text and avoid echoing secrets. Verify the
actual spoken feedback with assistive technology.

Invalidate retained context before login, logout or account/role changes. The server
continues to own authentication, authorization, CSRF and transaction semantics.
Build, policy, asset or context incompatibility takes a bounded document GET,
which can lose in-memory layout state. Deploy matching server, manifest, group
assets and HTML together; roll back that complete set together.

## Verify the experience you ship

Test actual document and layout-node identity across both directions, fresh leaf
props, direct entry/refresh, Back/Forward, rapid cancellation, focus/scroll,
no-JS links/forms and cleanup. Test incompatible builds as explicit fallbacks.
Exercise keyboard and assistive-technology behavior in the consuming application.
The [qualification ledger](design/router/qualification.md) distinguishes the
framework's measured checks from remaining acceptance and release obligations.
