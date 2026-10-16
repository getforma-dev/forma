# Diagnostics

The current [server-renderable subset and build diagnostic catalogue](../packages/compiler/docs/subset.md) live with the compiler. Native handler and browser runtime diagnostics remain below.

The [pre-FORMA-101 build catalogue](archive/FORMA-101-strict-subset/docs/DIAGNOSTICS.md) preserves the superseded warning-only and placeholder behavior.

## Declared handler diagnostics (FORMA-102)

These codes are returned as structured Rust errors/warnings. Bind errors identify route/property and TypeScript/Rust source positions when available; checked-value errors include the array index in the property path. No listener should open until binds succeed, and a failed render returns no HTML.

| Code | Meaning |
|---|---|
| BIND-101 | A declared TypeScript field is absent from Rust, including an optional field. |
| BIND-102 | Rust and TypeScript field kinds differ. |
| BIND-103 | Optional Rust data cannot satisfy a required TypeScript field. |
| BIND-104 | String enum literal sets differ. |
| BIND-105 | Rust metadata is malformed, recursive or outside the closed schema. |
| BIND-106 | Declared SERVER roots are missing, duplicated, undeclared, defaulted or mistyped. |
| BIND-107 | Unknown page/route or logical manifest alias. |
| BIND-108 | A browser-only or removed route has no SSR contract. |
| BIND-109 | Logical page alias matches more than one route. |
| BIND-201 | Extra Rust field: warning; omitted from encoded data. |
| RENDER-401 | Integer outside JavaScript's exact safe range. |
| RENDER-402 | Non-finite floating point value. |
| RENDER-403 | Date outside JavaScript's supported epoch-millisecond range. |
| RENDER-404 | Value projection does not match the bound closed schema. |
| RENDER-405 | A changed development module cannot bind to the existing handler; includes BIND causes. |

See [declared props](DECLARED-PROPS.md) for optional-field precedence, safe dates and reload behavior.

### Startup completion and explicit browser rendering

| Code | Boundary | Meaning |
| --- | --- | --- |
| BIND-110 | finalize | Declared SSR route has no verified handler; startup remains open for repair. |
| BIND-111 | bind | Registry is finalized; bind before finalization or create a fresh registry. |
| BIND-112 | startup/reload | Route names/modes changed; restart and bind the new topology. |
| RENDER-103 | browser shell | Route is absent or is not explicitly Browser. |
| RENDER-104 | document assets | Manifest or referenced resource integrity is invalid; no unchecked tag is emitted. |
| RENDER-105 | static SSR | Declared islands, executable request configuration or effective module preloads require a JavaScript entry; no response is produced. |
| LOAD-109 | startup/reload | A parsed island module is paired with an empty SSR JavaScript list. Startup refuses; debug reload retains the prior valid module/manifest pair. |
| RENDER-406 | typed render | Registry has not successfully finalized; no response is produced. |

### Native island request state

| Code | Boundary | Meaning |
| --- | --- | --- |
| RENDER-501 | island snapshot | Declared ordered input mapping or projected value is invalid; includes route, component and field path. No partial page is returned. |
| RENDER-502 | island snapshot | Complete escaped UTF-8 state envelope exceeds 1,048,576 bytes, including envelope/commas/escapes. Exactly the limit is accepted. |
| RENDER-503 | keyed list row | FORMA-181 (DR-8): a `LIST` named by FMIR section `0x0006` writes each row's canonical key (`docs/parity-rules.md`, "Keyed rows") as the row root's `data-forma-key`. The render is refused, naming the LIST's bytecode offset, the zero-based row and the key path, when the row's value at the path is missing, declared twice, behind a non-object, or not a string or a safe integer; when two rows of one list execution share a canonical key (both row ordinals are named; the key itself never is, as it is row data, and each execution of a LIST, including an inner LIST under each outer row, is its own scope); when the row renders anything at its own level but exactly one root element, optionally wholly enclosed by one registered child's `<!--f:iN-->` envelope (text, a conditional or list range, a second element, an envelope beside the root); when the row closes an element it did not open or leaves one open; or when that root carries an authored `data-forma-key`, static or dynamic. A key longer than what is left of the output budget is refused before it is built, as `RENDER-301`'s output limit. The whole page is refused: no partial HTML or state envelope reaches a client that could not adopt it. The walker's `IrError::InvalidListKey` carries the same fields (`ListKeyViolation`, `ListKeyReason`). |

State is captured before an island body runs, so later list-row changes cannot alter an earlier occurrence. Only declared fields are disclosed; absent/null optional object fields are omitted and optional array positions remain null. Final response size includes the state script and all document metadata; exceeding the inherited/request output limit returns the existing `RENDER-301`. Body-only work counts remain available on that error.

### FORMA_E_MOUNT_SSR Whole-page SSR mount is retired

The DOM `mount()` target carries `data-forma-ssr`. The call throws before
component/root/effect/listener creation and does not change the target or its
contents, including an empty server-marked root. Use declared
`activateIslands({ Counter })` for SSR interaction. Browser routes and explicit
`browserOnly` islands remain supported. Public direct `hydrateIsland()` remains
a separate caller-owned API; it does not regain compiled registration authority.
This is a staged FORMA-105 boundary pending the compiler, FORMA-104 adoption and
template successor integration.

## Staged island adoption diagnostics (FORMA-104)

This is the approved target contract for the pending FORMA-104 activation
integration. Private preparation/lifecycle helpers already use several of these
codes; the complete host event, diagnostic location and status behavior below is
not a claim about the currently exported activation path. No new callable public
API is introduced by this catalogue update. Ordinary CSR error handling remains
unchanged.

| Code | Boundary | Meaning and corrective action |
| --- | --- | --- |
| `FORMA_E_HYDRATE_NODE` | node matching; retained code | The expected node kind, tag or namespace does not match the served node. Keep the server and client component structure consistent; adoption does not replace the node. |
| `FORMA_E_HYDRATE_LIST_COUNT` | list matching; retained code | Server and client row counts of an unkeyed list differ. Supply the same initial rows; adoption does not trim or append rows to repair the mismatch. |
| `FORMA_E_HYDRATE_KEY` | keyed list matching (FORMA-181) | A served keyed row and the client's items do not pair by canonical key: a key on one side only, a served key twice, a served row without `data-forma-key` beside keyed rows, two client keys with the same canonical text (1 and `"1"`), or a client key outside the domain (not a string or a safe integer, or a string with an unpaired surrogate). Refused before any row runs, writing nothing. Give the client the server's rows (in any order) with their own keys. |
| `FORMA_E_HYDRATE_MARKER` | marker validation | A required marker is missing, malformed, duplicated, out of range or incorrectly nested. Preserve the compiler/native marker grammar and paired output. |
| `FORMA_E_HYDRATE_STRUCTURE` | structural validation | A claimed node/range, topology or ownership relationship is invalid or changed during preparation, or the private walker cannot validate the context. Do not move or replace the prepared structure before commit. The [private raw noscript limitation](../packages/core/docs/ADOPTION-PREPARATION.md) also uses this code. |
| `FORMA_E_HYDRATE_VALUE` | initial value/default validation | Initial text, attributes, branch/list values or normalized control defaults disagree with the served content/state, or a prepared observation was invalidated. Fix the initial server/client disagreement; do not rely on an early user edit to hide it. |
| `FORMA_E_HYDRATE_INPUT_TARGET` | early edit transfer | An edited control has no authenticated component-local reversible binding, or its edited value cannot be converted by that binding's explicit codec. Use an eligible local binding; an untouched read-only binding is allowed. Static initialization preserves edits without seeding. |
| `FORMA_E_HYDRATE_INPUT_CONFLICT` | early edit transfer | Multiple edited controls propose incompatible values for the same actual local signal. Resolve the conflicting edits before retrying; traversal order cannot choose a winner. |
| `FORMA_E_HYDRATE_EFFECT` | live callback failure | An owned effect, live binding or event callback fails after commit. Correct the throwing application callback; its adopted owner is disposed, while unrelated owners remain live. |
| `FORMA_E_HYDRATE_REF` | deferred ref failure | A deferred ref callback fails after commit. Correct the ref; its adopted owner is disposed. |
| `FORMA_E_HYDRATE_COMPONENT` | component construction | Component construction throws before commit. Correct the component; prepared subscriptions/listeners are disposed and served content is retained. |

The planned production and development notification is one bubbling
`forma:error` event from the failed island host per owner, with frozen detail:

```ts
{ island: componentName, occurrence, binding: number | null, code, path? }
```

`binding` is a deterministic island-local adoption traversal index, not an FMIR
slot, signal ordinal or identity input. It is `null` before a binding can be
identified. `path`, when available, describes structural location such as a
branch or list-row occurrence. The detail contains no props, request-state
payload, input values or thrown error object. Existing `onError`/console
reporting can be secondary; it does not replace this planned event.

For a framework mismatch or component failure before commit, the planned
failure path preserves the original nodes/content and performs only the
required `data-forma-status="error"` write, once. It does not repair, mount a
fallback, attach partial listeners or seed controls. The earlier FORMA-103
state/schema/identity preflight remains a distinct zero-write refusal. After
commit, a callback failure disposes its owner and reports once, retaining the
DOM as last written; application writes that occurred before the throw are not
claimed to be rolled back. Successful adoption records active ownership
internally and does not require a success-status or SSR-marker cleanup write.
