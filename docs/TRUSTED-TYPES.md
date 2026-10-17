# Response and Trusted Types contract — 3.x staging

This is the development contract, not a release announcement or a claim that applications have migrated. Upgrade the coordinated package set and follow [compatibility](compatibility.md) and [declared props](DECLARED-PROPS.md) before deploying.

## Server migration

Return `PageResponse` directly as the framework response. Its HTML, nonce and headers are private; the named `into_parts_unchecked()` exit is the only way to split the response and is governed by the raw-entry lint. Normal responses keep `Cache-Control: no-store`, their nonce-bound policy and document headers together.

`PageOutput`, `render_page` and `render_page_with_nonce` are removed. Bind a `PageHandle<P>` at startup and call its checked `render(&props, &RenderCtx)` method. The renderer draws the nonce; no public page-render operation accepts one from the caller. The interim `try_render` and strict tuple-loader bridges are also removed. Call `load_ir_modules`, bind every SSR route, and call `Pages::finalize` before opening the application's listener.

`PageConfig::config_script` is removed. Code belongs in the bundle; request data belongs in declared props, or the retained `config_json` channel, whose serializer escapes `<` so data cannot end its script element. For an SSR prefix, pass an explicit `RawHtml::trusted(value)` to `RenderCtx::with_body_prefix`; a string does not satisfy that API. For explicit Browser documents, `PageConfig::body_prefix` still borrows the typed value. This constructor records a reviewed raw entry, not sanitization. Typed head links and preloads remain available without a raw prefix.

## Client migration

Use text children and normal attributes for data. For deliberately reviewed markup, call `trustedHtml(markup)` and pass the result to the raw API. The supported typed raw paths include `dangerouslySetInnerHTML`, `srcdoc`, `setAttr`, `setHTMLUnsafe`, `template`, `templateMany`, `mountMarkup`, and the returned handle's `update` operation. The runtime's former public `reconcile` export is removed. Strings, String objects and structural look-alikes are refused before conversion, cache mutation or a native sink. Null and false remain clear sentinels on raw props. Reusing a template or the internal reconciler cache does not bypass the check.

`h('script')` is refused, including case variants. Put executable code in the build's bundle. Native compilation enforces the same rule with BUILD-623, including literal and foreign-namespace script elements; this supersedes the earlier FORMA-139 literal-script allowance. Native srcdoc emission refuses BUILD-624 because string/declared props cannot carry the trustedHtml brand. Use a safe iframe src or a Browser-mode typed raw sink. Literal null/false remain omitted. The server's explicit trusted raw shell APIs and FMIR trusted-input contract are unchanged. Runtime `data-bind:srcdoc` and row srcdoc interpolation cannot carry a reviewed raw type, so they emit `FORMA_E_RUNTIME_SRCDOC` with binding context and leave srcdoc absent. The unreviewed tier retains its stricter `FORMA_E_UNREVIEWED_SRCDOC` refusal. Ordinary neighboring bindings and reused-row attributes continue updating; these forms never rely on an uncaught native TypeError.

## Enforced policy and explicit route relaxation

Every strict SSR page, browser shell and named preview frame includes these enforced directives in debug and release, with or without a reporting endpoint:

```text
require-trusted-types-for 'script'; trusted-types forma forma-runtime
```

The named frame policy keeps its existing sandbox, hash-only script and no-network overrides. The only `'unsafe-inline'` remains the separately named style-attribute directive. Browser-native Trusted Types support is distinct from Forma's always-active typed API checks.

For a route still being migrated, `PolicyExtensions::relax_trusted_types(reason)` removes only those two enforcement directives and keeps them in Report-Only. A nonblank reason is required and route/reason pairs are logged with bounded repetition; sibling routes remain strict. List the relaxation in the consumer's `forma-raw-allowlist.json` with owner, actual end date, reason and counted site, and run `npx forma-raw-lint --report raw-entries.json src crates` in that consumer's CI. The lint refuses missing, expired or malformed entries. Runtime does not read that file or enforce its dates, so omitting the CI check omits that governance. Applications without a reporting endpoint may have no A2 report history; review the relevant routes explicitly before removing the relaxation.

## What the shared mint guarantees

Any script on the page can call the shared `forma` mint and obtain a real TrustedHTML. The `trusted-types` directive controls policy names, not caller identities, and `trustedHtml()` does not sanitize its argument. Forma's own raw sinks require a minted value; the separate `forma-runtime` parser accepts only browser TrustedHTML under enforcement. Duplicate creation of an existing policy name is refused, while duplicate copies of Forma share the existing registry. Do not treat this as isolation from another script already running in the document.

## Evidence and remaining acceptance

`packages/core/e2e/trusted-types.spec.ts` runs the named policies as actual headers, records `securitypolicyviolation`, proves Report-Only reports and enforced native refusal with separate controls, and checks library raw refusals, F2 and the shared mint. Adoption and tiered-mount browser suites preserve positive rendering/updates. `scripts/core-raw-package.test.mjs` checks the actual packed declarations with `skipLibCheck: false`; Rust removal doctests and response/CSP tests check the server boundary. `packages/build/tests/raw-lint.test.ts` exercises each exit unlisted, listed by line/symbol, and expired.

P17 verifies both packed templates' actual enforced headers and zero CSP events during positive interactions; it is recorded separately from the native-policy control tests. Historical A2 template sources remain archived. The maintained templates already use typed Pages and explicit Browser APIs. Packing stages their dependency manifests and locks without rewriting application source, then verifies restoration of all ten source/manifest/lock files. FORMA-144 owns template qualification and FORMA-188 owns the fixture applications and complete payload-context acceptance. These checks imply no external application acceptance. Live publication remains gated.
