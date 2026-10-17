# Islands — hydrating server-rendered HTML

Registered components receive one declared props object. The compiler binds each
literal `activateIslands({ Counter })` registry entry to its schema, mode and
identity digest; applications do not construct this metadata themselves.

```tsx
import { activateIslands, createSignal, h } from "@getforma/core";

function Counter(props: { initial: number }) {
  const [count, setCount] = createSignal(props.initial);
  return <div>
    <span>{() => count()}</span>
    <button onClick={() => setCount(count() + 1)}>+1</button>
  </div>;
}

activateIslands({ Counter });
```

The server takes a bounded snapshot of each executed island's declared inputs
from the same values used to render its body. The browser validates every
requested host before arming any trigger or invoking any component. Each accepted
component then runs in an isolated reactive root; a failed sibling does not
prevent another valid island from activating.

`activateIslands()` returns a `Promise<void>` for the requested **load** islands.
Preflight and claim reservation remain synchronous. Load activation starts in a
browser timer task unless first input promotes it sooner. Each timer drain starts
a cooperative 12 ms slice and yields between whole islands. This is not a hard
duration bound on synchronous preflight, an indivisible island, or application
code. Await the result when subsequent code requires load activation to finish.
The promise resolves after those islands activate, fail in isolation, or are
disposed, including requested load work already pending from another call.
Visible, idle and interaction islands complete their part when their triggers
are armed; the promise does not wait for those future triggers. Synchronous
preflight exceptions still throw, and isolated component errors still use the
existing diagnostics rather than rejecting the promise.

Queued load islands listen for pointerdown, focusin and click so their first
input can promote that island synchronously before normal event handling. This
priority path preserves the first event for retained SSR targets and leaves
native default actions intact. Browser-only replacement creates a new target,
which cannot receive an event already dispatching on the old target; callers
that need its handlers ready must await activation. No event is replayed and
no island transaction is split. Input promotion can exceed the
background slice. Other islands continue in FIFO order, and disposal releases
pending activation and its temporary listeners.

This is the 3.0 development contract. Legacy `(element, props)` registrations,
`data-forma-props` and `#__forma_islands` no longer provide SSR state. Rebuild the
page and browser entry together. An uncompiled SSR callback is refused; a
Browser-shell route remains an ordinary browser mount without this preflight.

## Deployment mismatch

Before state preflight or any trigger, `activateIslands` compares the consuming
bundle's build identity with `data-forma-build` on forma-server's actual page
root: the direct body child `div#app`. It does not search arbitrary stamped
elements or descendants. A requested subtree uses its original Document's root,
and the first verdict is retained for that Document. Either identity absent or
empty means unchecked, preserving older servers and bundles built without Forma.

On a mismatch, no island component, observer, timer or interaction listener runs.
Served content and node identity remain intact; island hosts receive
`data-forma-status="skew"`. Core dispatches a cancelable `forma:skew` CustomEvent
on the Document with `detail: { page, bundle, reload }`. `reload` is eligibility
for automatic reload: readable session storage has no record for that full page
identity. Cancel the event to supply application UI instead. Cancellation keeps
the page inert and does not consume eligibility.

Otherwise core records the identity before reloading once. A storage access,
read or write failure leaves the page inert without navigation. The reloaded
Document can report the mismatch again, but cannot automatically reload for the
same identity in that tab. Different identities have separate records.

`mount()` applies the same Document guard before component execution or DOM
replacement and returns an inert disposal callback on mismatch. Public direct
`hydrateIsland` is caller owned and is not gated. Core does not import island
chunks; failures of application-owned `import()` calls remain the application's
to handle. See `src/dom/__tests__/skew.test.ts` and the three-engine
`e2e/skew.spec.ts` checks. The rolling-deployment product drill is a separate
release qualification.

## SSR with server data

Seed local signals from the declared props argument. A server value of 1001 must
reach the signal before its first effect; a bare browser default of 42 would
start from different state. Distinct local signals seeded from the same prop
remain distinct. Imported or lexical shared getters keep their actual identity
and are not recreated from a snapshot.

### Getting props to the island

Every SSR response contains exactly one non-executable
`<script type="application/json" data-island-state>` in its head, including when
there are no islands. The envelope is `{"v":1,"s":[],"i":[...]}`; each occurrence
contains exactly `h` (the compiled digest) and `p` (projected declared props).
The matching original host carries `data-forma-state` and `data-forma-h`.
This is compiler/server output, not a separate manual serialization API.

The complete escaped state envelope is capped at 1 MiB. Every literal `<` in
state strings is escaped. Finite numbers retain their IEEE-754 value, with
negative zero canonicalized to zero; signed epoch milliseconds become `Date`
objects in the browser. Declared arrays, objects and enums are checked before
activation. Optional null object fields are omitted; optional array positions
retain null. Undeclared and forbidden fields never reach the component.

The decoder reads only the first matching head block once per Document.
Malformed envelope data refuses the document; a malformed individual entry
leaves unrelated valid entries eligible. Missing state, mismatched digests,
duplicate occurrence claims, unknown registrations and schema mismatches log
stable `FORMA_E_ISLAND_*` codes and leave the host's content and status unchanged.
They run no component, effect or trigger. Later injected hosts cannot acquire an
original occurrence claim, even through a subtree activation request.

See [the decoder contract](ISLAND-STATE.md) and
[the reviewed wire grammar](../../../docs/proposals/FORMA-103-STATE-WIRE.md).
`sanitizePropsDeep` remains a standalone utility for other data paths; SSR
activation uses declared-schema projection rather than the old generic sanitizer.
The utility mutates and returns the same input. It throws `TypeError` when an
own `__proto__`, `constructor` or `prototype` key cannot be deleted, including
inside frozen or sealed data. Earlier deletions are not rolled back on refusal;
discard that partially sanitized input rather than passing it to a merge or store.
Frozen data without forbidden own keys remains accepted.

Verified by `src/dom/__tests__/island-state.test.ts` and
`src/dom/__tests__/island-state-activation.test.ts`.

## Strict activation

After state preflight, a compiled SSR component describes **one owned Element**
matching its original host. Preparation reads and validates the existing nodes,
markers, attributes, text and control defaults before publication. Success makes
zero initial DOM writes: no node replacement, text normalization, SSR-marker
removal or lifecycle-status write. The runtime tracks activation privately; an
unchanged `data-forma-status="pending"` is not evidence that activation failed.
Effects, refs and listeners become live only after the complete plan validates.
Later updates use their owned reactive bindings.

An empty SSR host does not select a browser fallback. Returning an imperative
DOM Node, an appended fragment or no value is not a description and is refused.
Compiled Fragment/Show/List roots are not a substitute for the owned Element.
Keep those ranges inside the component's root. `browserOnly` is an explicit
separate mode, described below.

An initial mismatch leaves the original content and node identity intact. It
performs only the required `data-forma-status="error"` write and emits one
bubbling `forma:error` event for the failed owner. The frozen detail contains
`island`, `occurrence`, `binding` (or null), `code`, and an optional deterministic
`path`; it contains no props or payload. Reporting also reaches `onError` with
source `'hydration'` in development and production. A valid neighbor still runs.
State/identity preflight refusals happen earlier and make **no DOM writes**,
including no status change or activation event.

| Code | Refusal |
|---|---|
| `FORMA_E_HYDRATE_NODE` | Missing or mismatching original node/tag |
| `FORMA_E_HYDRATE_MARKER` | Missing, malformed or mismatching marker range |
| `FORMA_E_HYDRATE_STRUCTURE` | Unsupported description or changed ownership/topology |
| `FORMA_E_HYDRATE_VALUE` | Original text, attribute or control default differs |
| `FORMA_E_HYDRATE_LIST_COUNT` | Initial unkeyed list cannot consume the original range |
| `FORMA_E_HYDRATE_KEY` | A keyed row's identity is missing, repeated, outside the key domain or on one side only |
| `FORMA_E_HYDRATE_INPUT_TARGET` | An early edit has no proven reversible local binding |
| `FORMA_E_HYDRATE_INPUT_CONFLICT` | Multiple edits disagree for one local signal |
| `FORMA_E_HYDRATE_EFFECT`, `FORMA_E_HYDRATE_REF`, `FORMA_E_HYDRATE_COMPONENT` | Owned callback/component failure |

Later failures revoke the owner's callbacks, listeners and reactive work and
report once; they do not undo application writes already made by a callback.
Components themselves are not sandboxed: arbitrary imperative application DOM
writes cannot be rolled back by this contract. Return a supported description.

Verified by `src/dom/__tests__/activation-transaction.test.ts` > "records successful SSR activation internally with zero writes and no duplicate component call"
Verified by `src/dom/__tests__/activation-transaction.test.ts` > "emits one bubbling coded mismatch with only one status write and keeps its neighbor live"
Verified by `src/dom/__tests__/activation-transaction.test.ts` > "preserves write-free identity refusal before execution"
Verified by `src/dom/__tests__/activation-transaction.test.ts` > "never selects a client fallback for an empty SSR host"
Verified by `src/dom/__tests__/activation-transaction.test.ts` > "isolates a postcommit callback failure and emits one production-shaped diagnostic"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "an imperative island returning its own element refuses without running its deferred effect"

### Server-rendered lists

The server delimits a list with `<!--f:l0-->` / `<!--/f:l0-->`. A list the
compiler keys (`createList(items, row => row.id, …)`) has each row's
`data-forma-key` on the row's root, written by the native renderer as the key's
canonical text: a safe integer in decimal (`-0` as `0`), a string under value
rule 1 (`docs/parity-rules.md`, "Keyed rows"). Adoption binds each client item
to the served row whose decoded attribute equals the item's canonical key, in
any order: numeric key 1 matches attribute `"1"`, and a client key `"a\r\nb"`
matches the served `"a\nb"`. For example:

```tsx
import { activateIslands, createSignal, createList, h } from "@getforma/core";

function TrackList(props: { items: { id: number; name: string }[] }) {
  const [items] = createSignal(props.items);
  return <div><ul>{createList(
    items,
    item => item.id,
    item => <li>{item.name}</li>,
  )}</ul></div>;
}

activateIslands({ TrackList });
```

Initial adoption never creates missing rows, removes extra rows or moves a
row (FORMA-181). Each keyed row is walked through a cursor bounded to that row
(its root, or the registered child's `f:i` envelope that wholly encloses it),
so a row cannot consume its neighbour, and a registered child keeps its own
served host, state and occurrence whichever position the client gives it. The
served order is kept until the list source changes; the first real update then
reconciles the client's order against it, moving rows without rebuilding them.
A row's index starts at its position in the client's array. A key on one side
only, a served key twice, a served row without a key beside keyed rows, two
client keys with the same canonical text (1 and `"1"`), or a client key outside
the domain (a fraction, `null`, an unpaired surrogate) refuses with
`FORMA_E_HYDRATE_KEY` before any row runs; text or a range beside keyed rows is
`FORMA_E_HYDRATE_STRUCTURE`, and a row of another shape is the ordinary node or
value refusal. FORMA-123's row-count check is no longer the criterion for keyed
rows. After successful adoption, ordinary keyed reconciliation can insert,
remove and reorder rows.

An unkeyed range is consumed by the actual row descriptions. A logical row can
contain multiple nodes, shared literal Text or no nodes, so its server row count
cannot be inferred from child-element count. LIST_COUNT diagnostics report the
known client item count and exact remaining/exhausted DOM extent instead.
Its client key function still feeds the shared canonical cache: fractional numbers
and lone surrogates refuse with `FORMA_E_HYDRATE_KEY` before any row callback or
DOM write, even when the served range has no `data-forma-key` attributes. Safe
integers and valid Unicode strings are admitted without adding those attributes.
Matching empty ranges remain empty until a later array update; they never
trigger an implicit browser mount. State/props must describe the same initial
items used by the native renderer.

Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "marks the island error with FORMA_E_HYDRATE_LIST_COUNT and removes or adds no row"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "keyed initial count mismatch refuses without removing or replacing any server row"
Verified by `src/dom/__tests__/adoption-keyed-list.test.ts` > "binds reversed client keys to the same served nodes with no write through a microtask and a macrotask, then a real update reorders"
Verified by `src/dom/__tests__/adoption-keyed-list.test.ts` > "compares the decoded attribute with the canonical key text: numbers, -0, line endings and NUL"
Verified by `src/dom/__tests__/adoption-keyed-list.test.ts` > "refuses a key on one side only, a repeated key or a key outside the domain with FORMA_E_HYDRATE_KEY before any row runs"
Verified by `src/dom/__tests__/adoption-keyed-list.test.ts` > "binds keyed registered children by key: each client row matches its own host, state and occurrence"
Verified by `src/dom/__tests__/adoption-keyed-list.test.ts` > "a duplicate served key fails only its own island with FORMA_E_HYDRATE_KEY; the neighbouring keyed island activates"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "the coded message reports known client items and unconsumed DOM without inventing server row counts"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "equal counts adopt 40 unkeyed rows in place by index, as before, and keep reconciling"
Verified by `src/dom/__tests__/adoption-list.test.ts` > "binds reversed served keys to their own rows without moving them"
Verified by `src/dom/__tests__/adoption-list.test.ts` > "adopts multiple-element Fragment rows without wrappers and moves their complete spans later"
Verified by `src/dom/__tests__/adoption-list.test.ts` > "adopts text-only and empty rows with no initial split or synthetic anchors"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "hydrateIsland() called directly keeps no binding it adopted before the list failed"

### Early form edits and exact text

Preparation first validates the decoded initial value against the server's
normalized default, then checks any edit the user made before activation. An
edit cannot excuse a wrong server default. Compiler hooks associate an admitted
binding with its actual component-local default-equality signal tuple; only that
proven binding can seed a reversible text, number/range, boolean or string-array
edit. Captured globals, computed/read-only expressions, custom-equality setters
and guessed setter names do not gain authority. Conflicting edits refuse.
Seeding holds notifications until validation completes, preserving the live
control, focus and selection; dependent updates caused by that earlier user edit
are distinct from the zero-write initial adoption of an untouched page.

A literal initialization with no reactive reader preserves an early edit without
seeding anything. An edited reactive reader without the compiled association
refuses `FORMA_E_HYDRATE_INPUT_TARGET`. This includes public direct hydration.
An edit returned to its original default is indistinguishable from no edit.

`textarea` and HTML `title` use exact RCDATA text, without hydration comments.
The runtime does not strip marker-looking strings from older output. Literal
marker text is valid only when it is the intended matching text. Later textarea
updates control both the live value and reset default, as ordinary CSR does.

Verified by `src/dom/__tests__/activation-transaction.test.ts` > "uses actual compiled local authority to seed an early edit and later control the live value"
Verified by `src/dom/__tests__/adoption-controls.test.ts` > "validates every default before considering an edited readonly binding"
Verified by `src/dom/__tests__/adoption-controls.test.ts` > "does not let an early edit excuse a wrong decoded initial value"
Verified by `src/dom/__tests__/adoption-controls.test.ts` > "preserves static value checked and textarea edits with explicit initial-only observations"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "refuses an edited public reactive input and leaves its later updates inert"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "binds a marker-free textarea by the element and writes nothing when it agrees"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "refuses older textarea marker text without stripping or binding it"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "binds matching title text by the element and refuses older marker-bearing output"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "after the user types, a textarea's reactive text controls its live and default values, client-rendered and adopted alike"

### Existing namespaces, styles and typed markup

Initial SVG/MathML adoption validates the original namespace and node shape;
it does not repair a different tag, missing text marker or missing child. Matching
attributes are not rewritten, including iframe `src`, which would reload even
when assigned the same URL. Later fresh branches and rows resolve namespaces
from each constructed parent. Nested HTML links inside SVG `foreignObject` and
SVG titles inside MathML `annotation-xml` retain their intended namespaces.
Fresh template children belong to `template.content`; later readers keep their
own cleanup lifetime when the fragment moves into its live parent.

Styles are compared through an inert CSSOM model, without assigning a live
style block. The direct facade accepts strings and own-data object fields with
string/finite-number values; accessors, arbitrary coercions and `cssText` refuse.
That facade capability does not extend the compiler's admitted style grammar.

Raw content and `srcdoc` retain the `trustedHtml()` boundary. Matching normalized
raw content is opaque, not interpreted as compiler markers. Empty server content
with a nonempty requested raw value refuses instead of filling it. An initial
null/false raw value allows ordinary fallback children; later raw replacement
tears down their owned work first. The private preparation helper refuses
nonnull raw markup on HTML `noscript` with STRUCTURE because inert normalization
cannot establish the document's scripting mode. Ordinary CSR is unchanged.

Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "adopts a server-rendered inline SVG with no DOM write and no re-created node"
Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "adopts case-sensitive SVG tags such as clipPath and linearGradient in place"
Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "writes nothing where the server already holds the value, and still writes every change"
Verified by `src/dom/__tests__/adoption-materialize.test.ts` > "constructs later nested namespace branches with the actual owned Show adapter"
Verified by `src/dom/__tests__/adoption-postcommit-materialize.test.ts` > "keeps movable template readers and nested compiler conditional values live after insertion"
Verified by `src/dom/__tests__/adoption-content.test.ts` > "refuses a missing or different served style rather than filling or repairing it"
Verified by `src/dom/__tests__/adoption-content.test.ts` > "supports own string and finite-number object fields for the direct hydration facade"
Verified by `src/dom/__tests__/adopt-inner-html.test.ts` > "adoption writes nothing where the server already holds the markup"
Verified by `src/dom/__tests__/adopt-inner-html.test.ts` > "adoption aborts on untyped markup without writing while ordinary CSR can recover"

### Browser mounting and public direct hydration

`mount()` throws `FORMA_E_MOUNT_SSR` on a `data-forma-ssr` target, including
an empty one, before component/root/effect/listener work or DOM writes.
Use compiled `activateIslands({ Counter })` for SSR interaction. Browser-shell
mounting and explicit `browserOnly` remain separate supported paths.

Public `hydrateIsland(component, target)` uses strict preparation under an
explicit caller-owned `createRoot`. It returns the same target. Coded mismatch
reports through `onError` and returns; an initial user exception is cleaned up
and rethrown unchanged. It adds no compiled state or early-edit setter authority.
A marked Element target is the component root; an unmarked target contains it.
Direct root Fragment/Show/List descriptions consume the target's exact children;
this facade behavior does not change the compiled single-Element contract.
The caller must dispose its root when finished.

Verified by `src/dom/__tests__/mount.test.ts` > "refuses a marked %s root by %s before component/root/effects/listeners or DOM writes"
Verified by `src/dom/__tests__/owned-adoption.test.ts` > "forwards a thrown component error unchanged and disposes its caller root"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "compiled island Fragment roots refuse while the public facade adopts independent ranges"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "a root Fragment binds its click handler and reactive text under a caller-owned adoption root"

## Browser-only components: `browserOnly()`

Some components cannot render on the server: a chart that measures the
viewport, a map, an editor. Wrap such a component in `browserOnly()`, the one
marker for a subtree that renders in the browser alone (one name, so a search
finds every use):

```tsx
import { activateIslands, browserOnly, h } from "@getforma/core";

// chart.tsx: declared once, at the top level of a module.
export const Chart = browserOnly((props: { title: string }) =>
  <canvas aria-label={props.title} />,
);

// The page renders it like any component: <Chart title="Sales" />.
// The entry registers it under that name:
activateIslands({ Chart });
```

The compiler records mode `browserOnly`, the declared schema and ordered inputs.
The server emits an empty host plus the same bounded head-state occurrence used
by other islands. The compiled registry wrapper supplies one projected props
argument to `Chart`; its browser implementation renders into the empty host.
A client-rendered page calls the component directly. Without a document it
renders nothing.

Browser-only props use the declared type contract, including objects, arrays,
optional values and server-derived data. Unsupported expressions remain build
diagnostics; they are not silently omitted from the state. A Browser-shell route
(`ssr: false`) has no SSR state block and mounts through its own browser entry.

Verified by `src/dom/__tests__/browser-only.test.ts` > "registered in activateIslands, renders the component in its empty host, from the server props"
Verified by `src/dom/__tests__/browser-only.test.ts` > "called as a component, renders it as any component in a client-rendered tree"

---

## Historical qualification

The earlier compiler 0.3.7 whole-page mount observations and repair behavior are
preserved in the [exact prior guide](archive/2026-10-15-strict-adoption-retirement/packages/core/docs/ISLANDS.md.txt).
They do not describe this strict activation path. Compiler subset completion,
package-size limits and integrated template/packed gates
remain separate development acceptance work; this guide is not a declaration
that FORMA-104 or the complete 3.0 upgrade is finished.

## Hydration triggers

The compiler-generated host includes `data-forma-hydrate` to select when an
already-loaded registration activates. This does not control bundle fetching:

| Trigger | When it hydrates | Use case |
|---|---|---|
| `load` (default) | First available slice, then queued browser tasks | Above-the-fold content |
| `visible` | When the island enters the viewport | Below-the-fold components |
| `idle` | During browser idle time | Non-critical functionality |
| `interaction` | On first `pointerdown` or `focusin` | Skeleton + skin pattern |

```html
<!-- Excerpt of a generated host; its occurrence/hash attributes are omitted. -->
<div data-forma-island="1" data-forma-component="Comments" data-forma-hydrate="visible">
  <!-- Activation waits until visible; this does not defer bundle loading. -->
</div>
```

---

## Scoping to a subtree, and disposal

`activateIslands(registry, root?)` accepts a container to request only its
original document islands. The first call still freezes claims across the whole
Document, so duplicate claims outside that subtree also refuse their owners.
A shadow-only host or later injected host was never in that original document
set and is refused. Deferred activation rechecks the frozen markers immediately
before running the component.

```ts
import { activateIslands, deactivateIsland, deactivateAllIslands } from "@getforma/core";

activateIslands(registry, originalContainer);
deactivateAllIslands(originalContainer);
deactivateIsland(islandElement);
```

Dispose islands before removing their content so their effects and deferred
observers are released. Islands removed inside a `createList` row are disposed
automatically. Disposal accepts any `ParentNode`; it does not grant a new state
claim or make later inserted hosts eligible.

Verified by `src/dom/__tests__/island-state-activation.test.ts` and
`src/dom/__tests__/list-disposal.test.ts`.

---

## Where the wire format is specified

The marker grammar (`<!--f:t0-->`, `<!--f:s0-->`, `<!--f:l0-->`, `<!--f:i0-->`),
the `data-forma-*` attributes and the head-state envelope are
**shared contracts**, not implementation details of this library: the Rust
walker emits them and this runtime consumes them.

- [Island state wire grammar](../../../docs/proposals/FORMA-103-STATE-WIRE.md)
  — canonical identities, declared input bindings and bounded snapshots
- [Stack architecture §3](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE.md)
  — the contracts, and where each one is enforced
- [FMIR format](https://github.com/getforma-dev/forma/blob/main/docs/FMIR-FORMAT.md)
  — the binary the server renders from
