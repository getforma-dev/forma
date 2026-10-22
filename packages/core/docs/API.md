# Core API

Everything on this page is exported from `@getforma/core` unless a subpath is
named. For the network, storage and runtime entry points see
[`CDN-AND-EXPORTS.md`](CDN-AND-EXPORTS.md); for island hydration see
[`ISLANDS.md`](ISLANDS.md).

---

## The `h()` function

`h()` is the core of FormaJS rendering. JSX components compile to `h()` calls, and hyperscript calls `h()` directly
to create real DOM elements. The separate HTML runtime binds explicitly
mounted markup through its directive engine.

```ts
h(tag, props?, ...children)
```

| Parameter | Type | Description |
|---|---|---|
| `tag` | `string \| Function` | An HTML tag name (`'div'`, `'button'`) or a component function (`Counter`) |
| `props` | `object \| null` | Attributes, event handlers, and component props. Pass `null` or `{}` to skip. |
| `children` | `string \| number \| () => string \| Node \| Array` | Zero or more children — static text, reactive functions, elements, or arrays of any of these. |

### The key rule

**If a child is a function, it is reactive.** FormaJS wraps it in an effect so
the DOM text node or subtree updates when signals inside it change. A plain
string or number is static — rendered once, never touched again.

The same rule holds for props: `class={() => …}` re-runs on signal change;
`class={…}` is evaluated once.

### Patterns

```ts
// Static text child
h("footer", { class: "text-sm" }, "Built with Forma")

// Reactive text child — updates when count() changes
h("button", { onClick: fn }, () => `Count: ${count()}`)

// Multiple children
h("div", { class: "card" },
  h("h2", null, "Title"),
  h("p", null, "Body text"),
  h("button", { onClick: fn }, "Click"),
)

// Children as an array (useful for dynamic lists)
h("ul", null, items.map(item => h("li", null, item.name)))

// Component function with props
h(Counter, { initial: 5 })

// Nested reactive children
h("div", null,
  () => showHeader() ? h("h1", null, "Welcome") : null,
  h("p", null, () => `You have ${count()} items`),
)
```

### JSX equivalence

JSX is syntactic sugar that compiles to `h()` calls. These are identical:

```tsx
// JSX
<button class="btn" onClick={() => setCount((c) => c + 1)}>
  {() => `Count: ${count()}`}
</button>

// h()
h("button", { class: "btn", onClick: () => setCount((c) => c + 1) },
  () => `Count: ${count()}`
)
```

Configure the JSX transform with `jsx: "react"`, `jsxFactory: "h"`,
`jsxFragmentFactory: "Fragment"`. There is no JSX-specific runtime.

---

## Signals

```ts
import { createSignal, createEffect, createComputed, batch } from "@getforma/core";

const [count, setCount] = createSignal(0);
const doubled = createComputed(() => count() * 2);

createEffect(() => console.log("count:", count()));

batch(() => {
  setCount(1);
  setCount(2); // effect fires once with value 2
});
```

**Custom equality** — skip updates when the value has not meaningfully changed:

```ts
const [pos, setPos] = createSignal(
  { x: 0, y: 0 },
  { equals: (a, b) => a.x === b.x && a.y === b.y },
);

setPos({ x: 0, y: 0 }); // skipped — equal
setPos({ x: 1, y: 0 }); // applied — different
```

**Computed with previous value** — the getter receives the previous result:

```ts
const changes = createComputed((prev) => {
  const current = items();
  if (prev) console.log(`${prev.length} → ${current.length} items`);
  return current;
});
```

**Reactive introspection** — type guards and utilities from alien-signals 3.x:

```ts
import { isSignal, isComputed, getBatchDepth, trigger } from "@getforma/core";

isSignal(count);       // true
isComputed(doubled);   // true
getBatchDepth();       // 0 outside batch, 1+ inside
trigger(doubled);      // force recomputation
```

The cost model behind these — what an equal-value write costs, what `batch()`
actually collapses, and where it does nothing — is measured in
[`PERFORMANCE.md`](PERFORMANCE.md), with a noise floor next to every number.

---

## Conditional rendering

```ts
import { createSignal, createShow, createSwitch, h } from "@getforma/core";

const [loggedIn, setLoggedIn] = createSignal(false);

// Two branches
createShow(
  loggedIn,
  () => h("p", null, "Welcome back"),
  () => h("p", null, "Please sign in"),
);

// Multi-branch with caching
const [view, setView] = createSignal("home");

createSwitch(
  view,
  [
    { match: "home", render: () => h("div", null, "Home") },
    { match: "settings", render: () => h("div", null, "Settings") },
  ],
  () => h("div", null, "404 Not Found"),
);
```

---

## List rendering

```ts
import { createSignal, createList, h } from "@getforma/core";

const [items, setItems] = createSignal([
  { id: 1, name: "Alice", art: "/covers/alice.jpg" },
  { id: 2, name: "Bob", art: "/covers/bob.jpg" },
]);

createList(
  items,
  (item) => item.id,
  (item) => h("li", null,
    h("img", { src: item.art, alt: item.name }),
    item.name,
  ),
);
```

Static item fields (`src: item.art`) bake into the element when the row renders
— the row is re-created when its key changes. Function props
(`src: () => coverUrl()`) are reactive and update the attribute in place.

### Indexed item replacement

`createKeyedRows(initial, keyFn)` stores plain items by their canonical keys.
Pass that handle to the two-argument `createList(rows, renderRow)` overload;
the row callback receives a stable read-only item getter and the usual index getter.
Replace items through the handle; passing an argument to the item getter cannot write it.

```ts
import { createKeyedRows, createList, h } from "@getforma/core";

const rows = createKeyedRows([
  { id: 1, label: "Alice" },
  { id: 2, label: "Bob" },
], item => item.id);

createList(rows, (item, index) => h("li", null,
  h("span", { title: () => item().label }, () => item().label),
  h("button", { onClick: () => console.log(item()) }, "Inspect"),
  () => String(index()),
));

rows.set(1, { id: 1, label: "Alicia" });
rows.replace([{ id: 2, label: "Bob" }, { id: 1, label: "Alicia" }]);
```

`set(key, nextItem)` replaces one existing item. Its canonical key must stay
the same; missing keys and key changes throw before any value is published.
Passing the same object is a no-op. Reactive holes read the current item through
`item()`; a one-time read outside a reactive callback remains a snapshot. The
row factory, node identity and index are unchanged by `set`.

`replace(nextItems)` changes membership or order. It validates the complete
dense array and all keys before publishing any retained values, then batches
the change. Retained keys keep their getters and row nodes; removed rows dispose
their views. Several lists may share one handle and dispose independently.
Directly mutating an input object does not notify readers.

Keys follow the keyed-adoption domain: well-formed strings or safe integers.
Numeric `1` and string `"1"` identify the same key; string line endings and NUL
follow the shared text normalization. Duplicate canonical keys, sparse arrays,
fractions and lone surrogates throw. Key callbacks must not reenter mutation
of the same collection. The indexed overload takes no options and supplies
no early-edit writeback authority for editable controls.

For native SSR, create the collection inside the component that returns its
unconditional list, and mutate it through deferred intrinsic event handlers.
The [indexed native subset](../../compiler/docs/subset.md#indexed-row-updates)
defines the declared-data and original-binding proof required for admission.

---

## Store — deep reactivity

```ts
import { createStore } from "@getforma/core";

const [state, setState] = createStore({
  user: { name: "Alice", prefs: { theme: "dark" } },
  items: [1, 2, 3],
});

// Read reactively — tracked at the exact property path
state.user.name;   // "Alice"
state.items[0];    // 1

// Setter API — partial merge
setState({ user: { ...state.user, name: "Bob" } });
setState((prev) => ({ items: [...prev.items, 4] }));

// Or mutate directly — only affected subscribers update
state.user.name = "Bob";
state.items.push(4);
```

> `Object.keys(state)`, `for...in`, and spread (`{...state}`) are **not**
> reactive. Use signals or explicit arrays for collections whose membership
> must react.

A store setter is a sink for untrusted data if you hand it a parsed JSON body:
forbidden keys are stripped, but see the note on prop sanitization in
[`ISLANDS.md`](ISLANDS.md) for where the shallow/deep line falls.

---

## Components and lifecycle

```ts
import { createSignal, defineComponent, onMount, onUnmount, h } from "@getforma/core";

const Timer = defineComponent(() => {
  const [seconds, setSeconds] = createSignal(0);

  onMount(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id); // cleanup on unmount
  });

  return h("span", null, () => `${seconds()}s`);
});

document.body.appendChild(Timer());
```

`onMount(fn)` runs after DOM creation. If `fn` returns a function, it registers
as an unmount callback. `onUnmount(fn)` registers cleanup explicitly. Both feed
the same cleanup queue, so these are equivalent:

```ts
onMount(() => { const id = setInterval(tick, 1000); return () => clearInterval(id); });
onMount(() => { const id = setInterval(tick, 1000); onUnmount(() => clearInterval(id)); });
```

---

## Context — dependency injection

```ts
import { createContext, provide, inject } from "@getforma/core";

const ThemeCtx = createContext("light");

provide(ThemeCtx, "dark");
const theme = inject(ThemeCtx); // "dark"
```

---

## Reducer

```ts
import { createReducer } from "@getforma/core";

const [state, dispatch] = createReducer(
  (state, action) => {
    switch (action.type) {
      case "INCREMENT": return { count: state.count + 1 };
      case "DECREMENT": return { count: state.count - 1 };
      default: return state;
    }
  },
  { count: 0 },
);

dispatch({ type: "INCREMENT" }); // state() === { count: 1 }
```

---

## History — undo / redo

`createHistory` wraps a signal you already have. It takes the `[get, set]`
tuple as its single source argument and returns a **controls object** — it is
not a tuple and must not be destructured as one.

```ts
import { createSignal, createHistory } from "@getforma/core";

const [text, setText] = createSignal("");
const { undo, redo, canUndo, canRedo } = createHistory([text, setText]);

setText("hello");
setText("hello world");

canUndo();  // true
undo();     // text() === "hello"
canRedo();  // true
redo();     // text() === "hello world"
```

`createHistory(source, { maxLength })` caps the stack (default 100, minimum 1).
The full controls object is
`{ undo, redo, canUndo, canRedo, history, cursor, clear, destroy }`;
`canUndo` / `canRedo` / `history` / `cursor` are reactive getters. Call
`destroy()` to stop tracking the source and release the stack.

> **Limitation:** the source getter must return a stable value — a primitive or
> a stable object reference. A `createStore` slice that returns a *fresh proxy
> on every read* is not supported: the undo/redo echo guard compares by
> identity, so every undo would look like an external change and clear the redo
> stack.

Verified by `src/__tests__/readme-examples.test.ts` > "runs exactly as documented"

---

## Error handling

`mount()` fails fast — if the selector does not match, it throws:

```ts
mount(() => h("p", null, "hello"), "#nonexistent");
// Error: mount: container not found — "#nonexistent"
```

Before rendering, `mount` applies the [deployment identity guard](ISLANDS.md#deployment-mismatch). A mismatch leaves the target intact and returns an inert disposal callback.

Otherwise a target carrying `data-forma-ssr` throws `FORMA_E_MOUNT_SSR` before the
component, reactive root, effects or listeners run, and before any DOM write.
Use declared `activateIslands` for SSR interaction. Ordinary Browser mounting
and unmounting are unchanged; public direct `hydrateIsland` remains separate
and requires caller-owned reactive cleanup. Both SSR activation and public direct
hydration now validate the original DOM before publication; neither repairs an
initial mismatch. Compiled activation requires one owned Element and can seed
only compiler-proven local early edits. Public hydration has no such setter
authority. See [strict activation](ISLANDS.md#strict-activation) for diagnostics,
zero-write success and the distinct Browser-only path.

Verified by `src/dom/__tests__/mount.test.ts` > "refuses a marked %s root by %s before component/root/effects/listeners or DOM writes"

**Global error handler** for effects and lifecycle callbacks:

```ts
import { onError } from "@getforma/core";

onError((error, info) => {
  console.error(`[${info?.source}]`, error);
});
```

**Error boundaries** — catch rendering errors with fallback UI:

```ts
import { createErrorBoundary, h } from "@getforma/core";

createErrorBoundary(
  () => h(UnstableComponent),
  (error, retry) =>
    h("div", null,
      h("p", null, `Something went wrong: ${error.message}`),
      h("button", { onClick: retry }, "Retry"),
    ),
);
```

---

## Async — `createResource` and `createSuspense`

`createResource(source, fetcher, options?)` re-runs the fetcher whenever the
source signal changes, aborting the previous request. The returned resource is
callable for the data and carries `loading`, `error`, `refetch` and `mutate`.

```ts
import { createSignal, createResource, createSuspense, h } from "@getforma/core";

const [userId, setUserId] = createSignal(1);

const user = createResource(
  userId,
  (id, { signal }) => fetch(`/api/users/${id}`, { signal }).then((r) => r.json()),
);

user();          // data, or undefined while loading
user.loading();  // reactive boolean
user.error();    // reactive; undefined when fine
user.refetch();  // re-run with the current source

setUserId(2);    // aborts the in-flight request and refetches
```

`createSuspense(fallback, children)` shows `fallback` while any
`createResource` created *inside* `children` is loading. The boundary is
captured when the resource is created, so the resource must be constructed
during the `children()` call.

```ts
createSuspense(
  () => h("p", null, "Loading…"),
  () => h(UserCard),
);
```

---

## SVG and MathML

`h()` creates each element in the namespace the HTML parser gives the server's
markup, wherever it can know it.

- The SVG tags it knows by name (`svg`, `path`, `circle`, `clipPath`,
  `feDropShadow`, …) are SVG, and MathML Core's (`math`, `mrow`, `mi`, `mo`,
  `mn`, …) are MathML, wherever they appear.
- A tag that is both HTML and SVG (`title`, `a`, `script`, `style`, `font`)
  takes the namespace of the content it is built in. Where its parent is known
  that is the parent's: SVG inside an SVG element. It is HTML inside a
  `foreignObject`, `desc` or `title` (the parser's HTML integration points),
  inside a MathML `mi`, `mo`, `mn`, `ms` or `mtext`, and in HTML. The parent is
  known for:
  - a reactive child;
  - a `createShow` branch, `createList` row or `createSwitch` case rendered
    once the helper is in the document;
  - a portal into an SVG;
  - `mount()` into an SVG element;
  - ordinary client-rendered control flow.

  Strict initial adoption validates existing namespaces without creating or
  repairing nodes. Later branches and rows resolve child namespaces from the
  constructed parent, including nested HTML inside SVG `foreignObject` and SVG
  inside MathML `annotation-xml`. These paths have separate adoption controls.
- **A child passed to `h()` is built before its parent exists.** In
  `h("svg", null, h("title", null, "Close"))` the `title` is created first, as
  HTML. Build a hand-written SVG tree with such a tag inside `svg()`, which
  creates it in SVG. That holds for a helper's first render too: inside `svg()`
  it is SVG from the start.

```ts
import { svg, h } from "@getforma/core";

const icon = svg(() =>
  h("svg", { viewBox: "0 0 24 24", width: 24 },
    h("title", null, "Close"),               // an SVG title
    h("a", { href: "#close" },               // an SVG link
      h("circle", { cx: 12, cy: 12, r: 10, fill: "currentColor" }),
    ),
  ),
);
```

Inside `svg()`, build a `foreignObject`'s (or `desc`'s, or `title`'s) HTML
content outside it, where it is created as HTML:

```ts
const card = h("div", null, h("a", { href: "/more" }, "more"));
const chart = svg(() => h("svg", null, h("foreignObject", { width: 100, height: 40 }, card)));
```

A compiler pass that builds compiled JSX this way is a follow-up (FORMA-171).
The shared namespace vectors (`src/__tests__/vectors/namespaces.json`) are run
through `h()` building each child with its parent known, and through each browser's parser and adoption in Chromium,
Firefox and WebKit.

Verified by `src/dom/__tests__/namespace-resolution.test.ts` > "a title or an a passed to h() before its svg parent exists stays HTML, and is SVG inside svg()"
Verified by `src/dom/__tests__/namespace-resolution.test.ts` > "a foreignObject's or desc's content is HTML when built there: an eager child, a reactive child, and content built outside svg()"
Verified by `src/dom/__tests__/namespace-resolution.test.ts` > "a function child inside an svg builds in the SVG namespace on every run"
Verified by `src/dom/__tests__/namespace-resolution.test.ts` > "a createShow inside an svg renders each branch once, in SVG, inside svg() from its first render and on every toggle"
Verified by `src/dom/__tests__/namespace-resolution.test.ts` > "list rows inside an svg are SVG when first rendered inside svg(), and when added or moved later without it"
Verified by `src/dom/__tests__/namespace-resolution.test.ts` > "createSwitch cases inside an svg are SVG, each rendered once, cached cases included"
Verified by `src/dom/__tests__/namespace-resolution.test.ts` > "a portal into an svg, and mount() into an svg, create SVG elements"
Verified by `src/dom/__tests__/namespace-resolution.test.ts` > "h() creates math and its elements in the MathML namespace, and HTML inside a token element, as the parser does"
Verified by `src/__tests__/renderer-contract.test.ts` > "h(), building each child with its parent known, gives every element the namespace the parser gives it, with the same markup"
Verified by `src/dom/__tests__/svg-namespace.test.ts` > "an icon built in svg() has the namespaces and markup the parser gives the server HTML"

---

## Portals

`createPortal(children, target?)` renders `children` into another element
(default `document.body`) and returns a placeholder comment to keep in the
tree. Disposal removes the portalled node.

```ts
import { createPortal, h } from "@getforma/core";

createPortal(() => h("div", { class: "modal" }, "Hi"), "#modal-root");
```

---

## The rest of the export surface

Everything the root entry exports, grouped. The application APIs are stable and typed;
the explicitly marked compiler helper follows the supported compiler/core version window.
The sections above cover application APIs with non-obvious semantics.

| Group | Exports |
|---|---|
| Signals | `createSignal`, `createEffect`, `createComputed`, `createMemo` (alias of `createComputed`), `createResource`, `createRef`, `createReducer`, `batch`, `untrack`, `on`, `value` (wraps a constant as a getter) |
| Ownership | `createRoot`, `createUnownedRoot`, `getOwner`, `runWithOwner`, `onCleanup`, `onError`, `trackDisposer` |
| Introspection | `isSignal`, `isComputed`, `isEffect`, `isEffectScope`, `getBatchDepth`, `trigger`, `getSignalName` |
| Rendering | `h`, `svg`, `Fragment`, `fragment`, `createText`, `mount`, `template`, `templateMany` |
| Control flow | `createShow`, `createSwitch`, `createList`, `createKeyedRows`, `reconcileList`, `createPortal`, `createSuspense`, `createErrorBoundary`, `cleanup` |
| Components | `defineComponent`, `disposeComponent`, `onMount`, `onUnmount`, `createContext`, `provide`, `inject`, `unprovide` |
| State | `createStore`, `createHistory`, `persist(source, key, options?)` — mirrors a `[get, set]` pair into `localStorage` |
| Islands | `activateIslands`, `hydrateIsland`, `deactivateIsland`, `deactivateAllIslands`, `sanitizePropsDeep`, `browserOnly(component)` — a component that renders in the browser alone ([ISLANDS.md](ISLANDS.md#browser-only-components-browseronly)) |
| Compiler internal | `__islandRegistration(component, metadata)` — generated registration with canonical schema, digest and render mode; [internal state contract](ISLAND-STATE.md), not an application bypass |
| Compiler internal | `__adoptionSignal(site, pair)` and `__adoptionWritable(read, getter, codec, site)` retain actual component-local signal identities during strict adoption preparation. `__adoptionChild(undefined, component, args)` defers an admitted child call during private description; outside it the original call keeps its exact argument count. `__adoptionConditional(test, consequent, alternate)` describes an admitted DOM ternary; ordinary execution reads the test once and calls only the selected branch thunk. These helpers grant no claim or setter authority by themselves. The compiled activation path consumes these hooks; public direct hydration remains unprivileged. These exports are not application APIs. |
| Events | `createBus`, `delegate(container, selector, event, handler)`, `onKey(combo, handler, options?)` |
| DOM utils | `$`, `$$`, `addClass`, `removeClass`, `toggleClass`, `setStyle`, `setAttr`, `setText`, `setHTMLUnsafe`, `closest`, `children`, `siblings`, `parent`, `nextSibling`, `prevSibling`, `onResize`, `onIntersect`, `onMutation` |
| Raw HTML | `trustedHtml(markup)` — the one raw-HTML entry, which every raw sink takes ([below](#trustedhtml-the-one-raw-entry)) |

Verified by `src/__tests__/docs-truth.test.ts` > "documents every symbol the root entry exports"

---

## Escape hatches — the trust boundary

FormaJS never builds markup from strings. `h()` creates elements with
`document.createElement` and writes text with `textContent`, which is why
`innerHTML` is not used for library-generated markup. The raw sinks
deliberately parse trusted markup; **none of them sanitizes**, and all are
first-party-content-only sinks. The HTML runtime refuses its two `srcdoc`
binding forms before a sink:

| Sink | Where | What it does |
|---|---|---|
| `dangerouslySetInnerHTML={{ __html }}` | prop on `h()` / JSX | assigns `innerHTML` on the element; `null`, `undefined` and `false` are no prop; give no children beside it (`FORMA_W_INNER_HTML_CHILDREN`) |
| `setHTMLUnsafe(el, html)` | `@getforma/core` | assigns `innerHTML` on the element |
| `template(html)`, `templateMany(html)` | `@getforma/core` | parses the markup into a cached `<template>`, which compiled output clones |
| `mountMarkup(root, html, options)`, then `handle.update(html)` | `@getforma/core/runtime` | parses trusted markup and reconciles it inside the explicitly owned mount; the required options choose its tier and grants |
| `srcdoc` attribute | `h()` and adoption | the browser parses the *attribute value* as a document, so escaping does not neutralize it; anything but a trusted value is refused in development and production |
| `data-bind:srcdoc`, `{item…}` in a list row's `srcdoc` | the HTML runtime | refuses the expression/row binding with `FORMA_E_RUNTIME_SRCDOC`; it does not write an iframe document ([HTML-RUNTIME.md](HTML-RUNTIME.md)) |

Everything else is guarded: URL-bearing attributes (`href`, `src`, `action`,
`formaction`, `xlink:href`, `poster`, `background`, `data`) drop `javascript:`,
`vbscript:` and `data:text/html` values, and `on*` attribute names are dropped
in any casing on the client.

Verified by `src/dom/__tests__/element-url-safety.test.ts` > "drops dangerous URLs from client-created elements"
Verified by `src/dom/__tests__/element-url-safety.test.ts` > "drops ONCLICK-cased string props instead of writing an inline handler"
Verified by `src/dom/__tests__/element-url-safety.test.ts` > "srcdoc requires trustedHtml and strings are refused before the sink"

### `trustedHtml()`: the one raw entry

Every raw sink requires `trustedHtml(markup)`; plain strings are refused. It is the one way to
say that a string is markup someone vouches for, so a search for its name finds
every raw entry in an application, and a consumer's CI can list each one with an
owner and an end date. It sanitizes nothing: pass only markup you control.

```ts
import { h, trustedHtml } from '@getforma/core';

h('article', { dangerouslySetInnerHTML: { __html: trustedHtml(sanitizedMarkdown) } });
h('iframe', { sandbox: '', srcdoc: trustedHtml(previewDocument) });
```

Where the browser has Trusted Types, `trustedHtml()` returns a `TrustedHTML`
made by Forma's policy `forma`, so a page whose policy requires Trusted Types
accepts it at the sink ([`../CSP.md`](../CSP.md#trusted-types)); elsewhere it
returns a frozen stand-in that core's sinks recognise and write as its markup.
The zero-build runtime exports it too (`FormaRuntime.trustedHtml` in the CDN
bundles), for `mountMarkup()` and its returned `MountHandle.update()`.
Reconciliation is internal, not a public runtime export. A `TrustedHTML` from
an application's own policy is accepted as well; TypeScript takes it for the `TrustedHtml` type only
through a cast (`value as unknown as TrustedHtml`).

The v3 type signatures and runtime checks reject raw strings, boxed strings
and look-alikes before parsing or returning cached markup. These checks run
in development and production, even without native Trusted Types. `h('script')`
is also refused. The codes are in [STABILITY.md](STABILITY.md#deprecated-forms).

Verified by `src/dom/__tests__/trusted-html.test.ts` > "every raw sink writes a trustedHtml() value without a warning, and the DOM holds its markup"
Verified by `src/dom/__tests__/trusted-html.test.ts` > "every raw sink refuses strings before parsing, including an already cached trusted value"
Verified by `src/dom/__tests__/trusted-html.test.ts` > "a look-alike object is not trusted HTML"
Verified by `src/dom/__tests__/trusted-html.test.ts` > "every raw sink refuses look-alikes and String objects"

The full threat model is in [`../SECURITY.md`](../SECURITY.md).
