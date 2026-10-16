# Fauth WebKit gate: retained failure and source findings

Source remains24a6c0b0. Actual first browser gate is `tmp/product-browser-cjs/fauth-three-engines.{log,json}`:40passed,1failed,10serial cases not run. The only reported failure is the existing verify-page.mjs browser-error assertion: WebKit's console describes `require-trusted-types-for 'script'; trusted-types forma forma-runtime` delivered report-only without report-to. This shows the browser observed that policy warning. The invocation did not persist a complete HTTP response-header map, so a fresh direct owned-server header capture is still required before claiming a complete response comparison. No test, error filter or policy has changed.

## Exact existing seams

- `e2e/fixtures/apps/apps.spec.ts:26` selects CARGO_TARGET_DIR or ordinary e2e/target; line53 hardcodes its `debug/fixture-fauth` child path. The run used the normal `e2e/target/debug/fixture-fauth` just built by Cargo, not a release binary. `FORMA_FIXTURE_PORT_BASE` was unset, so every owned server bound port0. Its command/binary hash are preserved in retained-products-proof.json.
- `e2e/fixtures/apps/build.sh:34` runs cargo build without --release. The fauth source lane is currently documented/implemented as debug, and no supported profile selector exists in apps.spec.ts. It would be inaccurate to call a release selector an already-existing fauth harness feature.
- `crates/forma-server/src/csp.rs:266-277` explicitly documents this endpoint-less report-only policy as development-only and its known WebKit console behavior; report_only_policy returns it only under cfg(debug_assertions). A release build emits no such endpoint-less report-only header. `csp.rs:669-672` retains configured/relaxed cases separately.
- `crates/forma-server/src/response.rs:157-162` always writes the enforced policy, then additionally writes Report-Only if present. Removing a development-only report-only header by using actual release compilation does not remove enforced Trusted Types.
- The distinct typed SSR site already has FORMA_SSR_PROFILE=release documented in `e2e/ssr/build.sh:16-18`. It now also has a real reporting receiver (`e2e/ssr/README.md:5`). Neither fact gives fauth an existing release selector; they show the intended production/server distinction, not proof of this failed response.

## Proposed narrow repair and proof, not executed

Prefer an explicit fixture-only selector over copying a release binary into a misleading debug path. Add `FORMA_FIXTURE_PROFILE` to apps.spec.ts, allow only debug/release, default debug, and select TARGET/PROFILE/fixture-name. No test-body, deadline, console filter, CSP server code or public package changes. Document the optional release command in the fixture README. The existing default R17 behavior stays debug.

After source review and a free lane:
1. Preserve current debug binary/hash and all products. Start that exact binary on owned port0 once, fetch the actual configured login path from apps.json, save the complete actual response headers/body hash, and close the child. No browser.
2. Compile ONLY the same fixture-fauth native source via `cargo build --quiet --locked --release --manifest-path e2e/fixtures/apps/Cargo.toml --bin fixture-fauth`, jobs3, ordinary e2e/target. No core/compiler/builder re-run or JavaScript/IR mutation.
3. Capture the release response in the same owned way. Require enforced Trusted Types and same enforced policy directives (normalizing only the per-response nonce for comparison); require the exact debug report-only policy and its release absence, not a generic policy bypass. Preserve both binary/product/source hashes and raw headers.
4. With `FORMA_FIXTURE_PROFILE=release`, run the same51 fauth cases, then the three previously unexecuted commands (12namespace,3conditional,15core). Exact original assertions/timeouts/workers2 remain; no failure suppression. All failures stop the next stage and remain durable. This is explained configuration qualification, not a performance retry.

No new source change, native/server/browser invocation, header capture or retry has run for this proposal. Both original wrapper failures and actual40/1/10 remain distinct.
