# Native router feasibility server

This is an unpublished, loopback-only FORMA-301 experiment. It exercises actual
`PageHandle` binding and the checked Rust renderer. It does not provide a production
authentication system, a persistence layer, or a supported router API.

The parent experiment must build `../dist/manifest.json` and compiler-produced FMIR
for `/proof/a` and `/proof/b`. Both routes declare these page props:

```ts
type PageProps = { count: number; name: string; csrf: string; error: string };
```

Use distinct route islands and one shared, integrity-checked bootstrap. A shared
layout outside the replaced route region can contain a retained input for the
browser proof. The server does not hand-edit any FMIR or manifest.

```sh
cargo run --manifest-path experiments/forma-router/server/Cargo.toml --locked
```

The server prints its loopback origin; `PORT` defaults to `0`. `FORMA_ROUTER_DIST`
can point to another complete fixture build. The lockfile is seeded from the
reviewed repository lock so compatible dependencies stay on that resolution.

- GET `/proof/a` and `/proof/b`: complete `PageResponse`, or native JSON with
  `Accept: application/vnd.forma.navigation+json`.
- POST `/proof/update`: URL-encoded `name` and `csrf`; same handler returns a
  full 422 validation page/303 redirect without JS, or an action outcome with
  `Accept: application/vnd.forma.action+json`.
- `data-forma-navigation` in the initial document contains app, build, route,
  group, layout, context, and policy identity. The fetched native JSON includes
  these fields plus `kind: "page"`, `title`, `html`, unchanged v1 `state`, and
  asset URLs/integrities. Its `html` wrapper is not itself an island.
- JSON actions contain `version`, `app`, `build`, `group`, `layout`, `context`,
  `policy`, `endpoint`, `kind:"action"`, `outcome`, actual HTTP `status`, and `data`.
  `PageHandle::action_context(&ctx, "/proof/update")` binds the required private
  `ActionContext` to the finalized page and actual typed request policy. Every
  `ActionResponse` constructor requires this context. The client must admit these
  identities and the exact requested endpoint/status before reading outcome data.
  Endpoints deliberately accept only canonical ASCII pathnames with no query,
  fragment, percent escapes, dot segments, repeated slash, or trailing slash.
  Validation is HTTP 422. A confirmed redirect uses `outcome:"redirect"` with
  `data:{location:"/proof/b",status:303}` and HTTP 200, preventing Fetch from
  concealing the POST/redirect/GET decision.

The server checks an HttpOnly SameSite session cookie, exact Origin, and the form
CSRF token before mutation. This one-process fixture intentionally shares one
public test state; it is not evidence of tenant isolation or production auth.
It binds only `127.0.0.1` and includes unauthenticated test control endpoints.

Fault controls:

- GET `?delay=500` holds a response; `?policy=changed` changes the CSP policy
  identity; `?context=changed` changes the explicit security-context generation.
- POST fields `delay=500`, `redirect=true`, or `fail_after=true` hold, redirect,
  or produce an unreadable response after the mutation committed. A failed
  response must never lead the client to send another POST automatically.
  Missing, unreadable, or incompatible action admission metadata means an unknown
  outcome after submission; neither the body nor network status proves rollback.
- GET `/__proof/state` reports counts and data. POST `/__proof/reset` resets the
  public fixture. `/__proof/csp` is the bounded test session's reporting sink.

Current protocol limitations are intentional and visible: enhanced native rendering
refuses executable request configuration, inline personality CSS, raw prefixes,
request-specific head links, and body classes. HTTP middleware/proxy additions to
document policy are outside the typed fingerprint and must be homogeneous within
an admitted navigation group. No dynamic JavaScript graph is loaded by the server.
The metadata is compatibility information, never authorization.
