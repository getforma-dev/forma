# Changelog

## [Unreleased]

### The parity harness (FORMA-183)

- `e2e/parity/` holds the harness that keeps the walker and `@getforma/core` equal by test (DR-9): a deterministic, edge-first state generator over a declared props schema, each field rotated into its type's edge list (inside the priority block first) so same-typed fields never share an edge in the first states and every field meets the priority edges within ten, optionals present by one bit of the index each, and list-key fields given unique identities (the shared rule-1 vectors are in its string domain); a comparison of the browser's parse of the server HTML against core's render of the same state, with transport removed only where it is transport (marker comments and core's anchors on both sides; the activation attributes, `data-forma-key` and the U+200B holder on the server side only, a holder matching client `""` or U+200B and counted as `holderAmbiguous`, since the wire cannot tell them apart) and nothing else normalized, attributes compared with their namespace; a one-line report naming the module, the state and the node; and `renderBoth`, which renders one corpus module at one state through both sides. `crates/forma-server/examples/parity_render.rs` is its server half (the walker's low-level path); `e2e/parity/corpus.json` names the 14 corpus modules. Tooling only: no package, crate API or emitted byte changes.
- `scripts/check.sh` runs the harness's own tests (type check and `node --test`) and, before anything else, stops on a Node without type stripping rather than skipping the step; the root `playwright.config.ts` ignores `e2e/parity/`, whose `*.test.mts` files are `node --test` suites.
- The suite over the corpus (`e2e/parity/src/run.mts`): each module's states through the application's path (a synthesized manifest, `load_ir_modules`, `Pages::bind` with a harness `PageProps` mirroring the module's own schema, `PageHandle::render`), the server's own document and headers served in Chromium, P1, and P2: the module's production entry, built through `formaSsrPlugin`, activates its islands while a MutationObserver records every DOM write, which must be none. Known divergences are data (`e2e/parity/expected-divergent.json`), and one that stops occurring fails the run. CI runs it as the non-blocking `parity` job and uploads the report. Step 0, 14 modules and 23 states: P1 19 equal, 4 expected-divergent (each naming the ticket that clears it: FORMA-181, FORMA-182 twice, FORMA-101), P2 14 equal; 2 structural classes. P3 and the switch to blocking are the next slices.

### Value rule 1: line endings and NUL — FORMA-182

- `docs/parity-rules.md` states the marker vocabulary and rule 1 (CRLF and CR to LF, NUL to U+FFFD, per value, before ordinary DOM text and attribute writes) and lists rules 2 to 7 with where their behaviour lives today. One shared vector file, `crates/forma-ir/tests/fixtures/parity/normalization.json`, is read by forma-ir's and core's suites. The walker and `@getforma/core` apply the rule in their ordinary writers; transport (props, state, keys) stays exact. The `textarea`, `pre` and `listing` first-token line feed is protected by the walker and the URL guards refuse a NUL anywhere in a URL attribute. Document-head metadata in forma-server and the broader value rules remain open.

### SSR e2e lane on the 3.0.0 entry contract (FORMA-105)

- The SSR e2e cases (`e2e/ssr/cases/`) use the one entry shape `BUILD-611` accepts: a standalone literal registry and a standalone top-level `mount()`. Their conditional entries (`if (islands) activateIslands(...) else mount(...)`) were the pre-3.0.0 shape and refused compilation once the entry policy landed; `mount()` no longer adopts a server-marked root, so each case's interactive subtree is an island seeded from declared props and `root-fragment` is a static page that serves no script (DR-6).
- `e2e/ssr/build-cases.mjs` declares each case twice, as an application does: route `/` server-rendered and route `/csr` an explicit Browser route (`ssr: false`) of the same entry, which keeps the mount for the client-rendered comparison; it also checks that a page with islands ships exactly its own script and a page with none ships no script. The Rust renderer renders `/csr` from the real manifest.
- `e2e/ssr/regressions.spec.ts` observes activation as core documents it since strict activation (FORMA-104): no DOM write on success, so no host in `error`, no `forma:error` event, then behaviour. The pre-3.0.0 lane is archived under `docs/archive/2026-10-15-islands-only-e2e/`.

### Fixed — FORMA-105 (full-stack e2e lane)

- `e2e/fixtures/formajs-runtime.global.js` and `e2e/fixtures/formajs.global.js` are no longer tracked; `e2e/sync-fixtures.sh` writes them from `packages/core/dist` and `scripts/check.sh` runs it first. The committed copies predated `trustedHtml()` and failed five cases of `e2e/full-stack.spec.ts` whenever the lane ran without a fresh sync. The spec now refuses to run without the bundles, naming the sync script, and the sync script prints core's build output when that build fails instead of exiting silently. Verified by `e2e/full-stack.spec.ts` > `the bundles are the fresh sync, not a stale copy`.

### Removed — FORMA-110

- Removed core's server functions, Node SSR and WASM entry points; the compiler's Vite plugins and their standalone transforms; and the WASM walker feature, build step, manifest field and server bootstrap. Browser islands continue to use `h()` and native Rust SSR remains supported.
- `@getforma/build` rejects `"use server"` directives with `BUILD-808`, including imported modules and watch rebuilds. Move server-side work to authenticated Rust routes called with `fetch`.
- `walk_island` remains internal. The pre-removal API guides are retained under `docs/archive/2026-10-15-legacy-apis/` and `packages/core/docs/archive/2026-10-15-legacy-apis/`.


### FMIR v3 development staging (FORMA-185)

The seven package versions are aligned at `3.0.0-dev` so the compiler and Rust reader can
compare their exact base version `3.0.0`; nothing is tagged or published. Templates retain
their audited A2 pins until their own migration ticket. FORMA-112 owns the full release contract.

The v3 writer and reader land together: a 24-byte signature/version/length/CRC header,
variable sections, typed props schema/key-path/source-position metadata, shared generated
constants, stable load codes and lossless canonical dumps. Six unused opcode values and
PropsMode are removed. All bytecode string references fail at load. V2 modules require a
rebuild. The fourteen HTML goldens are unchanged; real emission, independent fault fixtures,
loader-before-bind checks, stable fuzz replay and a pinned nightly fuzz workflow cover the change.

### Unified release workflow (FORMA-187)

- FORMA-187: prepare the unified seven-package release pipeline, exact-commit CI
  gate, packed template/corpus verification, two minimal publishing jobs and
  compatibility record. A2 dry runs remain non-publishing; milestone contract
  hooks must be completed before the first `v3.0.0-alpha.1` release.

### The repository merge (FORMA-113)

formajs, forma-tools and create-forma-app were merged into this repository
with their histories: `@getforma/core` is `packages/core`, `@getforma/compiler`
and `@getforma/build` are `packages/compiler` and `packages/build`,
`@getforma/create-app` is `packages/create-app`, beside the crates in
`crates/`. Their tags carry the prefixes `formajs/`, `forma-tools/` and
`create-forma-app/`. A root npm workspace and the root Cargo workspace (now
with `forma-ir-derive`, whose published 0.0.0 placeholder is its source) are
built and tested by one command, `npm run check`, which one CI workflow runs.
Package names and versions did not change; nothing here is a release.


A2 whole-release audit follow-ups (FORMA-180, PR group 2). Tests, scripts and
workflows only: no crate code, no version.

- **The published `.crate` builds `--locked` on the Rust it declares (audit
  F7).** The release workflow's `pack` job locks with Cargo's MSRV-aware
  resolver (`CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS: fallback`), as CI's
  `msrv (forma-server, 1.85)` leg does, so the `Cargo.lock` inside the packed
  forma-server holds sha2 0.11.0 (Rust 1.85), not 0.11.1 (1.88); 0.2.2's
  packed lock failed `cargo build --locked` on 1.85 to 1.87, which no
  consumer's own lock does. The SR43 lint (`scripts/check-release-workflow.rb`)
  gains rule K5 for the setting, with three seeded violations (self-test 60 to
  63). The crates' file lists are unchanged.
- **forma-server's `forma-ir` requirement must equal forma-ir's version
  (audit F8).** `scripts/check-forma-ir-requirement.sh`, run by CI's
  `patch-is-live` job with its tests (`scripts/test-check-forma-ir-requirement.sh`),
  fails unless the requirement, normal and dev, is forma-ir's version:
  `[patch.crates-io]` and the release `verify` job both built green while
  0.2.2 carried `"0.2.0"` (fixed by FORMA-138). FORMA-112 replaces it with
  the one-version rule.
- **The list-walk time gate measures 100 against 3,200 rows, bounded at 64x
  (audit F17b).** `crates/forma-ir/tests/list_scaling.rs` compared 100 and
  1,600 rows at 32x; a walker that only scans the list once per row measured
  34.9x there, too close to the bound. Linear is now 32x; the same walker
  measures 110x to 125x, and the unmutated one 32.1x to 32.3x under a load
  average of 22 to 34.

## [0.2.2] - 2026-10-14

Release A2, the bridge to 3.0.0: additive, with deprecations. See
[crates/forma-ir/CHANGELOG.md](crates/forma-ir/CHANGELOG.md) and
[crates/forma-server/CHANGELOG.md](crates/forma-server/CHANGELOG.md) for the
itemised lists: each crate's "Upgrading from 0.2.1" names what an application
may meet, and its "Deprecated" names each deprecation's 3.0.0 replacement.

- **forma-server 0.2.2 requires forma-ir 0.2.2** (`forma-ir = "0.2.2"`,
  normal and dev; FORMA-138). forma-server calls `walk_to_html_counted`,
  `WalkCounts` and `IrError::Panicked`, which forma-ir 0.2.1 lacks, so the
  0.2.0 requirement it carried while both were unreleased would have let a
  lockfile holding forma-ir 0.2.1 fail to build it (E0425, E0599). Publish
  order: `ir-v0.2.2`, then `server-v0.2.2` once that run has published
  (CONTRIBUTING, "Releasing").
- **Public text names no internal decision records (FORMA-138, after
  FORMA-131).** forma-server's and forma-ir's rustdoc, `#[deprecated]` notes,
  development-build log lines, the retiring service worker's comment and
  `SECURITY.md` no longer cite decision-record, requirement or threat ids
  (`DR-`, `L-`, `SR`, `TH` and the like), which mean nothing to a reader of
  docs.rs; the allowlist they cited is named as `forma-raw-lint`'s. Internal
  `//` comments, private items' docs, tests and the CHANGELOGs keep them.
  Wording only: no item, signature or behaviour changed.
- **The install snippets name 0.2.2** (README and both crate READMEs, shown
  on crates.io): they said `"0.1"`, which resolves to 0.1.x and none of
  0.2's API.

- **The preview frame (FORMA-125, DR-14 tier (c), L-52).** forma-server's
  `PageResponse::frame` writes the document for content nobody reviewed: an
  opaque origin (`sandbox allow-scripts`), framed only by the application's
  origin, the runtime inline and allowed by its hash, and its requests
  closed (`connect-src`, `img-src`, `style-src`, `font-src`, `worker-src`,
  `form-action`), save the residuals its docs name: WebRTC, and navigations
  the host's own `frame-src` admits. Link hints and `srcdoc`, which no CSP
  directive governs and which connected in WebKit, are closed by core 2.1.0's
  frame runtime (its unreviewed mount removes them; formajs#35). The runtime is read and hashed at start
  from the build's `forma-runtime.js` (`PreviewFrame::load`; a missing
  runtime is a coded error). The host's side is documented in
  forma-server's `frame` module.

- **Trusted Types, reported (FORMA-127, DR-20).** forma-server sends
  `require-trusted-types-for 'script'; trusted-types forma forma-runtime` in
  `Content-Security-Policy-Report-Only` beside the unchanged enforced policy
  when the application names a reporting endpoint, and with no endpoint in
  development builds only (released, it would report to nobody and WebKit
  logs an error for it on every page); 3.0.0 enforces it. `PolicyExtensions` gains
  `report_to` (an endpoint the application runs, written into both policies;
  `report_uri` for pages served over plain HTTP)
  and `relax_trusted_types` (a named, logged per-route relaxation).

- **One named raw-HTML type, and typed homes for the rest (FORMA-126,
  DR-19).** forma-server's `RawHtml::trusted(..)` is the one way to say a
  string is markup to write unescaped; `body_prefix` takes it bound first,
  `let raw = RawHtml::trusted(..);` then `Some(&raw)`, and a plain string
  there still works and warns once per process in debug builds
  (`RAW-101`). What applications put in `body_prefix` that is not their own
  markup gets a typed home through `RenderCtx`: the
  route's `modulepreload` links, read from the build's manifest and nonced by
  forma-server (`with_module_preloads`), and head links (`with_head_link`);
  data keeps `config_json`. `render_page` writes 0.2.1's document.

- **A page edited under watch mode is served without a restart (FORMA-166,
  L-31, N7).** forma-server's `IrModules` loads through the strict loader
  and, in debug builds only, rereads a page's module on the next request
  after `forma-build --watch` rewrites it; a module that fails to load keeps
  the previous one and logs its `LOAD-1xx` code. Release builds read nothing
  after start.

- **forma-ir's `wasm` feature is deprecated (FORMA-131, DR-23).** Its exports,
  `render` and `render_island`, the browser's WASM walker, are
  `#[deprecated]` and are removed in 3.0.0 with the feature; islands
  re-render with `@getforma/core`'s `h()`. They still build and behave as at
  0.2.1. forma-server's `AssetManifest::wasm` and `WasmAssets` are deprecated
  with them, and the `window.__FORMA_WASM__` script they add to a page goes
  in 3.0.0.

- **The service worker is opt-in (FORMA-130, DR-25).** forma-server registers
  `/sw.js` only for an application that turns it on
  (`sw::configure(ServiceWorker::for_app(..)?.enabled())`); elsewhere `/sw.js`
  is a retiring worker that deletes Forma's v1 caches and the application's
  own, never another application's, and unregisters. `cargo test` now needs
  Node 18+ for the retiring worker's test.

- **The strict module loader is the default (FORMA-121, DR-11).** Call
  `load_ir_modules_strict` at start and refuse to start on its errors, each
  naming route, file and a `LOAD-1xx` code; the lenient `load_ir_modules`,
  which serves a corrupt module's route as an empty shell, is deprecated.
- **A list over budget fails before its first row (FORMA-122, DR-13).**
  forma-ir compares a list's length with the remaining iteration budget before
  walking it: a 60,000-row list under the default 50,000 fails in a
  comparison, not after 50,000 rows.
- **A render that returns its failure (FORMA-120, DR-11, DR-12).**
  forma-server's `try_render` returns `Result<PageResponse, RenderError>`: the
  page with its counts, or a coded error naming route and component, a caught
  panic included; `render_browser_shell` serves a route declared
  `ssr: false`. `render_page` (and its Phase 1 fallback) and
  `assets::load_manifest` are deprecated. forma-ir adds
  `walk_to_html_counted`. Both crates deny `unwrap`, `expect` and `panic!`
  outside tests.

- **A page response that carries its own headers (FORMA-124, DR-17).**
  forma-server's `PageResponse` always writes `no-store`, the strict policy and
  the document headers; handlers extend the policy through typed
  `PolicyExtensions`, never as text. `PageOutput`'s public fields and
  `headers()`, `PageConfig::config_script` and `render_page_with_nonce` are
  deprecated (removed in 3.0.0). Additive: every 0.2.1 call still compiles.
- **CI: actions pinned to commits, every job declares its token (DR-32,
  SR21, FORMA-010; no crate changed).** Each `uses:` names the commit its tag
  or branch pointed to on 2026-10-14, with the ref in a comment, so moving a
  tag no longer changes what runs. Every job in `ci.yml` declares
  `contents: read`; `release.yml` keeps its workflow-level `contents: read`
  and `id-token: write`.
- **CI: only the release's publish job can mint the publish token (SR43,
  L-34, L-42, FORMA-134; no crate changed).** `release.yml` splits into
  `check`, `pack`, `verify` and `publish`, and the workflow-level
  `id-token: write` is gone. `pack` restores no cache and compiles nothing:
  it locks the graph, runs `cargo package --no-verify` and records the
  `.crate`, its file list and the `Cargo.lock` with their SHA-256. `verify`
  builds the crate unpacked from that `.crate`. `publish`, the only job
  holding `id-token: write`, restores no cache and compiles nothing: cargo
  cannot upload a prebuilt `.crate`, so it checks the artefact against the
  record (whose own hash travels as a job output), re-packages from the
  tagged source with the recorded lock, publishes with
  `cargo publish --no-verify --locked` only if the `.crate` and its file list
  are byte-identical to the recorded ones, and then compares crates.io's
  checksum with the record. The tags stay the only trigger. CI's new
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
  After the upload, `scripts/check-published-crate.sh` reads the version's
  checksum from crates.io's API for up to 15 minutes: a checksum that differs
  from the record fails and points to crates.io's web page to yank it; a
  version not visible yet only warns. CONTRIBUTING's new "Releasing" section
  says to push `server-v*` only after the `ir-v*` run has published.
- **Documentation matches the code (FORMA-009; no code changed).** The
  compiler writes FMIR modules as `.ir` files, so `docs/FMIR-FORMAT.md`,
  `docs/ARCHITECTURE.md`, `docs/README.md`, the README and two doc comments no
  longer call them `.fmir`. `SECURITY.md` supports 0.2.x, not 0.1.x.
  `docs/TESTING.md` no longer claims coverage in all four repositories: only
  `formajs` collects it. ksx Studio is the first consumer planned for release,
  not a production one (`ci.yml`, the README, `docs/ARCHITECTURE.md`).
  `docs/ARCHITECTURE.md` marks B6, the compiler's last-insert-wins wording,
  reconciled with forma-tools#13.
- **The list-walk timing gate holds on a loaded machine (FORMA-167,
  FORMA-179; no code changed).** `list_walk_time_is_linear_in_row_count` took
  the best of nine samples at 100 and 400 rows and failed above 6x; under load
  it measured 11.8x and failed. It now times 100 and 1,600 rows (linear about
  16x, the quadratic walker it replaced about 256x) as back-to-back batches of
  equal work, and judges the median of up to 41 such rounds against 32x. The
  allocation gate beside it is unchanged. CONTRIBUTING says which skipped CI
  jobs are by design.
- **The release's artefact upload can be re-run (A2 audit S7, FORMA-179; no
  code changed).** The release's `pack` job uploads `release-packed` with
  `overwrite: true`, so re-running all jobs after a failure replaces the
  earlier attempt's artefact instead of failing on its name (A2 audit S7);
  `publish` still checks every file against the record whose hash `pack`
  passes as a job output. The SR43 lint's new rule K4 requires it, with two
  seeds in `--self-test`.

## [0.2.1] - 2026-10-14

A patch release of both crates. See
[crates/forma-ir/CHANGELOG.md](crates/forma-ir/CHANGELOG.md) and
[crates/forma-server/CHANGELOG.md](crates/forma-server/CHANGELOG.md) for the
itemised lists.

- **forma-server on Rust 1.85 to 1.87: lock with the MSRV-aware resolver.**
  sha2 0.11.1 (2026-10-12) declares Rust 1.88, and a resolve that ignores
  `rust-version` takes it, so a fresh build of forma-server on 1.85 to 1.87
  fails before compiling any of its code. The declared floor stays 1.85.
  Consumers on those toolchains lock with Cargo's MSRV-aware resolver
  (`resolver = "3"`, or `incompatible-rust-versions = "fallback"`) or run
  `cargo update -p sha2 --precise 0.11.0`; [CONTRIBUTING.md](CONTRIBUTING.md)
  has the details. CI's `msrv (forma-server, 1.85)` leg now locks that way and
  prints the sha2 version it built. No crate code changed.

## [0.2.0] - 2026-08-06

Security and robustness hardening pass across both crates. See
[crates/forma-ir/CHANGELOG.md](crates/forma-ir/CHANGELOG.md) and
[crates/forma-server/CHANGELOG.md](crates/forma-server/CHANGELOG.md) for the
itemised list, including the breaking changes and the one removed API
(`check_ir_compatibility`).

Highlights:
- **A list renders in O(rows), not O(rows²).** The walker deep-cloned the whole
  `SlotData` — including the list's own array — once per row, so a 400-row
  table took 31.5 ms and 1.1 M allocations to emit 61 KB of HTML. It now takes
  0.15 ms and 2,412 allocations, byte-identically, with a committed regression
  gate (`crates/forma-ir/tests/list_scaling.rs`) that fails the build if the
  cost stops being linear
- **The FMIR binary layout and its stability contract are published**
  ([docs/FMIR-FORMAT.md](docs/FMIR-FORMAT.md)) — consumers were already
  byte-guarding a format that was documented nowhere
- **This repo is now the documentation hub for the stack.**
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the entry point every repo
  links to, [docs/TESTING.md](docs/TESTING.md) is the testing policy and
  `Verified by:` citation contract all four repos are held to (derived from the
  mutation-probe audit, not from generic advice), [docs/README.md](docs/README.md)
  indexes the whole doc set, and [docs/archive/](docs/archive/) records what has
  been retired and why. `CONTRIBUTING.md` was rewritten to point at them
- Cross-stack parity fixes that change emitted bytes on purpose: boolean
  DYN_ATTR values (`disabled="false"` meant *disabled*), empty-string
  attributes, ECMAScript truthiness for empty arrays, `String(value)` for
  array/object slots, and first-match-wins SWITCH
- More load-time validation: islands the table does not declare, stray
  FALLBACK, unterminated TRY_START, and one consistent duplicate-slot-name rule
  across all three resolvers
- MSRV corrected (forma-server claimed 1.70 and has never built below 1.85) and
  pinned in CI; `#![forbid(unsafe_code)]`, `missing_docs`, a Windows runner, a
  cargo-deny job, and a guard that `[patch.crates-io]` has not silently
  fallen back to the published crate
- Island props JSON escaping made total (`<!--<script` breakout), tag/attribute
  names validated, URL attributes scheme-checked, `on*` handlers dropped
- Per-render output and LIST-iteration budgets so malformed or hostile input
  degrades to Phase 1 instead of aborting the process
- Checked offset arithmetic and one-shot structural validation of the opcode
  stream; a 32-bit test job added to CI because `usize` is 32 bits on wasm32
- `</style>` and `</script` breakouts actually closed in the server templates
  (the 0.1.3 `</style>` claim was never true), plus `'strict-dynamic'`,
  `style-src-attr`, `worker-src` and `object-src` in the CSP
- Correct `Accept-Encoding` qvalue handling, content-hash-gated `immutable`
  caching with ETag/304, a wider case-insensitive MIME table, and zero-copy
  asset bodies

## [0.1.0] - 2026-03-13

### forma-ir
- Binary IR format (FMIR v2): 16-byte header, section table, bytecode/strings/slots/islands
- Parser: IrModule, StringTable, SlotTable, IslandTableParsed
- Walker: walk_to_html(), walk_island() for SSR rendering
- Slot system: SlotData, SlotValue, JSON-to-slot conversion
- WASM exports: render(), render_island() (behind `wasm` feature)
- Dump module for IR debugging (behind `dump` feature)

### forma-server
- Types: PageConfig, PageOutput, RenderMode, AssetManifest
- CSP: generate_csp_nonce(), build_csp_header() with strict policy
- Asset serving: serve_asset<A>() with brotli/gzip content negotiation
- Service worker: serve_sw<A>() with no-cache headers
- IR loading: load_ir_modules<A>() with Phase 1 fallback
- Template rendering: render_page() with Phase 1 (empty shell) and Phase 2 (SSR) paths
