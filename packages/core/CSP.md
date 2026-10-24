# FormaJS & Content Security Policy (CSP)

FormaJS needs no `unsafe-inline` and no `unsafe-eval`, in **any** build. There is no switch that could change that: expressions in `data-*` attributes are evaluated by an allowlist AST interpreter, and **no shipped artifact contains `eval`, `new Function` or `with()`**. The opt-in fallback that used to exist has been deleted, not disabled.

The flagship example in [docs/HTML-RUNTIME.md](./docs/HTML-RUNTIME.md) — arrow-function callback and all — is served in CI under a real `Content-Security-Policy: script-src 'self'` response header, and the browser console is asserted to report zero violations.

Verified by `src/__tests__/runtime-csp-default.test.ts` > "no build can reach new Function, with any configuration"
Verified by `src/__tests__/runtime-csp-default.test.ts` > "never constructs a function, not even one that would have succeeded"
Verified by `src/__tests__/build-artifacts.test.ts` > "no build emits new Function or a with() scope wrapper"

---

## How It Works

Strict CSP headers block inline styles and scripts unless they carry a nonce:

```
style-src 'nonce-abc123' 'self';
script-src 'nonce-abc123' 'self';
```

FormaJS handles this in two ways:

**Scripts:** `<script>` tags rendered by `forma-server`'s page renderer include a `nonce` attribute. No inline event handlers are used — FormaJS attaches events via `addEventListener`, and an `on*` attribute is dropped in any casing on both the client and SSR paths.

Verified by `src/dom/__tests__/element-url-safety.test.ts` > "drops ONCLICK-cased string props instead of writing an inline handler"

**Styles:** The `h()` function applies styles via the CSSOM API (`Object.assign(el.style, ...)`) instead of `el.style.cssText` or `setAttribute('style', ...)`. CSSOM property assignment is not blocked by CSP — only string-based style injection is.

---

## Style Patterns — All CSP-Safe

```typescript
// Object style (always worked)
h('div', { style: { color: 'red', fontSize: '14px' } })

// String style (CSP-safe since v1.0.9)
// Internally parsed into individual properties via CSSOM
h('div', { style: 'color: red; font-size: 14px' })

// Reactive object style
h('div', { style: () => ({ borderColor: active() ? '#6366f1' : '#333' }) })

// Reactive string style
h('div', { style: () => `border-top: 3px solid ${color()}` })
```

All four patterns work under strict CSP. Internally, string styles are parsed by `parseCssString()` into property objects, then applied via `Object.assign(el.style, ...)`.

---

## What CSP Blocks (and FormaJS Avoids)

| Technique | Blocked by CSP? | FormaJS uses it? |
|-----------|-----------------|-------------------|
| `el.style.cssText = '...'` | Yes (`style-src` without `unsafe-inline`) | **No** — removed in v1.0.9 |
| `el.setAttribute('style', '...')` | Yes | **No** |
| `innerHTML` with `style="..."` | Yes | **Not for library-generated markup** — `h()` builds DOM with `createElement`/`textContent`. `innerHTML` is reached only through the explicit opt-in sinks: `dangerouslySetInnerHTML`, `setHTMLUnsafe()`, `template()` and `templateMany()`, `mountMarkup()` and its returned handle's `update()`, and the `srcdoc` attribute (the browser parses its value as a document), each of which takes `trustedHtml()`. See [SECURITY.md](./SECURITY.md#unsanitized-html-sinks) and [Trusted Types](#trusted-types). |
| `Object.assign(el.style, {...})` | No (CSSOM API) | **Yes** — all styles go through this |
| `el.style.color = 'red'` | No (CSSOM API) | **Yes** (via Object.assign) |
| `new Function(...)` | Yes (`script-src` without `unsafe-eval`) | **No** — an allowlist AST interpreter is used instead, in every build. There is no opt-in and no fallback; `scripts/verify-dist.mjs` greps every published artifact. |
| `eval(...)` | Yes (`script-src` without `unsafe-eval`) | **No** — same gate. |
| `with (scope) { … }` | No, but it defeats scope isolation | **No** — removed with the evaluator that used it. See [SECURITY.md](./SECURITY.md#why-an-allowlist-and-what-the-blocklist-it-replaced-could-not-do). |

---

## Common Issues

### "Applying inline style violates CSP directive"

**Cause:** Using a version of FormaJS before v1.0.9 that still uses `el.style.cssText`.

**Fix:** Update `@getforma/core` to v1.0.9+.

### "Refused to execute inline script"

**Cause:** A `<script>` tag is missing its `nonce` attribute. This happens if you inject scripts via `innerHTML`, create them with `document.createElement('script')` without setting the nonce.

**Fix:** Return forma-server's `PageResponse` from a typed `PageHandle::render` call. The renderer draws the nonce and attaches the document policy. Put code in the bundle and pass data as declared props or escaped `config_json`; `render_page`, caller-supplied nonces and `config_script` are removed in the staged 3.x contract. See [the migration guide](../../docs/TRUSTED-TYPES.md).

### "Refused to apply inline style" on `<style>` tags

**Cause:** A `<style>` tag is missing its `nonce` attribute. Forma-server's checked renderers add their nonce to the personality CSS `<style>` tag automatically. If you create `<style>` elements in JavaScript, they won't have nonces.

**Fix:** Use CSS classes instead of dynamic `<style>` injection. Or use `el.style.property = value` (CSSOM) which is not blocked.

### "An expression rendered nothing and the console says `data-forma-expr-error`"

**Cause:** The expression is outside the grammar, or it named something the allowlist does not offer. It was **not** evaluated, by design — the binding left the DOM alone rather than writing an empty string.

The `console.error` beside the attribute names the cause with a stable code and a column: `FORMA_E_SYNTAX` (the parser refused the text), `FORMA_E_UNRESOLVED` (an identifier that is not state, not a magic and not one of the frozen namespaces — `document`, `window` and `fetch` land here), `FORMA_E_METHOD_DENIED` / `FORMA_E_PROPERTY_DENIED` (not on the allowlist for that receiver), `FORMA_E_CALL_DENIED` (a call whose target is not an allowlisted callable: a value held in state, or a method passed as an argument), `FORMA_E_CALL_FAILED` (an allowlisted call whose native threw on its arguments, `JSON.parse('{')` or `(1).toFixed(500)`; the message names the method and the error), `FORMA_E_KEY_DENIED` (`constructor`, `__proto__`, `call`, …), `FORMA_E_ASSIGN_DENIED` (unknown or read-only target), `FORMA_E_UNSUPPORTED` (parsed, but outside the grammar: an arrow function anywhere but a callback's first argument, a block body, destructured parameters, a computed object key, a handler statement that is not an assignment, an update, an `if` or a call, and a `data-on:` name in another framework's modifier syntax, such as `click.stop` or `keydown.enter`), `FORMA_E_LIMIT` / `FORMA_E_BUDGET` (a parse or evaluation budget), and under a tiered mount `FORMA_E_GRANT_DOM` / `FORMA_E_GRANT_NAVIGATE` (a grant the mount does not give; see [docs/HTML-RUNTIME.md](./docs/HTML-RUNTIME.md#mounting-markup-you-did-not-write-tiers-and-grants)).

**Fix:** Rewrite it within the grammar (see [docs/HTML-RUNTIME.md](./docs/HTML-RUNTIME.md), *The expression grammar is an allowlist, not a blocklist*) or precompute the value server-side. There is no fallback to opt into: adding `'unsafe-eval'` to your policy will not make it run, because FormaJS has no code path that would use it. Call `getDiagnostics()` for the full list, or listen for the `formajs:diagnostic` event.

---

## Server Configuration (forma-server)

`forma-server` generates strict CSP headers automatically via `build_csp_header()`:

```
default-src 'none';
script-src 'nonce-{random}' 'self';
style-src 'nonce-{random}' 'self';
connect-src 'self';
img-src 'self' data:;
font-src 'self';
frame-ancestors 'none';
base-uri 'none';
form-action 'self'
```

Every page render generates a unique cryptographic nonce. Scripts and the personality `<style>` tag get this nonce. Everything else must come from `'self'` (same origin).

The preview frame's document is the one place a script is allowed by hash, not by nonce: forma-server writes `formajs-frame.global.js` inline into that document (`PageResponse::frame`), and the document's policy names the script's SHA-256 (`script-src 'sha256-…'`) with no `'self'`, so the opaque-origin frame runs exactly that runtime and nothing a module could add. Styles there are allowed by nonce, which the hash-allowed runtime has none of to give a `<style>` element, so a module styles itself with `style` attributes only. The runtime is built so its hash holds: one classic script, byte-identical from build to build, with no `</script`, `<!--` or source map comment (see [docs/HTML-RUNTIME.md](./docs/HTML-RUNTIME.md#mounting-markup-you-did-not-write-tiers-and-grants), *The preview frame*).

Verified by `src/__tests__/runtime-frame.test.ts` > "the frame runtime is one classic script a server can inline as it is"
Verified by `src/__tests__/runtime-frame.test.ts` > "two builds of the frame runtime are byte-identical"

**This header is satisfied by every build.** The hardened artifact is no longer a stronger guarantee — it is the same runtime, bundled without code splitting — so pick either on size and packaging grounds alone.

**Do not add `unsafe-inline` or `unsafe-eval`.** FormaJS is designed to work without them.

Note that `img-src 'self' data:` above permits `data:` images. FormaJS matches that posture: `data:image/svg+xml` is allowed only for image-context sinks (`<img src>`, `<video poster>`, …) and blocked for document-context sinks (`<iframe src>`, `<object data>`, `<a href>`, `<use href>`), where the browser would parse it as a document and run script inside it.

Verified by `src/security/__tests__/url-safety.test.ts` > "allows data:image/svg+xml for image-context sinks"
Verified by `src/security/__tests__/url-safety.test.ts` > "blocks data:image/svg+xml for document-context sinks"

---

## Trusted Types

A policy carrying `require-trusted-types-for 'script'` makes the browser refuse
a string written to an HTML sink (`innerHTML`, a `<template>`'s `innerHTML`, an
iframe's `srcdoc`, `insertAdjacentHTML`, …) or a script sink (an `on*`
attribute, a script's `src`) unless a Trusted Types policy the page allows made
it. forma-server 3.x includes both directives in every enforced document policy:

```
Content-Security-Policy: …; require-trusted-types-for 'script'; trusted-types forma forma-runtime
```

This applies in debug and release, with or without a reporting endpoint. A
route may use the named `relax_trusted_types(reason)` exit; it removes only
these enforced directives and retains them in Report-Only. The nonblank reason
is checked at runtime; owner and end date are checked by the consumer's SR8
`forma-raw-lint` allowlist in CI, not by a runtime calendar.
`forma` and `forma-runtime` are core's two policies:

- **`forma`** makes what `trustedHtml(markup)` returns, the one raw-HTML entry
  ([docs/API.md](docs/API.md#trustedhtml-the-one-raw-entry)). Every raw sink
  writes a `trustedHtml()` value as the `TrustedHTML` it is, so the page
  accepts it. Core refuses strings and look-alikes with stable codes before
  the browser sink, regardless of whether native Trusted Types is available.
- **`forma-runtime`** belongs to the internal parser used by the public
  `mountMarkup()` and returned `MountHandle.update()` APIs. Internal
  reconciliation trims trusted markup before parsing, so browser `TrustedHTML`
  is minted again, trimmed, through this policy. A changed iframe `srcdoc`
  within that trusted markup uses the same policy. Plain strings are refused
  before parsing and are never minted; reconciliation is not a public export.

Both pass markup through unchanged: what they enforce is that a raw entry is
named. Each is created once per page, on first use, since an enforcing page
refuses a second policy of one name, and every copy of core on the page (the
runtime's IIFE beside core's ESM build, say) shares it through a registry on
`globalThis` under the key `@getforma/core#trusted-types`. The registry holds
no policy: it holds the mint `trustedHtml()` is, so a script that reaches the
key can mint `forma` values as `trustedHtml()` can (SR8's lint lists the key
as a raw entry), and a `forma-runtime` parser that takes only a browser
`TrustedHTML`, so on an enforcing page no script can mint a `forma-runtime`
value from a string.
If the page refuses either name (it is not listed, or another script created
it first), core writes markup as a string, which the page then refuses, and a
development build logs `FORMA_W_TT_POLICY_REFUSED` once.

What core writes of its own passes such a policy:

- `mount()`, the function it returns, and a reactive `dangerouslySetInnerHTML`
  that becomes `null` empty an element with `replaceChildren()`, which no
  policy checks.
- `mountMarkup()` and its returned handle's `update()` pass trusted markup to
  the internal `forma-runtime` parser. Reconciliation writes no `on*` attribute
  or script `src`: a changed one is removed, as h() and adoption write no `on*`
  name either, and since FORMA-276 neither a changed URL attribute with a
  script scheme, nor since FORMA-277 an SVG animation value with one
  ([SECURITY.md](./SECURITY.md#url-and-handler-attributes-in-each-sink)).
  Raw strings are refused before parsing or a cached-markup shortcut.

Raw APIs accept only named trusted markup. Runtime `data-bind:srcdoc` and
`{item…}` interpolation cannot carry that value, so both are refused before
the DOM sink with a coded diagnostic identifying the binding. Their neighboring
attributes continue to work; there is no uncaught native TypeError.

Under the header above, Report-Only and enforced, `e2e/trusted-types.spec.ts`
runs core's own test pages and every raw sink given `trustedHtml()`, including
a `reconcile()` diff that changes an iframe's `srcdoc` and a button's `onclick`,
and asserts zero violations; a string written to `innerHTML` raises one
report, and the page still renders under Report-Only. It runs in Chromium on
every merge, and in Firefox and WebKit before each release.

Verified by `src/dom/__tests__/trusted-html.test.ts` > "core's own writes raise no Trusted Types violation: mount, unmount, the null clear, and every sink given trustedHtml()"
Verified by `src/dom/__tests__/trusted-html.test.ts` > "reconcile() parses trusted markup through the forma-runtime policy and a string through no policy"
Verified by `src/dom/__tests__/trusted-html.test.ts` > "reconcile()'s diff mints a changed srcdoc of trusted markup and writes no on* or script src"
Verified by `src/dom/__tests__/trusted-html.test.ts` > "a string cannot enter reconcile after trusted markup populated its cache"
Verified by `src/dom/__tests__/trusted-html.test.ts` > "the shared registry holds no policy, and its forma-runtime handle mints nothing from a string"
Verified by `src/dom/__tests__/trusted-html.test.ts` > "trustedHtml() returns a TrustedHTML from the forma policy where the browser has Trusted Types"
Verified by `src/__tests__/runtime-srcdoc.test.ts` > "data-bind:srcdoc is refused with its binding code while neighboring attributes work"

---

## Testing CSP

Check the browser console for CSP violations. They appear as:

```
Refused to apply inline style because it violates the following
Content Security Policy directive: "style-src 'nonce-...' 'self'"
```

If you see this with FormaJS v1.0.9+, the issue is outside FormaJS — check for:
- `innerHTML` containing `style="..."` attributes
- `el.style.cssText = '...'` in non-FormaJS code
- Third-party libraries that inject inline styles

---

## Version History

The 3.0.0 row describes the prepared final source; publication remains pending.
The release record, not this source-history table, establishes publication.
It is not evidence that the package is available from a registry.

The last row carries the same label as `CHANGELOG.md`'s `## [Unreleased]`
heading, and moves to a version number when that entry does. A test pins both
ends of that rule: the newest row says `Unreleased`, and the row below it ends
at the version in `package.json`.

Verified by `src/__tests__/docs-truth.test.ts` > "CSP.md's version history ends at the shipped version, then Unreleased"

| Version | CSP Status |
|---------|------------|
| < 1.0.9 | String styles use `cssText` — **requires `unsafe-inline` in `style-src`** |
| 1.0.9 – 1.5.0 | All styles use CSSOM. Scripts need no `unsafe-inline`, **but the standard runtime shipped with the `new Function` fallback ENABLED**, so any expression outside the regex parser's grammar silently evaluated to `undefined` under a policy without `unsafe-eval`. |
| 2.0.0 | The regex parser and the fallback are **deleted**. Every build evaluates expressions with an allowlist AST interpreter — arrow-function callbacks, object literals, `$event`, bare method-call handlers and the frozen `Math`/`JSON`/`Object`/`Array` namespaces all run with no `unsafe-eval` — and anything outside the grammar is reported with a code and a column instead of silently dropped. **Fully CSP-safe, no `unsafe-inline` and no `unsafe-eval`, with nothing left to misconfigure.** |
| 2.0.1 | No CSP-affecting changes since 2.0.0. |
| 2.0.2 | No CSP-affecting changes since 2.0.1. |
| 2.0.3 | No CSP-affecting changes since 2.0.2. |
| 2.1.0 | Trusted Types: what core writes of its own passes `require-trusted-types-for 'script'; trusted-types forma forma-runtime` (its clears use `replaceChildren()`; the runtime's parser re-mints trusted markup through `forma-runtime`, and its diff of that markup writes no `on*` or script `src`), and every raw sink takes `trustedHtml()`, made by core's policy `forma`. Such a page reports only what the application writes as a string, the runtime's `srcdoc` bindings included. See [Trusted Types](#trusted-types). |
| 3.0.0 | Published: refuses plain strings at raw APIs and refuses `h('script')`; runtime srcdoc bindings report coded refusals. Forma-server enforces both Trusted Types directives without requiring a reporting endpoint. |
| Unreleased | Changes after the published 3.0.0 set will be recorded here. |
