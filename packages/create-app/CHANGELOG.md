# Changelog

## [Unreleased]

### Changed

- **The templates require `esbuild ^0.28.1`, the range `@getforma/build`
  0.3.0 requires, so a scaffolded app installs one esbuild** (FORMA-165). With
  the templates on `^0.25.0` beside build's `^0.28.1` and tsx's `~0.28.0`, npm
  installed three copies, 0.25.12 and 0.28.2 twice, each with its platform
  binary. Both `admin/package-lock.json` files are regenerated and now lock
  esbuild 0.28.2 once; every other pin is unchanged, and the files shrink
  (minimal 56 KB to 26 KB, 107 entries to 53; dashboard 87 KB to 57 KB, 163
  entries to 109). Each
  `Cargo.lock` was regenerated too, with the MSRV-aware resolver, and came out
  identical. `npm test` fails when a template locks a direct dependency more
  than once, and the scaffold gate counts the esbuild copies `npm ci`
  installs. `docs/TEMPLATES.md`'s regeneration steps now delete the copied
  `package-lock.json` before resolving.
  Verified by `tests/templates.test.ts` > "locks one copy of each direct npm dependency, the one its own dependencies also use"
  Verified by `tests/scaffold.test.ts` > "%s: npm ci, frontend build, cargo check --locked"

### Fixed

- **The project name is checked against cargo's package-name rules before
  anything is written, and a refused name is told which rule it breaks**
  (FORMA-024). A name such as `0app` passed the old pattern and
  scaffolded a project whose first build failed, because cargo refuses a
  package name that starts with a digit. The CLI now also refuses what
  `cargo new` refuses for a package with a binary (a Rust keyword such as
  `fn`; `test`; cargo's build directory names `build`, `deps`, `examples` and
  `incremental`, which fail every build of a binary) and a Windows device
  name. The name never becomes an npm package name, so a Node.js core module
  name such as `events`, which 0.6.1 scaffolded into a working project, is
  still accepted. Each message names the tool whose rule it is, and the tests
  hold those claims to the tools themselves: npm's own validator in `npm test`,
  and `cargo new` in the scaffold gate. `validate-npm-package-name` joins the
  devDependencies as that oracle; the CLI gains no dependency.
  Verified by `tests/scaffold.test.ts` > "refuses %s (%s) before writing anything, naming the rule"
  Verified by `tests/scaffold-lib.test.ts` > "refuses %j, naming the rule: %s"
  Verified by `tests/scaffold-lib.test.ts` > "agrees with npm's own validator: npm accepts every name it accepts but the core module names, and refuses every name it says npm refuses"
  Verified by `tests/scaffold.test.ts` > "cargo new accepts every project name the scaffolder accepts, and refuses every name it says cargo refuses"

### Security

- **CI: actions pinned to commits, every job declares its token, and the
  dispatch payload is checked (DR-32, SR21, FORMA-010; the package is
  unchanged).** Each `uses:` names the commit its tag or branch pointed to on
  2026-10-14, with the ref in a comment. Every job in `ci.yml` declares
  `contents: read`; `release.yml` already declared its permissions and keeps
  them. `update-core-dep.yml` declares `contents: read` only, so it stays
  inert (it cannot push its branch or open its pull request) until DR-32
  deletes the dispatch at the repository merge, and it reads the
  `core-release` payload's version only from an environment variable: a value
  that is not a release version (`v1.2.3` or `v1.2.3-rc.1`, the `v` optional)
  fails the run before anything is changed. Before, the payload was pasted
  into the shell script, so a dispatch could run commands (TH15).
- **CI: only the release's publish job can mint the publish credential (SR43,
  L-34, L-42, FORMA-134; the package is unchanged).** `release.yml` splits into
  `scaffold`, `pack` and `publish`. The scaffold gate and the build run in jobs
  without `id-token: write`; `pack` restores no cache, packs the tarball with
  `npm pack --ignore-scripts` and records its SHA-256; `publish`, the only job
  holding `id-token: write`, restores no cache and installs nothing, checks the
  downloaded tarball against that record (whose own hash travels as a job
  output) and runs `npm publish <tarball> --provenance --access public
  --ignore-scripts`. The `v*` tag stays the only trigger. CI's new
  `release-workflow` job runs actionlint (binary checked against a pinned
  SHA-256), `scripts/check-release-workflow.rb --self-test` and
  `scripts/test-release-artifacts.sh`.
  The lint also refuses a publish job that could go on after a failed check
  (`continue-on-error`, an `if:` on a step up to the publish, `always()`,
  `failure()` or `cancelled()` in the job's `if`, a check line that can
  swallow its failure, a shell without errexit), `container:` or `services:`
  on the publish or pack job, and a checkout of another repository or ref;
  every rule has a seed in `--self-test`, which fails if one does not. The
  artefact test flips a byte instead of writing one that may already be there.
  `pack`'s setup-node sets `package-manager-cache: false`, so a move to
  setup-node v5 keeps its cache off.

### Tests

- **"tells an npm user to install with npm ci" has its own timeout** (FORMA-179;
  the package is unchanged). It scaffolds a second project, which took up to
  2,297 ms on the Windows scaffold leg, against vitest's 5 s default; it now
  has 7 s, about 3x. Every other test that has run over 1.7 s in CI already
  had one. CONTRIBUTING says which skipped checks are by design.
- **The release's artefact upload can be re-run** (A2 audit S7, FORMA-179;
  the package is unchanged). The release's `pack` job uploads `release-packed`
  with `overwrite: true`, so re-running all jobs after a failure
  replaces the earlier attempt's artefact instead of failing on its name (A2
  audit S7); `publish` still checks every file against the record whose hash
  `pack` passes as a job output. The SR43 lint's new rule K4 requires it,
  with two seeds in `--self-test`.

## [0.6.1] - 2026-10-14

Template fixes from the Forma Stack decision brief's defects list, DR-17 and
DR-32 (ticket FORMA-008), and release A1's versions (FORMA-011). The templates
require and lock `@getforma/core` 2.0.2, `@getforma/build` 0.3.0 and
`forma-server` 0.2.1; the minimal template also `@getforma/compiler` 0.3.6 and
`forma-ir` 0.2.1.
Verified by `tests/templates.test.ts` > "pins frontend dependencies at or above the versions whose fixes it needs"

### Changed

- **Both templates ship their lockfiles, and the scaffolder copies them.**
  Each template now carries `admin/package-lock.json` and `Cargo.lock`, so a
  new project installs the set this repo's scaffold gate installed, not
  whatever resolves on the day (DR-32). This reverses 0.6.0's "no lockfile"
  rule: `package-lock.json` leaves `NEVER_COPY`. The staleness that rule
  guarded against is now a test failure instead. `npm test` fails when an npm
  lockfile's declared ranges differ from `package.json`'s, when a direct
  dependency is locked outside its range, or when a package resolves from
  anywhere but registry.npmjs.org. It also fails when a `Cargo.lock` names
  different direct crates from `Cargo.toml`, when a direct crate is locked
  outside its requirement, or when a crate comes from anywhere but crates.io.
  It checks too that `npm pack` puts all four lockfiles in the tarball. The
  scaffold gate installs with `npm ci` and builds with `cargo --locked`.
  Verified by `tests/templates.test.ts` > "ships an npm lockfile that agrees with package.json and resolves only from the npm registry"
  Verified by `tests/templates.test.ts` > "ships a Cargo.lock that locks its crates from crates.io under its placeholder name"
  Verified by `tests/templates.test.ts` > "carries every template's lockfiles in the npm tarball"
  Verified by `tests/scaffold-lib.test.ts` > "copies a template's lockfiles, never its installed dependencies or build output"
- **The lockfiles hold forma-server's Rust floor, 1.85, and so do a user's
  updates.** Each template declares `rust-version = "1.85"` and
  `resolver = "3"`, cargo's MSRV-aware resolver (Cargo 1.84+). Its
  `Cargo.lock`, and any later `cargo update`, therefore picks crates that still
  build on 1.85: an unaware resolve locked `sha2` 0.11.1, which needs 1.88; it
  is 0.11.0. The scaffold gate fails on any locked crate whose `rust-version`
  is above the template's, before and after a `cargo update`.
  Verified by `tests/scaffold.test.ts` > "%s: no locked crate needs a newer Rust than the template declares"
  Verified by `tests/scaffold.test.ts` > "%s: a user's own cargo update keeps every crate within the template's rust-version"
- **A scaffolded `Cargo.lock` reads exactly as cargo would write it.** The
  crate's own entry ships under the name placeholder. The scaffolder renames
  it, moves it to where cargo sorts it, and, when the project is named after a
  crate in its own graph (`tracing`, `serde`, `axum`, about a hundred names),
  rewrites references to that crate as cargo then writes them,
  `"tracing 0.1.44"`. Without that, `cargo --locked` refuses such a project
  and a plain `cargo run` rewrites its lockfile before anyone has changed it.
  Verified by `tests/scaffold-lib.test.ts` > "matches cargo's own lockfile for a project named %s, a crate in its graph, and is then a no-op"
  Verified by `tests/scaffold-lib.test.ts` > "matches cargo's own lockfile when the project ties a locked crate's name and version"
  Verified by `tests/scaffold-lib.test.ts` > "moves the renamed entry to where cargo sorts it and changes nothing else"
  Verified by `tests/scaffold.test.ts` > "puts the project's own Cargo.lock entry where cargo sorts it"
  Verified by `tests/scaffold.test.ts` > "%s scaffolded as %s, a crate in its own graph: cargo --locked accepts the lockfile and plain cargo leaves it"
- **The install step is `npm ci`**, in the CLI's next steps, both templates'
  "frontend not built" messages and their READMEs. A plain `npm install` may
  rewrite the shipped lockfile (npm 10 and 11 both rewrite the dashboard's),
  so a project's first documented step would modify it. When the CLI detects
  pnpm, yarn or bun it still prints that tool's `install`, with a note that it
  does not read `package-lock.json`.
  Verified by `tests/scaffold.test.ts` > "tells an npm user to install with npm ci, which leaves the shipped lockfile as it is"
  Verified by `tests/templates.test.ts` > "documents npm ci, never npm install, as the install step"

### Fixed

- **The minimal template's `ssrEntryPoints` key was never read.** It was keyed
  by route (`'/'`); `@getforma/build` 0.2.0 looks an SSR entry up by page name,
  the entry's outfile without `.js`, and silently falls back to the browser
  entry when the key is missing. The template worked only because that
  fallback was the same file. It is now keyed `home`. The scaffold gate points
  the template's own key at a different file and checks that the IR came from
  it.
  Verified by `tests/templates.test.ts` > "keys its SSR entry points by page name, as @getforma/build reads them"
  Verified by `tests/scaffold.test.ts` > "minimal: build:ssr reads ssrEntryPoints by page name"
- **The minimal template sent its page without `Cache-Control: no-store`.** A
  cached page replays one CSP nonce to every visitor. Both templates now send
  every page through forma-server's `PageOutput::headers()`, which writes the
  policy, `no-store`, the content type and the document security headers
  (`nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`) from the same render that produced the HTML
  (DR-17). The dashboard already set `no-store` by hand and now gains the
  document headers. The scaffold gate fetches every page route of each
  template twice and requires `no-store` on each response and a different
  nonce on every fetch, each matching its own HTML.
  Verified by `tests/templates.test.ts` > "sends every rendered page through PageOutput::headers(), so no-store travels with the nonce"
  Verified by `tests/scaffold.test.ts` > "%s: every page response carries Cache-Control: no-store and a fresh nonce per fetch"

## [0.6.0] - 2026-08-06

An audit pass across the scaffolder, both templates, their pinned dependencies,
the test suite and the docs. The headline is that neither template's
server-side rendering worked, and nothing in the repo could have noticed: the
suite asserted that template files *contained certain strings* and never
compiled or ran anything.

### Changed — breaking

- **The dashboard template no longer configures SSR at all**, and no longer
  ships a `build:ssr` script, an `ssr` flag in `build.ts`, a `@getforma/compiler`
  dependency, or the `forma-ir` / `load_ir_modules` wiring in `main.rs`. It asks
  for `RenderMode::Phase1ClientMount` explicitly.

  The wiring it had was inert: `render_page` falls back to Phase 1 unless
  **both** `ir_module` and `slots` are `Some`, and the template passed
  `slots: None`, so every request took the Phase 1 path while the code around
  it read as though SSR were on. Passing real slots does not fix it — the FMIR
  compiler walks source without executing it, so a component tag, a local
  helper that returns JSX, or a dynamic tag becomes an anonymous island
  placeholder. This dashboard is built out of components, so its IR renders to
  605 bytes of empty island shells and empty `createShow` markers: no sidebar,
  no top bar, no skeletons. Serving that as Phase 2 and letting the client
  adopt it takes the template from **16 of 16 Playwright tests passing to 14 of
  16 failing** — the app does not render at all. The README now documents this
  and points at the `minimal` template for a working Phase 2 setup.

  **Re-measured 2026-08-06 against the fixed compiler, and the decision stands.**
  `forma-tools`' `[Unreleased]` fixes the resolver defects behind most of that
  605-byte number: `.tsx` pages no longer compile to placeholder IR, components
  imported by a page file resolve, islands carry real component names, inline
  mounts get named signal slots. Scaffolded fresh against the local fixed
  compiler (`file:` dependencies on `packages/compiler` and `packages/build`),
  built with `ssr: true` and a `main.rs` wired for Phase 2 with slot data, the
  dashboard emits **14856 bytes** of IR with **64 islands, 27 of them named**,
  and genuinely server-renders its sidebar, top bar and layout. Its Playwright
  result is **still 2 of 16**, against 16 of 16 in Phase 1. The remaining 37
  islands are anonymous for reasons no source-walking compiler can fix: every
  page body is a `.map()` over data fetched at runtime from `/api/*`, or a
  component handed a non-literal prop. The measurement table is in
  `templates/dashboard/README.md`; the mechanism is in
  `docs/RENDERING-PHASES.md`. **No template file changed.**

- **The minimal template's page is a single file again.** `HomeIsland.tsx` is
  gone and its markup moved inline into the `mount()` callback in
  `admin/src/home/app.tsx`, which is what makes the SSR path work at all —
  esbuild rewrites every export form into `export { … }` specifiers, and the
  compiler's component extractor only recognises `export function` /
  `export const` declarations, so an imported `.tsx` component could never be
  resolved. The build said so, quietly: `IR: could not find return h() tree in
  HomeIsland` followed by a 121-byte placeholder.

  That compiler defect is **fixed in `forma-tools`' `[Unreleased]`** — export
  specifiers, aliases, `export default` and `index.ts` barrels all resolve now,
  and the forms that still do not warn with the file, the construct and the
  consequence. It is **not published**, and this template pins
  `@getforma/compiler ^0.2.0`, so the single-file page is still what a
  scaffolded app needs today. Once the compiler releases, an imported `.tsx`
  component is a supported shape here again.

- **Template dependency pins moved forward**: `@getforma/core` `^1.0.0` →
  `^1.5.0`, `@getforma/build` `^0.1.0` → `^0.1.9`, `@getforma/compiler`
  `^0.1.0` → `^0.2.0` (minimal only). `engines.node` on the templates and on
  this package is now `>=20.19.0`, which is what the toolchain has actually
  required since vitest 4.

### Fixed

- **A template lockfile can no longer reach a scaffolded app.** `package-lock.json`
  joins `NEVER_COPY`, so even if one is committed to a template again it is
  filtered out of the copy rather than pinning every app scaffolded afterwards.
  Deleting the stale lockfiles (below) fixed the instance; this closes the
  class. The test drives the real `cpSync` through the scaffolder's own filter,
  so it fails if either the set or the wiring regresses.
  (Reversed in [Unreleased]: the templates now ship lockfiles on purpose, and
  this entry's test was replaced by one that requires they are copied.)
- **The dashboard template could not be built on Windows.** It shipped a
  committed `admin/package-lock.json` from March pinning `@getforma/build`
  0.1.6, `@getforma/compiler` 0.1.6 and `@getforma/core` 1.0.6; `npm install`
  honours a lockfile and ignores the ranges in `package.json`, so a freshly
  scaffolded dashboard installed five-month-old dependencies (with two
  advisories) and died in the Tailwind step with `ENOENT spawnSync npx` —
  fixed upstream in `@getforma/build` 0.1.9. The lockfile is deleted; a test
  now fails if any template gains one.
- **Compiler 0.1.6, which that lockfile pinned, could not find the dashboard's
  `mount()` call at all** (`IR: could not find mount() call in src/app.tsx`) and
  emitted a 126-byte placeholder. This is the "SSR produces a placeholder"
  report that started the audit; the real IR it emits with a current compiler
  is no better, for the reasons above.
- **The minimal template's SSR now genuinely works.** `npm run build:ssr` emits
  real IR (`IR emitted (real): home.ir (451 bytes, 0 islands)`), `main.rs`
  calls `load_ir_modules` and passes `SlotData` built from the IR's own
  defaults, and the server sends the page's markup inside
  `<div id="app" data-forma-ssr>`. Verified in a browser: the client adopts the
  server DOM — one `<h1>`, one `<main>`, no duplication — and the counter works.
- **Both templates now initialise `tracing_subscriber`.** Without it,
  forma-server's `IR compatibility check failed`, `IR walk failed` and
  `missing IR module or slots` warnings go nowhere, which is how a dead SSR
  path stays dead without anyone noticing.
- **Both `.gitignore`s now cover secrets** (`.env`, `.env.*`, `*.pem`, `*.key`)
  and OS/log noise, and the dashboard's also covers Playwright's
  `test-results/`, `playwright-report/` and `blob-report/`. `Cargo.lock` stays
  tracked, with a comment saying why.
- **The minimal template styles through a CSS entry instead of `style`
  attributes.** The CSP that `render_page` emits has no `unsafe-inline` for
  styles, so a `style="…"` attribute arriving in server-rendered HTML is
  blocked by the browser (confirmed: `Applying inline style violates the
  following Content Security Policy directive`). The dashboard's `style={…}`
  props are fine — `h()` applies those through the CSSOM, which CSP does not
  cover — and the READMEs now say which is which.
- **Scaffolder hardening.** `--template` with no value (or another flag as its
  value) is now an error instead of silently falling through to the prompt; a
  project name equal to the template name is no longer swallowed; names are
  length-capped and Windows device names rejected; the destination is probed
  with `lstat` so a dangling symlink cannot be written through; `cpSync` runs
  with `errorOnExist`, no dereferencing, and a filter that refuses to copy
  `node_modules`, `dist`, `target` or `.git` out of a template; placeholder
  replacement skips anything that is not a regular file; a failed scaffold
  removes the half-written directory instead of leaving one that blocks the
  next attempt.
- Unused `serde_json` dependency removed from the dashboard's `Cargo.toml`
  (a new test fails on any declared crate that no `src/*.rs` mentions).
- Minimal template sends the `content-security-policy` header from
  `render_page`'s `page.csp` (the per-request nonce was generated but never
  enforced by the browser).

### Added

- **A scaffold-and-build gate.** `FORMA_SCAFFOLD_E2E=1 npx vitest run`
  scaffolds each template into a temp directory, runs `npm install`, builds the
  frontend, runs `cargo check`, and then *starts the compiled server and reads
  its response*: the minimal template must serve real markup inside
  `data-forma-ssr` after `build:ssr`, and the dashboard must serve a Phase 1
  shell whose CSP nonce matches the script tag it emitted. It also asserts the
  SSR build reports `IR emitted (real)` with `0 islands`. CI runs it on Linux
  and Windows, and the release workflow runs it before `npm publish`.

  Every leg was mutation-checked rather than assumed: a syntax error in
  `main.rs` fails the Rust leg; restoring the old imported-component entry
  fails the IR leg with the exact `IR emitted (placeholder): home.ir (121
  bytes)` line; and putting `slots: None` back fails the HTTP leg with
  `expected … to contain 'data-forma-ssr'` — that last one is the dashboard's
  original defect, now caught.
- Unit tests for the scaffolder's pure half (`src/scaffold.ts`, split out of
  `index.ts` so importing it in a test no longer starts the CLI and its
  prompts): name validation, placeholder replacement, and that neither the
  replacement walk nor the `_gitignore` walk follows a symlink out of the
  destination.
- Structural template tests replacing the substring assertions — file
  inventories, parsed `package.json` / `tsconfig.json` / `Cargo.toml`, declared
  crates versus crates actually used, the route table versus the routes the
  README documents, and the Playwright test count versus the number the README
  claims.
- **The CLI's template descriptions are now under test.** A description may not
  name a feature the template lacks, and may not contain a number no test
  checks. This caught the dashboard being advertised as "Live dashboard **with
  islands**" when neither template calls `activateIslands` — it is a
  client-mounted app. The description now says what the template is, `--help`
  renders from the same `TEMPLATE_INFO` map as the interactive picker so the
  two cannot drift, and the page and API-route counts in it are checked against
  the files and routes that exist.
- **Citation resolution (`tests/docs-truth.test.ts`).** Every
  `Verified by: <test file> > "<test name>"` in the docs, the sources and the
  templates is resolved against the tests that exist: a citation naming a test
  that is not there fails the build. A citation pointing at nothing is worse
  than no citation, because it converts a reviewer's suspicion into confidence.
- **`docs/`** — [`TEMPLATES.md`](docs/TEMPLATES.md) (what a template is, what
  the scaffolder rewrites, what every template must do, how to add one),
  [`RENDERING-PHASES.md`](docs/RENDERING-PHASES.md) (the compiler rule that
  decides whether a template can have Phase 2, and why it is version-bound),
  a docs index and an archive index — plus a `CONTRIBUTING.md`. The README now
  carries a stack orientation header linking the other three repos and the
  shared architecture document.

### Changed

- **Security:** dashboard template binds to `127.0.0.1:3000` by default instead of `0.0.0.0:3000`. Set the `FORMA_HOST` environment variable (e.g. `FORMA_HOST=0.0.0.0 cargo run`) to expose the server; a warning is printed when binding to a non-loopback host since the `/api/*` routes have no authentication. **Migration:** if you relied on the previous implicit LAN exposure, you must now set `FORMA_HOST=0.0.0.0` explicitly.
- The dashboard README is now roughly half its previous size. What went was a
  FormaJS tutorial duplicating the upstream docs and a Phase 2 section whose
  every concrete claim was false — "Full HTML (sidebar + layout + skeletons)",
  "Server renders: sidebar navigation with all icons and labels … table
  headers", "Offline: Yes (Service Worker caches HTML)" (the generated service
  worker only handles `/_assets/*`), and a pointer to a "GateWASM reference
  implementation" that exists nowhere in this stack. What stayed is a map of
  where each primitive is used, the API table, and the security warning.
- The minimal README's SSR instructions were three steps ending in "No other
  code changes needed", which was false in both directions: `main.rs` hardcoded
  `Phase1ClientMount` with `ir_module: None`, and the build emitted a
  placeholder anyway. It now describes what the compiler can and cannot
  server-render, and the claim is true.


## [0.5.0] - 2026-03-17

### Changed
- Flagship dashboard template completely rebuilt — 4 islands (StatsCards, Sidebar, ActivityFeed, DataTable) with different hydration triggers, Rust JSON API routes, createFetch/createStore/createShow/$dispatch, SSR Phase 2 fallback, dark theme, separation of concerns
- Polished CLI — colored output, git init, package manager detection, branded header
- Dashboard is now the default template (listed first)
- Minimal template description: "Clean slate — ready to build on"

### Fixed
- Placeholder mismatch: CLI now replaces both {{PROJECT_NAME}} and {{project-name}}
- Dashboard build.ts outputDir fixed (was ../dist, now dist)
- 9 missing CSS class definitions added
- Unused nonce variable removed from dashboard main.rs
- Unused tower-http dependency removed from dashboard Cargo.toml
- Dead api.ts removed (islands use createFetch directly)
- Stale dist rebuilt

## [0.4.0] - 2026-03-17

### Added
- Flagship dashboard template with islands, API routes, dark theme

## [0.3.0] - 2026-03-17

### Added
- `--help`, `--version`, `--template <name>` CLI flags
- Graceful error message when frontend not built (instead of Rust panic)
- `typescript` added to template devDependencies

### Fixed
- `.gitignore` files now survive npm pack (renamed `_gitignore` → `.gitignore` after copy)
- Process exits with code 1 on error (was 0)
- `engines: { node: ">=18" }` added to package.json

### Changed
- Dashboard template title changed from "Home" to "Dashboard"

## [0.2.0] - 2026-03-15

### Changed
- Templates updated to @getforma/core ^1.0.0
- Migrated templates from h() calls to JSX syntax
- Added automated dep update workflow for @getforma/core

## [0.1.0] - 2026-03-14

### Added
- Initial release with minimal and dashboard templates
- CLI with project name validation and template selection
