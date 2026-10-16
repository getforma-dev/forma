# Lazy HTML prototype correctness qualification

The candidate allocates an HTML prototype when its tag is first requested, then
clones the cached prototype for later requests. It removes the eager allocation
of 40 unrelated tags. The existing per-module cache is initialized before native
creation, and the final successful lookup/assignment path is retained.

This evidence qualifies the bounded correctness slice, not runtime speed or the
Forma 3 release. No decoder or mobile performance campaign ran on this candidate.
The 12 ms decoder and 50 ms mobile requirements remain unresolved; no threshold,
error assertion, CSP policy, timeout or retry rule was relaxed.

## Exact source and products

Base: `cf869f8302ea0a07d144f39b808a8452485df970`.

| Commit | Change and actual scope |
| --- | --- |
| `dc43901dcb3cd44d927b44067775bf7767920343` | Lazy native prototype allocation and fresh-module controls; finite checks and core types |
| `24a6c0b0157baa434524ffc8431041ebb1b3854b` | Real-browser state-isolation control and factual changelog; core/typed product build and five size caps |
| `fe2ba420a6e7e382eb8b18a6c96d3e6be76a9efa` | Fixture-only debug/release binary selector and documentation; actual headers and final 81 browser cases |

Only `e2e/fixtures/apps/apps.spec.ts` and its README differ between the last two
heads. `product-release-profile/fixture-selector-source.json` and
`source-deltas/fixture-profile-source-proof.json` identify that exact delta.
Production core, compiler, build and native source remain unchanged. The final
run reauthenticated all 80 core artifact files and 323 compiler/build/typed
artifact files from the original build; their manifests are retained in
`../../archive/forma-191-lazy-prototype/product-gate-first/`. Only the ordinary
release-profile `fixture-fauth` binary was newly compiled. Finite checks are not
relabeled as executions on the later fixture-only commit.

Node 24.22.0, Playwright 1.64.1, Cargo jobs 3, Vitest maximum workers 2 and
Playwright workers 2 were explicit. Dependency installation used the unchanged
lock with scripts disabled. `source.json` authenticates the current reviewed
source and lock; raw `provenance.json` and executed wrappers retain exact commands,
paths, environment allowlists and timestamps.

## Finite checks and actual builds

The corrected fresh-module suite passes 51/51. Against the original eager runtime,
those identical controls fail in the intended 49 cases and pass the other 2. The
original test version also exposed a separate Happy DOM `option.defaultSelected`
assumption; both original outcomes and its narrow correction are preserved.
The seven existing suites cover element behavior, namespaces, adoption,
conditional generations, listener installation and list disposal: 119/119 pass.
The combined eight-file run passes 170/170; core type checking passes.

The actual core build and all five gzip caps pass without a cap change:

| Artifact | Actual bytes | Cap |
| --- | ---: | ---: |
| Core entry | 48,085 | 48,294 |
| Browser ESM | 48,240 | 48,448 |
| Runtime | 39,140 | 41,500 |
| Hardened runtime | 37,596 | 40,500 |
| Frame runtime | 38,618 | 40,000 |

The typed SSR and fauth products were built with the actual compiler/native path.
Fauth route sizes are login 26,213, onboarding 26,205 and benchmark 27,567 bytes,
all within the existing 28,000-byte N2 limit. No size result is a timing result.

## Fixture profile and complete browser result

Two prior loader failures occurred before browser execution. The corrected CJS
wrapper's collection-only commands selected exactly 51 + 12 + 3 + 15 cases.
The first actual fauth run then produced 40 passes, 1 WebKit failure and 10
unexecuted serial cases because the debug native server emits an endpointless
Report-Only policy warning. All first results are archived, including that error.

The new fixture selector defaults to `debug` and accepts only `debug` or `release`.
A direct invalid-value collection control refuses with `invalid
FORMA_FIXTURE_PROFILE`. Existing test bodies and browser-error checks are
unchanged. The release binary is built explicitly with:

```sh
CARGO_BUILD_JOBS=3 cargo build --quiet --locked --release --manifest-path e2e/fixtures/apps/Cargo.toml --bin fixture-fauth
```

The actual owned debug and release servers returned the complete same enforced
CSP after only per-response nonce normalization. The debug Report-Only header was
exactly `require-trusted-types-for 'script'; trusted-types forma forma-runtime`;
the release response had no Report-Only header. Raw HTML/headers and both binary
hashes precede the assertions in `product-release-profile/`; the full policy and
comparison are in `header-comparison.json`. No header or error was filtered.

The final commands select `FORMA_FIXTURE_PROFILE=release` and pass all cases,
with zero skips, retries or unexpected results:

| Existing or added control | Chromium | Firefox | WebKit | Total |
| --- | ---: | ---: | ---: | ---: |
| Typed fauth login/application behavior | 17 | 17 | 17 | 51 |
| Native namespace and callback controls | 4 | 4 | 4 | 12 |
| Typed conditional disposal | 1 | 1 | 1 | 3 |
| Core regressions including fresh template/form/option/custom state | 5 | 5 | 5 | 15 |
| Total | 27 | 27 | 27 | 81 |

Actual launched browser versions: Chromium 156.0.8078.4, Firefox 157.0 and
WebKit 27.2. Reports, exact commands and the browser version/executable inventory
are preserved. The 300-second supervisor retained live PID/start-identity
ancestry and normal cleanup evidence; no owned process remained.

## Behavioral scope and remaining work

This intentionally changes `document.createElement` call counts/order and the
observability of unused native prototype creation through monkeypatches or
custom element constructors. An unused tag now captures a later global document
when first requested. The existing per-module cache and same-tag recursive
constructor behavior are retained; there is no per-Document cache redesign.
Fresh-module controls cover cross-tag reentry, throwing native creation recovery,
all former builtins, uncommon/custom tags, namespaces, adoption and script refusal.
Real browsers independently cover mutable option/template/form state and distinct
custom element instances; existing login/disposal suites cover broader behavior.

The old CPU profile motivated a source hypothesis only. Its cost is not assigned
to this toolchain or these runs, and no timing improvement is claimed. Full hosted
CI, independent final review and later release qualification remain separate.

`SHA256.json` inventories every file in this evidence directory except itself.
The independent archive manifest authenticates every earlier source/log separately.
All summaries were completed before these manifests were frozen.
