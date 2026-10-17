# @getforma/compiler

[![npm](https://img.shields.io/npm/v/@getforma/compiler)](https://www.npmjs.com/package/@getforma/compiler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

FMIR compiler for [Forma](https://github.com/getforma-dev/forma). Emits binary modules for native Rust SSR while browser bundles keep runtime `h()`.

Add the compiler for Rust SSR; browser-only applications run without it.

The Vite plugins (`formaCompiler`, `formaServer`), `compileFormaJSX` and `transformServerFunctions` were removed in 3.0.0. Use `@getforma/build` and authenticated Rust routes. [The old plugin documentation](../../docs/archive/2026-10-15-legacy-apis/packages/compiler/README.md) is archived.

## Install

These examples target the `3.0.0-beta.1` prerelease and require its coordinated
publication. Select that prerelease explicitly:

```bash
npm install -D @getforma/compiler@3.0.0-beta.1
```

## esbuild SSR Plugin — `formaSsrPlugin`

Emits FMIR (Forma Module IR) binary files for Rust-based server-side rendering. Only needed with the full Forma stack (`forma-ir` + `forma-server`).

```ts
import { formaSsrPlugin } from "@getforma/compiler";

// Used by @getforma/build, not typically called directly
```

Use esbuild `write: false`. The plugin appends `<page>.ir` to the returned
`outputFiles`, alongside the browser output, and never writes files itself.
Publish these files only after the complete esbuild call succeeds. `@getforma/build`
handles publication, rollback and watched generations. `write: true` is refused.

One captured source graph produces the FMIR and browser registration metadata.
A distinct `clientEntryPoint` must resolve the same island declarations as
`entryPoint`; matching spelling alone is insufficient. Source/type edits during
compilation refuse the product and can be retried. Browser routes (`ssr: false`)
do not use this transform. The island table lives inside the binary; callers who want it as data use `generateRealIr(entry)`,
which returns `{ binary, islands }`. (Through 0.2.0 the plugin also dropped a
`<page>.islands.json` sidecar into the output directory — build metadata in the
served asset tree, read by nothing but a since-removed `@getforma/build` step.)

### FMIR v3 compatibility

The compiler emits [FMIR v3](../../docs/FMIR-FORMAT.md): a 24-byte header,
a section table, and required bytecode, strings, slots, islands and page props
schema. CRC-32 covers every byte except its own four-byte field. The writer's
base major/minor/patch comes from the compiler package version. A reader accepts
its own major and writer minors up to its own; patch numbers do not restrict
compatibility. `3.0.0-dev` and `3.0.0` both encode `3,0,0`. Upgrade the renderer
first and follow the [compatibility contract](../../docs/compatibility.md).
Use aligned compiler and Rust packages and rebuild older `.ir` files. V2 modules
are refused with a rebuild diagnostic.

`dumpFmir(binary)` exports the same lossless canonical text as Rust's `dump_ir`,
including section flags, unknown optional payloads and island extension bytes.
`IrEmitContext` exposes schema, key-path and source-position writers for tooling.
Production AST compilation carries the declared page and island contracts and the
proved list key paths. Request data is bound through those declarations, not
through guessed numeric slot IDs or anonymous slot names. See
[declared props](../../docs/DECLARED-PROPS.md) and the format document for the
current wire contract.

### Build diagnostics

The [server-renderable subset and diagnostic catalogue](docs/subset.md) define
what 3.0 can publish. Unsupported native constructs fail the build with a stable
code, original source location, reason and fix. There is no warning-only SSR mode
or placeholder module. `strict: false` and `FORMA_STRICT=0` remain accepted as
compatibility inputs and cannot downgrade an error.

The direct esbuild plugin applies the same policy. `@getforma/build` collects
diagnostics across entries before refusing publication, writes an optional JSON
report, and retains the previous good output. `collectDiagnostics(() =>
generateRealIr(entry))` remains the low-level inspection API; callers must inspect
its diagnostics before publishing any returned bytes.

A callable list source also needs a native value: use a declared array prop or a
closed literal-default signal. The compiler does not evaluate arbitrary getters,
filters or maps. Retired BUILD-303/504 remain reserved; their historical guidance
is archived. The current list key and row-root proofs are described in the subset.

### Browser-only components and native admission

A component declared `const Chart = browserOnly(ChartImpl)` from
`@getforma/core` must be registered in the compiler-visible `activateIslands`
object. Its typed props must be representable by the declared contract. The
compiler emits its authenticated host and state contract without walking its
implementation. An unsupported native component does not implicitly become such
a host. Unregistered or unrepresentable boundaries fail with BUILD-610; the old
BUILD-706/708 dropping/shell behavior is retired. A route that uses only browser
rendering can select `ssr: false` in `@getforma/build`.

### Native sources and ownership

The compiler follows named source components and supported relative imports and
re-exports, including TypeScript/JSX export aliases. Package implementations,
recursive composition and composition beyond three inlining levels are refused.
The [subset catalogue](docs/subset.md) names the admitted constructs and links a
negative and a passing fixture for every page diagnostic.

Server data enters through typed page and island props. A computed server value
belongs in its own declared prop; arbitrary calls, arithmetic, filters and maps
are not evaluated at request time by the native walker. Literal-default signals
and proved prop-seeded signals can supply initial native values. Closed client
values are not addressable handler slots. Duplicate signal getter names across
scopes still report BUILD-503 and now refuse publication; use distinct getter
names or one shared declaration as appropriate.

`createList` needs a callable source proved to read a declared array prop or
closed literal-default signal, a property-path key, and one stable owned Element
per row. A plain array source is BUILD-616; callable but native-unproved data is
BUILD-610. The native writer and client adoption use the emitted key contract.

A value-bound select must own its option state through the same activation
boundary. Independently registered option/optgroup content under a different
owner refuses with BUILD-617. Ordinary unregistered helpers inside the owning
island and registered content under an unbound select remain admitted. The
independent island-root and finite parser-repair proof remains FORMA-139's
release gate, as recorded in the subset document.

### Closed values and diagnostics

The compiler can fold supported literal and module-constant expressions and
initial signal values. Folding does not turn a direct value into a reactive
binding; use a function where the browser should track it. Scalar text,
attributes and conditions obey [the shared value rules](../../docs/parity-rules.md),
including HTML boolean presence and explicit boolean conditions.

An unknown text/attribute value, unsupported props shape, unresolved component,
or literal past the FMIR string-table limit refuses publication. It does not
publish missing markup or a placeholder and leave the browser to repair it.
Historical slot-injection, warning-only and fallback guidance is preserved in
[the pre-FORMA-101 README](../../docs/archive/FORMA-101-strict-subset/packages/compiler/README.md).

## Public entrypoints

The package root exports compilation (`formaSsrPlugin`, `generateRealIr`) and
explicit tooling APIs: `IrEmitContext` and its schema/key-path/source-position
types; `DIAGNOSTIC_CATALOGUE`, `collectDiagnostics`, `diagnosticEntry`,
`formatDiagnostic`, `makeDiagnostic` and their diagnostic types; and FMIR
inspection/encoding (`readFmirContainer`, `dumpFmir`, `encodeFmirSections`,
`crc32`, `baseWriterVersion`, `COMPILER_WRITER_VERSION`, `FmirContainerError`,
`WriterVersion`, `FmirSection`). The release packed-set verifier uses the same
public inspection APIs as consumers.

`generateRealIr(entryPointPath)` drives component analysis, resolution, walking
and emission. Those implementation modules, including `ComponentAnalyzer`,
`walkHTree`, signal scopes and export resolvers, are private. Direct subpath
imports are not package exports. The runtime surface is pinned by
`supported-surface.test.ts`; package verification checks the built artifact.

## When Do You Need This?

| Scenario | Need compiler? |
|----------|---------------|
| Learning FormaJS, building prototypes | No |
| Rust SSR with `forma-server` | Yes — emits FMIR binary |
| HTML Runtime (`data-*` directives) | No — runtime handles everything |

## Peer Dependencies

- `esbuild >=0.17.0` (optional — for esbuild SSR plugin)
- `@getforma/core ^3.0.0` for the current minor; the coordinated `=3.0.0-beta.1` package is the explicit prerelease alternative. Patch differences are compatible.

## Part of the Forma Stack

### Frontend (TypeScript)

| Package | Description |
|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | Reactive DOM library — signals, h(), islands, SSR hydration |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | **This package** — h() optimization, declared props and islands, IR emission |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | Production pipeline — bundling, hashing, compression, manifest |

### Backend (Rust)

| Package | Description |
|---|---|
| [forma-ir](https://crates.io/crates/forma-ir) | FMIR binary format — parser and native HTML walker |
| [forma-server](https://crates.io/crates/forma-server) | Typed SSR and Axum responses — page rendering, asset serving, CSP headers |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://github.com/getforma-dev/create-forma-app) | `npx @getforma/create-app` — scaffolds a Rust server + TypeScript frontend project |

## License

MIT


### Paired entry product transport (staged FORMA-105)

`formaSsrPlugin` requires esbuild `write: false`. After a successful awaited
`build()` or `rebuild()`, call `getSsrEntryProducts(result)` on that exact result
object. Each immutable record identifies the canonical source/browser entry,
page, IR output path and SHA-256, the emitted island definitions and
`browserRequired`. The latter is based on the compiled definition set, including
conditional islands; an unused registration does not make a static page require
JavaScript. This transport does not itself remove browser code or publish files.
The islands-only entry rewrite below is a separate compiler checkpoint. Build
graph/manifest filtering consumes these accepted records; it remains an
integration gate, not a consequence of calling the accessor.

The accessor refuses failed results or replaced/mutated IR outputs. It returns
no native records for an explicit Browser-only build; callers must require one
matching record for every configured SSR entry. A failed native compilation
cannot use placeholder IR to establish a static policy.

Never publish from an early `onEnd`: a later plugin may still refuse the result.
A build integration may read records from its final guarded publisher, after all
other validation hooks; commit them together with that cycle's graph and
manifest. Refused watch cycles retain the previously accepted records and files.
The compiler exposes no mutable `onStart` metadata callback.


### Islands-only browser entries (staged FORMA-105)

A native entry may select its page with a standalone named core import:

```ts
import { mount, activateIslands } from '@getforma/core';
import { HomePage } from './HomePage';
import { Counter } from './Counter';

activateIslands({ Counter });
mount(HomePage, '#app');
```

The paired compiler authenticates that import, emits the original native page,
and omits the mount statement from the browser product. Only definitions
reachable in the emitted native product remain in the literal activation
registry; conditional islands still require JavaScript. The wrapper uses the
original declared component and captured getters. Imports and module
initialization stay in their original modules; no component is copied or
signal recreated. Ordinary bundler tree shaking removes unused pure page code.

A separate `entryPoint` may supply the compile-time native mount while
`clientEntryPoint` is activation-only. If both entries mount a named page, they
must resolve to the same original declaration, including through aliases or
barrels. All registration identities and canonical contracts must still match,
even for unused registrations. Separate inline page functions cannot prove
that declaration identity; use the activation-only browser shape instead.

`BUILD-611` refuses a used/assigned/exported mount result, nested or multiple
mounts, indirect mount aliases, namespace mount access, effectful target
arguments, and ambiguous activation-only Page imports. A named import alias
(`import { mount as render }`) is supported. An actual core namespace binding
may read a statically named non-mount member, including optional access. Dynamic
members and passing/exporting/aliasing/destructuring the namespace are refused
because they cannot prove the mount is absent. Erased type-only uses remain
valid. This conservative check does not apply to arbitrary user objects.
User functions merely named
`mount` are preserved. Empty activation calls may be omitted only as standalone
top-level statements with pure remaining arguments; required effects must be
explicit statements outside them. Nonempty activation root arguments and
surrounding behavior stay intact. Activation inside the removed page mount is
refused. These errors fail builds with or without strict mode.

A zero-island product records `browserRequired: false`; the publisher must keep
its explicit SSR mode/IR while omitting final JavaScript/module-preload links.
The compiler alone does not claim a zero-request route, complete105 acceptance,
or changed package size limits. Browser routes (`ssr: false`) remain normal
client mounts and do not use this native entry rewrite.

Multiple native entry plugins in one esbuild operation share a private
compilation coordinator. It waits for every current `onStart` analysis, checks
that overlapping original source snapshots agree, and composes original-range
entry edits before any file is loaded. Each contributor's source and resolution
guards still run before publication; a refused cycle cannot supply partial
transformation authority. Identical edits may be deduplicated; conflicting
ranges refuse instead of choosing the first plugin.

Ordinary sequential reuse of an esbuild options object is supported, as are
concurrent builds with independent options objects and previously completed
contexts that continue rebuilding. If two setups interleave while reusing the
same options object, the grouping is ambiguous and fails with `BUILD-611`.
Use distinct options objects for concurrent setups (and a fresh options object
after an incomplete failed setup). This coordinator does not add a public
combined-plugin API.

The coordinator collects adoption hooks from every original registration before
loading shared modules, then composes those hooks with entry edits in original
coordinates. Shared helper uses with conflicting writable codecs retain their
signal tuples but receive no setter authority. Each module receives one hygienic
hook import, and unchanged native bytes/contracts remain the authority for
browser registration. This is compiler preparation; the104 adoption transaction
and final combined browser/packed acceptance remain separate gates.
