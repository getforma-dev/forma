# Forma compatibility contract

This is the current 3.x development contract introduced by FORMA-112, on the
FORMA-185 FMIR v3 format. The seven packages share a release version:
`forma-ir`, `forma-ir-derive`, `forma-server`, `@getforma/core`,
`@getforma/compiler`, `@getforma/build`, and `@getforma/create-app`.
It is not a declaration that the remaining 3.0.0 milestone work has shipped.
`scripts/release-contracts.json` states which tickets gate which milestone: the
alpha's gates are done, the beta's, rc's and final's are pending, and a tag
publishes only for a milestone whose gates are all done (`docs/RELEASING.md`,
"Milestone gate"). Historical A2 and partial FMIR-v3 release evidence is retained.

## Window and upgrade order

For writer W and reader R, accept exactly when
`W.major == R.major && W.minor <= R.minor`. Patches do not restrict acceptance.
A 3.1.4 reader accepts 3.0.9, 3.1.0 and 3.1.99; it refuses 3.2.0, 2.1.4 and 4.1.4.
Package suffixes are stripped before writing: `3.1.0-dev` and `3.1.0` both write
numeric `3.1.0`. Manifest wire versions have no prerelease/build suffix. FMIR
stores three u16 numbers; malformed or overflowing versions are refused.

Upgrade the renderer first within a major, then compiler/build/core and rebuild.
Compiler `3.y.z` peers on core `^3.y.0`; build `3.y.z` optionally peers on compiler
`^3.y.0`. A coordinated prerelease adds only its exact package version, for
example `^3.1.0 || =3.1.0-alpha.1`. Ordinary caret ranges do not admit unrelated
prereleases. Exact release artifact locks and Rust internal requirements remain
exact; the version helper distinguishes those edges from the compatibility peers.

npm rejects an incompatible required compiler/core peer. npm 11 may instead
warn for an optional build/compiler conflict during install, and a recorded-lock
`npm ci` may accept it silently. The build therefore checks any installed compiler
before writing output, even for a browser build. An absent compiler is valid for
browser builds; SSR requires it. This is verified with production code compiled
under controlled 3.2-build/3.1-compiler metadata, packed, installed outside the
checkout and executed; no `--force`, legacy-peer option or lifecycle script is used.

At build time, the nearest `Cargo.lock` above the working directory supplies the
resolved server version. Both the manifest writer and an SSR compiler must fit
its window. Missing locks warn. Malformed/unreadable/ambiguous locks fail rather
than falling back to a favorable ancestor. A lock without forma-server fails SSR
and warns for a standalone browser build. Watch mode watches lockfiles and
preserves the last valid output on incompatible rebuilds.

The TOML parser is `smol-toml` 1.9.1, pinned exactly: a real TOML parser is needed
for comments, quoted keys and tables; a line regex is not a lockfile parser.
It has no runtime dependencies or install lifecycle script. Installs remain
scriptless; repository advisory/signature checks and the recorded release graph
cover it. No build invokes Cargo or downloads a parser.

Evidence:

- `crates/forma-ir/tests/fixtures/compatibility/version-pairs.json` is shared by
  the actual-header Rust tests, TypeScript container reader and lockfile guard.
- `scripts/release-peer.test.mjs` exercises actual npm peer resolution.
- `scripts/compatibility-package.test.mjs` exercises the packed compiler surface
  and actual build refusal/equal/absent-compiler controls.
- `scripts/test-renderer-window.mjs` compiles production Rust with version 3.1.0-dev
  in isolated temporary source, checks unchanged locked resolution, and tests
  older/equal/patch acceptance and 3.2 module/manifest refusal before OS binding.
- `packages/build/tests/manifest-compatibility.test.ts` covers initial and watched
  Cargo.lock rejection, preserving output for split and non-split builds.

## Manifest 2

`version` is 2. `writer` is the build package's base triple. `app` is a required
application name. `build` is the deployment identity (FORMA-186, DR-29; L-6 as
amended by L-56): 16 lowercase hex characters computed from every output of a first
bundling pass (bundles, `.ir` modules, css, fonts) and the writers' versions,
compiled into every JavaScript bundle (`__FORMA_BUILD__` and a banner), and `dev` in
watch. forma-server stamps it on the page's root (`data-forma-build`, both the
server-rendered form and the browser shell). Before `activateIslands` or `mount`,
core compares the bundle identity with that root's attribute, freezes the verdict
per Document, and leaves a mismatched page inert. The cancelable Document event
`forma:skew` reports `{ page, bundle, reload }`; automatic reload is at most once
per full page identity in session storage, and unavailable storage prevents it.
Absent identities remain unchecked. Public `hydrateIsland` and application-owned
imports are outside this guard. See core's [deployment contract](../packages/core/docs/ISLANDS.md#deployment-mismatch).

`aliases` maps logical filenames to output filenames. `assets` maps each output
filename to `{ immutable, integrity, retained? }`. The build emits SHA-384/base64
integrity from final uncompressed bytes; compressed sidecars, the manifest and
worker are excluded. The server requires canonical full digests, including for retained entries,
and rendered external script/stylesheet/modulepreload resources carry that
integrity with anonymous crossorigin. See [full asset digests](UPGRADING-3.0.md#full-asset-digests). `retained: true` marks a file of the
previous release that the build copied in for tabs still open on it (FORMA-186,
`previousDist`; one generation, checked against the previous manifest's SHA-384);
a retained entry is always `immutable`.

Routes declare `mode: "ssr" | "browser"`, JS/CSS/fonts, optional static
`modulepreload`, and an IR filename only for SSR. A declared SSR route without IR
is an error, never an implicit browser fallback. Aliases and route references
must name metadata entries. A missing `immutable` field is invalid.

`AssetManifest::from_json` and serde deserialization validate schema, writer,
app, modes and references. Startup loaders revalidate hand-constructed manifests.
Schema 1, missing app and incompatible writer versions are refused before module
loading/binding, naming both versions where relevant. Unknown optional fields
cannot restore removed WASM behavior. `AssetManifest::resolve` uses aliases.

Asset cache policy reads metadata, including retained entries and split chunks
with uppercase hashes. A hash-looking filename marked mutable stays mutable;
an unhashed listed asset marked immutable gets immutable caching. Raw, compressed
and 304 responses use the same metadata. Unlisted files remain mutable. Private
IR, manifest and compression-sidecar direct requests remain forbidden. The
production cache is keyed by Embed type; overflow falls back to parsing rather
than reusing another type's policy. Development rereads rebuilt metadata.

Evidence: `packages/build/tests/manifest-compatibility.test.ts`,
`crates/forma-server/tests/manifest_compatibility.rs`,
`crates/forma-server/tests/manifest_cache.rs`, and exact DS11 template validation in
`scripts/verify-release-set.mjs`.

## Application identity and startup migration

Set `BuildConfig.app` explicitly, or let the build use the nearest Cargo package
name only if it already matches `[a-z0-9][a-z0-9-]{0,62}`. An invalid inferred
name fails with instructions to set `app`; no output directory name is guessed.
Scaffolding has a separate `APP_NAME` placeholder: accepted project names that
already match stay unchanged; other accepted names use a readable prefix and a
24-hex SHA-256 suffix. Underscores/64-character names remain accepted and
normalization-collision pairs produce different application identities.

An enabled worker now requires this checked startup call before binding:

```rust
let manifest = forma_server::assets::try_load_manifest::<Assets>()?;
let pages = forma_server::load_ir_modules::<Assets>(&manifest)?;
let home = pages.bind::<HomeProps>("home")?;
// Bind every other SSR route here as well.
pages.finalize()?;
forma_server::sw::configure_for_manifest(
    forma_server::sw::ServiceWorker::for_app("ledger")?.enabled(),
    &manifest,
)?;
// Bind the listener only after these operations succeed.
```

The app must match; `ledger` versus `other` refuses with both names. The old
`configure(enabled_worker)` path refuses unchecked enabled startup.
`configure(ServiceWorker::off())` remains supported. Reading the manifest does
not seal the worker's default. Thus applications enabling workers must update a
startup call; upgrading ranges and rebuilding alone is not a complete migration.
Direct manifest consumers also migrate `build_hash` to `build` and logical asset
lookups to `aliases`; construct mode/metadata fields when constructing manifests.

The source templates use the typed Pages API and exact coordinated version
seeds. Packing stages stable caret or exact prerelease requirements plus the
tested candidate versions and hashes in the locks. Candidate external
runtime additions come only from the committed workspace lock, nested beneath
the candidate; existing template third-party resolutions stay unchanged. Every
source manifest and lock is restored after packing, including failed staging.
P17 substitutes only unpublished candidate archives/paths and verifies those
exact DS11 artifacts; it does not repair a stale shipped lock during installation.

## Public compiler API and duplicate core

The public runtime exports are `formaSsrPlugin`, `generateRealIr`, `getSsrEntryProducts`, `IrEmitContext`,
`COMPILER_WRITER_VERSION`, `baseWriterVersion`, `FmirContainerError`,
`readFmirContainer`, `encodeFmirSections`, `dumpFmir`, `crc32`,
`DIAGNOSTIC_CATALOGUE`, `collectDiagnostics`, `diagnosticEntry`,
`formatDiagnostic`, and `makeDiagnostic`. Their documented schema/diagnostic
TypeScript types remain public. The container reader/dump/encoder deliberately
support tooling and P17; they do not claim the Rust loader's full payload
validation. AST walkers, component resolvers, module-loader helpers and removed
plugin entrypoints are internal. Package deep imports are blocked by exports.
The packed API test checks both executable exports and generated declarations.

Every build inspects retained bundler input metadata for physical core package
roots, including minified production and split output. Two copies produce
BUILD-816 with versions, real paths and entries, even when identical. Symlink
paths to one root remain quiet. It cannot detect arbitrary prebundled third-party
files that no longer identify the core package; this boundary is deliberate.
Preview-frame byte compatibility remains its separate stricter check.

## Cross-contract ownership and tests (design §6.8)

These are implementation and qualification entry points. Current release
readiness still requires the milestone gates and authenticated candidate evidence.

| Contract | Owner | Cross-boundary gate / remaining work |
|---|---|---|
| Seven-package version and window | forma-server | Shared version pairs; actual npm peers/packed build; actual renderer 3.1; DS11 exact-version assertions (112/187). |
| FMIR layout/opcodes | forma-ir | Frozen v3 faults, TS emission/Rust parse, private 14-case HTML/dump corpus (185). Window overlay changes only the patch fixture expectation; binary bytes and historical index remain untouched. |
| Published compiler subset | compiler | Per-code failing/near-miss conformance corpus and compiler/build tests. Later subset changes retain their own tickets. |
| Props schema | forma-ir | V3 schema/default load validation (185); typed derive/bind comparer/value and compile-refusal suites (102/103). |
| Markers, escaping/value and URL rules | core | `js_emitter_contract` HTML goldens, core malicious-value/URL and hydration tests. Shared value/name/URL vectors and generated three-engine parity retain the declared-data boundaries. |
| State block/island set/digests | core | Declared-schema state preflight, original host/occurrence claims, zero-write adoption and actual packed template interactions; see core ISLANDS/ISLAND-STATE. |
| Deployment identity | core | Two-pass identity emission and root stamping, Document-scoped skew guard, one-generation retention/security-mark refusal, and the actual fixture skew drill (186/188). |
| Manifest schema 2 | forma-server | Real build metadata, Rust schema/mode/ref/cache checks, packed minimal/dashboard load and before-bind negative controls (112/P17). |
| Trusted Types policy names | forma-server | Native response and Browser-shell CSP/Trusted Types enforcement, named raw-entry boundaries and three-engine browser controls (109). |
| Compiler import names | compiler | `supported-surface.test.ts` keeps component-entry `@getforma/core` h imports and excludes removed imports; packed compiler runtime/declaration surface test. `runtime-explicit-mount.test.ts` separately checks the HTML runtime's nine exports, which do not include h; legacy plugins and package deep imports are removed (110/108). |

## Reproduction and rollback

`npm run check` includes the shared workspace suites, actual renderer-version
fixture, packed API/optional-peer check, cross-language frozen corpus and browser
lanes. CI separately retains MSRV/platform/scaffold/supply-chain gates. Run the
release pack/verify scripts without publishing to reproduce DS11/P17; reports
record candidate hashes, locked graphs and explicit pending contracts.

To roll back an application, restore the previously tested A2 package and Cargo
locks together and rebuild all assets. A v3 manifest/module is not readable by the
old loader. Maintenance branches and historical artifacts are preserved.
