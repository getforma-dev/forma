# Islands — hydrating server-rendered HTML

Registered components receive one declared props object. The compiler binds each
literal `activateIslands({ Counter })` registry entry to its schema, mode and
identity digest; applications do not construct this metadata themselves.

```tsx
import { activateIslands, createSignal } from "@getforma/core";

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

This is the 3.0 development contract. Legacy `(element, props)` registrations,
`data-forma-props` and `#__forma_islands` no longer provide SSR state. Rebuild the
page and browser entry together. An uncompiled SSR callback is refused; a
Browser-shell route remains an ordinary browser mount without this preflight.

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

Verified by `src/dom/__tests__/island-state.test.ts` and
`src/dom/__tests__/island-state-activation.test.ts`.

### Server-rendered lists

Server rows carry `data-forma-key` matching the `keyFn` output, wrapped in a
`<!--f:l0-->` / `<!--/f:l0-->` marker pair that delimits the list region:

```html
<div data-forma-island="0" data-forma-component="TrackList">
  <ul>
    <!--f:l0-->
    <li data-forma-key="1">Track 1</li>
    <li data-forma-key="2">Track 2</li>
    <!--/f:l0-->
  </ul>
</div>

<!-- The generated head state contains the same declared items; the generated
     host also carries its occurrence and compiled digest. -->
```

The client island seeds a signal from `props.items` and passes it to
`createList`:

```ts
import { activateIslands, createSignal, createList, h } from "@getforma/core";

activateIslands({
  TrackList: (props: { items: { id: number; name: string }[] }) => {
    // Seed from server data — NOT createSignal([])
    const [items, setItems] = createSignal(props?.items ?? []);

    // Root must match the island root (<div data-forma-island="0">) —
    // a tag mismatch makes adoption bail and re-render fresh.
    return h("div", null,
      h("ul", null,
        createList(
          items,
          (item) => item.id,
          (item) => h("li", null, item.name),
        ),
      ),
    );
  },
});
```

Keys are compared as strings — `data-forma-key="1"` matches `(item) => item.id`
for `id: 1`. Matched rows are adopted in place without re-rendering; unmatched
client items render fresh, and unmatched SSR rows are removed (the two warnings
above).

If **no** row carries `data-forma-key`, adoption matches rows by index, which is
right only when the client array is the one the server rendered. So it first
checks the count. When the number of server rows differs from the array's
length (more items, fewer, or none at all, as before a signal is seeded), no
row is adopted, removed or rendered. The island keeps the server's rows and is
marked `error`, and the error `FORMA_E_HYDRATE_LIST_COUNT`, naming both counts,
is logged in every build and passed to `onError` handlers with the source
`'hydration'`. An island in `error` is inert. The listeners attached during
adoption are removed, on the server's elements and on those adoption built
through `h()` before the failure. The bindings it adopted are disposed, also
when you call `hydrateIsland()` yourself and your root lives on.

Adoption runs in a batch. A signal its code writes during adoption (in a `ref`,
say) takes its new value at once. The effects that write triggers elsewhere,
in another island or another `mount()` root, run when adoption ends. So what
they build is theirs: it keeps its listeners and its bindings if this island
fails. Adoption's own bindings still run when they are created. This holds
for any adoption that fails part-way. Nodes adoption had already replaced or
added before the failing list (a tag mismatch, a keyed row the server did not
render) stay as it left them. `mount()` and `hydrateIsland()` keep
`data-forma-ssr` on the container and do not throw, as for
`FORMA_E_HYDRATE_NODE` below. Equal counts adopt every row in place, and after
adoption the list reconciles by key as usual. This check is the bridge until the
server writes keys for every list (decision brief DR-8).

The server writes an empty list region when the list's data is not an array.
So a list the client computes for itself, inside a server-rendered island,
leaves the island inert unless its array starts empty. Start that list's signal
empty and fill it after activation, or render the list in the browser only. An
island whose only server content is an empty list region (comments, no element
or text) is rendered in the browser instead, like any island with no server
content.

Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "marks the island error with FORMA_E_HYDRATE_LIST_COUNT and removes or adds no row"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "a server region with no rows and a client array with items fails the island and inserts nothing"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "equal counts adopt 40 unkeyed rows in place by index, as before, and keep reconciling"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "rows that carry data-forma-key keep matching by key when the counts differ"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "an island failed by the row count keeps no handler or binding that adoption attached before the list"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "an island failed by the row count answers no click on the nodes adoption built fresh before the list"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "hydrateIsland() called directly keeps no binding it adopted before the list failed"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "a failing island's ref that writes a shared signal does not detach another island's new list row"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "a failing island's ref that writes a shared signal does not detach another island's new show branch"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "a failing mount() whose ref writes a shared signal does not detach a second mount() root's new row"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "a failing island's ref that writes a shared signal does not detach a client-rendered mount() root's new row"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "another island's row created while a failing island adopts keeps its reactive binding"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "the migration: an empty server region adopts an empty array, and rows filled after activation render"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "an island whose only server content is an empty list region is rendered in the browser, not checked"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "onError receives FORMA_E_HYDRATE_LIST_COUNT from activateIslands, mount() and hydrateIsland(), and each keeps the server rows"

### Server data flow

The server captures declared inputs when each island starts. The browser
projects fresh per-instance values, then calls the compiled unary component.
Its signals therefore start with the server values before effects run. Current
adoption still writes lifecycle status and may perform existing DOM repairs;
zero-write successful adoption and transactional mismatch handling are separate
FORMA-104 work, not claims of this state-preflight change. Later updates use the
same signals and ordinary keyed reconciliation.

---

## What adoption does with Fragments, form controls, `textarea`, `title` and SVG

**Fragments.** A component may return a Fragment (`<>…</>`, `h(Fragment, …)`
or `fragment(…)`) at a `mount()` root, at an island root, inside an element or
as a `createShow` branch. The server renders a Fragment's children in place, so
adoption walks them in place: their handlers and bindings attach to the
server's nodes. A root `createShow` or `createList` with no wrapping element is
adopted the same way.

**A component that returns a DOM node.** Returning the island's own element, a
node inside it, or a fragment it already appended into the element (and so
emptied) means the component wired the server's DOM itself: the island
activates as usual. A node built while hydrating that is not part of the
server's HTML cannot be adopted. The server's DOM stays as served, and the
error `FORMA_E_HYDRATE_NODE` is logged in every build and passed to `onError`
handlers with the source `'hydration'`. `activateIslands` marks that island
`error` and carries on with the others. `mount()` and
`hydrateIsland()` keep `data-forma-ssr` on the container and do not throw;
`mount()` also disposes the effects the component created. A component that
returns nothing (an island that sets up its own effects) still activates.

Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "a root Fragment binds its click handler and reactive text after mount() adoption"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "a Fragment at an island root is adopted, each island on its own"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "a root createShow or createList is adopted against the container's children"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "an island that returns its own element stays active and keeps updating"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "an island that returns a detached DOM node is marked error with its code, its sibling unaffected"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "mount() of a detached DOM node keeps the server DOM, logs the code, disposes its effects and does not throw"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "an island that appends a fragment into its element and returns it, now empty, stays active"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "onError receives FORMA_E_HYDRATE_NODE from activateIslands, mount() and hydrateIsland()"

**Form controls.** What a user enters between first paint and activation is
kept. For a bound `value`, `checked` or `selected`, adoption first compares the
control's live state with the default its markup gives it (`value` with
`defaultValue`, `checked` with the `checked` attribute, a select's selection
with its `selected` options). If they differ, the user changed the control, and
adoption writes nothing to it. If the control already holds the client's value,
adoption writes nothing either, attributes included. Only an untouched control
the server rendered differently gets the client's value. A control the user
changed and then set back to its default counts as untouched. Every update
after activation is written to the live property, so a controlled input follows
its signal again from then on.

Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "keeps text typed into an input before activation, then follows later updates"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "adoption writes nothing when the server and the client agree"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "repairs an untouched control the server rendered with another value"

**`textarea` and `title`.** The HTML parser reads these elements' content as
text, so a hydration marker inside one is not a comment: it shows in the text
and, in a textarea, in the value a form submits. forma-ir 0.2.1 writes no
markers there, and the runtime binds their reactive text by the element. A
textarea's reactive text is its default value, as it is when client-rendered:
the value follows it until the user types, and after that an update changes
what a form reset restores, not the user's text. Bind the `value` prop for a
controlled textarea. For one release the runtime also accepts the marker text
older servers write: adoption removes it when it accounts for the whole
difference from the client's text, and leaves text that only looks like a
marker alone.

Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "binds a marker-free textarea by the element and writes nothing when it agrees"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "keeps text typed into a marker-carrying textarea before activation"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "keeps server text that only looks like marker text, edited or not, without a write"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "after the user types, a textarea's reactive text changes only its default, client-rendered and adopted alike"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "binds a title's reactive text by the element, with or without marker text"

**Inline SVG and MathML.** These are adopted like any other element: the nodes
stay the server's, so focus and state inside an icon survive activation. The
parser keeps an SVG or MathML tag's case (`clipPath`), and adoption matches it
exactly; an HTML element matches a tag in any case. Where adoption must create
an element, it creates it in the namespace the parser gives that place. This
covers what the server rendered differently or left out, a show branch it left
empty, a keyed row it did not render, and every later toggle or row. Inside an
SVG element that namespace is SVG, inside a MathML element MathML, and HTML at
the parser's HTML integration points (a `foreignObject`, `desc` or `title`; a
MathML `mi`, `mo`, `mn`, `ms` or `mtext`; an `annotation-xml` whose `encoding`
is `text/html` or `application/xhtml+xml`) and in HTML. A `title` it creates in
an SVG is an SVG `title`, and an `svg` is SVG wherever it appears.

The parser still differs in three cases of markup that is not valid there:
- an HTML element such as `p` or `div` put directly in SVG or MathML, which the
  parser moves out of it and adoption leaves where it is;
- an `svg` directly inside a MathML element that is not an integration point
  (an `mrow`), which the parser makes a MathML element;
- a MathML name inside SVG, which the parser makes an SVG element.

`h()` creates an `svg` in SVG and a MathML name in MathML wherever it appears.

Client rendering gives the same namespaces where `h()` knows the parent: a
`title` or an `a` built inside `svg()`, or as a reactive child, a control-flow
branch or row, a portal or a `mount()` into an SVG. One written as a child
argument outside `svg()` is built before its `svg` exists and is HTML. See the
SVG and MathML section of [API.md](API.md).

**Reactive attributes.** An attribute the server already rendered with the
client's value is not written at adoption, on any element; every later change
is. Setting an attribute to the value it has is still a DOM write, and for an
`iframe`'s `src` it reloads the frame.

Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "adopts a server-rendered inline SVG with no DOM write and no re-created node"
Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "adopts case-sensitive SVG tags such as clipPath and linearGradient in place"
Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "rebuilds a mismatched SVG child in the SVG namespace, title and a included"
Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "creates the content of a foreignObject in the HTML namespace"
Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "creates MathML the server did not render in the MathML namespace"
Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "writes nothing where the server already holds the value, and still writes every change"
Verified by `src/dom/__tests__/svg-namespace.test.ts` > "an icon built in svg() has the namespaces and markup the parser gives the server HTML"
Verified by `src/dom/__tests__/namespace-resolution.test.ts` > "a show branch the server left empty, the branches it toggles to, and fresh keyed rows"
Verified by `src/dom/__tests__/namespace-resolution.test.ts` > "adoption creates what the server left out of a desc or an mtext in HTML, and an svg in SVG anywhere"

---

## Browser-only components: `browserOnly()`

Some components cannot render on the server: a chart that measures the
viewport, a map, an editor. Wrap such a component in `browserOnly()`, the one
marker for a subtree that renders in the browser alone (one name, so a search
finds every use):

```ts
import { activateIslands, browserOnly, h } from "@getforma/core";

// chart.tsx: declared once, at the top level of a module.
export const Chart = browserOnly((props: { title: string }) =>
  h("canvas", { "aria-label": props.title }),
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

## What adoption skips today

Adoption has no handling for the constructs below, so a server-rendered page
that uses one is not adopted as written (FORMA-016). Since compiler 0.3.7 each
is reported at build time with its code, file and line, and `@getforma/build`'s
strict mode makes it an error; the way out is to render the subtree in the
browser with `browserOnly()`, or to write it as a construct the server renders.

What each one does, measured in Chromium on a `mount()` root built with
compiler 0.3.7 and activated by this runtime, with a counter button after the
construct:

| Construct | What a server-rendered page gets today | Build code | Instead |
|---|---|---|---|
| A plain array child: `{rows.map(r => <li>…</li>)}` without `createList` | The server renders an empty island shell nothing registers; adoption skips the array, so the rows never appear. The rest of the page activates | `BUILD-701` | `createList(rows, keyFn, (r) => …)`, or `...CONST.map(…)` over a module-level const |
| The same in a reactive child: `{() => rows.map(r => <li>…</li>)}` | The server renders empty text; after activation the page shows the elements as text, `[object HTMLLIElement],[object HTMLLIElement]`. The rest of the page activates | `BUILD-701` | The same |
| `createErrorBoundary` | The server renders an empty shell where it stands, and **activation throws** `TypeError: Failed to execute 'insertBefore' on 'Node': parameter 1 is not of type 'Node'`: nothing after the construct activates (the button stays dead) | `BUILD-702` | Move the boundary out of the server-rendered tree |
| `createSwitch` | The same: activation throws, and nothing after it activates | `BUILD-703` | A `createShow` per case |
| `createPortal` | No error, and the rest of the page activates, but the portal's content never appears: the server's empty shell stays where it stood | `BUILD-704` | Create the portal from an effect after activation |
| `createSuspense` | The same as `createErrorBoundary`: activation throws, and nothing after it activates | `BUILD-705` | Render the loaded state from server data |

A reactive child that returns an element, `{() => c() ? <el /> : null}`,
renders right on the server, but adoption binds it as text: beside the
server's element the page shows `[object HTMLElement]` (or `null`), and the
element is never removed. Write it as `createShow(() => c(), () => <el />)`.
Client-rendered, all of these work.

Whether adoption learns these constructs, with parity vectors and a browser
fixture each, or 3.0.0's compiler refuses them in a server-rendered component,
is decided for 3.0.0 (DR-1).

---

## Hydration triggers

Control when an island hydrates via `data-forma-hydrate`:

| Trigger | When it hydrates | Use case |
|---|---|---|
| `load` (default) | Immediately on page load | Above-the-fold content |
| `visible` | When the island enters the viewport | Below-the-fold components |
| `idle` | During browser idle time | Non-critical functionality |
| `interaction` | On first `pointerdown` or `focusin` | Skeleton + skin pattern |

```html
<div data-forma-island="1" data-forma-component="Comments" data-forma-hydrate="visible">
  <!-- JS loads only when scrolled into view -->
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
