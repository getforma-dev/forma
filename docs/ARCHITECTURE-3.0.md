# Forma 3.0 architecture

Forma is one repository and seven coordinated packages. TypeScript components compile to FMIR v3; Rust renders the binary module with typed request data; the browser adopts declared islands using signals. Static page markup stays outside island activation. This describes the implemented 3.0 contracts; release acceptance is recorded separately by the [release gates](release/3.0-GATE-DISPOSITIONS.md) and the published release record.

## Packages and boundaries

| Package | Owns |
| --- | --- |
| `@getforma/compiler` | The admitted native source subset, declared props/schema, island identity and FMIR emission |
| `@getforma/build` | Entry bundling, route manifest, asset identities/integrity, compression, size reporting and deployment retention |
| `@getforma/core` | Signals, DOM construction, checked island adoption, updates and the explicit HTML runtime |
| `@getforma/create-app` | The minimal and dashboard templates and their coordinated dependency seeds |
| `forma-ir` | Binary parsing/validation, props conversion and native HTML walking |
| `forma-ir-derive` | The Rust `PageProps` derive |
| `forma-server` | Startup binding, typed render handles, complete responses, assets and explicit Browser mode |

The repository directories are `packages/`, `crates/`, `e2e/` and `scripts/`. The old standalone repositories are historical inputs to the monorepo, not separate current release units.

## Build, render and activate

The compiler proves the native subset without executing application data. Unsupported source produces a coded build error. Native islands and list rows have one stable Element root; lists use admitted callable sources and stable keys. Explicit `browserOnly` islands or Browser routes describe client rendering instead of silently replacing a failed native compilation. See the [admitted subset](../packages/compiler/docs/subset.md) and [parity rules](parity-rules.md).

The build emits the FMIR module, JavaScript entries, CSS/assets and a manifest with route modes and deployment identity. The server loads every declared SSR module, binds its schema to the Rust props type and finalizes the route set before listening. `PageHandle<P>::render` accepts typed request data and returns a complete `PageResponse` or a coded error. Browser shells are explicitly selected. A bad SSR module or render never silently becomes a client page. See [declared props](DECLARED-PROPS.md) and the [server API](../crates/forma-server/README.md).

Native HTML includes the marker/key vocabulary and one bounded inert head-state block. Compiler-bound registrations associate an island's identity with its schema and component. Activation validates original document claims and state before invoking components. Each SSR island adopts existing nodes without an initial repair write; a mismatch refuses that island while healthy siblings remain eligible. Signals and keyed/indexed updates retain ownership after activation. See [islands](../packages/core/docs/ISLANDS.md) and [indexed replacement](../packages/core/docs/API.md#indexed-item-replacement).

A static SSR route has no executable JavaScript entry. An explicit Browser route has a separate construction path. The HTML runtime is another deliberate entry: callers mount through an owner with an explicit security tier and grants. Importing it does not automatically scan or start the document. See the [upgrade guide](UPGRADING-3.0.md) for each public transition.

## Security and compatibility

The FMIR reader validates the binary envelope and bounded structures before walking. The server's response owns nonce, enforced CSP and security headers; Trusted Types constrain client HTML sinks. Shared name/URL rules and native/browser value rules enforce the same boundary across producers. Untrusted preview content uses the reviewed frame policy and explicit runtime capabilities. Server functions, the WASM walker and Node rendering are removed. The detailed contracts remain [FMIR](FMIR-FORMAT.md), [response and Trusted Types](TRUSTED-TYPES.md), [INV1](INV1.md) and [compatibility](compatibility.md).

Deployment identity couples served HTML and JavaScript. A mismatch remains inert or follows the bounded reload policy; retained assets support rolling upgrades and security revocation. The packed skew drill verifies these transitions rather than assuming matching package labels prove matching deployment bytes.

## Qualification and release

R17 checks the integrated source; the blocking parity harness compares native and browser products. P17 runs against all seven packed artifacts with workspace builds unavailable, including both templates, internal fixture applications, security and deployment drills, and recorded performance measurements. Independent review and green applicable CI precede merge commits. Publishing uses the trusted-publishing workflow and immutable version tags.

The current release decisions are documented in [gate dispositions](release/3.0-GATE-DISPOSITIONS.md): N2 is28,000 Forma gzip bytes per route, the decoder criterion follows L61, and L62 requires a one-hour fault-free packed-RC CI burn-in after RC qualification and the independent whole-release audit. Live identity/protection/alert rollout is explicitly deferred under L60. None of those statements is a claim that pending measurements have passed. External application migrations are outside this release's scope.

The [historical architecture](ARCHITECTURE.md) preserves earlier rationale and APIs. It is not the current API reference; the eventual v3 as-built design record will pin the final release and its actual qualification evidence.
