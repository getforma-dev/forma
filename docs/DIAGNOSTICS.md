# Build diagnostics: the code catalogue

Every construct the compiler cannot represent in a server-rendered module is
reported with a stable code, the file, the line and the column, one line of why
and one of fix (FORMA-119; v2's DR-1, L-3, N12). This page lists every code.
The catalogue in `packages/compiler/src/diagnostics.ts` is the source; a test
keeps this page, the catalogue and the conformance fixtures equal.

## Declared-state diagnostics (FORMA-103)

Unsupported native island expressions now end the build with source-located
**BUILD-610**, including without strict mode. Earlier construct-specific reason
codes remain in diagnostic reports; they no longer authorize empty fallback
hosts. Registered browser-only components require declared metadata.

**Reserved retired codes:** BUILD-303 (literal-row list degradation), BUILD-504
(aggregate default note), BUILD-408 (registered fallback shell), BUILD-706
(old browser-only prop dropping), and BUILD-708 (unregistered browser-only shell). Closed
aggregate defaults are now represented directly, and the fallback writer is
removed. These codes will not be reused. Exact earlier text and fixtures remain
in [the pre-state diagnostics archive](archive/2026-10-15-pre-state-diagnostics/README.md).

## What a diagnostic looks like

Reason diagnostics print the code after `IR:` and the source position after the
file. Unsupported native expressions also produce a BUILD-610 error, even when
strict mode is disabled:

```
   IR: BUILD-101 call expression helpers.extra(...) in /app/src/home/app.tsx:12:11 — cannot form a declared native island contract
```

The stable reason codes identify the construct; BUILD-610 makes its refusal
unconditional. Diagnostic wording describes the current result. Historical
warning-only behavior and the original source fixtures are preserved in the
pre-state archive above.

The line and column are where the author wrote the construct: in a `.tsx` or
`.jsx` file, which the compiler reads after esbuild has turned its JSX into
`h()` calls, the position is mapped back through the transform's source map.

## Strict mode, the JSON report, and the result

- **Strict mode** fails the build on every diagnostic but a note, after every
  page is compiled, with all of them at once: `build({ strict: true })`, or
  `FORMA_STRICT=1` in the environment when the config leaves `strict`
  unset. `build()` reads no command-line flag, as for `ssr` and `watch`:
  a build script that takes `--strict` maps it to the config (the
  create-forma-app templates do from create-app 0.6.2). It needs
  `@getforma/compiler` 0.3.7 or later; with an older compiler the build
  refuses rather than pass pages it never checked. In watch mode a page with
  an error keeps its last good module.
- **JSON**: `build({ diagnosticsJson: 'ssr-diagnostics.json' })` writes
  `{ version, strict, diagnostics }`, one object per diagnostic with its
  `code`, `severity` (`error`, `warning` or `note`), `page`, `file`,
  `line`, `column`, `message`, `why`, `fix` and, for BUILD-403, the
  `chain` (`component`, `file`, `line`, `column` per link). It is written
  whether or not the build fails, and its path must be outside `outputDir`,
  which the build replaces whole and serves: one inside is refused before
  anything is written, inside as the filesystem sees it (through real paths,
  so a symlink into `outputDir` counts; case-insensitively where the
  filesystem ignores case; `..` only as a whole segment). `version` is 1: a field may be added without
  changing it; renaming or removing one, or changing what one means,
  increments it.
- **The result**: `build()` returns the same list as `result.diagnostics`.
- **The plugin**: `formaSsrPlugin({ …, strict, onDiagnostics })` for a build
  that uses esbuild directly; under `strict` each diagnostic is an esbuild
  error at its file, line and column, with its why and fix as notes.
- **The compiler**: `collectDiagnostics(() => generateRealIr(entry))`, and
  `DIAGNOSTIC_CATALOGUE`, are exported.

Ordinary advisory diagnostics remain warnings unless strict mode is enabled.
Malformed or unsupported declared native contracts always fail with BUILD-610;
turning strict mode off cannot restore a fallback shell or empty scalar value.

## Counting composition depth (L-26)

BUILD-403 names the chain from the page down to the component it refused, as
`(chain: HomePage > Layout > Card > Panel > Badge)` in the line and as
`chain` in the JSON, so an application's composition past the inlining limit
can be counted in strict mode: the number of BUILD-403 entries.

## Notes

A note is printed as every diagnostic is, but strict mode never fails on it.
The raw-entry lint's BUILD-813 reports an allowlist entry listing nothing. BUILD-816 is a production
build warning, also nonfatal under strict mode. BUILD-802 is retired: unnamed
applications now fail identity validation (BUILD-815).

## Families

| Family | What it reports |
|---|---|
| BUILD-1xx | A subtree the compiler leaves to the browser (rule 11) |
| BUILD-2xx | An attribute or prop dropped or left empty |
| BUILD-3xx | Text, a conditional or a list the server renders empty or wrong |
| BUILD-4xx | A component the compiler does not inline |
| BUILD-5xx | A signal the compiler cannot name |
| BUILD-6xx | The page module: a placeholder, or a literal too long |
| BUILD-7xx | A construct adoption does not handle; `browserOnly()` is the way out |
| BUILD-8xx | The build package (reported by `@getforma/build`), its raw-entry lint included (BUILD-810 to BUILD-814) |

## The codes

## BUILD-1xx: A subtree the compiler leaves to the browser (rule 11)

### BUILD-101 Unrecognised call in the tree

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Write the subtree as h() calls, a component in a relative file, createShow or createList, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-101/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-101/pass/)):

```tsx
<div>{helpers.extra()}</div>
```

### BUILD-102 Unrecognised child expression

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Wrap a reactive child in a function (`() => …`), use createShow for a conditional and createList for rows, or fold the value into a module-level const.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-102/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-102/pass/)):

```tsx
<p>{caption}</p>
```

### BUILD-103 Dynamic tag

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Use a literal tag name, or a component the compiler can follow.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-103/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-103/pass/)):

```tsx
{h(tag, null, 'section body')}
```

### BUILD-104 Spread child that does not unroll

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Unroll a module-level const array of object literals, or render runtime rows with createList(source, keyFn, (row) => h(…)).

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-104/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-104/pass/)):

```tsx
{h('ul', null, ...rows.map((r) => h('li', null, r.name)))}
```

### BUILD-105 Spread over a table that is not static

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Declare the table as a literal `const` of object literals in the module it is imported from, with no nested declaration of the same name, or use createList.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-105/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-105/pass/)):

```tsx
{h('ul', null, ...ROWS.map((r) => h('li', null, r.name)))}
```

### BUILD-106 createShow branch the compiler cannot follow

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Write the branch inline as `() => h(…)`.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-106/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-106/pass/)):

```tsx
{createShow(() => open(), renderPanel, () => <p>closed</p>)}
```

### BUILD-107 createList the compiler cannot walk

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Write `createList(source, keyFn, (row) => h(…))` with the map function inline and the row parameter named, reading `row.field`.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-107/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-107/pass/)):

```tsx
<ul>{createList(todos, (r) => r.id)}</ul>
```

## BUILD-2xx: An attribute or prop dropped or left empty

### BUILD-201 Props passed as something other than an object literal

**Why.** None of the attributes the element carries are rendered on the server.

**Fix.** Pass the attributes as an object literal on the h('tag', { … }) call.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-201/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-201/pass/)):

```tsx
{h('div', props, 'x')}
```

### BUILD-202 Spread props

**Why.** The attributes inside `{...rest}` are not rendered on the server.

**Fix.** List the attributes explicitly on the h() call.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-202/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-202/pass/)):

```tsx
<div {...rest}>x</div>
```

### BUILD-203 Prop key the compiler cannot name

**Why.** A computed key, or a key that is neither an identifier nor a string, drops its attribute from the server-rendered HTML.

**Fix.** Use a plain identifier or string key.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-203/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-203/pass/)):

```tsx
{h('div', { [attrName]: 'v' }, 'x')}
```

### BUILD-204 Method-valued prop

**Why.** An object method (`{ title() { … } }`) has no binding form, so the attribute is not rendered on the server.

**Fix.** Write it as an arrow property (`title: () => …`) for a reactive binding.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-204/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-204/pass/)):

```tsx
{h('div', { title() { return 'x'; } }, 'y')}
```

### BUILD-205 dangerouslySetInnerHTML

**Why.** Raw markup is not rendered from the module: the element ships empty until the browser runs.

**Fix.** Render the content as h() children, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-205/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-205/pass/)):

```tsx
<div dangerouslySetInnerHTML={{ __html: '<b>x</b>' }} />
```

### BUILD-206 Reactive attribute the compiler cannot evaluate

**Why.** The attribute is omitted from the server-rendered HTML and appears only once the browser activates the page.

**Fix.** Initialize the signals it reads with literal defaults, or fold the value into a module-level const.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-206/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-206/pass/)):

```tsx
<a href={() => docsHref()}>Docs</a>
```

### BUILD-207 Attribute value the compiler cannot evaluate

**Why.** The attribute is omitted from the server-rendered HTML, and adoption does not re-apply a value that is not a function, so it never appears.

**Fix.** Inline the literal, use a module-level const, or wrap the value in a function (`() => …`) for a reactive binding.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-207/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-207/pass/)):

```tsx
<button title={'Enable ' + lookupName()}>Go</button>
```

## BUILD-3xx: Text, a conditional or a list the server renders empty or wrong

### BUILD-301 Text the compiler cannot evaluate

**Why.** This unresolved dynamic text expression has no closed native value and ends the build with BUILD-610.

**Fix.** Initialize the signals it reads with literal defaults so the server can render them.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-301/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-301/pass/)):

```tsx
<p>{() => format(count())}</p>
```

### BUILD-302 Conditional the compiler cannot evaluate

**Why.** The server renders the ELSE branch; if the browser would render the THEN branch, adoption keeps the wrong one until the condition changes value.

**Fix.** Initialize the signals the condition reads with literal defaults.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-302/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-302/pass/)):

```tsx
<div>{() => isOpen() ? <p>open</p> : <p>closed</p>}</div>
```

## BUILD-4xx: A component the compiler does not inline

### BUILD-401 Component imported from a package

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Compile the component's source in the application (a relative import), or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-401/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-401/pass/)):

```tsx
<div><Fancy /></div>
```

### BUILD-402 Component the compiler cannot find

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Import the component from a relative path, or declare it in the calling file.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-402/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-402/pass/)):

```tsx
<div><Widget /></div>
```

### BUILD-403 Composition past the inlining limit of 3

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Flatten the chain so the component sits at depth 3 or less, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-403/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-403/pass/)):

```tsx
<D />
```

### BUILD-404 Recursive component

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Render the recursion with createList over data, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-404/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-404/pass/)):

```tsx
return <ul><Tree /></ul>;
```

### BUILD-405 Component passed a prop the compiler cannot evaluate

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Pass literal values (strings, numbers, booleans, null) as props.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-405/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-405/pass/)):

```tsx
<Card title={computeTitle()} />
```

### BUILD-406 Component the compiler cannot follow

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Return the h() tree directly from the component (an expression body or a top-level `return h(…)`).

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-406/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-406/pass/)):

```tsx
<Empty />
```

### BUILD-407 Children passed to a component

**Why.** The compiler cannot place a component's children: they are not in the server-rendered HTML and appear only after the browser renders the component.

**Fix.** Pass the content as props, or render it inside the component.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-407/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-407/pass/)):

```tsx
<Card><b>bold</b></Card>
```

## BUILD-5xx: A signal the compiler cannot name

### BUILD-501 Signal default the compiler cannot evaluate

**Why.** The signal gets no named slot, so bindings to it land in anonymous slots that render empty on the server and cannot be set by name.

**Fix.** Initialize it with a string, number, boolean or null literal, or a module-level string const.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-501/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-501/pass/)):

```tsx
const [rows] = createSignal(loadRows());
```

### BUILD-502 Signal declared twice in one scope

**Why.** Two declarations with different defaults share one slot; the first owns it, so the server renders its default.

**Fix.** Declare the signal once.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-502/fail/app.ts) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-502/pass/)):

```ts
const [mode] = createSignal('b');
```

### BUILD-503 Signal name taken by another scope

**Why.** Two scopes declare the same signal name, so this one's slot is renamed (`name#2`); a server setting the plain name fills the other one.

**Fix.** Declare the signal once and import it, or set the renamed slot by its exact name.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-503/fail/app.ts) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-503/pass/)):

```ts
const [count] = createSignal(7);
```

## BUILD-6xx: The page module: a placeholder, or a literal too long

### BUILD-601 No mount() call in the entry

**Why.** The compiler cannot find the page, so it writes a placeholder module: the server renders an empty `<div id="app">` and nothing shows until the browser runs.

**Fix.** Call mount(() => …, '#app') or activateIslands({ … }) at the top level of the SSR entry, or declare the route `ssr: false`.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-601/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-601/pass/)):

```tsx
import { h } from '@getforma/core';
```

### BUILD-602 Page component the compiler cannot resolve

**Why.** The page component named in mount() cannot be found or read, so the compiler writes a placeholder module and the server renders an empty `<div id="app">`.

**Fix.** Import the page component from a relative path that exports it as a function.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-602/fail/page.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-602/pass/)):

```tsx
import { h } from '@getforma/core';
```

### BUILD-603 Page root that is not an h() call

**Why.** The page returns something other than an h() call, so the compiler writes a placeholder module and the server renders an empty `<div id="app">`.

**Fix.** Return the page tree as h() calls (or JSX).

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-603/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-603/pass/)):

```tsx
return 'just text';
```

### BUILD-604 Literal past 65,535 bytes

**Why.** FMIR's string table and slot defaults hold at most 65,535 bytes per entry, so the page cannot be encoded and the compiler writes a placeholder module.

**Fix.** Load content that long at run time (a handler-filled slot or a fetch), or split it into smaller literals.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-604/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-604/pass/)):

```tsx
<p>{C + C + C + C + C + C + C}</p>
```

### BUILD-605 Module const past 65,535 bytes

**Why.** A module-level const that folds to more than 65,535 bytes is not folded, so every use of it is reported where it is read.

**Fix.** Keep folded constants under 65,535 bytes, or load the content at run time.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-605/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-605/pass/)):

```tsx
export const D = C + C + C + C + C + C + C;
```

### BUILD-606 Module emission failed

**Why.** The compiler failed while emitting the page (or writing its module) and fell back to a placeholder module. This is a defect in the compiler or an input it does not expect.

**Fix.** Report it with the message; until it is fixed, declare the route `ssr: false`.

**In strict mode.** An error.

No page triggers it on purpose: it is tested by an unwritable output directory and an unreadable entry (`packages/compiler/tests/diagnostics-conformance.test.ts` > "BUILD-606").

## BUILD-7xx: A construct adoption does not handle; `browserOnly()` is the way out

### BUILD-610 Invalid declared page props

The page's declared props or their binding expression cannot be represented by the closed FMIR contract. Unsupported types, recursive schemas, unresolved declarations, reassignment, coercion and computed prop expressions fail compilation, including builds without `--strict`. The reported location is the original TypeScript declaration or expression before JSX lowering. No placeholder IR is written.

**Fix.** Declare named, typed object fields using booleans, strings, finite numbers, Date, string-literal enums, arrays, optional/null values and nested objects. Keep props immutable. Pass a computed presentation value as its own declared field. Read nested fields directly; repeated lists can share a declared array.

The [refusal fixture](../packages/compiler/tests/fixtures/conformance/BUILD-610/fail/page.tsx) and [passing fixture](../packages/compiler/tests/fixtures/conformance/BUILD-610/pass/page.tsx) pin original TSX positions.

### BUILD-611 Unsupported islands-only entry or static route

**Why.** The selected native entry cannot be rewritten without dropping a used mount result or argument effects, or its static route requests executable assets. This refusal is mandatory without strict mode. The compiler authenticates the actual named core import (including aliases), the original native page declaration, and each emitted island contract.

**Fix.** Use one standalone imported core `mount(Page, '#app')` or `mount(() => Page(), '#app')` as a compile-time native root. Keep activation outside that invocation. If the browser entry has a different root, make it activation-only; do not assign/export the removed mount result. Move required argument effects outside an omitted empty activation call. A static route must have no extra script entry or module preload.

Core namespace imports may use known non-mount members; optional mount access, dynamic members and namespace escape through alias/destructuring/arguments/export refuse. Erased type-only uses and unrelated user objects are unaffected.

The [refusal fixture](../packages/compiler/tests/fixtures/conformance/BUILD-611/fail/app.tsx) and [passing fixture](../packages/compiler/tests/fixtures/conformance/BUILD-611/pass/app.tsx) pin original entry positions.

### BUILD-612 List key that is not a property path of its row

**Why.** FORMA-181 (DR-8, L-7): every server-rendered list carries its rows' identity as a key
path in FMIR section `0x0006`, so the compiler must prove the key from the original source. The
proof reads the exact source snapshot before JSX lowering and admits a nonempty property path
of the key callback's own row parameter: `row.id`, `row.user.id`, the string-literal member
`row['id']`, and an immutable local alias of such a read. Anything else refuses here: the row
itself (`r => r`), an index or second parameter, a computed member, a call, coercion,
concatenation or arithmetic, a captured or reassigned binding, an empty string-literal segment
(`row['']`), a path deeper than 32 segments, a key callback with more than one return path (its
body must be an expression, or variable declarations and exactly one `return`), or a
`createList` call that does not resolve to the core import (a local function of that name, or an
ambiguous lowered position). A segment is not checked against the row's declared schema type
here or at render: the proof is lexical, the walker binds data rather than types, and closed
local rows and signal-seeded rows have no schema at all, so the one rule that covers every
list is the data-level one the walker applies to each row at render (`RENDER-503`): every
segment but the last must name a field of the row holding an object, the last a field holding
a string or a safe integer; a missing field, a field declared twice, a non-object on the way,
or `null`, a boolean, an array, an object, a fraction, an infinity or NaN at the end refuses
the whole render (decided at checkpoint B, 2026-10-15). This
refusal is mandatory without strict mode. The legacy
shape checks keep their precedence: a call missing its row callback, or whose row callback is
not an inline function with a named parameter, still reports BUILD-107 and ends with BUILD-610.

**Fix.** Key the list with a property path of its row, `(row) => row.id` or
`(row) => row.user.id`, written inline. A derived or formatted key belongs in the data the
list reads, as its own field.

**In strict mode.** An error (and an error without strict mode).

The [refusal fixture](../packages/compiler/tests/fixtures/conformance/BUILD-612/fail/app.tsx) and
[passing fixture](../packages/compiler/tests/fixtures/conformance/BUILD-612/pass/app.tsx) pin the
original TSX position of the list.

### BUILD-613 List row without one stable owned root

**Why.** FORMA-181 (the row slice of FORMA-139): the key is written on the row's root
element, so each row callback must return exactly one stable owned Element, proved through
ordinary lexical helpers and imported components. A transparent Fragment around exactly that
Element, and a registered child component that itself renders one, are admitted. Text,
`null`, an empty string, several roots, a conditional (`cond ? <li/> : null`), `createShow` or
`createList` as the root, a root reached through a spread or computed attribute, or an
authored `data-forma-key` on the root (reserved for the compiler-written identity) refuse
here, as does a row callback or row helper with more than one return path (`if (…) return
<li/>; return <p/>`): the body must be an expression, or variable declarations and exactly one
`return`. Conditionals and dynamic ranges inside the stable root remain valid. This refusal is
mandatory without strict mode.

**Fix.** Return one Element per row, `(row) => h('li', …)` or `<li>…</li>`, and move the
conditional inside it: `<li>{row.done ? <b>…</b> : null}</li>`. Do not write
`data-forma-key` yourself.

**In strict mode.** An error (and an error without strict mode).

The [refusal fixture](../packages/compiler/tests/fixtures/conformance/BUILD-613/fail/app.tsx) and
[passing fixture](../packages/compiler/tests/fixtures/conformance/BUILD-613/pass/app.tsx) pin the
original TSX position of the list.

### BUILD-614 Boolean in text

**Why.** FORMA-182, value rule 6 ([parity rules](parity-rules.md)): `h()` writes nothing for a
boolean child whatever its value, while the walker writes `true` or `false` for a boolean slot,
so a boolean read into text either breaks parity between the server's HTML and the browser's
DOM or shows nothing at all. The compiler refuses a text position whose value it can prove is
boolean: a declared boolean prop (optional included), a signal whose default is a boolean, a
closed boolean (an aggregate field, a list-row field, a module-level `const` initialized with
`true` or `false`), or an expression that can only be a boolean (`!ready()`, `count() > 0`, `a()
&& b()` of booleans), read eagerly or through a getter, as a child or as a `createShow` or
ternary branch. A boolean literal child writes nothing on both sides and is admitted. A mixed
expression whose boolean result stands for nothing (`ready() && 'Go'`) is admitted: eagerly it
folds, and through a getter the server writes an empty range when its default is the boolean,
as the browser does. This refusal is mandatory without strict mode.

**Fix.** The message gives the form that builds for its source. Write the word with
`String(flag)` on a non-optional declared boolean (it binds the text to the boolean slot, which
the walker writes as the word `String()` gives), on a boolean signal, and on an expression the
compiler evaluates (they fold to the same word). On an optional declared boolean (`String()`
would print `undefined` when it is absent), a closed value or a module `const` (`String()` of
those is not folded), write the word with a ternary, `() => (flag ? 'yes' : 'no')`. For
content, use `createShow(() => flag(), …)` or a ternary.

**In strict mode.** An error (and an error without strict mode).

The [refusal fixture](../packages/compiler/tests/fixtures/conformance/BUILD-614/fail/app.tsx) and
[passing fixture](../packages/compiler/tests/fixtures/conformance/BUILD-614/pass/app.tsx) pin the
original TSX position of the text.

### BUILD-615 Condition that is not boolean-typed

**Why.** FORMA-182, value rule 7 ([parity rules](parity-rules.md)): the walker picks a
`SHOW_IF` branch by the condition's value, with ECMAScript truthiness for anything that is not a
boolean, and a page whose condition is a number or a string only imitates what the author meant
(React's `{count && …}` printing `0` is the shape kept out). The compiler refuses a
`createShow` condition or a ternary test it can prove is not boolean-typed: a declared prop of
another type (an optional boolean is admitted: absent reads as false on both sides), a signal
whose literal default is a number, a string or `null`, a closed value (an aggregate or list-row
field, a module-level `const`) of another type, a literal, or an expression whose result is not
always a boolean (`a() && count()`, `name() || 'x'`). A signal getter passed to `createShow`
itself (`createShow(count, …)`) is read as its call, since `createShow` calls it; a getter named
without its call anywhere else in a condition (`() => open ? a : b`, `() => open`,
`ready() && open`) is a function, always truthy in the browser, and is refused with a message
naming the missing call. A boolean signal, a negation, a comparison,
`Boolean(x)`, `&&` and `||` of booleans, and a module-level boolean `const` are admitted, and
`Boolean(x)` and the module `const` are folded, so the server renders the branch the browser
takes. A condition the compiler cannot type at all stays BUILD-302. This refusal is mandatory
without strict mode.

**Fix.** Compare explicitly so the condition is a boolean: `() => count() > 0`,
`() => name() !== ''`, `() => item() !== null`, or `!!x` when truthiness is what is meant.

**In strict mode.** An error (and an error without strict mode).

The [refusal fixture](../packages/compiler/tests/fixtures/conformance/BUILD-615/fail/app.tsx) and
[passing fixture](../packages/compiler/tests/fixtures/conformance/BUILD-615/pass/app.tsx) pin the
original TSX position of the condition.

### BUILD-616 List source that is not a function

**Why.** FORMA-183's parity harness, finding F1: core's `createList(items, key, row)` calls
`items()` to read the rows, so a list source that is not a function fails in the browser with
`items is not a function` even though the native module renders it (the page's list array is a
named slot the module never evaluates). The compiler refuses a source it can prove is not a
function: a literal (an array, an object, a string, a number, `null`, `undefined`), a binding
whose value is one (an immutable local binding, or an immutable named export of an imported module),
a provably immutable data-valued core getter result (`rows()` from `createSignal`,
`createComputed` or `createMemo`), or a field that an inline parameter type
declares as data (`p.rows` with `p: { rows: Row[] }`). A function, a getter, and anything the
compiler cannot see through (an untyped parameter's field, another call's result) stay admitted.
A signal may hold a function and a computed callback may return one. A captured signal setter
prevents using its initializer as proof; object fields can change through aliases or getter reads,
so their initial values are not proof either. Callable and unknown results pass this callability check.
The refusal names the call's own argument. This refusal is mandatory without strict mode.

Callable sources still need native value provenance. A declared array prop or a
closed literal-default signal is admitted through its getter or an explicit
callback. An arbitrary getter, derived filter/map, mutable getter result or
unproved function field is refused separately with BUILD-610. The current
list-same-source corpus uses a two-row signal and renders both projections in
Rust and core; its previous empty-native stage is preserved under
`docs/archive/FORMA-101-unproved-list-sources/`.

**Fix.** Pass the getter itself or a function returning the rows: `createList(rows, …)` with
`const [rows] = createSignal([...])` or `createList(() => p.rows, …)`.

**In strict mode.** An error (and an error without strict mode).

The [refusal fixture](../packages/compiler/tests/fixtures/conformance/BUILD-616/fail/app.tsx) and
[passing fixture](../packages/compiler/tests/fixtures/conformance/BUILD-616/pass/app.tsx) pin the
original TSX position of the list.

### BUILD-701 Plain array child (`.map()` without createList)

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Render rows with createList(source, keyFn, (row) => h(…)), unroll a module-level const with ...CONST.map(…), or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-701/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-701/pass/)):

```tsx
<ul>{items.map((i) => <li>{i}</li>)}</ul>
```

### BUILD-702 createErrorBoundary in a server-rendered component

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Move the boundary out of the server-rendered tree, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-702/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-702/pass/)):

```tsx
{createErrorBoundary(() => <p>ok</p>, () => <p>failed</p>)}
```

### BUILD-703 createSwitch in a server-rendered component

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Use createShow for each case, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-703/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-703/pass/)):

```tsx
{createSwitch(() => tab(), [{ match: 'a', render: () => <p>a</p> }])}
```

### BUILD-704 createPortal in a server-rendered component

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Create the portal from an effect after activation, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-704/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-704/pass/)):

```tsx
{createPortal(() => <p>overlay</p>, document.body)}
```

### BUILD-705 createSuspense in a server-rendered component

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Render the loaded state from server data, or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-705/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-705/pass/)):

```tsx
{createSuspense(() => <p>loading</p>, () => <p>loaded</p>)}
```

### BUILD-707 browserOnly() called inside the tree

**Why.** This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.

**Fix.** Declare `const X = browserOnly(Impl)` at the top level of a module, render `<X …/>`, and register X in activateIslands.

**In strict mode.** An error.

Reported at, in [its fixture](../packages/compiler/tests/fixtures/conformance/BUILD-707/fail/app.tsx) (the near miss is [beside it](../packages/compiler/tests/fixtures/conformance/BUILD-707/pass/)):

```tsx
<div>{browserOnly(Panel)}</div>
```

## BUILD-8xx: The build package (reported by `@getforma/build`)

### BUILD-801 SSR build without @getforma/compiler

**Why.** The build was asked for server-rendered modules but cannot load @getforma/compiler, so it stops before output writes.

**Fix.** Install @getforma/compiler (a peer dependency of @getforma/build), or turn `ssr` off.

**In strict mode.** Always an error, with or without strict mode. Browser-only builds without the optional compiler remain supported.

Verified by: `packages/build/tests/strict-compiler.test.ts` > "refuses missing compiler for SSR before writes, while browser-only output remains supported".

### BUILD-805 Preview frame runtime missing from @getforma/core

**Why.** `previewFrame` is on, and the @getforma/core the bundles import has no dist/formajs-frame.global.js (it ships from core 2.1.0), or no core is found: there is no runtime to copy, and forma-server would refuse to start the frame (FRAME-101).

**Fix.** Install @getforma/core 2.1.0 or later where the bundles import it from, or turn `previewFrame` off.

**In strict mode.** An error, and without strict mode too: the build fails before it writes anything.

Printed as `@getforma/build: BUILD-805 @getforma/core 2.0.3 at <dir> (imported by app.js) has no dist/formajs-frame.global.js: …`, naming the version, the directory and the entries that import it. The build never falls back to another core, nor to core's `dist/forma-runtime.js`, the CDN alias of the auto-mounting runtime (`packages/build/tests/preview-frame.test.ts` > "BUILD-805: a core without the frame runtime (older than 2.1.0) fails the build, naming its version, and leaves the previous output as it was").

### BUILD-806 Preview frame runtime that cannot be inlined

**Why.** Core's dist/formajs-frame.global.js is empty, not UTF-8, or contains `</script`, `<!--`, a carriage return or a NUL: it is inlined as it is into the frame's `<script>` and allowed by its hash, so it would end early or not match its hash, and forma-server would refuse it (FRAME-103).

**Fix.** Reinstall @getforma/core and leave the file as published: no editor, formatter, patch or CRLF checkout may rewrite it.

**In strict mode.** An error, and without strict mode too: the build fails before it writes anything.

Printed with the file, line and column of what it refuses, as `@getforma/build: BUILD-806 <core>/dist/formajs-frame.global.js:2:11: @getforma/core 2.1.0's dist/formajs-frame.global.js contains "</script", …`; `</script` and `<!--` are matched in any ASCII case, as the HTML tokenizer and forma-server match them (`packages/build/tests/preview-frame.test.ts` > "BUILD-806: a runtime with %s fails the build with its code, before anything is written").

### BUILD-807 Bundles that import more than one @getforma/core

**Why.** `previewFrame` is on, and the bundles import more than one @getforma/core, whose frame runtimes differ (entries from packages with their own cores, or a library bundling its own): the frame runs one runtime, so the build would have to pick the core it renders previews with, and the page could mount the module with another.

**Fix.** Make every entry import one @getforma/core (one version in the workspace, `npm dedupe`, a library taking core as a peer dependency), or turn `previewFrame` off.

**In strict mode.** An error, and without strict mode too: the build fails before it writes anything.

Printed naming each core, its version and the entries that import it, as `@getforma/build: BUILD-807 previewFrame is on, and the bundles import 2 copies of @getforma/core whose frame runtimes differ: @getforma/core 2.1.0 at <dir> (imported by a.js); @getforma/core 2.1.1 at <dir> (imported by b.js)…`. Copies whose frame runtimes are the same bytes (one version installed twice) are one core to the frame: the build copies those bytes (`packages/build/tests/preview-frame.test.ts` > "BUILD-807: entries from two packages with cores whose runtimes differ fail the build, naming each core and its entries").

### The raw-entry lint: BUILD-810 to BUILD-814

`forma-raw-lint`, the build package's command for an application's CI
(FORMA-126; v2's SR8, M8, DR-19, L-37), reports these. It finds every use of
INV1's and INV2's exits (the raw-HTML constructors and the string forms the
A2 bridge still accepts, `reconcile()`, `mountMarkup()` and a mount handle's
`update()` among them, the typed raw homes, Trusted Types' per-route
relaxation) and fails on any that `forma-raw-allowlist.json` does not list
with an owner and an end date, and on any entry past its end date. Each line
names the exit (`trustedHtml`, `body_prefix`, …), the file, line and column,
and the innermost named function; `--json` writes the same as data. They are
never in a build's report. The exits, the allowlist's format and what the
scan misses are in the package README
([`packages/build/README.md`](../packages/build/README.md#raw-entry-lint-forma-raw-lint)).
The run exits 0 when it passes, 1 on a BUILD-810, BUILD-811 or BUILD-814,
and 2 on a BUILD-812 or a usage error.

### BUILD-808 Removed server function directive

**Why.** A source module contains a `"use server"` directive. Server functions
were removed in 3.0.0; shipping their bodies in a browser bundle is unsafe.

**Fix.** Move server-side work to an authenticated Rust route and call it with
`fetch`. Comments and ordinary string values are permitted.

**In strict mode.** Always an error, also when strict mode is off. The build
checks browser and SSR entry graphs before replacing output, and again on watch
rebuilds. Reported by `packages/build/tests/server-functions-removed.test.ts`.

### BUILD-809 Package or renderer compatibility cannot be satisfied

**Why.** The installed compiler is incompatible with the build, the resolved
forma-server does not accept an emitted writer, or the nearest Cargo.lock is
malformed or ambiguous. No lock warns; a lock without forma-server warns for a
browser-only build and fails SSR. npm optional-peer warnings cannot enforce this
boundary by themselves.

**Fix.** Use compatible packages and upgrade the renderer first. The refusal
names both versions, the lockfile and the minimum renderer minor where relevant.
Repair the nearest lock instead of bypassing it with a farther one.

**In strict mode.** Compatibility refusals are always errors. Missing-lock warnings
remain warnings. Initial refusal precedes writes; watch refusal preserves the last
valid output. Verified by `packages/build/tests/compatibility.test.ts`,
`packages/build/tests/manifest-compatibility.test.ts`, and the real installed
3.2-build/3.1-compiler control in `scripts/compatibility-package.test.mjs`.

### BUILD-810 Raw entry not on the allowlist (forma-raw-lint)

**Why.** The source uses one of INV1's and INV2's exits (raw HTML, a typed raw home or a Trusted Types relaxation), and the allowlist names no owner and end date for it (SR8).

**Fix.** Write it without the exit (render through a component, or the typed form the message names), or add an entry to forma-raw-allowlist.json with its path, line or symbol, exit, owner, until and reason.

**In the lint.** An error: the run exits 1.

Printed as `BUILD-810 error body_prefix in src/server/mod.rs:772:9 (in index_handler): body_prefix: body_prefix set to a value not traced to RawHtml::trusted (a string still works in 0.2.x); not on the allowlist` (`packages/build/tests/raw-lint.test.ts` > "SR8: a seeded body_prefix outside the allowlist fails, and so does an entry past its end date").

### BUILD-811 Allowlist entry past its end date (forma-raw-lint)

**Why.** The entry's until date has passed: the raw entry it lists was due to go, and its owner has neither removed nor renewed it.

**Fix.** Remove the raw entry and its allowlist entry, or, with its owner, set a new until and say why in reason.

**In the lint.** An error: the run exits 1. `until` is the last day the entry is valid, in UTC; the day after, it fails, whether or not it still lists anything.

Printed once per entry (`packages/build/tests/raw-lint.test.ts` > "SR8: a seeded body_prefix outside the allowlist fails, and so does an entry past its end date").

### BUILD-812 Allowlist file the lint cannot use (forma-raw-lint)

**Why.** The allowlist cannot be read, is not version 1, or has an entry without a path, a known exit, one of line or symbol, an owner, a real until date at most a year after the run, or a reason; the lint does not guess what it meant.

**Fix.** Correct the file: the message names the entry and the field.

**In the lint.** An error: the run exits 2. An entry with a problem lists nothing, so the raw entries it meant are reported too.

Printed once per problem (`packages/build/tests/raw-lint.test.ts` > "BUILD-812: an allowlist the lint cannot use stops the run with exit code 2, naming the entry and the field").

### BUILD-813 Allowlist entry that lists fewer uses than it says (forma-raw-lint; note)

**Why.** It matches fewer raw entries than its count, or none, so the inventory overstates and leaves room for unreviewed uses: one was removed, or moved to another line or symbol. A note: the run does not fail on it.

**Fix.** Lower its count to the uses it lists, remove it if it lists none, or point its line or symbol at where the raw entry now is.

**In the lint.** A note: never fails the run.

Printed once per entry (`packages/build/tests/raw-lint.test.ts` > "BUILD-813: an entry that lists nothing is a note, and the run passes").

### BUILD-814 Source file the lint cannot read (forma-raw-lint)

**Why.** The file could not be read or parsed, so the raw entries in it cannot be counted; the lint fails rather than pass a file it did not see.

**Fix.** Fix the syntax error the message names, or leave the file out with --exclude if it is not source.

**In the lint.** An error: the run exits 1. esbuild parses TypeScript and JavaScript (a `.js` file is also tried as JSX and TypeScript), and an HTML file's inline scripts (the rest of the HTML file is still read); a Rust file is tokenized, which does not fail. A path that cannot be read, or a symbolic link that leads nowhere or loops, is one too, unless its name says it is not source; `--exclude` and the skipped names are applied before anything is read.

Printed with esbuild's message and position (`packages/build/tests/raw-lint.test.ts` > "BUILD-814: a file esbuild cannot parse fails the run at its line, and so does an inline script").

### BUILD-815 Application identity is missing or invalid

**Why.** Manifest 2 needs a valid application name. There is neither an explicit
`app` nor an already-valid nearest Cargo package name.

**Fix.** Set `app` to 1–63 lowercase letters, digits or hyphens, starting with a
letter or digit, and use that name for the enabled server worker.

**In strict mode.** Always an error before writes. Verified by
`packages/build/tests/compatibility.test.ts` (explicit/fallback/missing/invalid
identity) and the scaffold application-name collision tests.

### BUILD-816 The build contains multiple physical copies of core

**Why.** Each physical core copy owns independent reactive state and Trusted Types
initialization, even when versions and bytes match. The diagnostic includes real
paths, versions and contributing entries.

**Fix.** Deduplicate core, make libraries declare it as a peer, and resolve every
entry to one physical package. One root reached by symlinks is not a second copy.

**In strict mode.** A warning. It is checked in production, with or without the
preview frame. Verified by `packages/build/tests/manifest-compatibility.test.ts`
> "reports two physical copies with splitting=%s, second version=%s and previewFrame off".
The check cannot identify a copy hidden in an arbitrary prebundled third-party
file that no longer identifies its core package.

### BUILD-817 Manifest references an asset the build did not emit

**Why.** A declared SSR route has no compiled module, or a referenced script,
stylesheet, font, preload or IR file is missing from the final output.

**Fix.** Correct compilation or route configuration. Declare a route as
browser-only explicitly when it does not have server output.

**In strict mode.** Always an error. Production staging is discarded; watch keeps
its last valid manifest until a successful rebuild. Verified by
`packages/build/tests/strict.test.ts` and
`packages/build/tests/manifest-compatibility.test.ts`.

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

### BUILD-818 Worker metadata cannot authenticate an asset

A protected immutable JS/CSS/WASM filename or its full canonical SHA-384 digest is
invalid. The build fails before replacing the prior output.

**Fix.** Generate the worker from the completed manifest after final asset bytes
are written. Do not substitute a filename hash or an abbreviated digest.

### BUILD-819 A route is over its size ceiling

The build classifies every route (DR-35) and holds it to its class's ceilings,
in gzip -9 bytes with 1 KB = 1,000 B and 1 KiB = 1,024 B (N2, restated by
decision brief L-55):

| Class | Chosen by | Forma's code | All of the route's JavaScript |
| --- | --- | --- | --- |
| `no-interactive-region` | a server-rendered route whose page has no island, or a route that lists no script | none | none: a service worker counted |
| `islands` | a server-rendered route with at least one island | 25,500 B | 75 KiB (76,800 B), or 365 KiB (373,760 B) for a route declared `canvas: true` |
| `whole-page-mount` | a route whose page the browser mounts whole: an entry declared `ssr: false`, or any route of an application built without `ssr` | 25,500 B | as islands |

Forma's code is `@getforma/core` and `alien-signals` as bundled, attributed from
the bundler's metafile (each input's share of the file's raw bytes, applied to
its compressed size), plus the identity banner `@getforma/build` writes at the
top of every JavaScript file (about 30 B gzip for each file the route loads
cold); Brotli is reported beside it. A route's JavaScript is the
`js` files and static `modulepreload` dependencies the manifest lists for it,
plus the generated `sw.js` when the route lists any script, since forma-server
writes the worker's registration only on a page that publishes a JavaScript
entry. The build fails before writing its output, naming each route over a
ceiling with its class and bytes, and the report above the failure shows every
route's figures. The same report is written as `size-report.json` beside
`manifest.json` (forma-server never serves it).

The error also fires when a file the manifest names for the route was written by
no bundling pass, so its Forma code cannot be attributed.

**Fix.** Trim what the route imports from `@getforma/core` or ships of its own,
or split the route. A page that hosts many modules (a canvas) is declared with
`canvas: true` on its route; the ceilings themselves are policy, not an option.
Verified by `packages/build/tests/route-size.test.ts` > "S7: a route at its
ceiling passes, a route one byte over fails naming the route and its bytes" and
"fails the build with BUILD-819 when a route's Forma code is over the ceiling,
leaving no output".

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
| `FORMA_E_HYDRATE_LIST_COUNT` | list matching; retained code | Server and client row counts differ. Supply the same initial rows; adoption does not trim or append rows to repair the mismatch. |
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
