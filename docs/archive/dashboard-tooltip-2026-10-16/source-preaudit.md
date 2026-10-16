# Forma 3.0.0 D14 source pre-audit

Status: **source pre-audit only; not D14 approval**

Reviewed immutable input:

- commit `227115703ba4fc6919ee89acfbeeb124a5de44bc`
- tree `2087e4bb97c913f3934bd002bb0af77a05849664`
- repository `getforma-dev/forma`
- reviewer invocation/model identity: the release lead explicitly selected this agent as `gpt-5.6-sol`; no provider receipt or session hash has been manufactured. The eventual `d14-review-evidence.json` must contain the actual retained session evidence supplied by the orchestration/runtime.

Review constraints: source inspection only. No build, test, install, browser, renderer, tag, publication, merge, or checkout mutation was performed. Files were read with `git show`/`git grep` against the immutable commit. Final D14 acceptance must review and bind the exact prepared RC version commit and its real qualification evidence.

## Blocking findings

### D14-PRE-001 — high — shipped dashboard violates its enforced Trusted Types policy and exposes an untyped HTML injection sink

Evidence:

- `packages/create-app/templates/dashboard/admin/src/pages/OverviewPage.tsx:103-118` assigns a JavaScript string template directly to `tooltip.innerHTML`; fetched API field `d.hour` is interpolated at line 107.
- `packages/create-app/templates/dashboard/src/main.rs:35-51` serves the dashboard with `forma_server::render_browser_shell`.
- `crates/forma-server/src/csp.rs:117-142` places `require-trusted-types-for 'script'` and `trusted-types forma forma-runtime` in every strict response.
- `scripts/release-template-islands.mjs:166-179` calls the dashboard interaction complete after clicking the Deployments navigation. It never exercises the Request Volume chart mousemove that reaches the sink.

Concrete failure:

- In Chromium, moving the pointer over the Request Volume chart reaches line 106. The enforced Trusted Types policy rejects a string assignment to `innerHTML`, producing a policy violation/TypeError and breaking the tooltip.
- In engines without Trusted Types enforcement, an API value such as `hour: "<img src=x onerror=...>"` is parsed as markup. The current mock endpoint returns fixed clock labels, but the shipped starter demonstrates and retains an unsafe pattern as soon as the endpoint is replaced with real data.

Disposition: release blocker. Replace the imperative string sink with DOM/JSX nodes and `textContent` for values (or a deliberately reviewed `trustedHtml` call only for constant markup), then add packed-template coverage that hovers the chart under the enforced policy and includes a hostile `hour` value. Re-review the corrected exact tree.

### D14-PRE-002 — high — native compiler/walker bypasses core's typed `srcdoc` raw-HTML boundary

Evidence:

- `packages/core/src/jsx.d.ts:14-19,243-246` types `srcdoc` as `RawMarkup`, the structural brand returned by `trustedHtml`.
- `packages/core/src/dom/trusted-html.ts:4-24` names `srcdoc` as a raw HTML sink and states that plain strings and lookalikes are refused in development and production.
- `packages/compiler/src/ir-walk.ts:1138-1149` special-cases only `dangerouslySetInnerHTML` as raw markup. It contains no `srcdoc` handling anywhere.
- `packages/compiler/src/ir-walk.ts:1151-1156` emits a declared string prop as `DYN_ATTR`; lines 1175-1183 emit a string literal as a static attribute.
- `crates/forma-ir/src/walker.rs:1708-1748` emits every valid attribute except `on*` and dangerous URL attributes. `srcdoc` is neither classified as a URL nor as a raw sink, so the walker HTML-escapes it into the attribute. The browser entity-decodes the value and parses it as a child HTML document.

Concrete failure:

- A native component containing `<iframe srcdoc={props.content}>` accepts declared request data as child-document markup on the server, while core's client `h()` path refuses the same plain-string value.
- A static source such as `<iframe srcdoc="<meta http-equiv=refresh content='0;url=https://evil.example'>">` is accepted into FMIR and becomes active child-document markup. Attribute escaping prevents outer-document breakout but does not make `srcdoc` text rather than HTML.

Disposition: release blocker. Refuse native `srcdoc` with a coded compiler diagnostic unless a deliberate cross-language trusted-raw representation is designed. Add static, declared-prop, function-valued and client parity/security fixtures. Re-review the corrected exact tree.

### D14-PRE-003 — medium — native compilation admits script elements that the public Browser runtime refuses

Evidence:

- `packages/compiler/src/ir-walk.ts:1029-1041` accepts every literal element tag, including `script`, then lines 1346-1360 emit an `OPEN_TAG` and its attributes. There is no script-element refusal on this path.
- `packages/compiler/src/html-context.ts:137-144` deliberately accepts literal children inside `script` and refuses only dynamic/reactive children with BUILD-620.
- `crates/forma-ir/src/walker.rs:1551-1567` accepts `script` as a valid element name; lines 1708-1748 emit its attributes. The native walker therefore serializes the compiled script element.
- `packages/core/src/dom/trusted-html.ts:268-272` refuses every case spelling of `h('script')` with `FORMA_E_SCRIPT_ELEMENT`.
- `docs/TRUSTED-TYPES.md:11,17` says executable code belongs in the bundle and that `h('script')` is refused. `packages/compiler/CHANGELOG.md:17` describes the existing script-construction refusal as retained.
- `packages/build/src/raw-lint-script.ts:1243-1246` can report `h('script')`/JSX script as a separately invoked raw-entry lint. The compiler/build lowering itself has no corresponding refusal; the lint is a distinct consumer CI command and cannot make direct compiler use fail closed.

Concrete failure:

- A native page source containing `<script>{'alert(1)'}</script>` is admitted into FMIR and serialized by Rust, while its Browser/client construction throws before producing the same element.
- In a standard forma-server response, the serialized authored script has no response nonce, so nonce-only `script-src` blocks it and records a CSP violation. The page neither follows the documented bundle-only rule nor preserves native/Browser behavior.
- Dynamic script children are separately refused, so this is not a claim that current request data reaches executable script. The defect is the admitted literal element and cross-renderer/CSP contract failure.

Disposition: release blocker. Add a coded compiler refusal for script elements before FMIR emission, covering HTML and foreign namespaces, and pin it with direct-compiler, build, native/Browser parity and packed strict fixtures. Re-review the corrected exact tree.

## Pending audit areas / provisional notes

- The generated TypeScript and Rust FMIR constants agree with `fmir-constants.json` for signature, layout, limits, sections, slot/schema types and opcodes.
- `scripts/release-audit.mjs` inventories every tracked regular blob and mode, requires a different provider/model identity string, hashes retained evidence, rejects critical/high non-resolved findings, and restricts post-audit RC changes to the audit gate plus documentation. This is gate plumbing, not an independent review by itself.
- The release workflow is tag-push-only, verifies an exact successful main push CI run and named required jobs, records/compares DS11, runs packed P17 before credential jobs, and uses trusted publishing paths. Final conclusions remain pending the exact versioned RC and real evidence.
- The reviewed package export maps remove `@getforma/core/server`, `/ssr` and `/wasm`; searches of active (non-archive/evidence) source found no retained server action, tuple loader, `try_render`, public render-mode, `PageOutput`, caller-nonce renderer or `config_script` API. The upgrade guide names the coordinated package move, removed subpaths and typed startup/response migration.
- `crates/forma-server/README.md:3-9` still presents alpha.2 as current and instructs exact alpha.2 dependencies. `crates/forma-ir/README.md:11-14,57-65` tells users to install 0.2.2 while calling alpha.2 current. `packages/core/README.md:10-17,55` still describes four repositories, links retired repositories, and recommends a 2.1.0 pin. These READMEs are registry-facing. `scripts/release-set.mjs:112-149` updates manifests, locks and template seeds but does not update README content. This is a prepared-RC blocker unless FORMA-145's manual documentation/version commit corrects it before the exact RC audit; the unprepared development commit is not being faulted merely for lacking the future RC number.
- No source-only conclusion is drawn from named test lists, historical evidence directories, or pending CI/P17. Actual qualification evidence must be authenticated and evaluated separately against the exact candidate it claims.

## Source pre-audit disposition

The immutable `227115703ba4fc6919ee89acfbeeb124a5de44bc` tree is **not acceptable as an RC source** while D14-PRE-001, D14-PRE-002 and D14-PRE-003 remain. This is not the final D14 decision: the prepared RC commit does not yet exist, the fixes have not been reviewed here, and real R17/P17/hosted CI/burn-in evidence has not been bound. Final D14 must enumerate every resolved finding, retain actual review/session evidence, cover the exact prepared RC tree, and distinguish source conclusions from measured qualification.

