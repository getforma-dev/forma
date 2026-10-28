# The 3.0 server-renderable subset

This is the published SSR admission contract and the single diagnostic catalogue.
A build must prove its native tree before publication. `@getforma/build` and the
direct `formaSsrPlugin` refuse every error below, including when `strict` is unset,
`strict: false`, or `FORMA_STRICT=0`. The two nonfatal build notes are identified
explicitly. There is no silent placeholder IR or warning-only SSR escape hatch.

## Admitted source

- Literal `h()`/JSX element names and static text, attributes and children; closed
  module constants and the supported static table unrolling forms.
- Attribute props `className`, `htmlFor` and `tabIndex` use native names `class`,
  `for` and `tabindex`, including reactive bindings. Other spellings stay as
  written. One native element cannot repeat an alias-normalized, ASCII-folded
  attribute name, such as `class` with `className` or `tabIndex` with `TabIndex`;
  use one spelling (BUILD-610). HTML tokenization also folds attribute tokens
  on SVG and MathML before their namespace adjustments, so this collision
  proof applies to every native element without rewriting its emitted names.
  A foreign SVG/MathML attribute must also retain its exact spelling and
  namespace after HTML parsing (BUILD-610). Use canonical SVG names such as
  `viewBox`/`preserveAspectRatio`, MathML `definitionURL`, and lowercase
  `data-*`/`aria-*`; `TabIndex` and `data-Foo` on SVG are unsupported. The seven
  standard lowercase XLink names are supported on foreign elements. Parser
  XML/XMLNS attributes and nonstandard XLink names do not match the current
  Browser writer's namespace and require Browser mode or another attribute.
  Exact `xlink:` props on ordinary HTML are likewise unsupported. Ordinary
  HTML mixed-case attributes and component input names retain their behavior.
  Integration-point children use their actual possible namespaces; an unknown
  MathML annotation encoding must prove both HTML and MathML. This lexical
  proof does not widen the downstream ASCII-only attribute-name policy.
- Named local components and relative source imports, including supported export
  aliases, with at most three inlining levels. npm component implementations and
  recursive composition are outside this subset.
- One typed props object containing scalar values, nested objects, arrays,
  optional fields and supported unions. Native reads use proved property paths,
  supported nullish fallbacks, explicit boolean conditions and closed values.
  Compute business data in the handler and pass the result as its own prop.
- Literal-default signals and proved prop-seeded signals. A closed local value
  stays client-owned; a handler cannot fill an invented `text:N`/`attr:` slot.
  Arbitrary function calls, server-data arithmetic, filtering and mapping are not
  a server expression evaluator.
- `createShow` and supported conditional forms with boolean conditions and
  native branches. Boolean text is refused; use the supported `String(flag)`
  form for text. `null`, `undefined` and static boolean children remain empty.
- `createList(source, row => row.id, row => h('li', ...))` with an original core
  call, a source reading a declared array prop or closed literal-default signal,
  a property-path key and one stable owned Element per row. A callable source is
  not enough to establish native rows. Derived rows belong in their own declared
  array prop; use `const [rows] = createSignal([{id:'a'}, {id:'b'}])` for closed
  local rows. Empty arrays are valid values but do not prove a nonempty fixture.
- Registered SSR islands with the current declared input/state contract, or an
  explicitly registered `browserOnly(Impl)` component. A route may opt out of
  SSR with `ssr: false`; no partial native fallback is invented.

## Indexed row updates

`createKeyedRows(initialRows, row => row.id)` and the two-argument
`createList(rows, item => h('li', null, () => item().label))` use the same
native LIST, PROP, and key-path section as the array-getter API. The factory
must resolve to the original core import through immutable local aliases.
Initial rows must be a required declared array (including required ancestors)
or a closed dense literal array. Keys use a synchronous expression callback
reading a literal property path of its own row, and each synchronous row callback
returns one stable Element; row-root helpers must also be synchronous. The item parameter is a zero-argument getter;
read fields as `item().field`, not `item.field`.

The factory eagerly validates all keys in the browser. Its native component
must therefore contain its LIST unconditionally in the same return. Deferred
or conditional LISTs, unused factories, effectful keys and optional initial
arrays refuse with BUILD-622. A native component module cannot eagerly create
a collection at module scope; create it inside the component owning its LIST. Multiple unconditional views of the same handle
are admitted. The runtime API can share independently disposed views; this
compiler restriction does not broaden initial adoption or writable state.
Handle aliases may feed those LISTs. Other handle use must be inside a proved
deferred intrinsic event callback; local named handlers and immutable handler
aliases are admitted when every use stays deferred. Eager set/replace calls,
IIFEs, extracted methods and unknown escapes refuse with BUILD-622. A custom
component onClick prop is not assumed to defer execution. Declared initial arrays
and their ancestors obey the same rule before and after the factory: eager
method calls, writes and unknown escapes refuse. Immutable declared-data aliases,
array-length reads and disjoint prop reads remain supported; this does not widen
registered components’ existing refusal of computed declared values.
Internal item getters never become captured createSignal slots, early-edit
inputs or authenticated writeback sites. Browser-only routes retain ordinary
runtime usage. Existing three-argument list source rules remain unchanged.

## Ownership and parser boundaries

A value-owning `<select>` and its option state must share the same activation
owner. An independently registered option/optgroup island below that select is
refused with BUILD-617, including through ordinary helper components, branches,
lists and relative imports. Keep those helpers unregistered inside the owning
select island, or move the boundary to the select or an outer element. An
unbound select does not acquire value ownership merely by existing.

LIST row-root proof remains BUILD-613. An SSR island must also prove one stable
owned Element (BUILD-621), directly or through immutable local/imported helpers.
A transparent Fragment around exactly one Element is valid. Root Show/List or
conditional markers, text, no root, several roots, and an entire root owned by
another registered island are refused. Keep dynamic ranges and child islands
inside the authored host. A browserOnly component retains its separate server
host. Binding-description inspection alone does not authorize native publication.

BUILD-618 enforces the finite3.0 nesting list through helpers, branches and lists:
p-closing HTML tags; nested a/form; li and dt/dd starts closing an ancestor;
option outside select and nested option/optgroup closing; interactive descendants
of a/button and content beyond a label's one labelled control. Explicit siblings,
nested lists, a label's own control and mutually exclusive alternative controls
remain valid. A repeated list cannot supply one label with several controls.
Attribute-sensitive interactive categories retain their conditions (for example,
input type=hidden and an a without href are not interactive). Disagreeing duplicate
attributes cannot prove a safe category, because HTML and JavaScript may retain
different values. Only an originally unbound `undefined` proves absence. The option/select
rule is this release's deliberately narrow subset, not every current HTML model.

HTML component title is BUILD-619; pass document title to the server render call.
SVG title remains valid. Dynamic/reactive style children are BUILD-620;
use immediate authored literal CSS and pass data through ordinary safe sinks.
Component script elements now refuse BUILD-623 in every namespace and spelling,
including literal, external and inert-type forms, matching core's bundle-only
contract. This explicitly supersedes FORMA-139's former literal-script admission;
its [original source and product](../../../docs/archive/forma-196-native-raw-boundary/README.md) remain unchanged.
Native srcdoc props refuse BUILD-624 because FMIR data has no trustedHtml brand;
use a safe iframe src or an explicit Browser-mode typed raw sink. Literal
null/false stay omitted. Original unbound undefined retains its supported omission;
JSX-lowered void expressions retain the existing strict BUILD-207 refusal.
Named constants and template expressions still enter the existing dynamic opcode
path and are refused here; no separate executable-text evaluator is introduced. Namespaces and
HTML integration points are tracked only to apply these finite checks correctly.
No broader parser-repair inference or general HTML validator is claimed.
See the [finite source corpus](../tests/html-context.test.ts) and
[original products](../../../docs/archive/FORMA-139-html-context/README.md).
Primary references: [in-body parsing](https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inbody),
[a content](https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-a-element),
[button content](https://html.spec.whatwg.org/multipage/form-elements.html#the-button-element),
[label association](https://html.spec.whatwg.org/multipage/forms.html#the-label-element).

## Reports and migration

Each error carries a stable code, original TypeScript/JSX file, line and column,
a reason and a fix. Build-level errors may have no source location. The build
collects all entries before reporting failure; a fatal contract within one page
can stop that page's analysis. `diagnosticsJson` writes the same errors with
`strict: true`, including on failure. Production keeps the last good output and
watch publishes again after a source repair. The low-level `generateRealIr`
inspection API may return diagnostics alongside bytes; only a successful plugin
or build is publication approval.

The original warning/placeholder documentation and tests are preserved in
[the migration archive](../../../docs/archive/FORMA-101-strict-subset/README.md).
BUILD-303, BUILD-408, BUILD-504, BUILD-706 and BUILD-708 remain retired and reserved.
No old number is reused. Diagnostic source positions and fixes are exercised by
[the conformance suite](../tests/diagnostics-conformance.test.ts); each page code
below links its refusal and admitted near miss. The remaining build codes link
their real lifecycle tests.

## Diagnostic catalogue

### BUILD-101 — Unrecognised call in the tree

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Write the subtree as h() calls, a component in a relative file, createShow or createList, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-101/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-101/pass/).

### BUILD-102 — Unrecognised child expression

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Wrap a reactive child in a function (`() => …`), use createShow for a conditional and createList for rows, or fold the value into a module-level const.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-102/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-102/pass/).

### BUILD-103 — Dynamic tag

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Use a literal tag name, or a component the compiler can follow.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-103/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-103/pass/).

### BUILD-104 — Spread child that does not unroll

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Unroll a module-level const array of object literals, or render runtime rows with createList(source, keyFn, (row) => h(…)).

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-104/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-104/pass/).

### BUILD-105 — Spread over a table that is not static

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Declare the table as a literal `const` of object literals in the module it is imported from, with no nested declaration of the same name, or use createList.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-105/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-105/pass/).

### BUILD-106 — createShow branch the compiler cannot follow

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Write the branch inline as `() => h(…)`.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-106/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-106/pass/).

### BUILD-107 — createList the compiler cannot walk

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Write `createList(source, keyFn, (row) => h(…))` with the map function inline and the row parameter named, reading `row.field`.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-107/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-107/pass/).

### BUILD-201 — Props passed as something other than an object literal

**Why.** The attributes have no explicit native representation, so the build refuses publication.

**Fix.** Pass the attributes as an object literal on the h('tag', { … }) call.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-201/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-201/pass/).

### BUILD-202 — Spread props

**Why.** Spread attributes have no proved native representation, so the build refuses publication.

**Fix.** List the attributes explicitly on the h() call.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-202/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-202/pass/).

### BUILD-203 — Prop key the compiler cannot name

**Why.** The native attribute key is not proved, so publication is refused instead of dropping it.

**Fix.** Use a plain identifier or string key.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-203/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-203/pass/).

### BUILD-204 — Method-valued prop

**Why.** An object method (`{ title() { … } }`) has no native binding form, so publication is refused.

**Fix.** Write it as an arrow property (`title: () => …`) for a reactive binding.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-204/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-204/pass/).

### BUILD-205 — dangerouslySetInnerHTML

**Why.** Raw markup has no admitted native tree contract, so publication is refused.

**Fix.** Render the content as h() children, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-205/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-205/pass/).

### BUILD-206 — Reactive attribute the compiler cannot evaluate

**Why.** The reactive attribute has no supported native value, so the build refuses the page instead of publishing HTML with an omitted attribute.

**Fix.** Pass the computed value as its own declared prop, initialize the signals it reads with literal defaults, or fold the value into a module-level const, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-206/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-206/pass/).

### BUILD-207 — Attribute value the compiler cannot evaluate

**Why.** The attribute has no supported native value, so the build refuses the page instead of publishing HTML with an omitted attribute.

**Fix.** Pass the computed value as its own declared prop, inline a literal or module-level const, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-207/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-207/pass/).

### BUILD-301 — Text the compiler cannot evaluate

**Why.** This unresolved dynamic text expression has no closed native value and ends the build with BUILD-610.

**Fix.** Initialize the signals it reads with literal defaults so the server can render them.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-301/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-301/pass/).

### BUILD-302 — Conditional the compiler cannot evaluate

**Why.** The conditional has no proved native value. Publishing its default ELSE branch could differ from the browser, so publication is refused.

**Fix.** Initialize the signals the condition reads with literal defaults.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-302/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-302/pass/).

### BUILD-401 — Component imported from a package

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Compile the component's source in the application (a relative import), or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-401/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-401/pass/).

### BUILD-402 — Component the compiler cannot find

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Import the component from a relative path, or declare it in the calling file.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-402/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-402/pass/).

### BUILD-403 — Composition past the inlining limit of 3

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Flatten the chain so the component sits at depth 3 or less, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-403/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-403/pass/).

### BUILD-404 — Recursive component

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Render the recursion with createList over data, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-404/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-404/pass/).

### BUILD-405 — Component passed a prop the compiler cannot evaluate

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Pass literal values (strings, numbers, booleans, null) as props.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-405/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-405/pass/).

### BUILD-406 — Component the compiler cannot follow

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Return the h() tree directly from the component (an expression body or a top-level `return h(…)`).

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-406/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-406/pass/).

### BUILD-407 — Children passed to a component

**Why.** The compiler cannot place a component's children in the native tree, so publication is refused.

**Fix.** Pass the content as props, or render it inside the component.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-407/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-407/pass/).

### BUILD-501 — Signal default the compiler cannot evaluate

**Why.** The signal has no closed native default, so publication is refused instead of inventing an empty binding.

**Fix.** Initialize it with a string, number, boolean or null literal, or a module-level string const.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-501/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-501/pass/).

### BUILD-502 — Signal declared twice in one scope

**Why.** Duplicate declarations cannot establish one unambiguous native default, so publication is refused.

**Fix.** Declare the signal once.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-502/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-502/pass/).

### BUILD-503 — Signal name taken by another scope

**Why.** The signal name conflicts across scopes and cannot establish one native binding, so publication is refused.

**Fix.** Give the scopes distinct signal names, or declare the signal once and import it.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-503/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-503/pass/).

### BUILD-601 — No mount() call in the entry

**Why.** The compiler cannot find the page, so no native product is emitted and the build refuses publication.

**Fix.** Call mount(() => …, '#app') or activateIslands({ … }) at the top level of the SSR entry, or declare the route `ssr: false`.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-601/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-601/pass/).

### BUILD-602 — Page component the compiler cannot resolve

**Why.** The page component named in mount() cannot be found or read, so no native product is emitted and the build refuses publication.

**Fix.** Import the page component from a relative path that exports it as a function.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-602/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-602/pass/).

### BUILD-603 — Page root that is not an h() call

**Why.** The page returns no native tree the compiler can follow, so no native product is emitted and the build refuses publication.

**Fix.** Return the page tree as h() calls (or JSX).

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-603/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-603/pass/).

### BUILD-604 — Literal past 65,535 bytes

**Why.** FMIR's string table and slot defaults hold at most 65,535 bytes per entry, so this page cannot be encoded and the build refuses publication.

**Fix.** Load content that long at run time (a handler-filled slot or a fetch), or split it into smaller literals.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-604/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-604/pass/).

### BUILD-605 — Module const past 65,535 bytes

**Why.** A module-level const that folds to more than 65,535 bytes is not folded, so every use of it is reported where it is read.

**Fix.** Keep folded constants under 65,535 bytes, or load the content at run time.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-605/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-605/pass/).

### BUILD-606 — Module emission failed

**Why.** The compiler failed while emitting the page and cannot produce a native module. Publication is refused; no placeholder module is substituted.

**Fix.** Report it with the message; until it is fixed, declare the route `ssr: false`.

**Build result.** Error: publication is refused.

[Lifecycle tests](../tests/diagnostics-conformance.test.ts).

### BUILD-610 — Invalid declared page props

**Why.** The declared data or expression cannot be represented by the closed native contract; publication is refused.

This includes multiple props on one element with the same normalized attribute
name: browser property order and parsed duplicate HTML attributes can disagree.

**Fix.** Declare supported typed props and pass computed values as their own props from the handler, use a closed literal-default signal, or move the component behind a registered browserOnly() boundary.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-610/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-610/pass/).

### BUILD-611 — Unsupported islands-only entry or static route

A compiled entry may use standalone top-level `await activateIslands(...)` when later module initialization needs load readiness. When every registration is pruned, the compiler retains `await (void 0)` and its async module checkpoint. The ordinary standalone call remains supported; consumed, nested or chained completion expressions and effectful arguments in a pruned call remain outside this entry rewrite.

**Why.** The selected native entry cannot be rewritten without discarding used results or effects, or its static route mapping requests executable assets; the build fails even without strict mode.

**Fix.** Use one standalone imported core mount selecting the native page, keep activation outside it, and use an activation-only browser entry when the browser root differs. Static routes must have no extra script entry or module preload.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-611/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-611/pass/).

### BUILD-612 — List key that is not a property path of its row

**Why.** The list has no provable key path (a computed value, an index, a call, the row itself, a foreign or reassigned binding, or no original core createList site), so the module cannot carry its rows' identity in the key-path section; the build fails even without strict mode.

**Fix.** Key the list with a property path of its own row parameter, `(row) => row.id` or `(row) => row.user.id` (the string-literal member `row['id']` is admitted), with the key callback inline.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-612/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-612/pass/).

### BUILD-613 — List row without one stable owned root

**Why.** The row callback does not return exactly one stable Element (text, nothing, several roots, a conditional or control-flow root, or an authored `data-forma-key`), so the row identity has no root to live on; the build fails even without strict mode.

**Fix.** Return one Element per row, `(row) => h('li', …)` or `<li>…</li>` (a Fragment around exactly one Element, or a registered child rendering one, is admitted); put conditionals inside that root and leave `data-forma-key` to the compiler.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-613/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-613/pass/).

### BUILD-614 — Boolean in text

**Why.** A boolean-typed value is read into a text position (a declared boolean prop, a signal whose default is a boolean, a closed boolean, or an expression that can only be a boolean): the browser writes nothing for a boolean child whatever its value while the server would write "true" or "false" (value rule 6, docs/parity-rules.md); the build fails even without strict mode.

**Fix.** Write `String(flag)` for the word (a non-optional declared boolean or a boolean signal), or render content with createShow or a ternary; `cond && 'text'`, whose boolean result stands for nothing, stays valid.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-614/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-614/pass/).

### BUILD-615 — Condition that is not boolean-typed

**Why.** A createShow condition or a ternary test reads a value the compiler can prove is not a boolean (a number, a string, null, an object, or a declared, closed or signal value of such a type): the server would pick the branch by ECMAScript truthiness, which a page reading `count` or `name` only imitates (value rule 7, docs/parity-rules.md); the build fails even without strict mode.

**Fix.** Compare explicitly so the condition is a boolean: `() => count() > 0`, `() => name() !== ''`, `() => item() !== null`, or `!!x` when truthiness is what is meant.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-615/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-615/pass/).

### BUILD-616 — List source that is not a function

**Why.** Core calls a list's source to read its rows, and this one is provably not a function (a literal, a binding to one, a provably immutable data-valued getter result, or a field its parameter type declares as data), so the page would fail in the browser with `items is not a function`; the build fails even without strict mode.

**Fix.** Pass the getter itself or a function returning the rows: `createList(rows, …)` with `const [rows] = createSignal([...])`, `createList(() => p.rows, …)`; callable sources also need a declared array prop or a closed literal-default signal for native rows (BUILD-610).

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-616/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-616/pass/).

### BUILD-617 — Registered option island outside its select value owner

**Why.** The native select value overrides option defaults across an independently registered SSR island, but that child receives no authenticated parent selection value; its own declared inputs cannot prove the selected state.

**Fix.** Keep the option or optgroup helper unregistered inside the owning select island, or move the island boundary to the owning select or an outer element. A whole route may explicitly use ssr:false.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-617/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-617/pass/).

### BUILD-618 — HTML nesting outside the finite native subset

**Why.** The authored tree contains a listed parser-repaired nesting or interactive-content conflict, so parsed native HTML cannot preserve the authored ownership.

**Fix.** Use explicit sibling elements, keep phrasing content inside p, place options inside select, and give interactive content and each labelled control their own valid host.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-618/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-618/pass/).

### BUILD-619 — Document title inside a component

**Why.** An HTML title emitted inside the component does not own the page document title.

**Fix.** Pass the page title to the server render call; an SVG title remains component content.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-619/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-619/pass/).

### BUILD-620 — Dynamic child in executable text content

**Why.** A dynamic or reactive style child enters a CSS context that ordinary HTML escaping cannot make safe.

**Fix.** Keep authored literal style text static; pass changing data through ordinary text, declared attributes, or the dedicated style APIs.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-620/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-620/pass/).

### BUILD-621 — SSR island without one stable owned Element

**Why.** The registered SSR component has text, empty, multiple, conditional/control-flow, async/generator, unresolved, or separately registered roots, so it cannot claim one stable Element containing its own ranges.

**Fix.** Return one authored Element, directly or through an ordinary synchronous resolved helper or a transparent one-Element Fragment; put conditionals, lists and child islands inside that host.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-621/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-621/pass/).

### BUILD-622 — Indexed rows without matching eager native validation

**Why.** An indexed factory validates its initial keys eagerly, but a deferred, conditional, unused or unproved LIST cannot perform the same native validation. Optional or derived initial arrays, effectful key callbacks, eager handle or initial-data mutations and unknown escapes also lack a matching native contract.

**Fix.** Use an original core createKeyedRows(requiredArray, row => row.id) with a required declared array or closed literal array, and an unconditional createList(rows, item => h(…)) in the same component return. Read item fields through item(); keep key callbacks as pure own-row property paths. Keep declared initial arrays and their ancestors unmodified and unescaped during construction. Mutate or expose them or the handle only in proved deferred intrinsic event callbacks, including immutable local handler aliases.

[Refusal fixture](../tests/fixtures/conformance/BUILD-622/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-622/pass/).

### BUILD-623 — Script element outside the bundle contract

**Why.** Core h() refuses script elements in every namespace and spelling; emitting one natively would bypass that bundle-only contract.

**Fix.** Load executable code through the page bundle. Native component script elements, including literal, external and inert-type forms, are not supported.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-623/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-623/pass/).

### BUILD-624 — Raw srcdoc outside the native data contract

**Why.** Native props and FMIR string attributes cannot prove the reviewed trustedHtml brand required by core srcdoc; escaping a string does not establish that trust.

**Fix.** Use a safe iframe src or an explicit Browser-mode trustedHtml sink. Literal null and false remain omitted attributes; other supported absence forms retain their existing behavior.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-624/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-624/pass/).

### BUILD-701 — Plain array child (`.map()` without createList)

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Render rows with createList(source, keyFn, (row) => h(…)), unroll a module-level const with ...CONST.map(…), or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-701/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-701/pass/).

### BUILD-702 — createErrorBoundary in a server-rendered component

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Move the boundary out of the server-rendered tree, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-702/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-702/pass/).

### BUILD-703 — createSwitch in a server-rendered component

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Use createShow for each case, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-703/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-703/pass/).

### BUILD-704 — createPortal in a server-rendered component

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Create the portal from an effect after activation, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-704/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-704/pass/).

### BUILD-705 — createSuspense in a server-rendered component

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Render the loaded state from server data, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-705/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-705/pass/).

### BUILD-707 — browserOnly() called inside the tree

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Declare `const X = browserOnly(Impl)` at the top level of a module, render `<X …/>`, and register X in activateIslands.

**Build result.** Error: publication is refused.

[Refusal fixture](../tests/fixtures/conformance/BUILD-707/fail/) · [Admitted near miss](../tests/fixtures/conformance/BUILD-707/pass/).

### BUILD-801 — SSR build without @getforma/compiler

**Why.** The build was asked for server-rendered modules but cannot load @getforma/compiler, so it stops before writing output.

**Fix.** Install @getforma/compiler (a peer dependency of @getforma/build), or turn `ssr` off.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/strict-compiler.test.ts).

### BUILD-805 — Preview frame runtime missing from @getforma/core

**Why.** `previewFrame` is on, and the @getforma/core the bundles import has no dist/formajs-frame.global.js (it ships from core 2.1.0), or no core is found: there is no runtime to copy, and forma-server would refuse to start the frame (FRAME-101).

**Fix.** Install @getforma/core 2.1.0 or later where the bundles import it from, or turn `previewFrame` off.

The diagnostic names the version that introduced the frame runtime. For a 3.0
application, use the matching coordinated 3.0 package set; this historical
minimum does not replace the compiler's current peer dependency requirement.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/preview-frame.test.ts).

### BUILD-806 — Preview frame runtime that cannot be inlined

**Why.** Core's dist/formajs-frame.global.js is empty, not UTF-8, or contains `</script`, `<!--`, a carriage return or a NUL: it is inlined as it is into the frame's `<script>` and allowed by its hash, so it would end early or not match its hash, and forma-server would refuse it (FRAME-103).

**Fix.** Reinstall @getforma/core and leave the file as published: no editor, formatter, patch or CRLF checkout may rewrite it.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/preview-frame.test.ts).

### BUILD-807 — Bundles that import more than one @getforma/core

**Why.** `previewFrame` is on, and the bundles import more than one @getforma/core, whose frame runtimes differ (entries from packages with their own cores, or a library bundling its own): the frame runs one runtime, so the build would have to pick the core it renders previews with, and the page could mount the module with another.

**Fix.** Make every entry import one @getforma/core (one version in the workspace, `npm dedupe`, a library taking core as a peer dependency), or turn `previewFrame` off.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/preview-frame.test.ts).

### BUILD-808 — Server functions were removed

**Why.** Forma builds browser code; a server function body must never ship as a browser implementation.

**Fix.** Move server-side work to an authenticated Rust route and call that route from the browser.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/server-functions-removed.test.ts).

### BUILD-809 — Package or renderer compatibility cannot be satisfied

**Why.** The installed compiler or resolved forma-server does not accept this writer, or the nearest Cargo.lock cannot establish one unambiguous renderer version.

**Fix.** Use one compatible package set, upgrade the renderer first within its major, and fix the nearest Cargo.lock before rebuilding.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/compatibility.test.ts).

### BUILD-810 — Raw entry not on the allowlist (forma-raw-lint)

**Why.** The source uses one of INV1's and INV2's exits (raw HTML, a typed raw home or a Trusted Types relaxation), and the allowlist names no owner and end date for it (SR8).

**Fix.** Write it without the exit (render through a component, or the typed form the message names), or add an entry to forma-raw-allowlist.json with its path, line or symbol, exit, owner, until and reason.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/raw-lint.test.ts).

### BUILD-811 — Allowlist entry past its end date (forma-raw-lint)

**Why.** The entry's until date has passed: the raw entry it lists was due to go, and its owner has neither removed nor renewed it.

**Fix.** Remove the raw entry and its allowlist entry, or, with its owner, set a new until and say why in reason.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/raw-lint.test.ts).

### BUILD-812 — Allowlist file the lint cannot use (forma-raw-lint)

**Why.** The allowlist cannot be read, is not version 1, or has an entry without a path, a known exit, one of line or symbol, an owner, a real until date at most a year after the run, or a reason; the lint does not guess what it meant.

**Fix.** Correct the file: the message names the entry and the field.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/raw-lint.test.ts).

### BUILD-813 — Allowlist entry that lists fewer uses than it says (forma-raw-lint; note)

**Why.** It matches fewer raw entries than its count, or none, so the inventory overstates and leaves room for unreviewed uses: one was removed, or moved to another line or symbol. A note: the run does not fail on it.

**Fix.** Lower its count to the uses it lists, remove it if it lists none, or point its line or symbol at where the raw entry now is.

**Build result.** Nonfatal build note.

[Lifecycle tests](../../build/tests/raw-lint.test.ts).

### BUILD-814 — Source file the lint cannot read (forma-raw-lint)

**Why.** The file could not be read or parsed, so the raw entries in it cannot be counted; the lint fails rather than pass a file it did not see.

**Fix.** Fix the syntax error the message names, or leave the file out with --exclude if it is not source.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/raw-lint.test.ts).

### BUILD-815 — Application identity is missing or invalid

**Why.** Manifest 2 requires a named application. No explicit valid app or already-valid nearest Cargo package name was supplied.

**Fix.** Set app to the same 1–63 character lowercase letter/digit/hyphen name passed to ServiceWorker::for_app.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/identity.test.ts).

### BUILD-816 — The build contains multiple physical copies of core

**Why.** Each physical copy has independent reactive state and Trusted Types initialization, even when the versions and runtime bytes match.

**Fix.** Deduplicate core, declare it as a library peer, and make every entry resolve one physical package.

**Build result.** Nonfatal build note.

[Lifecycle tests](../../build/tests/manifest-compatibility.test.ts).

### BUILD-817 — Manifest references an asset the build did not emit

**Why.** A declared SSR route has no compiled module, or a manifest reference has no corresponding output asset.

**Fix.** Fix the compilation or route configuration before serving this build; a browser route must be explicitly declared.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/output.test.ts).

### BUILD-818 — Worker metadata cannot authenticate an asset

**Why.** A protected immutable JS/CSS/WASM filename or its full canonical SHA-384 digest is invalid.

**Fix.** Generate the worker from the completed manifest after final asset bytes are written; do not substitute a filename hash or abbreviated digest.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/service-worker.test.ts).

### BUILD-819 — A route is over its size policy

**Why.** A cold-route gzip -9 metric exceeds its effective error threshold. The
ordinary defaults are 28,420 B estimated Forma code and 75 KiB total JavaScript
(365 KiB for a declared canvas); verified native navigation groups have their
separate fixed framework class. A route with no interactive region must ship
zero JavaScript. The same code also refuses a manifest file whose bundling
attribution is missing. Previous assets remain intact; measured size failures
retain an external JSON report.

**Fix.** Inspect the metric and import graph, then try a bounded safe optimization.
An explicit application `sizeBudgets` policy can express a reviewed tradeoff;
framework qualification and no-JavaScript/security contracts remain unchanged.
See [the build policy](../../build/README.md#application-size-policy-forma-232).

**Build result.** Error: publication is refused. Explicit warning-only excesses
use `BUILD-819 warning` and allow publication while retaining default excesses.

[Lifecycle tests](../../build/tests/route-size.test.ts),
[application policy tests](../../build/tests/size-budgets.test.ts).

### BUILD-826 — Invalid application size budget

**Why.** `sizeBudgets` has an unknown version, field or exact route, a nonfinite,
fractional or negative threshold, an empty metric rule, warning-only without a
warning, or warning greater than the effective error. `FORMA_SIZE_POLICY` also
requires its exact documented spelling.

**Fix.** Use the [versioned size policy](../../build/README.md#application-size-policy-forma-232).
This error is validated in development/watch mode too; watch does not measure
unminified bytes against production budgets.

**Build result.** Error; application policy is not silently ignored.

### BUILD-820 — The previous release for retention is not usable

**Why.** previousDist names something that is not the previous release's dist/: a path that does not exist or is not a directory, one with no readable manifest.json, another application's dist, a watch build's, one whose asset names are not flat file names, or a directory that is, holds or sits inside outputDir (which the build replaces whole).

**Fix.** Pass the directory of the release that is live, kept apart from outputDir, or leave previousDist out for a first deploy. A dist built by an earlier schema retains nothing and says so; that is not this error.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/retention.test.ts).

### BUILD-821 — A retained asset cannot be vouched for

**Why.** A file the previous manifest lists is missing from the previous dist, is not a regular file, or its bytes no longer match the SHA-384 the manifest recorded; or this build emitted a file of the same name with other bytes. The build will not copy bytes it cannot vouch for into a release browsers execute, and it fails before writing any output.

**Fix.** Keep the whole release artifact unaltered, as the build wrote it, and pass that directory. If the previous dist was damaged, restore it from the artifact store, or build this release as a security release (security: true) to retain nothing.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/retention.test.ts).

### BUILD-822 — FORMA_SECURITY_RELEASE is not a value the build understands

**Why.** The environment variable that marks a release as a security release (nothing is retained from the previous release) holds a value other than 1, true, 0, false or empty. Reading an unknown value as unmarked would retain a revoked build's assets in the release that exists to remove them, so the build refuses it.

**Fix.** Set FORMA_SECURITY_RELEASE=1 (or true) for a release that fixes a vulnerability, or unset it.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/retention.test.ts).

### BUILD-823 — Preview frame runtime that cannot be minified

**Why.** `previewFrame` is on, and esbuild cannot minify dist/formajs-frame.global.js of the @getforma/core the bundles import: a production build writes the frame's runtime minified (its bytes are on every preview document), so the file must be JavaScript esbuild can parse for ES2022.

**Fix.** Reinstall @getforma/core and leave the file as published: no editor, formatter or patch may rewrite it.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/preview-frame.test.ts).

### BUILD-824 — outputDir is a symbolic link

**Why.** outputDir itself (not a directory above it) is a symbolic link, or a junction on Windows, to a directory or to nothing. The build replaces outputDir whole: a production build renames a real staging directory over it and watch mode empties it first, so either would turn the link into a directory and leave the previous build in the link's old target, where whatever serves the link keeps reading it. The build refuses before it writes or deletes anything, and names the link and where it points.

**Fix.** Set outputDir to the directory the link points at, or build into a real directory and copy it where the link points. A symbolic link above outputDir (a symlinked parent directory) is followed and is not this error. Remove a link that points at nothing.

**Build result.** Error: publication is refused.

[Lifecycle tests](../../build/tests/build.test.ts).

### BUILD-827 — Navigation group is not a closed native product

**Why.** The navigation group has ambiguous owners, incompatible assets, unsupported output mode, conflicting island declarations, or executable imports outside its verified bootstrap.

**Fix.** Use distinct native owner entries, one initialization module, identical route CSS/fonts, literal bundled imports and a production build without watch or code splitting.

**Build result.** Error: publication is refused.

[Navigation group tests](../../build/tests/navigation-groups.test.ts).
