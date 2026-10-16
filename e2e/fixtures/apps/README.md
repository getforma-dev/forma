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
| `bench/` | `/pages/300`, `/pages/1500`, `/pages/10000`, `/pages/15000`, `/pages/20000`, `/pages/islands-100` | The consumers' heaviest pages as synthetic data (design.md A4), for FORMA-191's measurements and the parity corpus: a login of about 300 nodes and 2 islands, a console 1,500 and 10, a document 10,000 and 5, a canvas of 50 modules 15,000 and 50, a year of transactions 20,000 and 5, and a page of 100 islands (island 0 seeded 7, island 1 seeded 1001). Rows are page-level lists over a handler-generated dataset; the islands are small `Tile`s. |
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

The spec defaults to the ordinary `e2e/target/debug` binaries. To check the same built apps with
release servers, compile the release binaries and select that profile explicitly:

```sh
CARGO_BUILD_JOBS=3 cargo build --quiet --locked --release --manifest-path e2e/fixtures/apps/Cargo.toml
FORMA_FIXTURE_PROFILE=release npx playwright test e2e/fixtures/apps --workers=2
```

`FORMA_FIXTURE_PROFILE` accepts only `debug` or `release`; it selects `<target>/<profile>/fixture-<name>`
and does not compile anything. `CARGO_TARGET_DIR`, when set, still selects the target directory.
Without a configured reporting endpoint, development servers send an additional Trusted Types
Report-Only policy that WebKit reports as a configuration error; release servers omit that
development-only header. Both profiles keep the enforced policy and all browser-error assertions.

The servers take `FORMA_PORT` (default 0). The spec gives each one `FORMA_FIXTURE_PORT_BASE` plus its
index when that variable is set, so several clones can run it at once. The servers add one header,
`x-fixture-counts: nodes=…; bytes=…; list=…`, the walker's own counts, so a page's size is measured by
the walker and not guessed.

## What the checks are

`apps.spec.ts` (with `lib/verify-page.mjs` and `lib/behaviours.mjs`, which P17 runs unchanged against the packed set):

- every application builds with `strict: true` and nothing above a note, a native module per route, one
  script per route with islands;
- with JavaScript off, the server's values are in the HTML and the state envelope equals the oracle;
- strict adoption writes nothing: the island module is held, the values recorded, the module released,
  and the DOM must show no mutation record and the same nodes (a positive control proves the observer is
  watching); then the page's behaviour must change the DOM, which an island that never activated cannot do.
  The status attribute is not the evidence: a successful adoption leaves `data-forma-status="pending"`;
- the bench pages: the walker's own node count (the servers report it in `x-fixture-counts`) within 3%
  of the consumer's figure, the island count exact, the state envelope under 1 MiB, every tile counting
  on from the value the server sent (7 stays 7, 1001 stays 1001 among a hundred islands);
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
- **L-58 admits a client-side list under N2.** The controller chips and authentication results table
  are keyed lists inside their islands, seeded from the server's declared props. Their behaviour checks
  reverse the rows and require the existing DOM nodes to move with their keys, then restore the order.
  `positive/list-island` keeps the original smallest reproducer as an admitted build. Both the source
  lane and P17 read its emitted `size-report.json`; P17 records its bytes alongside every fixture route.
  The report's route ceilings and both its Forma and JavaScript verdicts must agree with the measured
  bytes. No measurement script extracts policy by matching a symbol in bundled JavaScript.
