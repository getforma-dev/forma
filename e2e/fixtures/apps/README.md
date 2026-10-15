# The fixture applications (FORMA-188)

Three applications written for this repository to the shape of three consumers' pages, so the 3.0.0
contract (declared props, the state block, strict adoption, the closed type set) is checked against
real shapes before an application has to migrate (L-54, DR-34). The pages are shaped after, not taken
from, the applications: they keep the element structure, the island count, the prop types and the list
sizes, and carry neutral, synthetic labels, class names, colours and values (two of the applications
are private repositories and this one is public). `apps.json` says, for each application, what it is
shaped after (`shapeSource`). P17 builds and serves the same sources against the packed set
(`scripts/release-fixture-apps.mjs`).

| Application | Pages | Shape it carries |
|---|---|---|
| `ledger/` | `/household` | A household arrival island: strings, one boolean behind a `createShow`, a status line that moves when the island's own request returns, a Retry button. |
| `fauth/` | `/t/:slug/login`, `/platform/onboarding`, `/platform/benchmark` | Three handlers' worth of props: a tenant's hosted login (an optional logo, a provider enum list, a signup-mode enum, derived booleans), a get-started page (three OAuth booleans and an optional config string), a results page (rows with numbers, an optional failure, a sort enum, an optional error). |
| `ksx/` | `/check` | A button-check screen: a nested roster payload (`mapper.slots[].bindings[]`), the booleans the old server injected under `show:` names, 1001 frames seen, a grid of chips, a keyboard echo that lights chips by class. |
| `negative/` | built only | The shapes the contract refuses, each with its code (see below). |

Each page is one `app.tsx` (the 3.0.0 entry: a literal `activateIslands` and a top-level `mount`), a
`#[derive(PageProps)]` handler in `src/bin/<application>.rs` bound with `pages.bind` and sealed with
`pages.finalize()` before the listener opens, and an entry in `apps.json`: the props type, the islands, the
sample state (the oracle the spec compares with the page's state envelope) and the server values that
must be in the HTML before any script.

## Running

```
npm run build                          # the packages, once
bash e2e/fixtures/apps/build.sh        # links the working tree, builds every app in strict mode, builds the servers
npx playwright test e2e/fixtures/apps # the spec (the root run picks it up; so does `npm run check`)
```

The servers take `FORMA_PORT` (default 0). The spec gives each one `FORMA_FIXTURE_PORT_BASE` plus its
index when that variable is set, so several clones can run it at once. The servers add one header,
`x-fixture-counts: nodes=…; bytes=…; list=…`, the walker's own counts, so a page's size is measured by
the walker and not guessed.

## What the checks are

`apps.spec.ts` (and `lib/verify-page.mjs`, which P17 runs against the packed set):

- every application builds with `strict: true` and nothing above a note, a native module per route, one
  script per route with islands;
- with JavaScript off, the server's values are in the HTML and the state envelope equals the oracle;
- strict adoption writes nothing: the island module is held, the values recorded, the module released,
  and the DOM must show no mutation record and the same nodes (a positive control proves the observer is
  watching); then the page's behaviour must change the DOM, which an island that never activated cannot do.
  The status attribute is not the evidence: a successful adoption leaves `data-forma-status="pending"`;
- the other branch of each condition (an invite-only tenant, no controller, no results), a hostile tenant
  name that must render as text, an unknown tenant that must be a 404.

## What writing them found

- **The closed type set bites on real shapes.** A condition over a signal (`mode() === 'login'`) is
  BUILD-610; the handler passes `startLogin` and `startRegister`. A spread of props into an island is
  BUILD-610; the page passes literal named fields. A conditional attribute (`type={() => … ? … : …}`) is
  BUILD-610; the click sets it. The studio's wire type `Record<string, string[]>` is outside the set
  (`negative/record-bindings`); the fixture spells it as an array of `{control, keys}`.
- **A derived name needs a rename.** `has_oauth` becomes `hasOauth`; the page's `hasOAuth` needs
  `#[props(rename = "hasOAuth")]`, and bind says so (BIND-101 names both spellings).
- **A reactive boolean `aria-pressed` writes `""`** for true and removes the attribute for false, which is
  not the string a screen reader needs; the fixture writes the string in the click.
- **An island with a client-side list is over N2 today.** Forma's code on the smallest island is 25,084 B
  gzip -9, `createShow` adds 241 B and `createList` 1,282 B: a route whose island holds a `createList` is
  about 26.4 KB against the 25,500 B ceiling (26,366 B when first measured, 26,403 B on `49c6146`) (`negative/list-island`, BUILD-819). The studio's chips and the
  service's results table are lists in islands on the pages these fixtures are shaped like, so the fixtures
  keep their lists in the page outside every island (server markup, no client code) and reach them by id.
  The fixture routes measured 25,399 to 25,447 B on the integration head `49c6146` (FORMA-186's identity banner added about 32 B per route), 53 to 101 B under the ceiling, and `negative/list-island` 26,403 B; the figures move with the tree.
