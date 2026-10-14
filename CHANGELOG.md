# Changelog

## [Unreleased]

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
- **Documentation matches the code (FORMA-009; no code changed).** The
  compiler writes FMIR modules as `.ir` files, so `docs/FMIR-FORMAT.md`,
  `docs/ARCHITECTURE.md`, `docs/README.md`, the README and two doc comments no
  longer call them `.fmir`. `SECURITY.md` supports 0.2.x, not 0.1.x.
  `docs/TESTING.md` no longer claims coverage in all four repositories: only
  `formajs` collects it. ksx Studio is the first consumer planned for release,
  not a production one (`ci.yml`, the README, `docs/ARCHITECTURE.md`).
  `docs/ARCHITECTURE.md` marks B6, the compiler's last-insert-wins wording,
  reconciled with forma-tools#13.

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
