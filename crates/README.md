# Forma Rust workspace

Forma renders compiled TypeScript components as HTML in Rust, without a JavaScript server runtime. The three crates share the coordinated version of the four npm packages in this repository. Start with the [current architecture](../docs/ARCHITECTURE-3.0.md) and [3.0 upgrade guide](../docs/UPGRADING-3.0.md).

| Crate | Responsibility | API reference |
| --- | --- | --- |
| `forma-ir` | FMIR v3 validation, declared-props conversion and the native HTML walker | [README](forma-ir/README.md), [format](../docs/FMIR-FORMAT.md) |
| `forma-ir-derive` | `#[derive(PageProps)]` for typed page data | [README](forma-ir-derive/README.md), [declared props](../docs/DECLARED-PROPS.md) |
| `forma-server` | Startup binding, typed page rendering, explicit Browser shells, assets and response policy | [README](forma-server/README.md) |

## Startup and requests

Load the asset manifest, call `load_ir_modules`, bind each SSR page to its Rust props type, and finalize `Pages` before opening the listener. Invalid modules and incompatible schemas refuse startup. A bound `PageHandle<P>` renders `P` with a `RenderCtx` and returns `Result<PageResponse, RenderError>`; the handler chooses its error response. It never falls back to an empty Browser shell after an SSR failure.

`PageResponse` keeps HTML, nonce, enforced CSP and response headers together. Its Axum `IntoResponse` implementation sends the complete response. `render_browser_shell` is the explicit Browser route path. The typed examples and limits are maintained in the [server README](forma-server/README.md), rather than duplicated here.

There is no WASM walker, Node renderer or server-function endpoint in the 3.0 surface. Applications use their server's own endpoint layer. The [archived A2 overview](../docs/archive/2026-10-16-current-overviews/crates-README.md) retains the previous slot-injection and deprecated fallback APIs for historical reference.

## Verification and publishing

From the repository root, `npm run check` runs R17 across Rust and TypeScript, including the compiler-to-walker contracts and browser adoption checks. See [testing](../docs/TESTING.md) for focused commands and [releasing](../docs/RELEASING.md) for the coordinated seven-package pipeline. A source checkout or passing crate suite alone is not packed-release qualification; P17 verifies the actual package set.
