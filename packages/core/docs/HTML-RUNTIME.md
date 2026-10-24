# The HTML Runtime — reactivity with no build step

Load the runtime, then hand reviewed markup to an explicit mount. No npm or bundler is required. Loading the runtime alone never binds the page.

```html
<script src="/vendor/formajs-runtime.global.js"></script>
<main id="counter">
  <div data-forma-state='{ "count": 0 }'>
    <p data-text="{count}"></p>
    <button data-on:click="{count++}">+1</button>
    <button data-on:click="{count = 0}">Reset</button>
  </div>
</main>
<script src="/counter.js"></script>
```

The application's `counter.js` names the tier and retains the lifecycle handle:

```js
const root = document.getElementById('counter');
const counter = FormaRuntime.mountMarkup(root, FormaRuntime.trustedHtml(root.innerHTML), { tier: 'reviewed' });
```

This uses the same signal graph as `h()` and JSX. Omitted grants give no fetch, outside-DOM or navigation authority. `trustedHtml()` marks an application-owned raw entry; it is not a sanitizer.

Verified by `src/__tests__/readme-examples.test.ts` > "the intro counter works without eval"

## A complete widget

```html
<div data-forma-state='{
  "query": "",
  "items": ["Apples", "Bananas", "Cherries", "Dates", "Elderberries"],
  "darkMode": false
}'>

  <!-- Two-way binding: type in the input, the list filters instantly -->
  <input data-model="{query}" placeholder="Search fruits...">

  <!-- Computed value: derived from query, updates automatically -->
  <p data-computed="matchCount = items.filter(i => i.toLowerCase().includes(query.toLowerCase())).length"
     data-text="{'Found ' + matchCount + ' results'}"></p>

  <!-- Conditional rendering: show/hide based on state -->
  <p data-show="{query.length > 0 && matchCount === 0}">No matches found.</p>

  <!-- List rendering: keyed reconciliation, only changed items re-render -->
  <ul data-list="{items.filter(i => i.toLowerCase().includes(query.toLowerCase()))}">
    <li>{item}</li>
  </ul>

  <!-- Event handling: mutate state directly from the markup -->
  <button data-on:click="{darkMode = !darkMode}">Toggle Dark Mode</button>

  <!-- Dynamic classes and attributes -->
  <div data-class:dark="{darkMode}" data-bind:data-theme="{darkMode ? 'dark' : 'light'}">
    Theme is: <span data-text="{darkMode ? 'Dark' : 'Light'}"></span>
  </div>

  <!-- Persist to localStorage: survives page refresh -->
  <div data-persist="{darkMode}"></div>
</div>
```

Reactive state, two-way binding, computed values, conditional rendering, list
rendering *with filtering*, event handling, dynamic classes, dynamic attributes
and `localStorage` persistence. Hand this reviewed markup to `mountMarkup(root, trustedHtml(markup), { tier: 'reviewed' })` as above; retain the handle for updates and disposal.

That block is not illustrative. It is **extracted from this file at test time**
and mounted, so the documentation and its proof cannot drift — editing it into
something the grammar does not accept fails the suite, and so does deleting it.
A second copy is served in Playwright under a real
`Content-Security-Policy: script-src 'self'` response header, with the browser
console asserted to report zero violations.

Verified by `src/__tests__/readme-flagship.test.ts` > "the documented block renders exactly what this page says it renders"
Verified by `src/__tests__/readme-flagship.test.ts` > "typing in the data-model input filters the list and the count"
Verified by `src/__tests__/readme-flagship.test.ts` > "binds every directive in the block with zero diagnostics"

---

## The expression grammar is an allowlist, not a blocklist

Expressions are evaluated by an **allowlist AST interpreter** (`src/expr/`):
lexer, precedence-climbing parser, validator, tree-walking interpreter. Every
build. There is no `eval()`, no `new Function()`, no `with()` and no switch that
could reach one in any shipped artifact.

Four properties, each mechanical:

- **Identifier resolution never consults `globalThis`.** `document`, `fetch`,
  `window`, `localStorage` and `process` are unreachable rather than blocked —
  only arrow parameters, list-row locals, element magics, your declared state
  and one frozen table of captured intrinsics resolve.
- **A method is never obtained by reading a property of its receiver.**
  `items.filter(…)` applies the `Array.prototype.filter` captured at module
  init, so a state object carrying its own `filter` never contributes one and a
  page script poisoning `Array.prototype` later cannot change what runs.
- **`constructor`, `__proto__`, `prototype`, `call`, `apply` and `bind` are
  denied on the *evaluated* key**, so every spelling — `.constructor`,
  `['constructor']`, `[k]` from server JSON, `['cons' + 'tructor']` — is the
  same case.
- **No loops, no recursion, no function values that escape their callback
  slot.** Every expression terminates by construction; budgets bound cost. A
  built-in call, and an operator that builds or reads a long string, is
  charged before it runs, against 250,000 units (one unit is about the cost of
  an array slot), so `Array.from({length: 12000000})` is refused with
  `FORMA_E_BUDGET` without building anything, while a search that lowercases
  9,000 records is answered, in Greek, Cyrillic or CJK as in ASCII. The
  budget, and the 100,000 steps, are **one per task**: the bindings evaluated
  in one task share them, and a binding that finds them spent by the bindings
  before it renders in the next task instead (SECURITY.md, "Termination and
  budgets"). A `data-list` is not charged to that budget; a pass over it is
  refused, on the list's length and before any row is built, when its rows
  times the weight of a row pass 160,000. A row weighs 1, and 1 more for each
  element and attribute of the row template (a nested `<template>`'s contents
  included), so the cap admits 80,000 rows of `<li>{item}</li>` (weight 2) and
  1,066 rows of the heaviest served row template found (vector-studio's team
  roster with `data-fm` on every element, weight 150). The cap is per pass: the
  lists an outer list's rows hold are made in one task and not bounded together
  (FORMA-255). A refused list reports `FORMA_E_BUDGET` and keeps the rows it
  had. Under the cap a list renders as before, in one task however long it is.
  Show a long list a page
  at a time: ask for the page where the data comes from, or slice it in the
  expression (`items.slice(start, start + 200)`, charged the length of the
  array it reads, so for arrays of up to about 250,000 items).

**Value expressions** — `data-text`, `data-show`, `data-if`, `data-list`,
`data-bind:*`, `data-class:*`, and the right-hand side of `data-computed` —
support: identifiers, `obj.a.b`, `obj?.a`, `obj['key']`, `arr[i + 1]`,
allowlisted method calls (`name.trim()`, `tags.join(', ')`, `Math.round(x)`,
`JSON.stringify(o)`, `Object.keys(o)`), **arrow-function callbacks** in `map` /
`filter` / `find` / `findIndex` / `some` / `every` / `flatMap` / `reduce` /
`sort`, `typeof x`, `!x`, unary `-x`, `? :`, `??`, `&&`, `||`, comparisons,
`+ - * / %`, array literals, object literals, and template literals with `${…}`
interpolation.

**Handler statements** — `data-on:*` — support all of the above plus `x++`,
`++x`, `x--`, `x = expr`, `x += expr` (and `-=`, `*=`, `/=`), the same on a
property path (`item.done = !item.done`, `$el.style.color = 'red'`), bare
method-call statements (`$el.classList.toggle('active')`,
`$refs.myInput.focus()`, `$dispatch('selected', {id})`), `if (cond) { … }` with
optional `else`, and `;`-separated sequences of those. `$event` and `event`
resolve inside them, gated by an allowlist.

A property-path write **mutates in place**: the signal still holds the same
object, so bindings reading it do not re-run. Reassign the root key
(`item = { done: !item.done }`) when the DOM has to follow.

Verified by `src/__tests__/readme-examples.test.ts` > "accepts every value-expression form the grammar section lists"
Verified by `src/__tests__/readme-examples.test.ts` > "accepts every handler-statement form the grammar section lists"
Verified by `src/expr/__tests__/handler-grammar.test.ts` > "a handler statement may be a bare method call"

**Permanently unsupported**, because these are the properties that make it safe:
statements inside expressions; `while` / `for` / `do`; `async` / `await`; arrows
used as values (legal *only* as the callback argument of the nine methods
above); bare calls `f(x)` where `f` is a value held in state; `.call` /
`.apply` / `.bind`; dynamic method lookup; `new`; `delete`; `in`; `instanceof`;
regex literals; `this`; `\u` / `\x` / octal escapes; destructuring; spread; and
any global outside the frozen table. A request to support X is answered by
adding X to a table, never by widening dispatch — see
[`../CONTRIBUTING.md`](../CONTRIBUTING.md).

Verified by `src/__tests__/readme-examples.test.ts` > "the forms this page says are permanently unsupported really are"
Verified by `src/expr/__tests__/adversarial.test.ts` > "no global is reachable by name"

An expression outside the grammar is **not evaluated, and it says so**. It logs
a `console.error` with a stable code and a column, emits a `formajs:diagnostic`
event, appears in `getDiagnostics()`, and marks its element
`data-forma-expr-error="unsupported"` (handlers get
`data-forma-handler-error="unsupported"`). The binding leaves whatever the DOM
already had — it never writes the string `undefined`.

Verified by `src/__tests__/failure-semantics.test.ts` > "a denied expression leaves the previous text in place and never renders undefined"
Verified by `src/__tests__/failure-semantics.test.ts` > "a denied binding does not stop its siblings from binding"

**A built-in that throws on its arguments is reported the same way**, on the
binding that called it, as `FORMA_E_CALL_FAILED`. The message names the method
and the error: `{JSON.parse(payload)}` of a payload that is not JSON reports
`JSON.parse() threw SyntaxError: …`, and `{(1).toFixed(500)}`,
`{(1).toString(1)}`, `{Object.keys(user)}` while `user` is `null`,
`{[].reduce((a, b) => a + b)}`, `{$el.matches('#1')}` and
`$el.classList.add('')` in a handler are reported the same way. One bad payload
costs that binding only: the rest of the markup binds and keeps working. Before
FORMA-271 the exception escaped `mountMarkup` and left the whole module
unbound. A real bug in Forma's own code is still not filed as an expression
failure. Some markup can still throw out of `mountMarkup`, for example a
`data-bind:` or `data-class:` with no name, or a value nested about 10,000 deep
that Forma's own code converts. SECURITY.md, *Known gaps*, lists the paths
found.

Verified by `src/__tests__/runtime-native-throw.test.ts` > "one native that throws costs one binding: every directive reports on its own element and the rest of the module works"
Verified by `src/__tests__/runtime-native-throw.test.ts` > "a real bug in code a native runs is rethrown, not filed as the native failing"
Verified by `src/__tests__/runtime-native-throw.test.ts` > "what can still throw out of mountMarkup: the runtime's own write of a data-bind: with no name, and a value nested 10,000 deep converted to text"

The hardened build is the same runtime under a second, tree-shaken bundling. It
is no longer a stronger guarantee — every build is equally eval-free:

```html
<!-- Historical published 2.1.0 artifact; not the 3.x mount contract. -->
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@2.1.0/dist/formajs-runtime-hardened.global.js"></script>
```

For 3.x, serve the installed `dist/formajs-runtime-hardened.global.js` locally
and use the same explicit mount call shown above. No published 3.x CDN URL is
assumed here.

Verified by `src/__tests__/build-artifacts.test.ts` > "no build emits new Function or a with() scope wrapper"

---

## Directive reference

| Directive | Description | Example |
|---|---|---|
| `data-forma-state` | Declare reactive state (JSON) | `data-forma-state='{"count": 0}'` |
| `data-text` | Bind text content | `data-text="{count}"` |
| `data-show` | Toggle visibility (display) | `data-show="{isOpen}"` |
| `data-if` | Conditional render (add/remove DOM) | `data-if="{loggedIn}"` |
| `data-model` | Two-way binding (inputs) | `data-model="{email}"` |
| `data-on:event` | Event handler | `data-on:click="{count++}"` |
| `data-class:name` | Conditional CSS class | `data-class:active="{isActive}"` |
| `data-bind:attr` | Dynamic attribute | `data-bind:href="{url}"` |
| `data-list` | List rendering (keyed reconciliation); a pass of more than 160,000 rows × row weight is refused with `FORMA_E_BUDGET` | `data-list="{items}"` |
| `data-computed` | Computed value | `data-computed="doubled = count * 2"` |
| `data-persist` | Persist state to localStorage | `data-persist="{count}"` |
| `data-fetch` | Fetch data from URL into a new state key | `data-fetch="GET /api/items → items"` |
| `data-fetch-id` | Name a `data-fetch` so `$refetch` can re-run it | `data-fetch-id="items"` |
| `data-transition:*` | Enter/leave CSS transitions | `data-transition:enter="fade-in"` |
| `data-ref` | Register element for `$refs` access | `data-ref="myInput"` |
| `$event` | The dispatched Event (also spelled `event`) | `data-on:input="{q = $event.target.value}"` |
| `$refetch` | Re-run a `data-fetch` by its `data-fetch-id` | `data-on:click="{$refetch('items')}"` |
| `$el` | Current DOM element (allowlisted properties only) | `data-on:click="{$el.classList.toggle('active')}"` |
| `$dispatch` | Fire CustomEvent (bubbles, crosses Shadow DOM) | `data-on:click="{$dispatch('selected', {id})}"` |
| `$refs` | Named element references | `data-on:click="{$refs.myInput.focus()}"` |

Every `Example` cell above is extracted from this file by the test suite and
mounted on the element shape its directive needs; all of them bind with no
diagnostic, including the last three, which needed the eval fallback until the
allowlist interpreter landed. A row whose example stops parsing fails the suite
by name.

**`data-bind:srcdoc` and `{item…}` in a list row's `srcdoc` are refused.**
The browser parses an iframe's `srcdoc` as a document; escaping does not make
it text. Runtime expressions cannot carry `TrustedHtml`, so v3 emits
`FORMA_E_RUNTIME_SRCDOC` identifying the binding before evaluation or a DOM
write. Neighboring bindings continue. For a reviewed document, use `h()` and
`trustedHtml()` ([API.md](API.md#trustedhtml-the-one-raw-entry)).

Verified by `src/__tests__/runtime-srcdoc.test.ts` > "data-bind:srcdoc is refused with its binding code while neighboring attributes work"
Verified by `src/__tests__/runtime-srcdoc.test.ts` > "a list row's srcdoc is refused with its binding code"

**A `data-computed` may be named like a state key, and may not read itself.**
`data-computed="name = expr"` binds `name` for its scope. Elements bind in
document order, and a reader is evaluated when it binds. If the state also
declares `name`, a reader bound after the computed (on a later element, or
on the computed's own element) reads the computed, and the state's value is
only a placeholder. A reader on an element before the computed's reads the
state value instead, and follows only it: it reads the computed once the key
is next written. A handler that writes `name` writes the state value, which
the readers bound after the computed never see.

A computed whose expression reads its own name (`visitCount = visitCount`,
`x = x + 1`, `n = items.map(i => i + n)`) is refused when it is bound, with
`FORMA_E_UNSUPPORTED` (`computed "x" reads its own name`) reported on its
element like any refused expression, and binds nothing: a state key of that
name keeps its value; otherwise each reader of the name reports
`FORMA_E_UNRESOLVED`. An arrow parameter, a property or a string of that name
is not a read of it. The check is by name, so it is conservative: a computed
in a `data-list` row named after a row local (`item = item * 2`, where `item`
would read the row's item) is refused on every row too, and the rows render
the row local. A computed that cannot compile binds nothing in the same way.

When it runs, only a read of a computed while that computed is being
evaluated is caught: through another computed (`a = b; b = a`), or through a
handler that a `$dispatch` in the computed runs. The read is refused with
`FORMA_E_UNSUPPORTED` (`computed "a" is read while it is being computed`),
reported on the computed's element, and the reader reports it too: a binding
keeps the text it had, a handler stops. That is all it catches. A cycle that
a later change closes, after both computeds already have values, is not
detected: with `a = flag ? b : 1; b = a + 1` and `flag` turning true, `a` and
`b` both answer 2 with no diagnostic. And a computed that cached the refusal
before reading anything that can change keeps it after the cycle breaks,
until the markup is mounted again. None of these throws out of `mountMarkup`;
the rest of the markup binds.

Verified by `src/__tests__/runtime-computed.test.ts` > "a computed may be named like a state key: a reader bound after it reads the computed, and follows what it reads"
Verified by `src/__tests__/runtime-computed.test.ts` > "a reader before the computed in document order reads the state placeholder until the key is next written"
Verified by `src/__tests__/runtime-computed.test.ts` > "a computed that reads its own name is refused on its element, and the state key of that name keeps rendering"
Verified by `src/__tests__/runtime-computed.test.ts` > "a computed that reads its own name and is no state key is refused, and each reader reports the name unresolved"
Verified by `src/__tests__/runtime-computed.test.ts` > "a computed reads its own value only as a free name: an arrow parameter, a property or a string of that name is not a self-reference"
Verified by `src/__tests__/runtime-computed.test.ts` > "a list-row computed named after a row local is refused on every row; the row local still renders"
Verified by `src/__tests__/runtime-computed.test.ts` > "a computed that cannot compile binds nothing either: a state key of its name keeps rendering"
Verified by `src/__tests__/runtime-computed.test.ts` > "computeds that read each other report the cycle on their element and to each reader, never a TypeError"
Verified by `src/__tests__/runtime-computed.test.ts` > "a handler that a $dispatch in a computed runs, and reads that computed, is refused; the computed still renders"
Verified by `src/__tests__/runtime-computed.test.ts` > "a cycle that a later change closes, after both computeds have values, is not detected"
Verified by `src/__tests__/runtime-computed.test.ts` > "a computed that cached a cycle error keeps it after the cycle breaks"

`$el`, `$event` and `$refs` hand expressions a **wrapped** element rather than
the live node, and the wrapper survives every hop, so `$el.ownerDocument`,
`$el.innerHTML` and `$refs.myInput.ownerDocument.location.href` are denials with
a diagnostic rather than answers.

Verified by `src/__tests__/readme-directive-table.test.ts` > "every Example cell in the directive table parses clean"
Verified by `src/__tests__/readme-directive-table.test.ts` > "the three magic-variable rows actually do what the table says"
Verified by `src/__tests__/readme-examples.test.ts` > "data-fetch loads into a state key and $refetch re-runs it, both without eval"

**`data-fetch` gives up after 30 seconds**, `createFetch`'s default timeout. A
request still unanswered then is aborted: its message (`data-fetch timed out
after 30000 ms`) lands in the `error:` target when the directive names one
(`data-fetch="GET /api/items → items |loading:busy |error:failed"`), and the
`loading:` target turns false. Each request of a `poll:` fetch has its own 30
seconds, or the shorter timeout in its fetch grant. Calling `handle.unmount()`
stops every request in flight: its timer is cleared and the request aborted.
Removing the root alone does not dispose it; retain and unmount its handle.

Verified by `src/__tests__/runtime-fetch-timeout.test.ts` > "a data-fetch to a stalled endpoint aborts at 30 s into its error: target"
Verified by `src/__tests__/runtime-fetch-timeout.test.ts` > "a data-fetch answered before 30 s lands in its target and is never aborted"
Verified by `src/__tests__/runtime-fetch-timeout.test.ts` > "each request of a polling data-fetch has its own 30 s"
Verified by `src/__tests__/runtime-fetch-timeout.test.ts` > "handle.unmount() stops a stalled request: its 30 s timer is cleared and the request aborted"
Verified by `src/__tests__/runtime-fetch-timeout.test.ts` > "handle.unmount() stops every in-flight request of a polling data-fetch, and disposal after removing the root does too"

---

## Mounting markup you did not write: tiers and grants

Every 3.x runtime binding belongs to an explicit `mountMarkup()` call, whether
the application wrote the markup or admitted a generated widget. Loading the
script and inserting markup do not bind it. Hand the reviewed markup to an
owned root, name its **tier**, grant only the required authority, and retain
the handle for updates and disposal. For example, a widget allowed to make
GET requests only under its own path is mounted with:

```ts
import { mountMarkup, trustedHtml } from '@getforma/core/runtime';

const widget = mountMarkup(document.getElementById('widget-slot')!, trustedHtml(markup), {
  tier: 'reviewed',
  grants: { fetch: { methods: ['GET'], paths: ['/api/widgets/42/'], cookies: false } },
  config: { name: 'widget-42' },
});
widget.update(trustedHtml(nextHtml)); // reconciled: scopes whose shape is unchanged keep their state
widget.unmount(); // every binding disposed, the root emptied
```

- **Only under the root.** The mount binds the markup it is handed (and what
  `update()` hands it later) under its root, never by watching `body`. The root
  itself is the application's element, not the mount's. The markup is a raw
  sink: pass `trustedHtml(markup)` for the content your
  review admitted. Plain strings are refused with `FORMA_E_MOUNT_ARGS`.
- **Configuration only from the call.** The step budget (`config.exprBudget`,
  default 100,000), the expression diagnostics switch (`config.diagnostics`)
  and containment hints (`config.autoContainment`) come from the call; a
  script tag's `data-forma-*`, `window.__FORMA_RUNTIME_CONFIG`,
  or a server directive map cannot configure a mount. The global setters were removed.
- **Tiers** (decision brief DR-14). `'compiled'`: markup the application's own
  build made. `'reviewed'`: a widget the application reviewed and admitted, on
  its own origin. `'unreviewed'`: content nobody reviewed, which mounts only in a
  document with an opaque origin (an `iframe` sandboxed without
  `allow-same-origin`, where `self.origin` is `"null"`) and takes no grants; on
  any other origin the call throws `FORMA_E_MOUNT_ORIGIN`.

| Grant | What it allows | Without it |
|---|---|---|
| `fetch: { methods?, paths, cookies?, timeoutMs? }` | `data-fetch` with those `methods` (default `['GET']`), to URLs under those `paths` (`'/api/x/'` on the page's origin, or an absolute `https://…/` prefix on another; a prefix without a trailing slash covers that path and the paths below it, never `/api/x-admin`), with the user's cookies only if `cookies: true`, aborted after `timeoutMs` (at most and by default 30,000) | the request is never sent; its `error:` target reads `data-fetch denied: …` |
| `dom: true` | an element outside the mount root through `$el`, `$event` or `$refs`, and a selector that asks about one | `FORMA_E_GRANT_DOM`; the binding writes nothing |
| `navigate: true` | `click()`, which follows a link or submits a form in the user's session, and `$dispatch` of an activation event (`click`, `auxclick`, `DOMActivate`, `submit`, `reset`, in any case), which WebKit or Firefox run as activation | `FORMA_E_GRANT_NAVIGATE`; the click is not made, the event not dispatched |

A grant left out of `grants` is not given; leaving out the entire object also gives none. Every call names its tier. Malformed grants throw `FORMA_E_MOUNT_ARGS`; mounting a root twice throws `FORMA_E_MOUNT_TWICE`, and `update()` after `unmount()` throws `FORMA_E_MOUNT_GONE`.

Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "binds only under the root it is handed: markup injected outside it stays unbound"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a tiered mount takes its step budget from its call, never from a script tag"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "binds all declared directives without a global directive map"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount refuses any origin but an opaque one, and any grant"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "with explicit empty grants a generated tree binds neither data-fetch nor $el.click()"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a fetch grant admits only its methods and path prefixes: %j %s"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a fetch grant's cookies decide the request's credentials"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a fetch grant's timeout shortens the abort"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "$el.click() is denied without navigate and runs with it"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "$dispatch of an activation event needs navigate: %s"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a mount call names a known tier, an element and markup, and mounts a root once"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "takes trustedHtml() markup and refuses look-alikes"

**`$el` stops at the mount root** (L-36). Every hop that yields an element
(`closest()`, `querySelector()`, `querySelectorAll()`, `children`, the first,
last, next and previous element, `$event.target`, `$event.currentTarget`,
`$refs`) hands back an element under the root, or is refused without `dom`.
`closest()` without `dom` walks only up to the root: it never tests an element
outside it, and past it answers `null`, as no match does, so
`$el.closest('body')` reaches nothing and no answer tells an outside ancestor's
attributes apart. A selector is a read of what it names, so without `dom` it
must be local: compound selectors (`li.row:not(.done)`, `[data-key]`,
`:nth-child(2n+1)`), with no combinator, which would ask about an ancestor or
a sibling (`body .row`, `[data-email^="a"] *`), and no `:has()`, `:scope` or
`:host`; `:is()`, `:where()` and `:not()` only over local selectors. What the allowlist
never offers stays unreachable whatever the grants: `parentElement`,
`parentNode`, `ownerDocument`, `getRootNode()`, `offsetParent`, `shadowRoot`,
`assignedSlot`, `form`, `labels`, `list`, `ownerSVGElement`, the node
siblings, `$event.relatedTarget`, `$event.composedPath()`, `$event.view`.

Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "$el.closest('body') reaches nothing without dom"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "closest() without dom never tests an element outside the root: an outside ancestor's attribute cannot be read a character at a time"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "matches() and querySelector(All)() cannot read past the element through %s"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "no hop from $el reaches past the mount root: %s"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a selector that reads past the element needs dom: %s"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "no property or method outside the allowlist reaches another element, granted dom or not: $el.%s"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "no event field outside the allowlist reaches another element, granted dom or not: $event.%s"

**`data-fetch` under a mount** treats a status outside 200-299 as an error:
`data-fetch answered HTTP 404` lands in the `error:` target and the data
target keeps what it had. `$refetch` reaches only the fetches of its own mount.

Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a 404 with a JSON body lands in the error: target, not the data target"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "$refetch reaches only the fetches of its own mount"

**Every denial is a coded diagnostic**, whatever the mount's `config.diagnostics` says: a `formajs:diagnostic` event, once per mount and expression,
whose `detail` is `{ kind: 'grant-denied', code, grant, mount, tier, expr,
reason, count }`, with `code` one of `FORMA_E_GRANT_FETCH`, `FORMA_E_GRANT_DOM`
and `FORMA_E_GRANT_NAVIGATE`. An application counts denials per tier from it.

Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a seeded denial raises one coded diagnostic, whatever the page's diagnostics switch says"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a mount takes its diagnostics switch from its call, not the page"

**Writing grants from observed use.** In a [development
build](STABILITY.md#development-builds), `handle.grantsUsed()` returns the
grants the mount has used so far, written as grants: the methods and exact
paths its `data-fetch` sent and whether the user's cookies went with them,
`dom: true` if it reached past its root, `navigate: true` if it clicked. Mount
a widget under the default, exercise it, and the report is the grant set to
review (L-36: a set derived this way takes effect once the founder approves
it, after the hostile corpus has run). A production build returns `null`.

Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "the development report lists exactly the grants a fixture widget used"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a production build carries neither the grant report nor the obsolete manual-switch warning"

**The preview frame** is where tier `'unreviewed'` renders.
`dist/formajs-frame.global.js` is its runtime: one classic, self-contained
script, the same bytes from the same sources, with no `</script`, `<!--` or
source map comment, so a server writes it inline into the frame document and a
policy allows it by its SHA-256 hash (forma-server's `PageResponse::frame`;
an application's build writes it, minified, into its assets as `forma-runtime.js`,
FORMA-175, which is not core's CDN alias of the same name). Core's file is
unminified and uncompressed, about 158 KB raw (38 KB gzipped; the README's
size table gates the gzipped figure); like every file published to npm it
stays readable. The build writes a minified copy of it into the application's
output instead (about 81 KB raw, FORMA-190 and FORMA-275; its hash is the one of the bytes
served), and the server inlines that into every frame document it serves
under `no-store`, so the application still compresses those responses (gzip
or brotli at its server or its edge) rather than serving the bytes as they
are. `@getforma/build`'s size report (`previewFrame: true`) carries the served
bytes as its frame document row.
It renders into
`<div id="forma-frame">` and never mounts the page or watches `body`. The host
posts one message carrying one `MessageChannel` port at the frame's first load
(`iframe.contentWindow.postMessage('forma-frame', '*', [channel.port2])`); the
frame takes the first such message whose source is its parent and stops
listening on its window. On the port it accepts only `{ type: 'module', html }`
(the first mounts it with `tier: 'unreviewed'` and no grants, each later one
updates it; it mints the module with `trustedHtml()`, so the frame's policy can
require Trusted Types) and sends only `{ type: 'ready' }`, `{ type: 'resize', height }`
and `{ type: 'error', code, message }`: a refused message (`FRAME_E_MESSAGE`),
a module it could not render (`FRAME_E_RENDER`), and each diagnostic the
runtime raised for the module, with its own code. A module's own
`$dispatch('formajs:diagnostic', …)` is not forwarded, but a real
diagnostic's message quotes the module's expression, so the host treats every
`error`'s text as the module's, untrusted. The host's half (the `iframe`'s
`sandbox="allow-scripts"`, checking each message's schema, tearing the frame
down on a second load) is the application's.

A module renders no `<link>` and no `srcdoc`. WebKit opened a connection to
any host a `<link rel="preconnect">` named (its `href` written or bound) from
inside the frame, which no CSP directive governs, and for one inside an
`<iframe srcdoc>`'s child document too. An unreviewed mount parses its markup
once, in the root's own context, removes every `<link>` and every `srcdoc`
attribute from those nodes (nested `<template>` contents included), writes
the nodes themselves rather than a string the root would parse again (a
second parse can create a `<link>` the first did not show, through foreign
content and foster parenting), and checks the live subtree after every write:
anything found there is removed and the render refused, the root cleared. A
`data-bind:srcdoc` is refused in this tier before it runs. Each is reported,
`FORMA_E_UNREVIEWED_LINK` or `FORMA_E_UNREVIEWED_SRCDOC` (the frame forwards
it to the host as an `error`). Under the frame's policy no `<link>` would have
done anything else; an `<iframe>` still renders, with `src` refused by the
policy and no document of its own.

A module styles itself with `style` attributes only. The frame's policy
allows styles by nonce (`style-src 'nonce-…'`, with `style-src-attr
'unsafe-inline'`), and the runtime, allowed by its hash, has no nonce to give
a `<style>` element, so a module's `<style>` blocks do not apply.

Verified by `src/__tests__/runtime-frame.test.ts` > "takes one port from its parent, renders each module in tier (c) and answers only ready, resize and error"
Verified by `src/__tests__/runtime-frame.test.ts` > "ignores a port from any window but its parent, and every port after the first"
Verified by `src/__tests__/runtime-frame.test.ts` > "refuses every message but the module, and changes nothing"
Verified by `src/__tests__/runtime-frame.test.ts` > "forwards the runtime's diagnostics, never a module's own formajs:diagnostic"
Verified by `src/__tests__/runtime-frame.test.ts` > "a module's <link> never reaches the frame document, and the host hears why"
Verified by `src/__tests__/runtime-frame.test.ts` > "a module's srcdoc never reaches the frame document, and the host hears why"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount renders no <link>: each is removed before the markup reaches the document"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount parses its markup once, in the root's context, and writes no string to the root"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount renders no srcdoc: the attribute is removed, a binding that would write one is refused, and each is reported"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount fails closed: a <link> that reaches the root after the strip is removed, reported, and the markup refused"
Verified by `src/__tests__/runtime-frame.test.ts` > "the frame runtime is one classic script a server can inline as it is"
Verified by `src/__tests__/runtime-frame.test.ts` > "two builds of the frame runtime are byte-identical"

**The shared responsibility** (v2 10.1). The application chooses each mount's
tier and passes grants only for content whose hash matches what its reviewer
approved, keeping the hash, the grants and the approver together (L-47);
markup whose hash differs mounts only in tier `'unreviewed'`. Forma enforces
what the mount grants. It cannot check which tier content deserves.

## Migrating the 2.x runtime bridge

3.0 removes runtime `initRuntime`, `destroyRuntime`, `mount`, `unmount`, `reconcile`, `setDebug`, `setDiagnostics` and `setDirectiveMap`. These names refer to the HTML runtime entry; the component entry's `mount()` remains available.

Replace an automatic or tierless binding with `mountMarkup(root, trustedHtml(markup), { tier, grants, config })`; replace `reconcile()` with the returned `handle.update()`, and dispose with `handle.unmount()`. A script import, DOMContentLoaded, DOM insertion or state-attribute edit never creates bindings. The handle disposes its bindings even if their scope moved or was detached. Unmount nested handles before replacing their enclosing content.

Move diagnostic and budget settings to each call's `config`. There is no global debug or directive-map setter. `data-forma-mount="manual"` is obsolete and may be removed: development logs `FORMA_W_MANUAL_MOUNT_REMOVED` once with the replacement call; production contains no warning. Script `data-forma-*` configuration and `window.__FORMA_RUNTIME_CONFIG` do not change a mount.

Verified by `src/__tests__/runtime-explicit-mount.test.ts` and the actual packed-runtime explicit controls in `e2e/hostile-widgets/explicit-controls.mjs`.

---

## Where to go next

- [`../CSP.md`](../CSP.md) — the full CSP story: what a strict policy blocks,
  what FormaJS does instead, and the diagnostics you get when an expression is
  refused.
- [`API.md`](API.md) — the programmatic API (`createSignal`, `h()`,
  `createList`, …) that the same signal graph powers.
- [`CDN-AND-EXPORTS.md`](CDN-AND-EXPORTS.md) — which build to load, and the
  subpath exports.
- [`design/CSP-SAFE-EXPRESSION-GRAMMAR.md`](design/CSP-SAFE-EXPRESSION-GRAMMAR.md)
  — the design record behind the grammar: why it is a subset, where the line is
  drawn, and which alternatives were rejected. It is history, not a description
  of current behaviour; this page and [`../SECURITY.md`](../SECURITY.md) are.
