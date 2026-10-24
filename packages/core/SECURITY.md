# Security Policy

## Reporting Vulnerabilities

Report security vulnerabilities to **victor@getforma.dev**. Do not open public issues for security reports. We will respond within 48 hours and provide a fix timeline.

## Architecture & Trust Boundaries

FormaJS v1.0.0+ uses subpath exports to segment capabilities by trust level:

| Import | Capabilities | Trust Level |
|--------|-------------|-------------|
| `@getforma/core` | Signals, DOM, components, state, events, islands | No network, no eval, no filesystem — but see *Unsanitized HTML sinks* below |
| `@getforma/core/runtime` | HTML Runtime (data-* directives) | Allowlist AST interpreter. **No `eval`, no `new Function`, no `with()` in the artifact** — grepped by `scripts/verify-dist.mjs` |
| `@getforma/core/runtime-hardened` | HTML Runtime (tree-shaken bundling) | Identical source and identical guarantee; a second bundling, kept because two documented CDN URLs point at it |
| `@getforma/core/http` | `createFetch`, `createSSE`, `createWebSocket` | Network access (intentional) |
| `@getforma/core/storage` | `createLocalStorage`, `createIndexedDB` | Browser storage access (intentional) |

The root entry's "no network" row is a real boundary, not a convention: `fetch`, `WebSocket` and the storage APIs live only behind their subpaths and are absent from the root barrel.

The proof is an EXACT export-surface pin per subpath, not a list of names asserted
absent: `toBeUndefined()` on a name the barrel never had passes with any typo and
can only fail if someone adds the export, whereas an exact set fails in both
directions — a network primitive leaking into the root barrel, and a documented
export silently disappearing from it.

Verified by: `src/__tests__/index-surface.test.ts` > "%s exports exactly the documented names"

### Unsanitized HTML sinks

`h()` builds DOM with `document.createElement` and writes text with `textContent`; the library never parses a markup string of its own. Six APIs, and two bindings of the HTML runtime, deliberately opt out. **None of them sanitizes**; all but `mountMarkup` should be treated as first-party-content-only, and `mountMarkup` bounds what the markup's expressions may do, not what the markup is:

- `dangerouslySetInnerHTML={{ __html }}` — prop on `h()` / JSX; assigns `innerHTML`.
- `setHTMLUnsafe(el, html)` — exported from `@getforma/core`; assigns `innerHTML`.
- `template(html)` and `templateMany(html)` — exported from `@getforma/core`; parse the markup into a cached `<template>` that compiled output clones.
- The `srcdoc` attribute — the browser parses the *attribute value* as a document, so attribute escaping does not neutralize it. It is emitted (a sandboxed `<iframe srcdoc>` is legitimate).
- The HTML runtime's `data-bind:srcdoc`, and `{item…}` in a list row's `srcdoc`, are refused with `FORMA_E_RUNTIME_SRCDOC` before evaluation or writing a document. Their diagnostics identify the binding; neighboring bindings continue. Unreviewed mounts retain their stricter `FORMA_E_UNREVIEWED_SRCDOC` admission diagnostic.
- `mountMarkup(root, markup, { tier, grants })` — exported from `@getforma/core/runtime`; parses `trustedHtml(markup)` under the explicit root and updates through its returned handle, then binds it with the grants it names (see *Tiered mounts* below). Its markup is still parsed as HTML: a `<form action>` a user submits, or a `<style>` that restyles the page, is the application's admission to refuse, and unreviewed markup belongs in the opaque-origin preview frame.

Each raw API requires `trustedHtml(markup)`, the named raw-HTML constructor (DR-19). Plain strings and look-alikes are refused with a stable `FORMA_E_RAW_*` code before the DOM sink, in development and production; `mountMarkup` uses `FORMA_E_MOUNT_ARGS`. The name is the control: a search for it finds every raw entry in an application, which is what a consumer's CI allowlist (SR8) lists with an owner and an end date. Where the browser has Trusted Types, `trustedHtml()` makes a `TrustedHTML` through Forma's policy `forma`, so a page whose policy carries `require-trusted-types-for 'script'; trusted-types forma forma-runtime` lets it through and reports or refuses a plain string at the same sink. Forma enforces this typed boundary even in browsers without native Trusted Types. What core writes of its own passes such a policy: `mount()` and its clears use `replaceChildren()`, and the runtime mount handle writes markup that arrived trusted through its own policy, `forma-runtime`, and its diff of that markup writes no `on*` attribute, script `src`, or URL attribute with a script scheme (see *URL and handler attributes in each sink* below). The policies are shared by every copy of core on a page through a registry on `globalThis` (`Symbol.for('@getforma/core#trusted-types')`) that holds no policy: it holds the mint `trustedHtml()` is, which SR8's lint lists as a raw entry, and a `forma-runtime` parser that takes only a browser `TrustedHTML`, so on an enforcing page no script can mint a `forma-runtime` value from a string. Said plainly: any script on the page, core's or not, can mint a real `TrustedHTML` of the `forma` policy through that registry, so `trusted-types forma forma-runtime` bounds which policy names exist, not who may call the mint; the boundary the directive enforces is that no script mints a `forma-runtime` value from a string, and a `forma` value marks a raw entry a consumer's allowlist (SR8) owns, as `trustedHtml()` itself does. `h('script')` is refused before construction with `FORMA_E_SCRIPT_ELEMENT`. See [CSP.md](./CSP.md#trusted-types).

Verified by: `src/dom/__tests__/element-url-safety.test.ts` > "srcdoc requires trustedHtml and strings are refused before the sink"
Verified by: `src/dom/__tests__/trusted-html.test.ts` > "core's own writes raise no Trusted Types violation: mount, unmount, the null clear, and every sink given trustedHtml()"
Verified by: `src/dom/__tests__/trusted-html.test.ts` > "every raw sink refuses strings before parsing, including an already cached trusted value"
Verified by: `src/dom/__tests__/trusted-html.test.ts` > "the shared registry holds no policy, and its forma-runtime handle mints nothing from a string"
Verified by: `src/__tests__/runtime-srcdoc.test.ts` > "data-bind:srcdoc is refused with its binding code while neighboring attributes work"

## Supply Chain Security Notes

### There is no `new Function` in the HTML Runtime

Expressions in `data-*` attributes are evaluated by an **allowlist AST interpreter** (`src/expr/`): lexer, precedence-climbing parser, validator, tree-walking interpreter. Every shipped artifact — `dist/runtime.js`, `dist/runtime.cjs`, the three classic-script builds (the `FormaRuntime` global, its hardened twin, and the preview frame's script, which defines no global), the hardened pair, and the Node-compatible runtime build — contains **zero `eval`, zero `new Function` and zero `with()`**. There is no opt-in switch, because there is no fallback to switch on: `setUnsafeEval()`, `isUnsafeEvalAllowed()` and `data-forma-unsafe-eval` were removed along with the code they guarded.

`scripts/verify-dist.mjs` greps every built artifact as the last step of `npm run build`, so this is asserted on the bytes that ship rather than inferred from the source.

Verified by: `src/__tests__/runtime-csp-default.test.ts` > "no build can reach new Function, with any configuration"
Verified by: `src/__tests__/runtime-csp-default.test.ts` > "never constructs a function, not even one that would have succeeded"
Verified by: `src/__tests__/build-artifacts.test.ts` > "no build emits new Function or a with() scope wrapper"

### Threat model

Three models drive every rule below. They are written down because the design that preceded this one failed the first outright.

- **T1 — the attacker controls the expression SOURCE.** Any app that server-renders user content into markup, or has any HTML-injection sink, hands the attacker a `data-computed` or `data-on:click` string. Worse: the runtime's MutationObserver auto-binds *injected* elements, so **every HTML injection sink is also an expression sink**. This is the model the grammar has to survive.
- **T2 — the attacker controls VALUES, not source:** `data-fetch` responses, `data-forma-state` attributes, `localStorage` via `data-persist`.
- **T3 — resource exhaustion:** huge arrays or deeply nested callbacks from T2 data.

### Why an allowlist, and what the blocklist it replaced could not do

The previous design compiled the expression with `new Function` and ran it inside `with (proxy) { … }`, guarded by a nine-name blocklist. Two structural failures, both verified rather than theorised:

1. **`with()` + `Proxy` is not a sandbox.** The proxy's `has` trap answered `key in scope.getters`. Returning `false` does not mean "undefined" — it means *"not mine, keep walking the scope chain"*, terminating at the global object. Every identifier that was not a declared state key resolved to the **real global**: `document`, `fetch`, `localStorage`, `window`.
2. **A static string scan cannot see a computed key.** `items['constructor']`, `items[k]` with `k` from server JSON, `items['cons' + 'tructor']` and `items[String.fromCharCode(…)]` all reached `Array` → `Function`, and the blocked name never appeared in the source text. That chain worked in the *CSP-safe* path, in the hardened build, with no `new Function` in the library.

The replacement inverts the relationship. A blocklist over a full evaluator must enumerate every hostile input, and the evaluator's semantics are the attacker's toolkit. An allowlist over an AST makes the interpreter's semantics the *only* toolkit, and it contains nothing dangerous — there is no equivalent of (2) against a table lookup, because `"constructor"` is not a key in any table.

### The five guarantees

- **G1 — closed token set.** The lexer never hands source to JavaScript. It recognises identifiers, decimal numbers, quoted strings, template literals and a fixed punctuator list; every other byte is a syntax error with a column. Only the eight simple escapes are decoded — `\u`, `\x` and octal are rejected at the lexer, which kills unicode-escaped-key bypasses before any semantics exist to bypass.
- **G2 — total consumption.** The parser must end at EOF. Leftover tokens are an error, never a silent fallback. This is the direct fix for the "no branch matched, return null, fall through to eval" shape of the parser it replaces.
- **G3 — exhaustive union.** AST nodes are a closed TypeScript discriminated union, and the validator and the interpreter both end their switch with `const never: never = node`. Adding a node kind without adding both cases is a compile error.
- **G4 — the validator is not the interpreter.** Two independent passes. The validator asserts node kinds, shape constraints and budgets; the interpreter **re-asserts** every safety-critical invariant (key filter, receiver kind, call target) at evaluation time rather than trusting the validator.
- **G5 — no escape hatch.** No path to `new Function`, `eval`, dynamic property dispatch, or a real intrinsic, enforced by a gate that reads the source of `src/expr/**`.

Verified by: `src/expr/__tests__/no-escape-hatch.test.ts` > "src/expr contains no path to the Function constructor or a global"
Verified by: `src/expr/__tests__/no-escape-hatch.test.ts` > "no property is read off a value with a computed key outside safeRead"
Verified by: `src/expr/__tests__/validate.test.ts` > "every AST kind has a validator case and an interpreter case"

### Identifier resolution never consults `globalThis`

Names resolve against, in order: arrow-parameter frames, `data-list` row locals, element magics (`$el`, `$event`, `$refs`, `$dispatch`, `$refetch`), the scope's own state and computed getters, and one frozen null-prototype table of captured intrinsics (`Math`, `JSON`, `Object`, `Array`, `Date.now`, `Number`, `String`, `Boolean`, `parseInt`, `parseFloat`). Then it **fails**, with a reported `FORMA_E_UNRESOLVED`.

`document`, `fetch`, `window`, `localStorage` and `process` are therefore not blocked — they are **unreachable**, because there is no code path that could find them. That is a property of the resolver's shape, not of a list someone has to keep current.

Verified by: `src/expr/__tests__/adversarial.test.ts` > "no global is reachable by name"

### Method dispatch never reads a property of the receiver

```
kind = kindOf(recv)                // Array.isArray / typeof — never instanceof
tbl  = METHODS[kind]
if (!hasOwn(tbl, safeKey(m))) throw MethodDenied
Reflect.apply(tbl[m], recv, args)  // captured intrinsic, frozen at module init
```

That one rule defeats, by construction: dynamic-key constructor access, prototype-pollution reach, receiver-supplied method impersonation (a T2 object carrying its own `filter` is not an Array, so `filter` is not offered — and even for a real Array the captured intrinsic runs, not the own property), `Array.prototype` poisoning by another page script, getter side effects on the method-lookup step, and `.call` / `.apply` / `.bind` escalation.

Two audited helpers are the **only** places member access is implemented:

- **`safeKey(k)`** — coerces to string, rejects symbols, rejects keys longer than 128 characters, and rejects `constructor`, `__proto__`, `prototype`, `__defineGetter__` / `__defineSetter__` / `__lookupGetter__` / `__lookupSetter__`, `eval`, `Function`, `call`, `apply`, `bind`, `caller`, `callee`, `arguments`. It runs on the **evaluated** key, whatever syntax produced it, which is what makes every spelling of a bypass the same case and all of them dead.
- **`safeRead(recv, key)`** — a nullish base yields `undefined` (absent data, not a failure); host receivers dispatch by kind; `length` is allowed on arrays and strings; a plain object or array data key requires an **own** property whose descriptor is a **data** descriptor, so a poisoned getter never runs and the prototype chain is never walked; anything else is a reported denial.

Verified by: `src/expr/__tests__/adversarial.test.ts` > "every spelling of a constructor reach is denied"
Verified by: `src/expr/__tests__/adversarial.test.ts` > "a poisoned Array.prototype.filter is not what runs"
Verified by: `src/expr/__tests__/adversarial.test.ts` > "an accessor property is refused instead of invoked"
Verified by: `src/expr/__tests__/adversarial.test.ts` > "a receiver's own filter is never invoked"

### The DOM is reachable only through a wrapper

`$el`, `$event`, `$refs` and everything they hand back — `classList`, `style`, `dataset`, `closest()`, `querySelector()`, `event.target` — are **wrapped**, and the wrapper survives every hop. Reads, writes and calls are restricted to fixed per-kind tables. `$el.ownerDocument`, `$el.parentNode`, `$el.innerHTML`, `$el.style.cssText`, `$event.view` and `$refs.x.ownerDocument.location.href` are denials with a diagnostic, not answers.

Before this, `$refs` returned the **raw** element, and `data-text="{$refs.r.ownerDocument.location.href}"` read the real page URL from inside a "CSP-safe" expression in the hardened build, with no diagnostic at all.

Verified by: `src/expr/__tests__/adversarial.test.ts` > "$refs.r.ownerDocument.location.href is denied"
Verified by: `src/dom/__tests__/el-magic-safety.test.ts` > "$refs hands back a wrapped element, not the live node"

### Tiered mounts: roots handed in, grants, a bound on `$el` (2.1.0)

Tiered mounts were introduced in 2.1.0 to bound the authority of admitted markup (v2 TH11). In 3.0, `mountMarkup(root, markup, { tier, grants, config })` is the only HTML-runtime binding path, including for first-party pages. The application supplies marked reviewed markup, an owned root, the required tier and only the grants that content needs (decision brief DR-14, DR-15, L-36, L-47; the full reference is `docs/HTML-RUNTIME.md`, *Mounting markup you did not write*):

- **Every binding belongs to an explicit mount.** Loading the runtime, DOMContentLoaded and DOM changes do not bind markup. The runtime has no body observer or tierless lifecycle exports. `mountMarkup()` requires a tier, its handle owns updates/disposal, and captured ownership permits disposal after a scope is moved or detached. The old manual script attribute is obsolete; its development warning grants no authority.

- **Its configuration comes only from its call.** Set the step budget through the mount's `config.exprBudget`; script-tag attributes and global configuration do not change a mount.
- **The wrapper is bounded by the root.** Every hop from `$el`, `$event` or `$refs` that yields an element is checked against the root, and one past it is refused with `FORMA_E_GRANT_DOM` unless the mount grants `dom`; so is a selector that asks about an ancestor or a sibling (`$el.matches('[data-email^="a"] *')` would read an attribute of the page one character at a time). `closest()` without `dom` never tests an element outside the root: its walk stops there and answers `null`, as no match does. (Before formajs#30's review it tested the outside ancestors and refused a match, and that refusal against no match read an ancestor's `data-secret` a character at a time in all three engines.)
- **`data-fetch` sends only what the `fetch` grant names** (methods, path prefixes checked after the URL parser normalises the path, cookies or not, a timeout up to 30 s), and **`click()` needs `navigate`**, as does `$dispatch` of an activation event (`click`, `auxclick`, `DOMActivate`, `submit`, `reset`): WebKit follows a link, submits or resets a form on an untrusted `click`, `auxclick` or `DOMActivate`, and Firefox on an untrusted `submit` or `reset`. Redirects are refused before a second request: the grant authorizes the initial URL only. A network or redirect rejection before a response writes `FORMA_E_FETCH_REQUEST: data-fetch failed before a response; redirects are not followed` to its error target; the browser does not distinguish those causes. A status outside 200-299 is an error, never data.
- **Every denial is a coded `formajs:diagnostic`**, whatever any diagnostics switch says, counted per mount.
- **An `unreviewed` mount** refuses every origin but an opaque one, takes no grants, and renders no `<link>`, no `srcdoc`, no `on*` handler attribute and no URL attribute with a script scheme: the markup is parsed once, in the root's own context, and every `<link>`, `srcdoc` attribute, `on*` attribute and URL attribute whose value has a script scheme (judged against its element's tag, as every attribute sink judges it) is removed from those nodes (`FORMA_E_UNREVIEWED_LINK`, `FORMA_E_UNREVIEWED_SRCDOC`, `FORMA_E_UNREVIEWED_HANDLER`, `FORMA_E_UNREVIEWED_URL`), the nodes themselves are written (never a string the root parses again: a second parse re-created a `<link>` the first had not shown, through nested `<form>`, `<math>`, `<mglyph>` and `<style>`), the live subtree is checked after every write and the render refused if anything is found, and `data-bind:srcdoc` is refused before it runs. `<link>` and `srcdoc` because WebKit opened a connection for `<link rel="preconnect">` from inside the sandboxed preview frame, which no CSP directive governs, and for one inside an `<iframe srcdoc>` (the A2 audit, S1; formajs#35's review, B1 and S2). Handler and URL attributes so that the frame does not depend on its policy alone for them (FORMA-276): its hash-only `script-src` and Trusted Types refused them before, and still do.

Leaving out `grants` gives none in 3.0. The application chooses the tier and passes grants only for content whose hash matches what was reviewed (L-47); Forma enforces what the mount grants and cannot check which tier content deserves.

Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "binds only under the root it is handed: markup injected outside it stays unbound"
Verified by: `src/__tests__/runtime-explicit-mount.test.ts` > "import, DOMContentLoaded, injected nodes and state-attribute changes never bind without a handed root"
Verified by: `src/__tests__/runtime-explicit-mount.test.ts` > "exports only explicit mount lifecycle and host inspection helpers"
Verified by: `src/__tests__/runtime-explicit-mount.test.ts` > "warns once about the obsolete manual switch and names the replacement mount call"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "no hop from $el reaches past the mount root: %s"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "closest() without dom never tests an element outside the root: an outside ancestor's attribute cannot be read a character at a time"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "$dispatch of an activation event needs navigate: %s"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "a selector that reads past the element needs dom: %s"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "with explicit empty grants a generated tree binds neither data-fetch nor $el.click()"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "a 404 with a JSON body lands in the error: target, not the data target"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "a seeded denial raises one coded diagnostic, whatever the page's diagnostics switch says"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount refuses any origin but an opaque one, and any grant"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount renders no <link>: each is removed before the markup reaches the document"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount parses its markup once, in the root's context, and writes no string to the root"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount renders no srcdoc: the attribute is removed, a binding that would write one is refused, and each is reported"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount fails closed: a <link> that reaches the root after the strip is removed, reported, and the markup refused"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount renders no script URL and no handler attribute: each is removed and reported, on the first render and on update"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount fails closed: a script URL or handler attribute that reaches the root after the strip is removed, reported, and the markup refused"

### Termination and budgets

The language has no loops, no recursion, no generators and no way to name or store a function, so **every expression terminates by construction** — an arrow is legal only in the callback slot of nine allowlisted array methods, and cannot be assigned, stored, returned or re-invoked. Budgets therefore bound *cost*, not hanging: 4,096 source characters, 512 AST nodes, depth 32, arrow nesting 2, four call arguments, and a 100,000-step evaluation budget configurable per mount through `config.exprBudget`. The step budget counts interpreter nodes, not the work inside a built-in, so **every built-in call is also charged before it runs** against an allocation budget (DR-16): 250,000 units, where a unit is about the cost of one `Array.from` slot. A call pays a unit for each array slot or string character it produces or converts; string calls that amplify nothing (case mapping, searching, trimming, slicing) pay their measured cost per character. Case mapping is tiered by the costliest character of the text: Latin-1, and the general punctuation, currency signs and letterlike symbols that map to themselves (U+2000 to U+20CF, U+2100 to U+2125: curly quotes, dashes, `…`, `€`, `™`), lowercase at 1/32 of a unit a character; text whose first character above those is in a script whose ordinary text measured 4 to 19 ns a character (Latin Extended, Greek, Cyrillic, Armenian, Hebrew, Arabic, the Indic scripts, Thai, Vietnamese, CJK, kana, Hangul, emoji) at 1/16; anything else (Georgian, Cherokee, Greek Extended, fullwidth Latin) at 1/2. Turkish `İ` (U+0130) is a Latin Extended-A letter, so text with it is priced 1/16 too, though it lowercases to two characters and measured 27 to 30 ns. Lowercasing 260 characters of English therefore costs about 8 units, and of Greek about 16. A case-mapping call on more than 1,048,576 characters, the result cap it would pass anyway, is refused before it runs. Each call is charged the weight of its arguments as text (most built-ins convert an array argument with `join`; the few that read arguments as data, such as `Object.keys` and `Array.from`, are charged their element count instead, and a string method reads a string argument for a thirty-second of a unit a character), then its row in `src/expr/cost.ts` (`map` the receiver's length, `repeat` the receiver's length times the count, `Array.from` the length it is asked for, a default `sort` the comparisons and the length of each string element it compares, …). Converting an array or object with an operator (`'' + list`, `` `${list}` ``, `list < 1`, `x += list`) is charged the same way; `===`, and `==` against `null` or between two objects, convert nothing and are not charged.

**Two bounds keep the stack, not the cost, in check** (FORMA-274). The budgets count steps and units, not how deep the engine's stack goes, and two shapes overflowed it inside every budget: a RangeError (Firefox: InternalError) out of `mountMarkup`, or an uncaught page error.
- **A value nested more than 100 arrays or objects deep is refused** with `FORMA_E_BUDGET` (`a value nested over 100 deep`) before anything converts it. Converting a value recurses through its nesting (`join`, `String()`, a default `sort`, `JSON.stringify`, an operator), and `String()` of nested arrays overflowed past 785 levels in Firefox 157 (622 under 2,000 frames of a caller), 2,822 in Node 24 (2,185), 4,112 in Chromium 156 (3,178) and 4,990 in WebKit 27.2 (4,771). The deepest values in the founder's applications nest 5 levels in a `data-forma-state` (1,481 parsed) and 23 in any JSON file of theirs (1,000 files, a CDK tree; their `data-fetch` fixtures 4). The check is part of the walk that prices every conversion (`weigh`), so it covers every source a value comes from: state, a response, storage, `setScopeValue`, a handler's write, and an expression that built it (`Array.from({length: 10000}).reduce(a => [a], 0)` made 10,000 levels inside every budget, which no check where data enters would see). With the `toString` check below it adds 1 to 7% to that walk (0.12, 1.2 and 12 MB of records, Node 24, three runs, each the median of 21).
- **At most 32 evaluations nest**: a computed read by another, or a handler that `$dispatch` or `click()` runs from inside an evaluation, each nest one more. A chain of 1,000 computeds overflowed Chromium's and Firefox's stack out of `mountMarkup`, and a handler that dispatched its own event to itself recursed into an uncaught page error in all three engines. The longest chain of computeds in the founder's applications is 4. The 33rd is refused with `FORMA_E_BUDGET` before it starts. A computed refused this way has read nothing, so it is computed again on its next read after the task, instead of keeping the refusal as its value.

Both are final and arm nothing, like the refusals that check a length or a count (FORMA-249). Together they leave the stack room: 31 handlers relayed by `$dispatch`, the last converting a value 100 deep, ran in Chromium 156, Firefox 157 and WebKit 27.2. What they do not bound is the nesting of the markup itself: *Known gaps*.

**Operators on strings are charged too** (FORMA-028). Joining keeps the pieces as a rope, which the first read of it copies whole, so a short expression with no state could build a 524,288-character rope in 19 steps and read copies of it for seconds. Now `+`, `+=` and template literals pay a 128th of a unit for each character they build past 511; comparing two long strings pays a 128th a character compared; an operator that parses a long string as a number (`s * 1`, `-s`, `s < 1`, `s == 1`) pays an eighth a character; and comparing, or reading a character of, a string the same expression has just built with `+` pays for copying it (8 units plus a 32nd a character, to 512). Each case of the review that found this is refused in under 30 ms at 4x CPU throttling, where 2.0.3 took 0.6 to 4.3 s. A write that would grow an array past 250,000 elements is refused, so a handler cannot make a sparse array longer than one evaluation could build. Past the budget the call is refused with `FORMA_E_BUDGET` and never runs, so `Array.from({length: 12000000})` costs nothing, where 2.0.1 built a 139 MB array in a 300 ms task before refusing it. `repeat` ≤ 10,000 and `flat` depth ≤ 8 are refused before the call as before, and results stay capped at 1 MiB strings (now for `+=` too) and 1,000,000-element arrays.

**Both budgets are one per task, and one per event** (FORMA-028). The runtime keeps a meter of what the evaluations of the current task have spent, and every evaluation it starts counts on from it; one that starts inside another (a `data-computed` read by a binding, a handler that `$el.click()` or `$dispatch` reaches) spends the running one's budget. Ten bindings at the cap in one widget used to run ten budgets in one task, 382 ms at 4x. A binding refused only because the bindings before it in its task spent the budget is not reported: it re-runs in the next task, where it starts first, so the ten bindings render one task at a time, none over 42 ms at 4x (p99 of 41 runs). A binding over the budget on its own is reported as before; a computed refused inside a reader is evaluated alone at the start of the next task, so its failure is never cached as its answer. A binding waits only if the task had spent allocation units before it. A charge that a cost-table row sizes directly and that is larger than the whole budget is reported at once; a weighed value that heavy, arriving late in a busy task, is counted only to the room left, so it waits once, is weighed in full when it runs first, and is then reported once. Once a binding waits, each later charge in the task is counted only to 10,000 units: lighter bindings still render now, and heavier values are refused after counting that far, cheaply, and render in later tasks; a waiting binding is not weighed again in full in every retry (FORMA-173). The cap bounds what each binding after a wait counts; together, the refusals after a wait count at most 50,000 units in a task, and one cap more, however many bindings wait. Past that the cap is 0: every later charge in the task is refused at once (a list on its length alone), and a light binding that charges anything waits a tick too. 400 bindings after a wait, each a little over or under the cap, made tasks of 66 and 69 ms p99 at 4x with the cap alone, and 24 and 15 ms with the allowance; ten or twenty bindings each weighing most of the budget, or twenty each a little heavier than the room left, at most 24 ms (`scripts/measure-task-budget.mjs`, group F). The cap is read from the meter at each charge, so a binding the reactive flush runs inside another evaluation sees a cap set while that one ran. A binding too heavy for any task, refused with nothing spent before it in its task, is weighed to the whole budget and reported, once; that refusal arms the same cap as a wait and counts the cap toward the same allowance (FORMA-178), so the bindings after it are counted only to the cap: one that is too heavy for any task waits, is weighed in full once in a task where it runs first, and is reported there. Only a refusal the budget meter makes does this. A refusal that checks a length or a count (`repeat()` past 10,000, `flat()` deeper than 8, a string past 1 MiB) arms nothing itself, so a binding after it that fits renders in the same task (FORMA-249); but what the evaluation charged before that check stays on the task's meter, as any evaluation's charges do, and `repeat()` and `flat()` are charged their cost-table row before their count or depth is checked. So `'x'.repeat(20000)` leaves its 20,000-unit row charge on the meter and is then refused on its count, arming nothing; but a charge before the check that does not fit is an allocation refusal, which arms the cap: `'x'.repeat(300000)` and `'x'.repeat(1000).repeat(20000)` are refused on their row charge before the count is read, and `Array.from({length: 300000}).flat(99)` on `Array.from`'s before `flat()` runs (FORMA-250, from FORMA-249's review). Several such bindings are therefore reported one to a task, not all at once, and a binding that would have fitted the room left after a reported refusal waits a task if it is past the cap. A light binding still renders in the same task only while at most five bindings too heavy for any task come before it: each reported refusal or wait counts 10,000 units toward the 50,000-unit allowance, so the cap is 0 from the sixth and a light binding that charges anything waits. Measured on twenty `label.toUpperCase()` bindings after N such bindings (FORMA-249): none waits for N up to 5; with each of the N refused at once on a charge a cost-table row sizes, six are reported to a task and the light bindings wait 1 tick for N=6 to 10, 2 for N=12, 3 for N=20 and 6 for N=40; with each a 75,000-number list converted to text, one is reported to a task and they wait N-5 ticks (1 for N=6, 5 for N=10, 35 for N=40). Before FORMA-178 they rendered in the same task in every case; the delay is stale text for those ticks, not a longer task. Only light bindings that come after the heavy ones in document order wait; those before them render as before. In milliseconds, as FORMA-249's review measured it (Chromium 156 at 4x CPU throttling on an M1 Pro, median of 7 runs at a load average of 5 to 8, where one tick took about 4.3 ms): for N=40 in the list form the last light binding rendered about 152 ms after the update, against 96 ms before FORMA-178, when one 96 ms task blocked the page until all of them rendered, and the longest task is now 4.5 to 4.8 ms; in the row form, 16 ms against 6.5 ms. Twenty bindings each of a 300,000-unit list made a 53 ms task at 4x and forty a 99 ms task (FORMA-173's final review); now the worst task is at most 19 ms for twenty and 6 ms for forty, each reported once (`scripts/measure-task-budget.mjs`, group G). A handler cannot be re-run later, so an event the runtime has not seen starts a fresh meter, unless an evaluation dispatched it (`$dispatch`, `$el.click()`): that event is part of the evaluation's task, and keeps its meter and its cap. The handlers an event reaches as it bubbles share its meter; the bindings they update spend what is left, and render in the next task if it is not enough. The runtime's own conversions of a result to text (FORMA-025: `data-text`, `data-bind:*`, `data-model`, `data-persist`, and a `data-list` row's `{item}` placeholders and key) are charged the same way inside the binding's budget before they run, so a list of a thousand references to one 300,000-character string is refused before `String()` would write 300 million characters. The budgets are sized from the tail of measurements at 4x CPU throttling, with garbage collection counted (`scripts/measure-alloc-budget.mjs`, `scripts/measure-task-budget.mjs`).

**What the budgets do not bound.** The meter is zeroed by each event the runtime has not seen (`begin`), not only between tasks, so the events one task delivers each get a budget: one click or keystroke dispatches several, and a form submission one per control (review S1). A widget that binds handlers to all of them can spend a budget per event in one task; under A14 every widget is the founder's reviewed code, and that is carried with the cases below. A price per character cannot see content, and three costs depend on it. A string search whose pattern's first characters fill the text (`'ab'` in `'aaaa…'`) measured 39 ns a character at 4x where ordinary text takes under 1, so one evaluation of such searches ran up to 315 ms. A string stored two bytes a character (any string that held a character above U+00FF, or a slice of one) costs up to about four times its case-mapping tier's charge, so seven or eight `toLowerCase` calls on 1 million such characters ran 56 ms, and up to 100 ms for alternating-case text. And the tier of a text is read from its first character above Latin-1, because a full scan of two-byte text measured 6 to 7 ns a character, most of the cost of lowercasing it: lowercasing all-capital Greek measured up to 19 ns a character, about three times its 1/16 charge, so four calls on 960,000 such characters ran 73 ms, Turkish `İ` text, priced 1/16 with no prefix, 76 ms for one call on a million characters before the 1 MiB cap refused its two-million-character result, and text that opens with one Greek letter and continues in Cherokee (up to 39 ns a character) 90 ms. The bound is what one task's 4 million characters at 1/16 cost at the costliest lowercasing measured, about 40 ns a character: about 160 ms a task (review S3). Each is bounded per task, to one evaluation, not to 50 ms. And a `data-list` pass is bounded only by an absolute cap, not by the task's budget (FORMA-172). A list built a row of DOM for every item however little the expression that made them cost: `Array.from({length: 249990})` was 249,990 template clones in one task, 3.2 to 4.0 s at 4x on an M1 Pro (250,000 numbers from state, 3.3 to 4.3 s). Now a pass whose rows times the weight of a row pass 160,000 is refused, on the list's length, before any item is read or any row is built; a row weighs 1, and 1 more for each element and attribute of the row template, a nested `<template>`'s contents included, since a pass builds the rows it lacks and rebinds the rest at about 4 to 7 µs a unit of weight at 4x. It reports `FORMA_E_BUDGET` ("a data-list of rows weighing 2 is refused past 80000 rows (rows × weight is capped at 160000)") against the list's expression, marks the list `data-forma-expr-error`, and keeps the rows it had. The refusal itself checks a length and charges nothing, so, like the other refusals that check a length, it arms no cap and delays nothing after it (FORMA-249); what the list's expression charged before it stays on the task's meter, as any evaluation's charges do. In the Chromium e2e test at 4x, which requires the refusal to take under 50 ms, 250,000 items were refused in 4.2 to 4.5 ms on the M1 Pro and in 7.6 to 13.4 ms on a CI runner in runs 40032265860, 40034377741, 40040340320 and 40042343018, and in `scripts/measure-task-budget.mjs` in 0.8 ms (p50); `Array.from({length: 249990})` is refused in 23 ms, its own `Array.from` at the allocation cap. The cap is sized from the templates the founder's applications actually serve: vector-studio recompiles every stored module when it loads it and stamps `data-fm` on every element, so its team-roster row weighs 150 (27 elements, 122 attributes) and its todo-list row 144 (21 and 122), the heaviest of the row templates found (the stored files weigh 123); 1,000 rows of either fit, with room for templates up to 160. Under the cap nothing changed: a list is not charged to the task's budget and renders in the task that hands it its items, however long that is, as on 3.0.0. The largest lists the cap admits took, at 4x, median of 21 runs on an M1 Pro under load: 1.1 s (80,000 `<li>` rows), 1.4 s (11,428 table rows with five directives each) and 1.4 s (6,956 rows of 22 elements); 1,000 served todo-list rows took 1.1 s and the 1,066 served team-roster rows the cap admits 0.6 s. A CI runner (GitHub ubuntu-latest, 4x, two Playwright workers) is about two to three and a half times as slow: its Chromium e2e test printed 3.5 s for the 80,000 `<li>` rows, 4.6 s for the 11,428 table rows, 3.9 s for 1,000 served todo-list rows and 1.9 s for the 1,066 served team-roster rows in run 40032265860, and 2.2, 2.6, 2.9 and 1.1 s in run 40042343018. A refused list can show a page of its data instead: ask for it where it is produced, or slice it in the expression (`items.slice(start, start + 200)`, itself charged the length of the array it reads, so for arrays of up to about 250,000 items). A list too big to build in 50 ms at 4x (about 4,000 `<li>` rows, or 500 such table rows) but under the cap still makes one long task, as before; rendering it across tasks is FORMA-255. The cap is per pass, so it does not bound what one pass's rows hold: an outer list whose rows each hold a list makes all those lists in one task, and ten rows each holding a static list of 69,999 `<li>` rows (`data-list="{ item.products }"`) built 699,990 rows in one task of 6.8 to 14.5 s at 4x on an M1 Pro (6.8 to 7.9 s in the implementer's runs, 12.7 s in the first review's, 11.9 s median and 14.5 s at most in the last review's), with no diagnostic, as on 3.0.0. The inner lists are priced only when their expression is written exactly `{item.x}`, which the outer list's placement pricing happens to weigh (FORMA-025), not with spaces or without braces as vector-studio writes them. A per-task list allowance is FORMA-255's. The weight counts elements and attributes, not what they cost: cloning and inserting `<iframe>` measured 4.6 ms at 4x, `<video>` 306 µs and `<audio>` 243 µs against a median element's 1 µs, and 100 `<iframe>` rows took 374 to 471 ms at 4x, so the 80,000 the cap admits would take five to six minutes. A directive that does not compile is reported again in every row, about 0.2 ms a directive (the served todo row has three such handlers, half its cost). And the weight counts neither the comments in a row template, each a comment node cloned with every row, nor the `{item}` placeholders in its text: the placeholders in one run of text share one text node, written once a row, and each placeholder is one conversion to text and two appends a row (its value, then the text after it). So a list of such rows can take far longer than its weight suggests. The largest ordinary evaluation is near the line too: the 9,000-record search measured 24 to 50 ms median at 4x across six scripts (ASCII 24 ms, Greek 50), where 2.0.1 measured 19 to 42 ms in the same session.

Verified by: `src/expr/__tests__/adversarial.test.ts` > "a nested callback over a large array trips the step budget"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "%s of a value nested 10,000 deep is refused with FORMA_E_BUDGET on its element"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "a value an expression builds itself is refused the same way: no entry point sees it"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "a deep value from data-fetch, data-persist, setScopeValue or a handler write is refused where it is converted"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "a value 100 deep renders and one 101 deep is refused; the deepest state and fixtures found in the app corpora render"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "a chain of 31 computeds read by a binding renders; one of 32 is refused with FORMA_E_BUDGET, never a stack overflow"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "a handler that dispatches its own event to itself stops at the cap, with one diagnostic"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "a computed refused for nesting is computed again on its next read, not cached as failed"
Verified by: `src/expr/__tests__/adversarial.test.ts` > "an argument that would allocate hundreds of megabytes is refused"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "every allowlisted native refuses an argument heavier than the budget before it runs"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "every size-driven cost refuses a hostile size before the native runs"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "the budget is per evaluation and cumulative across its calls"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "an operator does not convert a value heavier than the budget"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "loose equality charges only an operand it converts"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "a handler cannot grow an array past the allocation budget"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "a native that reads its argument as data is charged its element count, not its text"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "a text search over records is answered as on main"
Verified by: `src/expr/__tests__/native-cost.test.ts` > "case mapping is charged by the costliest character of its receiver"
Verified by: `src/expr/__tests__/string-growth.test.ts` > "every round-2 rope case is refused before the long task"
Verified by: `src/expr/__tests__/string-growth.test.ts` > "a template literal and += are charged by the length they produce"
Verified by: `src/expr/__tests__/string-growth.test.ts` > "comparing long strings is charged by the characters compared"
Verified by: `src/expr/__tests__/string-growth.test.ts` > "comparing or reading a string just built is charged for copying it"
Verified by: `src/expr/__tests__/string-growth.test.ts` > "an operator that parses a long string as a number is charged for it"
Verified by: `src/expr/__tests__/string-growth.test.ts` > "a string method reads a string argument for a thirty-second of a unit a character"
Verified by: `src/expr/__tests__/ordinary-search.test.ts` > "a search over 900 and 9,000 records of %s text is answered"
Verified by: `src/__tests__/runtime-task-budget.test.ts` > "ten bindings at the cap spend one budget per task and all of them render"
Verified by: `src/__tests__/runtime-task-budget.test.ts` > "a binding over the budget on its own is reported, not retried"
Verified by: `src/__tests__/runtime-task-budget.test.ts` > "a chain of computeds spends one budget between them"
Verified by: `src/__tests__/runtime-task-budget.test.ts` > "a computed refused inside a heavy reader is evaluated again on its own"
Verified by: `src/__tests__/runtime-task-budget.test.ts` > "the handlers one event reaches share one budget"
Verified by: `src/__tests__/runtime-task-budget.test.ts` > "a length or count refusal arms nothing, but the charges before it stay on the meter and one that does not fit arms the cap"
Verified by: `src/__tests__/runtime-text-cost.test.ts` > "data-text of a value heavier than the budget is refused before it is converted"
Verified by: `src/__tests__/runtime-text-cost.test.ts` > "every other conversion of a result to text is refused before it runs"
Verified by: `src/__tests__/runtime-list-cap.test.ts` > "a list of 250,000 items is refused before any item is read"
Verified by: `src/__tests__/runtime-list-cap.test.ts` > "a list of Array.from({length: 249990}) builds no row"
Verified by: `src/__tests__/runtime-list-cap.test.ts` > "a list exactly at the cap renders, and one row more is refused"
Verified by: `src/__tests__/runtime-list-cap.test.ts` > "a refused list is reported once, naming the data-list and its row limit, and keeps the rows it had"
Verified by: `src/__tests__/runtime-list-cap.test.ts` > "a page of a long list renders: the remedy the docs give for a refused list"
Verified by: `src/__tests__/runtime-list-cap.test.ts` > "1,000 rows of each of the heaviest row templates vector-studio serves render, in the task that hands the list its items"
Verified by: `src/__tests__/runtime-list-cap.test.ts` > "the heaviest served row template renders up to the cap and is refused one row past it"
Verified by: `src/__tests__/runtime-list-cap.test.ts` > "a 1,000-row table with directives in every row, and an ordinary list, render as before"
Verified by: `src/__tests__/runtime-list-cap.test.ts` > "the contents of a <template> in a row count toward its weight"
Verified by: `src/__tests__/runtime-list-cap.test.ts` > "each list inside the rows of another is checked on its own"
Verified by: `src/__tests__/runtime-list-cap.test.ts` > "a list under the cap charges the task nothing: the bindings in its rows and after it render in the same task"
Verified by: `src/__tests__/runtime-list-cap.test.ts` > "a refused list delays no binding and no list after it"

### Failure is always visible

An expression that cannot be compiled or cannot be evaluated is **not evaluated, and says so**: a `console.error` naming the code, the message and the column, a `formajs:diagnostic` event, an entry in `getDiagnostics()`, and a `data-forma-expr-error` / `data-forma-handler-error` attribute on the element. The binding writes nothing — the DOM keeps what it had, and the string `undefined` is never rendered. `undefined` is a legitimate VALUE, so it can never double as an error signal.

Verified by: `src/__tests__/failure-semantics.test.ts` > "a denied expression leaves the previous text in place and never renders undefined"
Verified by: `src/__tests__/failure-semantics.test.ts` > "a genuine runtime bug is not swallowed as an expression denial"

**A `data-on:` name in Vue or Alpine modifier syntax is reported the same way** (FORMA-269). `data-on:click.stop` listened for an event named `click.stop`, which no browser dispatches, so the handler never ran and nothing said so. A key event with anything after a dot, or an event whose first suffix is one of their modifiers (`stop`, `prevent`, `once`, `self`, …; docs/HTML-RUNTIME.md lists them), is now refused as `FORMA_E_UNSUPPORTED` on its element and binds no listener. Refusing a modifier does not perform it: under a refused `data-on:submit.prevent` the form still submits, as before FORMA-269. Any other dotted name is a custom event and binds as before.

Verified by: `src/__tests__/runtime-event-modifiers.test.ts` > "data-on:click.stop is refused with a coded diagnostic that names the attribute, and binds no listener"
Verified by: `src/__tests__/runtime-event-modifiers.test.ts` > "plain event names and dotted custom events bind as before, with no diagnostic"
Verified by: `src/__tests__/runtime-event-modifiers.test.ts` > "a refused .prevent prevents nothing: the default still happens, as before FORMA-269"

**An allowlisted native that throws is reported the same way** (FORMA-271). `JSON.parse('{')`, `(1).toFixed(500)`, `(1).toString(1)`, `Object.keys(null)`, `Array.from(null)`, `[].reduce(f)`, a higher-order method called with no callback, a selector the DOM cannot parse (`$el.matches('#1')`) and `classList.add('')` throw on their arguments. Each is now refused as `FORMA_E_CALL_FAILED` on the binding that made the call, with a message that names the method and the native's error, its text cut at 200 characters (`number.toFixed() threw RangeError: toFixed() digits argument must be between 0 and 100`). The rest of the markup binds. Before, the exception escaped `mountMarkup` from any binding and left the whole module unbound. From a handler it was an uncaught page error with no diagnostic.

Only the native call is converted. The interpreter makes every allowlisted call through one wrapper. An error that Forma's own code throws while a native runs it passes through as it is, whether it is a real bug or an expression error with its own code: an arrow callback, a handler that `click()` dispatches, a computed that a callback reads, and the runtime magics `$dispatch` and `$refetch`. Code an application put in reach and a native runs is converted, because the native call is what threw: a `toString` or getter of a value the application put in state, or the application's own override of an element method.

The refusal is final and arms no cap, like the refusals that check a length or a count (FORMA-249): the same call would throw again in a later task. What the call was charged before it ran stays on the task's meter.

The message can quote part of the call's argument, which may be T2 data, up to the 200-character cut. In Chromium 156, `JSON.parse` quotes the first characters of the text it refused, and a DOM method quotes the selector it could not parse. The message reaches the console, `getDiagnostics()` and the `formajs:diagnostic` event, and so any telemetry that hooks them; the last two are skipped only when the mount turns diagnostics off. The preview frame forwards it to the host as untrusted text. A throw during a render reached the host before this change too, as `FRAME_E_RENDER`; a throw at event time was an uncaught error in the frame and did not reach the host at all, and now reaches it the same way. Markup cannot read it.

**What else threw is reported the same way** (FORMA-274). FORMA-271's review listed what still escaped `mountMarkup`, or failed at event time as an uncaught page error. Each was reproduced in happy-dom and Chromium 156 with the built runtime, and each is now a coded diagnostic on the binding that met it, the rest of the markup binding and working:
- a `data-bind:` or `data-class:` with nothing after the colon is refused when it is bound, `FORMA_E_UNSUPPORTED` (`data-bind: has no name`); the runtime wrote the empty name (`setAttribute('')`, and in browsers `classList.toggle('')`);
- the runtime's own DOM write of a binding's value that the browser refuses: `data-model` writing a file input's `value` or a non-number to a `<progress>` or `<meter>`; under an enforcing Trusted Types policy, `data-bind:src` or `data-text` on a `<script>`, or a `src` in a `data-list` row. `FORMA_E_CALL_FAILED` (`data-model write threw InvalidStateError: …`), at mount and on every later run, where a later run used to reach `onError()` only;
- a value nested too deep (*Termination and budgets*);
- a value converted to text or a number whose `toString` is not a function: an object JSON shadowed (`{"toString": 1}`), or an array a handler gave one (`list.toString = 1`). Converting it threw a TypeError wherever something but a native converted it: an operator, a template literal, `data-text`, `data-bind:`, Forma's own argument checks, a key, a `data-list` key, a style or dataset write. It is refused before the conversion, `FORMA_E_CALL_FAILED` (`a value whose toString is not a function`), by the same walk. Only where a value is converted to text or a number, and only the values that conversion reaches: the value, and each element of an array it converts, at any depth; never an object's members, which converting the object does not touch. A value serialized or handed on as data is never refused for it: `JSON.stringify`'s value, `$dispatch`'s detail, `data-persist`, a row's whole `{item}`, `Array.from`'s array-like. So a dictionary keyed by user input that has a `toString` key still serializes, persists, renders as a row and travels as an event's detail;
- a sort comparator's result, which the native converts after the comparator stepped, so the wrapper took its error for Forma's: it is priced, and refused, as an operator's operand is;
- an event-time property write the browser refuses (`$el.dataset['a-b'] = 1`, a file input's `value`, a `<progress>` or `<meter>` `value`, `max` or `min`, and under Trusted Types a `<script>`'s `textContent` or `innerText`): made through the native wrapper, `FORMA_E_CALL_FAILED` (`$el.value = … threw InvalidStateError: …`) on the handler's element;
- a DOM method that answers a promise that rejects (Chromium 156's `scrollIntoView({behavior: 'bad'})`): the rejection is caught and reported on the element, `$el.scrollIntoView() rejected TypeError: …`, never left unhandled;
- what application code throws through a native that cannot be converted to text (`Object.create(null)`, an object whose `toString` throws): named `an unprintable value`, where the wrapper's own `String(e)` threw in its place;
- a namespace member's call now names its namespace to the wrapper, so only the allowlist's own namespaces (`JSON`, `Math`, …) count as natives: a member that is Forma's own function would pass its errors through.

In happy-dom, `click()` and `dispatchEvent` hand a listener's exception back to their caller, which a browser never does: there, an exception a handler raised before its first step would be filed as the `click()`'s. That is a unit-test artifact; in Chromium a listener's exception is the page error it is, and the handler that clicked is not blamed.

**"Markup cannot throw out of `mountMarkup`" is still not a guarantee** (FORMA-274's decision). The FORMA-274 matrix runs every directive, and each way an expression hands a value to the runtime, a native or a DOM method (85 bodies, 15 of them handlers, one of which writes the value as a key onto an array), with each of 48 hostile T2 values (nested 10,000, 101 and 100 deep, a string past 1 MiB, 300,000 numbers, odd numbers, radix and digit extremes, empty and invalid names and selectors, script URLs, `__proto__`, own `toString` and `valueOf` keys, a dictionary with them, the key `toString`, records), at mount, at event time, on later values and through `update()`: in happy-dom and in Chromium 156 nothing throws out of `mountMarkup`, no handler raises an uncaught page error, nothing rejects unhandled, and every diagnostic has a `FORMA_E_` code; in happy-dom, where the test can watch it, no later run reaches `onError()` either. The expression grammar's own depth limits held for 4,000-character chains of `!`, `-`, `typeof`, parentheses, array literals and `if`, in happy-dom and in Chromium 156, Firefox 157 and WebKit 27.2. But the nesting of the markup is not bounded: a `data-list` nested a few hundred levels deep still overflows the stack, and *Known gaps* lists that and what else remains. So the claim stands for values and expressions, not for markup in general, and the probes guarding it stay `correctness`.

Verified by: `src/expr/__tests__/native-throw.test.ts` > "no allowlisted native throws a raw exception, whatever plain data it is given, and these are the ones that refuse"
Verified by: `src/expr/__tests__/native-throw.test.ts` > "the message names the method and the error, and is bounded"
Verified by: `src/expr/__tests__/native-throw.test.ts` > "code an application put in reach and a native runs is converted: a toString of a value in state, an override of an element method"
Verified by: `src/expr/__tests__/native-throw.test.ts` > "a real bug in an arrow callback passes through as it is"
Verified by: `src/expr/__tests__/native-throw.test.ts` > "a runtime magic is Forma code, not a native: what it throws passes through as it is"
Verified by: `src/expr/__tests__/native-throw.test.ts` > "a real bug in an evaluation a DOM method runs (a handler a click() dispatches) passes through as it is"
Verified by: `src/expr/__tests__/native-throw.test.ts` > "a budget refusal inside a callback keeps its defer, so it still waits for a later task"
Verified by: `src/__tests__/runtime-native-throw.test.ts` > "one native that throws costs one binding: every directive reports on its own element and the rest of the module works"
Verified by: `src/__tests__/runtime-native-throw.test.ts` > "a real bug in code a native runs is rethrown, not filed as the native failing"
Verified by: `src/__tests__/runtime-native-throw.test.ts` > "a native that throws is final: it arms nothing, and what it was charged before it ran stays on the task's meter"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "a data-bind: or data-class: with no name is refused at bind time with FORMA_E_UNSUPPORTED, and the rest of the module mounts"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "a write the browser refuses is reported on its element, at mount and on a later run: %s"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "what a write is handed is checked and charged before it is written, so the write itself is all the wrapper catches"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "is refused with FORMA_E_CALL_FAILED before anything converts it, where it threw a TypeError out of mountMarkup and the handler"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "an object of the application with its own toString function still converts, and what that function throws is the native call that threw"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "a dictionary with a toString key still serializes, persists, renders as a row and travels as $dispatch detail"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "the same dictionary is refused where it would be converted, at any depth of an array, never as an object member"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "an array a handler gave its own toString is refused wherever it is converted"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "%s is reported on its element as FORMA_E_CALL_FAILED, not thrown to the event"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "the rejection is reported on the element, not left unhandled"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "%s is reported as FORMA_E_CALL_FAILED, not a TypeError out of the handler"
Verified by: `src/expr/__tests__/native-throw.test.ts` > "what a native throws that cannot be converted to text is still reported, named as unprintable"
Verified by: `src/expr/__tests__/native-throw.test.ts` > "a namespace member is a native only if the namespace is the allowlist's own: a runtime magic's member passes what it throws through"
Verified by: `src/expr/__tests__/native-throw.test.ts` > "happy-dom's click() hands a listener's exception back to its caller, where a browser reports it: the step rule keeps Forma's own as Forma's"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "every directive given %s: nothing throws out of mountMarkup, an event or a later run, and every failure is coded"
Verified by: `src/__tests__/runtime-throw-paths.test.ts` > "the grammar's own depth limits hold for 4,000-character chains: each is a coded FORMA_E_LIMIT, never a stack overflow"

In Chromium, `e2e/native-throw.spec.ts` checks the DOM methods that throw only in a browser (`classList.add('')`, `classList.add('a b')`, `classList.toggle('')`, `classList.replace('', 'x')`): each handler reports a coded diagnostic, and no uncaught page error reaches the page. It also checks FORMA-274's browser-only cases (an empty `data-class:` name, `$el.dataset['a-b'] = 1`, the rejected `scrollIntoView`), the stack bounds, that a dictionary with a `toString` key still serializes, persists, renders as a row and travels as detail while an array given one is refused where converted, the browser's side of the `click()` artifact, and runs the FORMA-274 matrix: no `mountMarkup` throw, page error or unhandled rejection.

### Residual risks

- **`toString` coercion.** Rendering a value as text, interpolating it into a template literal, or `Array#join`-ing it calls that value's `toString`. JSON data cannot supply a function, but it can shadow `toString` with a value that is not one (`{"toString": 1}`), and a handler can write one onto an array; converting such a value threw. It is refused where it would be converted, arrays included, and never where it is serialized or handed on as data (FORMA-274, *Failure is always visible*). A few natives are charged as if they converted an argument they only read (`Array.of`, an options object of `scrollIntoView` or `focus`, a `force` argument, `JSON.parse`'s reviver), and `list.join()` checks the array's own `toString`, which `join` does not call: such a value is refused there too. An app that puts class instances, or objects with their own `toString` function, into state supplies the method itself; it is then the app's own code, not the attacker's, under T2. What that function throws is reported when a native or the runtime's `data-text` converts the value, and escapes as before when an operator or `data-bind:` does.
- **An expression is still code.** Under T1 the grammar bounds what an injected expression can *do* — no globals, no network, no DOM outside the allowlist, no non-termination — but it can still read and write the declared state of the scope it was injected into, and call the DOM methods on the allowlist. Never build a `data-*` attribute from user input.
- **Expression budget configuration.** The application can raise a mount's step budget through `config.exprBudget`; it remains responsible for the admitted work. A script tag's `data-forma-expr-budget` is ignored and grants no authority.
- **What a tiered mount does not bound.** `$dispatch` events (other than the activation events `navigate` covers) bubble out of the root to the host's listeners, which is how a widget talks to its host: a listener treats their type and `detail` as the widget's data. `focus()` and `scrollIntoView()` act on elements inside the root but move the page's focus and scroll. `data-persist` reads and writes the origin's `localStorage` under `forma:<key>`, shared with every other mount and page that persists the same key. A local selector can learn a bounded number of bits about the page around its element through state the element inherits (`:disabled` under a disabled `fieldset`, `:read-write` under `contenteditable`) or its position among its siblings, never a value. Loading the 3.0 runtime never binds markup outside a handed root.

### `fetch` in the HTTP module

`@getforma/core/http` uses the browser's native `fetch` API for `createFetch`, `createSSE`, and `createWebSocket`. This is opt-in — it is not included in the main `@getforma/core` entry point.


## Security Hardening (v0.5.0 – 2.0.0)

- **`$el` safe proxy** (0.7.0, superseded): allowlisted `$el` reads through a Proxy. Superseded by the host-wrapper model above, which applies the same discipline to `$event` and `$refs` — the two the Proxy did not cover.
- **`findBlockedMethod`** (0.7.0, removed): a static scan for `constructor`, `__proto__`, `eval` and `Function` in expression text, including bracket concatenation. Removed with the evaluator it guarded; a string scan cannot see `items[k]` where `k` arrives from server JSON, and the allowlist interpreter checks the evaluated key instead.
- **Allowlist AST expression interpreter** (unreleased): replaced the regex parser and the `new Function` fallback outright — see *Supply Chain Security Notes* above.
- **SSR `escapeAttr` + scheme detection** (1.0.10): Escapes `<`, `>`, `'`, `"`, `&`. `isDangerousUrl` blocks `javascript:`, `vbscript:` and `data:text/html` in URL-bearing attributes, **normalizing away the whitespace/control characters browsers ignore in a scheme**, so `java\tscript:` is caught too. Attribute names are validated and `on*` handler attributes are dropped case-insensitively. Applies to the `data-bind:*` and `data-list` runtime sinks in both builds, and since FORMA-276 to an attribute that a mount's `update()` changes on an element it keeps, and to the unreviewed tier's strip.
- **CSP parser operator precedence** (0.7.1): Fixed to match JavaScript semantics (addition before comparison, AND before OR).
- **RPC argument sanitization + CSRF mitigation + authorization hook** (1.4.0): see the RPC section below.
- **Client/SSR sink parity, `data:image/svg+xml` context rule, store prototype guard, tag-name validation** (unreleased): see the URL scheme posture below and `CHANGELOG.md`. The reconciler's update path joined the parity in FORMA-276. Markup a compiled or reviewed mount renders first is the application's admission of its own markup and is written as it is: *URL and handler attributes in each sink* below says what each sink does.

### URL and handler attributes in each sink

Each sink that checks an attribute applies the same check, `isUnsafeAttrWrite` in `src/security/url-safety.ts` (`is_dangerous_url` and `is_event_handler_attr` in the Rust walker). It refuses an `on*` handler attribute, and a URL attribute (`href`, `src`, `action`, `formaction`, `xlink:href`, `poster`, `background`, `data`) whose value has a script scheme: `javascript:`, `vbscript:` or `data:text/html` in any case, once the whitespace and control characters a URL parser ignores are taken out, and `data:image/svg+xml` except on an image sink. Markup is checked after the HTML parser has decoded its character references, so `&#106;avascript:` is the same case as `javascript:`. The table says which sinks check, and where markup is written as it is.

| Sink | URL attribute with a script scheme | `on*` attribute |
|---|---|---|
| SSR walker | not emitted | not emitted |
| `h()` (static and reactive props, `xlink:`), hydration adoption | not written | not written |
| `data-bind:*`, `{item…}` in a `data-list` row's attributes | removed | removed |
| `$el.setAttribute()` | refused, `FORMA_E_METHOD_DENIED` | refused, `FORMA_E_METHOD_DENIED` |
| `mountMarkup()` first render, tiers `compiled` and `reviewed` | written as the markup has it | written as the markup has it |
| `update()`, tiers `compiled` and `reviewed`: an attribute it changes on an element the diff keeps | removed (FORMA-276) | removed |
| `update()`, tiers `compiled` and `reviewed`: an element it adds, the content of a scope it replaces or resets, or the whole markup when it replaces the root's content (the root's keyed children share no `data-forma-id` with it) | written as the markup has it | written as the markup has it |
| tier `unreviewed`, first render and every update | removed and reported, `FORMA_E_UNREVIEWED_URL` | removed and reported, `FORMA_E_UNREVIEWED_HANDLER` |

The first render, and what an update writes as new, is the markup the application handed `mountMarkup()` as `trustedHtml()`: its admission, as for `setHTMLUnsafe()` (*Unsanitized HTML sinks* above). Untrusted data belongs in a binding, which checks it, and untrusted markup in tier `unreviewed`. The diff refuses what it would change, as h()'s reactive props refuse a new value, and says nothing, like the other sinks. A value the update leaves as it was is not written, so it is not checked again.

Verified by: `src/__tests__/renderer-contract.test.ts` > "drops every script scheme written to %s"
Verified by: `src/__tests__/renderer-contract.test.ts` > "drops every entity-spelled script scheme on %s"
Verified by: `src/__tests__/renderer-contract.test.ts` > "never writes %s as an attribute"
Verified by: `src/__tests__/runtime-tiered-mount.test.ts` > "a %s mount's first render keeps its markup's own attributes; an update that changes one on an element it keeps applies the URL and handler check"

In Chromium, the hostile-widget matrix (`e2e/hostile-widgets`) writes its URL payloads as static attributes through `update()` in four contexts, and `e2e/frame.spec.ts` checks that none reaches the preview frame's document, after a render and after an update.

### `data:` URL posture

`data:text/html` is blocked unconditionally. `data:image/svg+xml` is **conditional**, because the same value is inert in one sink and executable in another: fetched through an image sink (`<img src>`, `<image href>`, `<video poster>`/`src`, `<audio src>`, `<source src>`, the legacy `background` attribute) the browser decodes it in image mode where script never runs; loaded through a document sink (`<iframe src>`, `<object data>`, `<a href>`, `<use href>`) it is parsed as a document and an `onload=` inside it fires.

So: **allowed for image-context sinks, blocked for document-context sinks, and blocked when the sink is unknown** — a call site that forgets to pass the element tag gets the strict answer.

`srcset` is deliberately not scheme-checked: its value is a comma-separated candidate list with descriptors that a single scheme test would mis-parse, and every candidate is fetched in image mode.

Verified by: `src/security/__tests__/url-safety.test.ts` > "allows data:image/svg+xml for image-context sinks"
Verified by: `src/security/__tests__/url-safety.test.ts` > "blocks data:image/svg+xml for document-context sinks"
Verified by: `src/security/__tests__/url-safety.test.ts` > "blocks data:image/svg+xml when no tag is supplied"

### Island props

Compiled SSR island state is read from the first head block once per Document,
with a 1 MiB UTF-8 cap. Each instance receives a fresh projection of its declared
schema: undeclared and forbidden keys never reach component props, including in
nested objects and array elements. Identity and schema checks complete before
any requested component or trigger runs. Legacy inline and shared-spill channels
are refused. `sanitizePropsDeep(props)` remains a standalone iterative utility
for other data paths; it is not the state decoder or a schema bypass.
It mutates in place and throws `TypeError` if a forbidden own key cannot be
deleted. The input may already be partially modified when it throws and must
not be used as sanitized data. Harmless frozen data is accepted.

Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "island activation projects only declared safe fields at every depth for both instances"
Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "standalone sanitization still strips props nested 10,000 deep"
Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "sanitizePropsDeep strips forbidden keys at every depth"

### Store prototype-pollution guard

`createStore` refuses `__proto__`, `constructor` and `prototype` writes through both `setState` and the proxy's `set` trap, so untrusted JSON cannot replace the store's prototype and forge fields the app never defined.

**What is not covered:** `Object.setPrototypeOf(state, x)` and `Object.defineProperty(state, …)` have no traps and are not intercepted. Both are explicit API calls in your own code, not shapes a JSON payload can forge.

Verified by: `src/state/__tests__/store-proto-hijack.test.ts` > "setState with a __proto__ key does not replace the store prototype"
Verified by: `src/state/__tests__/store-proto-hijack.test.ts` > "assigning __proto__ directly on the proxy does not replace the prototype"

## Known gaps

Stated here rather than left for a reader to discover:

- **An expression is still code under T1** — the grammar bounds what it can reach, not the fact that it runs. See *Residual risks* above.
- **A compiled or reviewed mount writes its first render as the markup has it.** Its URL and handler attributes are not checked there, nor on an element an `update()` adds; only an attribute the update changes on an element it keeps is (FORMA-276). This is the application's admission of its own markup, not a sanitizer: *URL and handler attributes in each sink* above.
- **The nesting of the markup is not bounded, so markup can still throw out of `mountMarkup`** (FORMA-274). A `data-list` pass binds its new rows as it builds them, so a list in a row renders inside the outer list's pass and the stack grows with each level: in Chromium 156 a `data-list` nested 1,000 levels (as the parser builds it, at most 512 elements deep) overflowed the stack out of `mountMarkup`, and 500 levels with a few directives a row. Binding nested lists also costs more than linearly in their depth (each level binds its template's elements against the row before they are lifted out): in happy-dom 14 levels took 0.4 to 0.7 s, before FORMA-274 as after it, so markup nested that deep hangs before it overflows. Neither is from a value or an expression; both are left for a follow-up.
- **A binding's later run that throws something other than an expression error reaches `onError()` only**, and the console in a development build; in production it says nothing. FORMA-274's matrix found none from a value, but the markup can still make one: a `data-if` on the root of a `data-list` row removes the row from the list's own record, and the next change to the list throws `NotFoundError` inside its pass.
- **In happy-dom (unit tests only)** `click()` and `dispatchEvent` rethrow a listener's exception, and the parser does not cap nesting at 512 as browsers do: 500 nested `data-list`s overflow Node's stack there.

- **Modifier syntax the FORMA-269 check does not recognise still binds a dead handler, with no diagnostic.** The check refuses only a key event with a dotted suffix and an event whose first suffix is one of the Vue and Alpine modifiers docs/HTML-RUNTIME.md lists. These still listen for their literal name, which never fires:
  - a first suffix that is not in the list: `click.foo`, `click.foo.stop`;
  - an empty first suffix: `click.`, `click..stop`;
  - Alpine's `.camel` and `.dot` (`data-on:custom-event.camel`);
  - Datastar's `__` syntax (`data-on:click__prevent`).

  Svelte's `data-on:click|preventDefault` stays one attribute in Chromium, `data-on:click|preventdefault`, and its handler never runs on a click.

  Verified by: `src/__tests__/runtime-event-modifiers.test.ts` > "modifier syntax the check does not recognise is not detected: it listens for its literal name, with no diagnostic"

  In Chromium, `e2e/event-modifiers.spec.ts` checks the Svelte form.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 3.0.x | Current unified major; Critical and High security fixes under the stack policy. |
| 2.x | Maintenance line; Critical and High fixes through the date in the stack policy. |
| < 2.0 | No |

The [stack security policy](../../SECURITY.md#supported-versions) is the
authoritative support schedule and response target for published releases.
Its dates derive from the original publication records.
