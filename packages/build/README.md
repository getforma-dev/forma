# @getforma/build

[![npm](https://img.shields.io/npm/v/@getforma/build)](https://www.npmjs.com/package/@getforma/build)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Production build pipeline for [FormaJS](https://github.com/getforma-dev/forma) applications. Handles esbuild bundling, CSS generation, content hashing, Brotli/gzip compression, asset manifest generation, SSR IR emission — all from a single config.

**This replaces writing your own build script.** It provides content hashing and optional native Rust SSR from one config.

## Install

These examples target the `3.0.0-rc.3` prerelease and require its coordinated
publication. Select that prerelease explicitly:

```bash
npm install -D @getforma/build@3.0.0-rc.3
```

This installs `esbuild` automatically. For SSR features (FMIR emission), also install the compiler:

```bash
npm install -D @getforma/compiler@3.0.0-rc.3
```

## Quick Start

```ts
// build.ts
import { build } from "@getforma/build";

await build({
  app: "my-app",
  entryPoints: [
    { entry: "src/app.tsx", outfile: "app.js" },
  ],
  routes: {
    "/": { js: ["app"], css: [] },
  },
  outputDir: "dist",
});
```

```bash
npx tsx build.ts
```

This bundles your app with esbuild, content-hashes all assets, generates Brotli + gzip compressed versions, and writes an asset manifest.

### Optional shared ESM graph

Set `codeSplitting: true` to share one runtime across entries and preserve native
`import()` boundaries. Split JavaScript keeps esbuild's linked graph filenames
(`page.ABC12345.js`, `chunk.DEF67890.js`); do not rename those files afterward.
`manifest.assets` includes entries and chunks, while each route's `modulepreload`
contains only transitive static imports. Servers can preload those files without
fetching lazy tools. `total_size_br` includes static dependencies but not deferred
imports. Manifest 2 records `immutable: true` for production graph assets,
including uppercase esbuild hashes; forma-server reads that metadata rather than
guessing from filenames. Development files have `immutable: false`. `serverInlined` copies retain valid relative imports but are not
standalone scripts, so split ESM should normally be served as external modules.

With `ssr: true`, an entry can set `ssr: false` to keep only that route browser-only.
Watch builds keep stable entry URLs, regenerate chunk mappings, and remove old
successful-graph chunks after rebuilding instead of accumulating them on disk.

### Verified on-demand asset caching

Production builds default to `serviceWorker: 'on-demand'`. Installation downloads
nothing. The worker's exact URL table comes from the finalized manifest's full
SHA-384 digests and immutable metadata, including dynamic JS/CSS/WASM chunks.
It never uses hash-like filename spelling as evidence of immutability.

Both cache hits and network replacements must have eligible immutable response
metadata and bytes matching that digest. A bad cache entry is evicted best effort
and refetched with the HTTP cache bypassed; it is never served, even if deletion
fails. Bad network bytes, unreadable responses or unavailable Web Crypto fail the
protected fetch. Storage/quota failure still permits a verified network response,
and a valid cached asset remains available offline. The digest covers decoded,
uncompressed bytes, including assets delivered with gzip or Brotli.

Navigation, APIs, writes, query URLs, explicit cache-bypass requests, unlisted or
mutable files, HTML, fonts, the worker and the manifest are not cached by this
worker. Responses with private/no-store headers, redirects or unsuitable MIME
are refused for protected assets. The server still opts into registration; merely
generating a worker does not enable it. `precache` is removed and is a configuration
error before output changes. Development remains network-only.

### Per-application workers (`app`)

Every manifest names its application. Set `app` explicitly, or omit it only when
the nearest `Cargo.toml` has a package name already matching
`[a-z0-9][a-z0-9-]{0,62}`. Invalid or missing names fail before output writes
(`BUILD-815`). The build never normalizes an inferred Cargo name. The scaffolder
uses a separate deterministic application name for otherwise valid project names
containing underscores or more than 63 characters.

```ts
await build({ ...config, app: 'ledger', serviceWorker: 'on-demand' });
```

An enabled server worker must be configured against the validated manifest before
binding the listener:

```rust
let manifest = forma_server::assets::try_load_manifest::<Assets>()?;
forma_server::sw::configure_for_manifest(
    forma_server::sw::ServiceWorker::for_app("ledger")?.enabled(),
    &manifest,
)?;
```

A different manifest `app` is refused, naming both values. `sw::configure` remains
the off-worker convenience; it refuses an enabled worker without a manifest.
Reading the manifest does not seal the default worker setting. This startup call
is a source migration for applications enabling a worker.

The existing production cache name is `forma:<app>:<build>`, using the first 12
hex digits of the current build identifier. Activation removes its own older
caches and legacy Forma caches, never another named application's caches. It does
not skip waiting or claim open pages. Development workers stay network-only.
The final deployment identity and retained-build protocol remain FORMA-186.

Verified by: `packages/build/tests/compatibility.test.ts`,
`packages/create-app/tests/scaffold.test.ts`, and
`crates/forma-server/tests/manifest_compatibility.rs`.

### Compatibility before output writes

The compiler peers on core and the build optionally peers on the compiler at
`^3.y.0`. Coordinated prereleases add only their exact version. An incompatible
required compiler/core peer fails installation. npm may warn or accept an
optional build/compiler conflict, including a silent recorded-lock `npm ci`;
`build()` therefore checks an installed compiler itself and refuses skew before
writing output. Browser builds without a compiler remain supported; SSR requires
one (`BUILD-801`).

The build parses the nearest `Cargo.lock` from its working directory. The resolved
server must share the writer's major and have at least its minor, for both the
manifest writer and any SSR compiler. Patch numbers do not narrow the window.
Missing lockfiles warn; malformed, unreadable or ambiguous locks fail. A lock
without forma-server fails SSR and warns for a standalone browser build. Upgrade
the renderer first. Watch mode rechecks lock changes and preserves the last valid
bundle when they fail. See [the compatibility contract](../../docs/compatibility.md).

Every production build also reports multiple physical copies of core (`BUILD-816`),
even when their versions match and `previewFrame` is off. One package reached by
symlinks is one copy. This uses retained bundler inputs and real package roots;
it cannot identify core hidden inside an arbitrary prebundled third-party file.

Verified by: `packages/build/tests/manifest-compatibility.test.ts` and
`scripts/compatibility-package.test.mjs` (actual packed code and installs).

### The preview frame's runtime (`previewFrame`)

forma-server's preview frame (`PageResponse::frame`, FORMA-125) renders content
nobody reviewed in an opaque-origin document whose one script is core's frame
runtime, written inline and allowed by its SHA-256 hash. It finds that runtime
the way it finds every asset: `PreviewFrame::load` reads the manifest's
`aliases["forma-runtime.js"]` from the embedded output at start, and refuses to
start the frame without it (FRAME-101). An application that serves the frame
turns the setting on:

```ts
await build({ ...config, previewFrame: true });
```

The build then writes `dist/formajs-frame.global.js` from the
`@getforma/core` the bundles import (core 2.1.0 and later), minified, as
`forma-runtime.<hash>.js`, and names it in the manifest:

```json
"aliases": { "app.js": "app.1797a84b.js", "forma-runtime.js": "forma-runtime.e7a8cc12.js" }
```

- **The core the bundles import, so the preview renders a module with the
  core the page mounts it with.** Before anything is written, each entry is
  bundled in memory with the bundles' own esbuild options, and every file it
  loads is mapped to its package (a directory whose package.json is named
  `@getforma/core`). The core is therefore the one the bundles reach,
  however they reach it: `formaAlias`, whose target esbuild resolves from the
  working directory (so a build run from a monorepo's root takes the root's
  core, as its bundles do); tsconfig `paths` to a vendored copy; a linked or
  pnpm-installed core, by its real path. When the bundles import cores whose
  frame runtimes differ (entries from two packages, each with its own core,
  or a library bundling its own), the build refuses rather than pick one
  (`BUILD-807`). Equal frame bytes may be copied once, but independent
  physical core copies still produce `BUILD-816`. When the bundles
  import no core, it copies the one installed where the build runs (the
  working directory, as Node finds a package). The entries must bundle at
  start, in watch mode too.
- **Never core's `dist/forma-runtime.js`.** That file shares the target's
  name, but it is the CDN alias of the auto-mounting runtime, which would bind
  the whole frame document instead of rendering the host's module in tier (c).
- **Minified in the output, as published in core** (FORMA-190, from the A2
  audit's F1). forma-server writes this runtime into every preview document
  under `no-store`, so each load pays its bytes: core's file is 164 KB
  readable. Core's published file stays readable (anything published to npm
  does); a production build writes an esbuild transform of it (whitespace and
  names, ES2022, deterministic) into `dist`, before the hashing pass, so the
  file's name, its SRI in the manifest and the SHA-256 forma-server computes
  for the frame's policy are those of the bytes served, and the script the
  browser runs is the one hashed. The size report's frame row reports those
  served bytes beside core's file. No source map is written: the script is
  inlined in an opaque-origin frame with `connect-src 'none'`, so a map could
  not be fetched, and its comment would be part of the hashed bytes. Watch mode
  copies core's bytes unchanged (a development build, readable in the browser's
  tools): that is the copy to debug. It is inlined, never
  fetched: no route loads it, it gets no `.br` or `.gz` copy, and the worker's
  lists leave it out.
- **It refuses what forma-server would refuse** (FRAME-103), before anything is
  written, so the previous output stays as it was: `BUILD-805` when the core
  the bundles import has no frame runtime (older than 2.1.0) or no core is
  found, `BUILD-806` when the runtime is empty, not UTF-8, or contains
  `</script` or `<!--` (in any case), a carriage return or a NUL, and
  `BUILD-807` as above, and `BUILD-823` when esbuild cannot minify it. The
  `BUILD-806` check runs on core's file and again on the minified bytes. Each
  fails the build with or without strict mode (`docs/DIAGNOSTICS.md`).
- **Watch mode** writes it unhashed as `forma-runtime.js`, and the dev manifest
  names it as itself, as it does every watched asset.
- **Off** (the default, or `false`), nothing is read and the output is
  byte-identical to a build without the setting. While it is on, no entry may
  take the name `forma-runtime.js` in any case (`Forma-Runtime.js` is the same
  file on macOS and Windows); any value but `true` or `false` is a config
  error.

### The size report: route classes and ceilings

A production build classifies every route and holds it to its class's
ceilings (N2; decision brief L-64, DR-35). Sizes are gzip at level 9, a KB
being 1,000 bytes and a KiB 1,024; Brotli is reported beside them. A route over
a ceiling fails the build with `BUILD-819`, naming the route, its class and
the bytes, before anything is written.

| Class | Which routes | Forma's code | All of the route's JavaScript |
|---|---|---|---|
| `no-interactive-region` | A server-rendered page with no island, or a route that lists no script | none | none (a service worker counted) |
| `islands` | A server-rendered page with islands | 28,100 B | 75 KiB (76,800 B), 365 KiB for a canvas |
| `whole-page-mount` | An entry declared `ssr: false`, or any route of an application built without `ssr` | 28,100 B | as `islands` |

L-64 authorizes this ceiling for cooperative activation only after the full 20-run performance campaign passes the original 50 ms N3 task ceiling. Source constants alone do not establish release qualification.

Forma's code is `@getforma/core` and `alien-signals` as bundled, attributed
from the bundler's metafile, plus the identity banner Forma's build writes at
the top of every JavaScript file (about 30 B gzip for each file the route
loads cold); the application's own code is outside that ceiling. A route's JavaScript is the files the manifest lists for it and the
generated `sw.js` when the route lists any script (forma-server registers the
worker only on such pages).

**`canvas`.** A page that hosts many modules and is JavaScript-heavy by design
declares it on its route:

```ts
routes: {
  "/studio": { js: ["studio"], css: ["studio"], canvas: true },
},
```

A canvas may ship 365 KiB of JavaScript instead of 75 KiB; Forma's code stays
under 28,100 B either way, and the declaration gives nothing to a route
without JavaScript. Only `true` or `false` is accepted (anything else is a
config error, reported before anything is written). It is provisional public
configuration at 3.0.0: declare it for a page that really is a canvas, and trim
or split any other page over 75 KiB.

The report is printed after the bundle summary, returned as
`BuildResult.sizeReport` (`BuildResult.sizes` is its routes) and written,
without the build's times, as `size-report.json` beside `manifest.json`: for the
same sources the same bytes, since the application embeds the directory, and
forma-server refuses to serve it. The times by phase (`bundle`, `hash`,
`compress`, `manifest`) are printed and in `BuildResult.sizeReport.times`. With
`previewFrame`, a frame-document row reports the runtime forma-server inlines
into every preview document. Watch mode reports nothing: its bytes are not what
a route ships.

## What It Does

| Step | What happens |
|------|-------------|
| **Validate** | Rejects an unknown `serviceWorker` value, an `app` name forma-server cannot take, a `previewFrame` that is not a boolean, two entries sharing an `outfile`, an `outfile` that is a path (or `forma-runtime.js`, in any case, with `previewFrame`), a route naming an asset no entry produces, or a route missing its `js` or `css` list, before touching `outputDir`; with `previewFrame`, finds the core the bundles import and reads and checks its frame runtime (`BUILD-805` to `BUILD-807`, and `BUILD-823` when it cannot be minified) |
| **Frame runtime** | (Optional, `previewFrame: true`) Writes the `dist/formajs-frame.global.js` of the `@getforma/core` the bundles import, minified (core's file stays readable; watch mode copies it unchanged), as `forma-runtime.js`, hashed with the other assets and left uncompressed |
| **Bundle** | esbuild bundles each entry point with JSX transform (`jsxFactory: "h"`) |
| **CSS** | Runs Tailwind CLI or concatenates CSS files |
| **Hash** | SHA-256 content hash appended to filenames (`app.a1b2c3d4.js`) |
| **Compress** | Brotli (level 11) + gzip (level 9) for `.js` and `.css` |
| **Manifest** | Writes schema 2: writer/app/build, aliases, route modes and filename-keyed immutable/SHA-384 metadata |
| **SSR** | (Optional) Emits one `<page>.ir` FMIR binary per entry for Rust server-side rendering |
| **Budget** | Warns if route brotli size exceeds threshold (default 200KB) |
| **Size report** | Per route: its class (no interactive region, islands, whole-page mount), what it loads cold in raw, gzip -9 and Brotli bytes, Forma's code (`@getforma/core` and `alien-signals` as bundled, attributed from the bundler's metafile, plus the identity banner Forma's build writes at the top of every JavaScript file) beside the application's, and the generated `sw.js` a route with JavaScript registers; with `previewFrame`, a frame-document row; the build's times by phase. Printed, returned as `BuildResult.sizeReport` (`BuildResult.sizes` is its routes), and written without the times as `size-report.json` beside the manifest (forma-server never serves it). **The gate:** a route over its class's ceiling fails the build with `BUILD-819` before anything is written, naming the route, its class and bytes (decision brief L-64, DR-35; the ceilings are not configurable): Forma's code at most 28,100 B gzip -9; all of a route's JavaScript at most 75 KiB, or 365 KiB if the route is declared `canvas: true`; none at all on a route with no interactive region |
| **Swap in** | A production build writes all of the above into a staging directory beside `outputDir` (`.<name>.forma-staging-…`) and swaps it in only when every step has succeeded: a build that fails part way leaves `outputDir` exactly as the last good build left it, so the application never embeds half a build. Watch mode publishes browser outputs only after a successful build and replaces files by rename; failed compatibility checks preserve the previous outputs |

## Configuration

```ts
import { build, type BuildConfig } from "@getforma/build";

const config: BuildConfig = {
  // Required (app may instead come from a valid nearest Cargo package name)
  app: "my-app",
  entryPoints: [
    { entry: "src/home/app.tsx", outfile: "home.js" },
    { entry: "src/dashboard/app.tsx", outfile: "dashboard.js" },
  ],
  routes: {                          // each route needs both js and css; [] for none
    "/": { js: ["home"], css: ["home"] },
    // canvas: true declares a page that hosts many modules: its JavaScript may
    // be 365 KiB gzip -9 instead of 75 KiB (the size report's ceilings)
    "/dashboard": { js: ["dashboard"], css: ["dashboard"], canvas: true },
  },
  outputDir: "dist",

  // Optional
  cssEntries: [
    // Tailwind: runs @tailwindcss/cli on the first input
    { input: "src/app.css", outfile: "app.css", tailwind: true },
    // Otherwise: concatenates the inputs in order
    { input: ["src/reset.css", "src/theme.css"], outfile: "dashboard.css" },
  ],
  fontDir: "src/fonts",              // Copy .woff2 files to dist
  ssr: true,                          // Enable FMIR emission
  ssrEntryPoints: {                   // page name (outfile minus .js) -> entry
    home: "src/home/app.tsx",         // the file with mount()/activateIslands()
    dashboard: "src/dashboard/app.tsx",
  },
  // strict: true,                   // Legacy no-op: 3.0 always refuses unsupported SSR
  // diagnosticsJson: "ssr-diagnostics.json", // Also write them as JSON, outside outputDir
  // previousDist: "../previous-release/dist", // Keep the live release's assets for open tabs; see "Retention"
  // security: true,                  // This release fixes a vulnerability: retain nothing (or FORMA_SECURITY_RELEASE=1)
  previewFrame: false,                // true: write core's frame runtime, minified, as forma-runtime.js (forma-server's PageResponse::frame)
  watch: false,                       // Rebuild on change; writes a dev manifest and, with ssr, each page's .ir
  budgetThreshold: 200_000,           // Warn at 200KB brotli per route
  formaAlias: "@getforma/core",       // What bare 'formajs' imports resolve to
  serverInlined: ["app.js"],          // Also keep the unhashed name on disk
};

await build(config);
```

`formaAlias` remains a migration bridge throughout 3.x. If the build's source
graph imports `formajs` or one of its subpaths, one warning lists the importing
files and the `@getforma/core` replacement. The same warning appears in
`BuildResult.warnings`; duplicate imports and the two production identity passes
do not repeat it. Erased TypeScript imports and re-exports are included. A
`build()` call with no legacy imports is quiet, including its initial watch
build. The alias still resolves as configured; omitting it does not make the
unavailable bare package resolve.

### Retention: a tab opened before a deploy

While a deploy rolls out, and for as long as a tab stays open, a page of the
previous release asks for hashed files (a lazily imported chunk) that the new
binary does not embed. Your pipeline keeps the previous release's `dist/` as a
release artifact (the one that is live) and passes its path as `previousDist`.
The build copies that release's own hashed assets into the new `dist/`, listed in
`manifest.json` as `{ "immutable": true, "retained": true, "integrity": ... }`, and
forma-server serves them as it serves any immutable asset, so you embed one
`dist/` and a one-deploy-old tab still loads its chunks.

- **One generation.** What the previous release itself retained is not copied
  again, so the assets at most double and a tab two deploys old gets a 404 for a
  chunk it asks for, which your code handles as it handles any failed `import()`.
- **Never copied:** `manifest.json`, `sw.js`, the `.ir` modules, and files that
  are not immutable (unhashed fonts). A file the new build also emitted under the
  same name is its own and is not flagged.
- **Checked.** Each copied file's bytes must match the SHA-384 the previous
  manifest recorded; a missing, linked or altered file fails the build with
  `BUILD-821`. A path that is not a usable previous release fails it with
  `BUILD-820`: it must be another directory than `outputDir` (which the build
  replaces whole), of the same `app`, not a watch build. A previous dist whose
  manifest is not schema 2 (your first 3.0.0 deploy over a 2.x release) retains
  nothing, and the build says so.
- **First deploy:** leave `previousDist` out; nothing is copied.
- **Security releases (L-16, SR45):** mark every release that fixes a
  vulnerability, a Forma security upgrade included, with `security: true` or
  `FORMA_SECURITY_RELEASE=1` (a `false` in the config does not unmark it). The
  build then retains nothing and the revoked build's files are not served; a
  revoked build's open tabs meet 404s for their lazy chunks.
- **Trust.** The SHA-384 check catches a damaged or altered file, not someone who can
  also rewrite the previous `manifest.json`: the previous `dist/` is trusted like your
  source. Keep it as a protected release artifact.
- `FORMA_SECURITY_RELEASE` is read like `FORMA_STRICT`: `1` or `true` (any case,
  trimmed) marks; unset, empty, `0` or `false` does not; anything else fails the build
  (`BUILD-822`).
- Watch mode ignores both options.

The identity does not depend on the retained set: the same inputs give the same
`build`, the same non-retained entries and, with the same previous release, a
byte-identical `dist/`.

## Output Structure

```
dist/
├── home.a1b2c3d4.js         # Content-hashed bundle
├── home.a1b2c3d4.js.br      # Brotli compressed
├── home.a1b2c3d4.js.gz      # Gzip compressed
├── home.e5f6g7h8.css
├── home.e5f6g7h8.css.br
├── dashboard.i9j0k1l2.js
├── home.m3n4o5p6.ir          # FMIR binary (if ssr: true)
├── forma-runtime.y5z6a7b8.js # Core's preview-frame runtime, minified and uncompressed (if previewFrame: true)
├── inter.woff2                # Copied fonts (never hashed)
├── sw.js                      # Service worker (generated last, never hashed)
└── manifest.json              # Asset manifest (generated last, never compressed)
```

Nothing else is written. In particular an SSR build emits **only** `<page>.ir`
per entry: no island registry, no island metadata sidecar. (Through 0.1.9 it
also wrote `<page>.islands.js` and `<page>.islands.json`, which every consumer
had to delete by hand — see the CHANGELOG.)

The compiler's successful entry product determines whether an SSR page needs
browser code. A page with no reachable island definitions keeps its native IR,
CSS and fonts, but its manifest has `mode: "ssr"`, `js: []` and no module
preloads. Conditional islands still require JavaScript even when one request
renders no island. Explicit `ssr: false` entries retain normal browser output.

The first configured route entry remains its native owner before filtering.
Keep that name in `routes[route].js`; do not replace the configuration with the
filtered manifest array. Additional route entries must declare `ssr: false`.
A static owner cannot request extra scripts or executable `serverInlined`
output: those contradictions fail with `BUILD-611`. Other explicitly inlined
resources remain available to their configured consumers.

Split output keeps every static and dynamic JavaScript dependency of active
entries, plus CSS/font resources; chunks used only by a removed static entry
are omitted. Watch retains old generation files for existing documents. A
candidate classification becomes accepted only when its complete graph, IR and
manifest publication succeeds; a failed rebuild keeps the prior route policy.

## Asset Manifest

Manifest 2 separates logical aliases from metadata keyed by emitted filename.
Every route declares `ssr` or `browser`; an SSR route without a module fails the
build (`BUILD-817`). This abbreviated example omits measured digests and sizes:

```json
{
  "version": 2,
  "writer": "3.0.0",
  "app": "ledger",
  "build": "5f0c9a1e7d2b4c86",
  "aliases": {"home.js": "home.a1b2c3d4.js", "home.ir": "home.a1b2c3d4.ir"},
  "assets": {
    "home.a1b2c3d4.js": {"immutable": true},
    "home.a1b2c3d4.ir": {"immutable": true}
  },
  "routes": {
    "/": {"mode": "ssr", "js": ["home.a1b2c3d4.js"], "css": [],
      "fonts": [], "ir": "home.a1b2c3d4.ir", "total_size_br": 0,
      "budget_warn_threshold": 200000}
  }
}
```

The actual build includes `integrity: "sha384-<base64>"` for each asset, computed
from its final uncompressed bytes. Compression sidecars, the manifest and the
worker are excluded. Integrity enforcement is FORMA-111; emission alone does not
provide that enforcement.

### The deployment identity (`build`)

`build` is the build's deployment identity: 16 lowercase hexadecimal characters
(`dev` in watch mode). A production build computes it first, from every output of
a first bundling pass (the JavaScript and CSS bundles, the other emitted files and
the `.ir` modules, plus the css entries and fonts) and the writers' versions, and
only then compiles it in:

- as the constant `__FORMA_BUILD__` (esbuild `define`), which `@getforma/core`
  compares with the `data-forma-build` attribute forma-server writes on the page's
  root before it activates anything;
- as a `/*forma-build:<id>*/` banner in every JavaScript output, so the names,
  which hash content, change with the identity: every deploy renames every bundle.

The same inputs give the same identity wherever they are built from (esbuild
hashes paths relative to the working directory, so build from the project root).
An edit that changes no output byte, a comment, changes nothing and disturbs no
open tab. The identity does not depend on a previous `dist/`. The first pass
costs one more bundling run; the compiler's lines for it are not printed twice.

forma-server validates the schema, writer window, app, references and route modes
before loading modules. It resolves logical names through `aliases` and reads
cache immutability from metadata, including retained entries. Schema 1 and missing
`app` are refused. Rebuild assets with the aligned 3.x package set.

Verified by: `packages/build/tests/manifest-compatibility.test.ts`,
`crates/forma-server/tests/manifest_compatibility.rs`, and
`crates/forma-server/tests/manifest_cache.rs`.

### Watch mode is a development build

Watch mode resolves each package's `development` export condition, as Vite's
dev server does: it passes esbuild `conditions: ['development', 'module']`
(`module` because listing any condition drops esbuild's automatic one) and
defines `process.env.NODE_ENV` as `"development"`. `@getforma/core` points the
condition at a build that keeps its development warnings (hydration
mismatches, dropped props, the `FORMA_W_DEPRECATED_` codes), so they reach
the browser console while you develop. A production build passes neither: it
resolves the files it always did and logs none of them.

### Watch mode and server-rendered pages

Watched JS/chunks use esbuild's linked generation filenames, and IR filenames
include their SHA-256. New bytes are staged before an atomic manifest rename
selects the complete generation. Earlier files stay available for readers holding
an earlier manifest or HTML response, until a fresh production build replaces the
output directory. Failed compilation, validation or final publication keeps the
accepted manifest and its referenced bytes. Always resolve output through manifest
aliases; watched entry and IR filenames are no longer stable logical names.

With `ssr: true`, each browser context also watches the source and type inputs
of its SSR entry (`ssrEntryPoints`, else its browser entry). A successful cycle
returns JS and IR together; an SSR-only edit triggers the same paired cycle.
Compiler and publication errors keep the last accepted generation. Each native
rewrite logs its logical name and time, for example
`IR rewritten: home.ir in 36 ms`; the manifest holds its actual hashed filename.

In debug builds, `forma-server` validates the new manifest and module together.
A refused update retains the previous module and asset snapshot. Route names
and modes are frozen after startup finalization; those changes need a restart.

### Removed server functions

A `"use server"` directive at module or function scope, including in an imported
module, fails every build with `BUILD-808`, regardless of `strict`. Move server
work into an authenticated Rust route and call it with `fetch`. The initial
source check runs before output is replaced; watch rebuilds run the same guard.
The `wasm` configuration key and walker packaging step were removed in 3.0.0.
Islands re-render with core's `h()`; server rendering uses the native Rust walker.

Verified by `tests/server-functions-removed.test.ts` (directive and near-miss fixtures).

### SSR diagnostics and the server-renderable subset

SSR builds always enforce the [published subset](../compiler/docs/subset.md).
Every unsupported construct is reported with its stable code, original source
file, line, column, reason and fix. `build()` collects every page's diagnostics
before refusing publication; a failure leaves the previous output unchanged.
The direct compiler plugin applies the same gate.

`strict: true`, `strict: false` and the legacy `FORMA_STRICT` values `1`, `true`,
`0`, `false` or empty are compatibility inputs. They all select the same strict
behavior. The build reads no command-line flags. A watch rebuild that fails keeps
the page's last good product, then publishes normally after the source is fixed.

`diagnosticsJson: "<path>"` writes `{ version, strict: true, diagnostics }`, including
on failure. Each diagnostic carries `code`, `severity`, `page`, `file`, `line`,
`column`, `message`, `why` and `fix`. Its path must be outside `outputDir`, including
through symlinks. Additive report fields do not change the schema version;
renaming, removing or changing a field's meaning does.

Use a registered `browserOnly()` component for an explicitly browser-rendered
subtree, or `ssr: false` on an entry for a whole browser-only route. An unsupported
SSR expression cannot opt out of the gate merely by setting `strict: false`.

### Development service worker

Watch builds emit a network-only worker for stable `/_assets/` URLs. It bypasses
both CacheStorage and the browser's HTTP cache, immediately activates, and
deletes every cache named `forma-*`; caches named otherwise are left alone.
Production builds keep content-hashed assets cache-first in the worker's own
cache. If CacheStorage fails they answer from the network, and a failed cache
write (a quota error, say) never fails the response.

Without `app`, every worker mode deletes all `forma-*` caches except its own,
so Forma applications that share an origin delete each other's caches. With
`app`, the production worker's caches are named per application and build
(`forma:<app>:<build>`) and it deletes only its own application's (see
"Per-application workers" above).

When upgrading a running development app from the old cache-first worker,
rebuild the frontend, restart any server that embeds build output, then reload
so `/sw.js` updates. Reload once more after the new worker takes control if the
first navigation started under the old controller. No cache-clearing workaround
is needed for subsequent rebuilds. A server must actually serve the new asset
bytes; this worker change does not restart Rust or watch CSS on its behalf.

Run the controlled-page regressions with `npm run test:browser -w packages/build`
from the workspace root: the development worker's takeover, and a
per-application worker through upgrade, rollback and upgrade with two tabs open. It uses installed Chrome when bundled Chromium is
unavailable, or the explicit `FORMA_BROWSER_CHANNEL` override.

## Raw-entry lint (`forma-raw-lint`)

Raw HTML and the other ways out of escaping and Forma's policy are named, so
review and CI can find every one (DR-19, L-37). `forma-raw-lint` is the check
an application runs in CI (SR8): it fails on any use of those exits that its
allowlist does not list with an owner and an end date, and on any listed entry
past its end date. The allowlist becomes the inventory of the application's
raw entries.

```bash
npx forma-raw-lint src crates
```

```yaml
# .github/workflows/ci.yml
- run: npx forma-raw-lint --report raw-entries.json src crates
```

It reads TypeScript, JavaScript (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`,
`.mjs`, `.cjs`; not `.d.ts`), Rust (`.rs`) and HTML (`.html`, `.htm`) under
the files and directories it is given, skipping `node_modules`, `target` and
any file or directory whose name starts with `.`. Skips and `--exclude` are
applied before anything is read. A symbolic link is followed; one that leads
nowhere or loops is a `BUILD-814` (exclude it if it is not source), and a
file reached by two paths is read once. It needs nothing beyond this package:
an application that does not build with `@getforma/build` (a Rust-only one,
or one that uses `@getforma/core` alone) runs it with
`npx -p @getforma/build@3.0.0-rc.3 forma-raw-lint …` after RC publication.

**Point it at source, not build output.** A bundle that includes core carries
core's own raw entries: the registry key survives minification, and a
development build carries `data-bind:srcdoc` in a warning. Name the source
directories, or leave committed bundles out with `--exclude` (for example
`--exclude 'crates/*/assets/**' --exclude 'dist/**'`).

```
--allowlist <file>  The allowlist (default: ./forma-raw-allowlist.json, if it exists)
--root <dir>        What paths are relative to (default: the allowlist's directory, else .)
--exclude <glob>    Do not scan matching files or directories (**, *, ?); repeatable
--today <date>      Check end dates against this day, YYYY-MM-DD (default: today, UTC)
--json              Print the report as JSON instead of text
--report <file>     Also write the JSON report to this file
--exits             List the exits an entry's "exit" can name
```

**Exit codes.** 0, it passes; 1, a raw entry not on the allowlist
(`BUILD-810`), an entry past its end date (`BUILD-811`) or a source file it
cannot parse (`BUILD-814`); 2, a usage error or an allowlist it cannot use
(`BUILD-812`). An entry that lists fewer uses than its count, or none
(`BUILD-813`), is a note. The codes
are in the build diagnostics catalogue, [`docs/DIAGNOSTICS.md`](https://github.com/getforma-dev/forma/blob/main/packages/compiler/docs/subset.md).

```text
BUILD-810 error body_prefix in src/server/mod.rs:772:9 (in index_handler): body_prefix: body_prefix set to a value not traced to RawHtml::trusted (a string still works in 0.2.x); not on the allowlist
forma-raw-lint: 6 raw entries in 123 files: 5 listed, 1 not on the allowlist; 0 allowlist entries past the end date; 0 allowlist entries listing fewer uses than they say. Fail.
```

### The allowlist

`forma-raw-allowlist.json`, version 1:

```json
{
  "version": 1,
  "entries": [
    {
      "path": "src/server/mod.rs",
      "symbol": "index_handler",
      "exit": "body_prefix",
      "owner": "studio",
      "until": "2027-01-31",
      "reason": "the hand-written app shell; moves to RawHtml::trusted (appendix E)"
    },
    {
      "path": "client/pages/DocsPage.ts",
      "line": 751,
      "exit": "dangerouslySetInnerHTML",
      "owner": "docs",
      "until": "2027-01-31",
      "reason": "sanitised search snippets; wrap in trustedHtml under kmd's policy"
    }
  ]
}
```

Each entry has:

- `path`: the file, relative to the allowlist's directory, with `/`.
- `line` or `symbol`, exactly one: the line, or the innermost named function,
  method, class, `impl` or module, as the lint prints it after `in`
  (`FormaStage.update`, `RawHtml::from_static`). A symbol survives edits
  around it; a line pins one use.
- `exit`: one of the names below.
- `owner`: who answers for it.
- `until`: `YYYY-MM-DD`, the last day the entry is valid, in UTC (the run's
  date is UTC's, as on a CI runner, so west of UTC an entry ends some hours
  before the local day does). The day after, the run fails until the owner
  removes the raw entry or renews the date. It may be at most a year after
  the run's date (an entry further out is refused, `BUILD-812`), so every
  entry is revisited at least yearly.
- `reason`: why it is raw, and where it is going.
- `count` (optional, default 1): how many uses of that exit the entry lists.
  A second use in the same function is not on the allowlist until the count
  says so, and an entry that lists fewer uses than its count is a `BUILD-813`
  note, so a count never leaves room for an unreviewed use.

An unknown field, a missing one, an exit the lint does not know or a date
that is not a real day stops the run with `BUILD-812`, naming the entry and
the field. The `--json` report's `rawEntries` lists every raw entry found,
listed or not, with its file, line, column, symbol and exit: the list an
allowlist starts from.

### The exits

TypeScript and JavaScript, inline scripts in HTML included:

| Exit | What the lint finds |
|---|---|
| `trustedHtml` | Each call of `trustedHtml()`, under any name it is imported or destructured as (`@getforma/core`, `./runtime`, the CDN's `FormaRuntime`), and each reference to it that is not a call, or that exports it under another name. |
| `dangerouslySetInnerHTML` | Any `__html` key, wherever it is written, whose value is not a `trustedHtml(…)` call or a `const` in scope bound to one (a string still works in 2.x and warns in development); and the prop itself set to a value the lint cannot read as `{ __html: … }`: by JSX, `h()`, a quoted or computed key (a `const` holding the name included), shorthand, `obj.prop =`, `obj['prop'] =` or `Reflect.set(obj, 'prop', …)`. |
| `setHTMLUnsafe` | Core's `setHTMLUnsafe(el, markup)` given markup not traced to `trustedHtml()`. |
| `template` | Core's `template(markup)`, likewise. |
| `templateMany` | Core's `templateMany(markup)`, likewise. |
| `reconcile` | The runtime's `reconcile(el, markup)`, likewise. |
| `mountMarkup` | The runtime's `mountMarkup(root, markup, options)` (core 2.1.0's tiered mount), likewise: a string still works in 2.x. |
| `MountHandle.update` | `update(markup)` on the handle `mountMarkup()` returns, given markup not traced to `trustedHtml()`: on a variable, field or property assigned the handle (`=`, `??=`, `\|\|=`, `&&=`, or an arm of a ternary), by dot or by bracket (`w.update(…)`, `w['update'](…)`), chained on the call (`mountMarkup(…).update(…)`), or destructured from it (`const { update } = mountMarkup(…)`, `{ update: up }`). The follow is by name, file-wide: a second object held under a handle's name, or another `update` destructured in the same file, is reported too, and an entry on the list says so. |
| `srcdoc` | A `srcdoc` prop, attribute or property (any case) set to a value not traced to `trustedHtml()`: JSX, `h()`, a quoted or computed key, `setAttr`/`setAttribute(…, 'srcdoc', …)` (a template literal or a `const` holding the name included), `.srcdoc =`, `['srcdoc'] =`, `Reflect.set` and `Object.defineProperty`. |
| `core-reexport` | `export * from '@getforma/core'` (or a subpath, or `export * as x from …`): every raw sink of core's behind the application's own module, where the lint does not follow its importers. A named re-export of a sink (`export { reconcile } from '@getforma/core/runtime'`, or a sink imported from core and exported) is reported under the sink's own exit. |
| `h('script')` | A `script` element built by core's `h()`: `h('script', …)` (any case), under a name `h` is imported as, on core's namespace, or JSX `<script>`. Its `src` runs under `'strict-dynamic'`; it warns in development and 3.0.0 refuses it (FORMA-109). |

Markup, in HTML files and in string literals in either language:

| Exit | What the lint finds |
|---|---|
| `data-bind:srcdoc` | The HTML runtime's `data-bind:srcdoc` binding, which no `trustedHtml()` can reach. |
| `list-row-srcdoc` | A `srcdoc` attribute whose value carries `{item`, a list row's binding, after character references (`&#123;`, `&lbrace;`) and string escapes (`\u{7b}`, `\x7b`) are decoded, as the runtime reads it. |
| `trusted-types-registry` | The string `@getforma/core#trusted-types`, the key of core's registry, through which the `forma` policy can mint without `trustedHtml()`. |

Rust:

| Exit | What the lint finds |
|---|---|
| `RawHtml::trusted` | Each `RawHtml::trusted`, path-qualified, as `<RawHtml>::trusted`, as `Self::trusted` in an `impl` for it, or through an alias of it from any file. |
| `RawHtml-alias` | `RawHtml` under another name: `use … RawHtml as X`, `type X = …RawHtml`, any `= RawHtml` (an associated type, a generic default). |
| `r#html` | The raw identifier `r#html`, the name of `RawHtml`'s private field. |
| `body_prefix` | A `body_prefix` other than `None` that is not `Some(&x)` (or `x.as_str()`, `&*x`) where `x`'s last binding in scope is `RawHtml::trusted(..)` as its whole value or is declared `RawHtml`, or `self.x` declared `RawHtml` by the `impl`'s own struct: a string still works in 0.2.x. |
| `config_json` | `config_json` set to anything but `None`: data's typed home. |
| `config_script` | `config_script` other than `None`: deprecated, handler text in a nonced script, removed in 3.0.0. |
| `into_parts_unchecked` | `PageResponse::into_parts_unchecked`. |
| `with_module_preloads` | `RenderCtx::with_module_preloads`, the typed home for `modulepreload` links. |
| `with_head_link` | `RenderCtx::with_head_link`, the typed home for head links. |
| `relax_trusted_types` | `PolicyExtensions::relax_trusted_types`, a route's Trusted Types relaxation. |

The three fields are found where a struct literal or an assignment sets
them (`field: v`, `x.field = v`), through an `Option` method that writes them
(`.replace`, `.insert`, `.get_or_insert`, `.get_or_insert_with`, `.as_mut`,
`.as_deref_mut`), and through a mutable borrow (`&mut c.body_prefix`, as
`mem::replace` takes).

A typed use is one raw entry, its constructor: `{ __html: trustedHtml(md) }`
lists `trustedHtml`, and `let shell = RawHtml::trusted(..)` with
`body_prefix: Some(&shell)` lists `RawHtml::trusted`.

### How it reads, and what it misses

TypeScript and JavaScript are parsed by esbuild, as the build parses them: a
file that does not parse fails the run (`BUILD-814`) rather than pass unseen
(a `.js` file is also tried as JSX and as TypeScript). The lint reads
esbuild's output, where types are gone, JSX is `h()` calls and comments are
dropped, so a name in a comment, a type, JSX text or a string is never read
as a use; positions are mapped back through esbuild's source map. Rust is a
token scan, not a parse: it knows Rust's lexical grammar (nested comments, raw
strings, byte and C strings, char literals against lifetimes, raw
identifiers) and pairs brackets, so a struct literal's fields, a struct's
declared fields, a `use` tree and a pattern are told apart. HTML is read in
one pass, tag by tag: a comment starts only in text, never inside a quoted
value; an inline script is parsed as JavaScript (one that does not parse is a
`BUILD-814`, and the rest of the file is still read); a script of another
type (`text/x-template`, `application/json`) is read as markup, as a string
literal is. A string literal's escapes are decoded before its markup is
read.

What it cannot see, and review must:

- A sink reached through core's module inside a callback
  (`import('@getforma/core').then((m) => m.template(s))`, or
  `.then(({ template }) => …)`). `template`, `templateMany`, `reconcile`,
  `mountMarkup` and `setHTMLUnsafe` are followed from core's own module names
  and `FormaRuntime`:
  through named, namespace and default imports, `require` and `await import`,
  destructuring and aliases of the namespace (`const { template } = F`,
  `const G = F`), and bracket access (`F['template']`). `trustedHtml` is
  matched by name wherever it comes from.
- Provenance across files or through a function: a sink passes only when its
  argument is a `trustedHtml(…)` call or a `const` bound to one in scope (a
  parameter, `let`, `var` or any nearer binding of the same name shadows it,
  and only a `const` is trusted), and `body_prefix` only when the last binding
  of its name in scope makes or declares a `RawHtml` (a shadowing `let`, a
  parameter or a closure or pattern binding in between undoes it), or for
  `self.x` that the `impl`'s own struct declares `RawHtml`. Everything else is
  reported, so the lint errs toward an entry on the list.
- A name built at run time: the registry key from variables
  (`` `${pkg}#trusted-types` ``) or found with `Object.getOwnPropertySymbols`,
  and an attribute name such as `` `data-bind:${attr}` ``. A key or name
  written whole, or as a sum of literals esbuild folds
  (`'@getforma/core' + '#trusted-types'`), is found.
- A Rust name assembled by a macro (`paste!`), and `body_prefix` carried in by
  struct update (`PageConfig { ..base }`).
- Props built from data at run time (`JSON.parse('{"dangerouslySetInnerHTML": …}')`,
  a key assembled from variables): the lint reads the names written in the
  source.
- `h()` given a tag only known at run time (`h(tag, …)`).
- `update()` on a mount handle the file does not see made or does not hold
  under a plain name: one passed in as a parameter or reached in a callback
  (`Promise.resolve(mountMarkup(…)).then((h) => h.update(s))`); one kept in a
  collection or a property (`[mountMarkup(…)][0].update(s)`,
  `map.get('w').update(s)`, `{ w: mountMarkup(…) }.w.update(s)`,
  `const [w] = [mountMarkup(…)]`); one returned by a wrapper in the same file
  (`function mount(r, s) { return mountMarkup(r, trustedHtml(s), …) }`, then
  `const w = mount(r, s); w.update(s)` or `mount(r, s).update(s)`: the wrapper's
  own call is listed once, and every `update` after it is unseen); and
  `Reflect.get(w, 'update')(s)` or a key held in a variable (`w[k](s)`).
- The browser's own sinks (`innerHTML`, `insertAdjacentHTML`, `document.write`,
  `Element.setHTMLUnsafe`, `document.createElement('script')`): not Forma's
  exits, and what Trusted Types refuses in the browser (DR-20).

## When Do You Need This?

| Scenario | Need @getforma/build? |
|----------|----------------------|
| Learning / prototyping | No — use Vite |
| Production with Vite only | No — Vite handles it |
| Production with content hashing + compression | Yes |
| Rust SSR with `forma-server` | Yes — emits FMIR + manifest |
| Multiple route entry points | Yes — handles multi-page builds |

## Compiler vs Build

| | `@getforma/compiler` | `@getforma/build` |
|---|---|---|
| What it is | Vite/esbuild plugins | Full build pipeline |
| Use case | Add to existing Vite config | Replace your build script |
| `h()` → `template()` transform | Yes (Vite plugin) | No — bundles your source as written |
| Content hashing | No | Yes |
| Compression | No | Yes (Brotli + gzip) |
| Manifest | No | Yes |
| SSR IR emission | Plugin only | Integrated (loads the compiler when `ssr: true`) |
| Install | On its own | Alongside the compiler if you need SSR (optional peer dependency) |

## Part of the Forma Stack

### Frontend (TypeScript)

| Package | Description |
|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | Reactive DOM library — signals, h(), islands, SSR hydration |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | FMIR compiler and esbuild SSR plugin |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | **This package** — bundling, hashing, compression, manifest |

### Backend (Rust)

| Package | Description |
|---|---|
| [forma-ir](https://crates.io/crates/forma-ir) | FMIR binary format — parser and native HTML walker |
| [forma-server](https://crates.io/crates/forma-server) | Axum middleware — SSR page rendering, asset serving, CSP headers |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://github.com/getforma-dev/create-forma-app) | `npx @getforma/create-app` — scaffolds a Rust server + TypeScript frontend project |

## License

MIT

The recurring Chromium worker checks run the real `build()` output, including a
lazy module without a script tag. They verify cache replacement, network refusal,
offline reads and gzip/brotli decoding, then exercise two tabs through alternating
deployments, upgrade, rollback and retirement using `forma-server`'s actual
off-worker response. The release rehearsal injects its unpacked build package into
the same harness and requires every named observation. Its HTTP-cache clearing is
limited to the fresh browser context so HTTP caching cannot mask CacheStorage.

When `codeSplitting` is enabled, one physical entry may be configured both as an
SSR entry and with `ssr: false`. The Browser root keeps its whole-page mount;
the SSR root keeps only its activation policy. Both use the same captured
compiler sources and share ordinary dependencies, including core, in one graph.
Each logical Browser root executes its own entry body. Ordinary imports of that
physical entry retain its SSR identity; a re-exporting facade does not opt into
a second whole-page mount. Keep reusable components and module singletons in
ordinary shared modules and declare the mount source itself as the Browser
entry.

### JSX SVG namespaces

With the default `h` JSX factory imported from `@getforma/core` (or the legacy
`formajs` alias), lexical SVG children such as `<svg><a><title>Icon</title></a></svg>`
are created in the SVG namespace. HTML inside `foreignObject`, `desc` and `title`
and the existing MathML integration points keep their original namespace.
The build emits a private per-file factory; it adds no code to core. Props,
spreads and children evaluate once in their original order, before element
creation. The compiler composes these edits with adoption hooks on the same
captured source for SSR and Browser entries, leaving native IR unchanged.

Inline function children and control-flow callbacks within the JSX subtree inherit
that lexical namespace; JSX in an attribute expression does not.
This applies to lexical JSX. A separately declared component returning `<a>`
has no known lexical SVG parent; use the existing `svg()` scope or a known-parent
reactive child for that case. Handwritten `h` calls are unchanged. An authored
custom JSX factory, automatic JSX runtime, or a file with an inner custom `h`
binding retains its own factory behavior. The existing script construction
refusal and the deferred dynamic SVG title adoption limitation still apply.

The actual native/CSR/adoption namespace vectors are exercised by
`e2e/ssr/namespaces.spec.ts`; unit controls cover evaluation order, source drift,
SSR/Browser ownership, custom factories and generated-name collisions.
